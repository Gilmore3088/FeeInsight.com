/**
 * Hamilton Home / Executive Briefing — Server Data Fetcher
 * Assembles thesis + positioning data for the Home screen.
 * Per D-09: page uses ISR 24h revalidation to avoid repeated API calls.
 * Per D-11: signal/alert queries are NOT cached — fresh on every load.
 */

import { getNationalIndexCached, getSourcedInstitutionCount } from "@/lib/data-store/fee-index";
import { getSpotlightCategories } from "@/lib/fee-taxonomy";
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { sql } from "@/lib/data-store/connection";
import { generateGlobalThesis } from "./generate";
import { hasAnthropicApiKey } from "@/lib/ai-provider";
import { recordProRequest } from "@/lib/agents/run-store";
import type { ThesisOutput, ThesisSummaryPayload } from "./types";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";

// ---------------------------------------------------------------------------
// Signal/alert types (Plan 02 additions)
// ---------------------------------------------------------------------------

export interface SignalEntry {
  id: string;
  institutionId?: string | null;
  signalType: string;
  severity: string;
  title: string;
  body: string;
  createdAt: string;
  evidencePolicy?: HamiltonEvidencePolicy | null;
  providerCallQueued?: boolean;
}

export interface AlertEntry {
  id: string;
  signalId: string;
  institutionId?: string | null;
  signalType: string;
  severity: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  evidencePolicy?: HamiltonEvidencePolicy | null;
  providerCallQueued?: boolean;
}

export interface HomeBriefingSignals {
  whatChanged: SignalEntry[];
  priorityAlerts: AlertEntry[];
  monitorFeed: SignalEntry[];
}

export interface PositioningEntry {
  feeCategory: string;
  displayName: string;
  medianAmount: number | null;
  p25Amount: number | null;
  p75Amount: number | null;
  institutionCount: number;
  maturityTier: "strong" | "provisional" | "insufficient";
}

export interface HomeBriefingData {
  thesis: ThesisOutput | null;
  confidence: "high" | "medium" | "low";
  positioning: PositioningEntry[];
  spotlightCount: number;
  totalInstitutions: number;
}

function getCurrentQuarter(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  const quarter = Math.floor(month / 3) + 1;
  return `Q${quarter} ${year}`;
}

function deriveDisplayName(feeCategory: string): string {
  if (DISPLAY_NAMES[feeCategory]) {
    return DISPLAY_NAMES[feeCategory];
  }
  return feeCategory
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveConfidence(
  maturityTiers: Array<"strong" | "provisional" | "insufficient">
): "high" | "medium" | "low" {
  if (maturityTiers.some((t) => t === "insufficient")) {
    return "low";
  }
  if (maturityTiers.every((t) => t === "strong")) {
    return "high";
  }
  return "medium";
}

/**
 * Fetch all data needed for the Hamilton Home / Executive Briefing screen.
 * Calls generateGlobalThesis() with a monthly_pulse scope — lighter than quarterly.
 * Returns thesis: null on API failure so page can render empty state gracefully.
 */
export async function fetchHomeBriefingData(
  options: { includeThesis?: boolean } = {},
): Promise<HomeBriefingData> {
  const includeThesis = options.includeThesis ?? true;
  // getNationalIndexCached hits the DB. During build-time ISR prerender (revalidate=86400)
  // the DB can be unreachable; degrade to an empty briefing — the page already renders an
  // "Analysis unavailable" state for null data — instead of crashing the build. Normal
  // request-time behavior (DB reachable) is unchanged.
  let allEntries: Awaited<ReturnType<typeof getNationalIndexCached>> = [];
  try {
    allEntries = await getNationalIndexCached();
  } catch {
    // DB unavailable at prerender — fall through with an empty briefing.
  }
  const spotlightCategories = getSpotlightCategories();

  // Build positioning entries for spotlight categories
  const positioning: PositioningEntry[] = spotlightCategories
    .map((category) => {
      const entry = allEntries.find((e) => e.fee_category === category);
      if (!entry) return null;
      return {
        feeCategory: category,
        displayName: deriveDisplayName(category),
        medianAmount: entry.median_amount,
        p25Amount: entry.p25_amount,
        p75Amount: entry.p75_amount,
        institutionCount: entry.institution_count,
        maturityTier: entry.maturity_tier,
      } satisfies PositioningEntry;
    })
    .filter((e): e is PositioningEntry => e !== null);

  // Derive confidence from spotlight maturity tiers
  const confidence = deriveConfidence(positioning.map((e) => e.maturityTier));

  // Distinct institutions behind the index (summing per-category counts double-counts).
  const totalInstitutions = allEntries.length > 0 ? await getSourcedInstitutionCount().catch(() => 0) : 0;

  // Build minimal ThesisSummaryPayload — lighter scope, no heavy data sources
  const top10 = allEntries.slice(0, 10);
  const thesisSummary: ThesisSummaryPayload = {
    quarter: getCurrentQuarter(),
    total_institutions: totalInstitutions,
    top_categories: top10.map((e) => ({
      fee_category: e.fee_category,
      display_name: deriveDisplayName(e.fee_category),
      median_amount: e.median_amount,
      bank_median: null,
      cu_median: null,
      institution_count: e.institution_count,
      maturity_tier: e.maturity_tier,
    })),
    revenue_snapshot: null,
    fred_snapshot: null,
    beige_book_themes: [],
    derived_tensions: [],
  };

  // Preview deployments and builds share the production database but carry no
  // ANTHROPIC_API_KEY. They cannot write a thesis, and logging that as a failed
  // pro.thesis step put a false alarm on the admin Crew page. Production still logs it.
  const thesisCannotRunHere = !hasAnthropicApiKey("hamilton") && process.env.VERCEL_ENV !== "production";

  let thesis: ThesisOutput | null = null;
  try {
    thesis = includeThesis && allEntries.length > 0 && !thesisCannotRunHere
      ? await generateGlobalThesis({ scope: "monthly_pulse", data: thesisSummary })
      : null;
    if (thesis) {
      await recordProRequest({
        operation: "thesis",
        title: "Hamilton briefing thesis",
        status: "completed",
        summary: "Generated the monthly briefing thesis.",
        userId: null,
        detail: { model: thesis.model, input_tokens: thesis.usage?.inputTokens ?? 0, output_tokens: thesis.usage?.outputTokens ?? 0 },
      });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    let errorType: "budget_blocked" | "missing_key" | "rate_limit" | "api_error" = "api_error";
    if (errorMessage.includes("Provider budget") || errorMessage.includes("budget policy")) {
      // A budget policy refused the call before it reached the provider: not an API error.
      errorType = "budget_blocked";
    } else if (errorMessage.includes("API key") || errorMessage.includes("ANTHROPIC_API_KEY")) {
      errorType = "missing_key";
    } else if (errorMessage.includes("rate_limit") || errorMessage.includes("429")) {
      errorType = "rate_limit";
    }
    await recordProRequest({
      operation: "thesis",
      title: "Hamilton briefing thesis",
      status: "failed",
      summary: `Thesis generation failed (${errorType}).`,
      userId: null,
      detail: { error_type: errorType, error: errorMessage.slice(0, 500) },
    });
    console.warn("[Hamilton] Thesis generation failed", {
      timestamp: new Date().toISOString(),
      errorType,
      scope: "monthly_pulse",
    });
    thesis = null;
  }

  return {
    thesis,
    confidence,
    positioning,
    spotlightCount: positioning.length,
    totalInstitutions,
  };
}

/** Raised inside the 24h cache so a failed briefing is never stored. */
export class HomeBriefingUnavailableError extends Error {
  constructor(reason: string) {
    super(`Hamilton briefing unavailable: ${reason}`);
    this.name = "HomeBriefingUnavailableError";
  }
}

/**
 * The cacheable briefing: complete or nothing. Throwing (instead of returning a
 * null thesis or an empty index) keeps unstable_cache from pinning an outage for a day.
 */
export async function fetchCacheableHomeBriefing(): Promise<HomeBriefingData> {
  const data = await fetchHomeBriefingData();
  if (data.positioning.length === 0) throw new HomeBriefingUnavailableError("fee index unavailable");
  if (!data.thesis) throw new HomeBriefingUnavailableError("thesis generation failed");
  return data;
}

// ---------------------------------------------------------------------------
// Signal/alert query functions (fresh every load — NOT ISR cached, per D-11)
// ---------------------------------------------------------------------------

/**
 * Fetch recent signals from hamilton_signals ordered by created_at DESC.
 * Returns empty array on failure (table may not exist or have data per D-02).
 */
function normalizeHomeInstitutionScope(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || !/^[1-9]\d*$/.test(trimmed)) continue;
    seen.add(trimmed);
  }
  return [...seen];
}

async function fetchRecentSignals(
  limit: number,
  institutionIds: string[] = [],
): Promise<SignalEntry[]> {
  try {
    const scopedInstitutionIds = normalizeHomeInstitutionScope(institutionIds);
    // No selected or watched institution: no signals (never another customer's activity).
    if (scopedInstitutionIds.length === 0) return [];
    const rows = scopedInstitutionIds.length > 0
      ? await sql`
          SELECT
            id,
            institution_id,
            signal_type,
            severity,
            title,
            body,
            created_at,
            source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_signals
          WHERE institution_id = ANY(${scopedInstitutionIds}::text[])
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            id,
            institution_id,
            signal_type,
            severity,
            title,
            body,
            created_at,
            source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_signals
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
    return rows.map((r) => ({
      id: String(r.id),
      institutionId: r.institution_id == null ? null : String(r.institution_id),
      signalType: String(r.signal_type),
      severity: String(r.severity),
      title: String(r.title),
      body: String(r.body),
      createdAt: String(r.created_at),
      evidencePolicy: r.evidence_policy == null ? null : (String(r.evidence_policy) as HamiltonEvidencePolicy),
      providerCallQueued: r.provider_call_queued === true,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch active priority alerts for a user, joined with signal data.
 * Ordered by severity DESC then created_at DESC. Per T-42-04: user_id scoped.
 * Returns empty array on failure per D-03.
 */
async function fetchPriorityAlerts(
  userId: number,
  limit = 3,
  institutionIds: string[] = [],
): Promise<AlertEntry[]> {
  try {
    const scopedInstitutionIds = normalizeHomeInstitutionScope(institutionIds);
    const rows = scopedInstitutionIds.length > 0
      ? await sql`
          SELECT
            pa.id,
            pa.signal_id,
            pa.status,
            pa.created_at,
            s.institution_id,
            s.signal_type,
            s.severity,
            s.title,
            s.body,
            s.source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((s.source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_priority_alerts pa
          JOIN hamilton_signals s ON pa.signal_id = s.id
          WHERE pa.user_id = ${userId}
            AND pa.status = 'active'
            AND s.institution_id = ANY(${scopedInstitutionIds}::text[])
          ORDER BY
            CASE s.severity
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
              ELSE 4
            END ASC,
            pa.created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            pa.id,
            pa.signal_id,
            pa.status,
            pa.created_at,
            s.institution_id,
            s.signal_type,
            s.severity,
            s.title,
            s.body,
            s.source_json ->> 'evidence_policy' AS evidence_policy,
            COALESCE((s.source_json ->> 'provider_call_queued')::boolean, false) AS provider_call_queued
          FROM hamilton_priority_alerts pa
          JOIN hamilton_signals s ON pa.signal_id = s.id
          WHERE pa.user_id = ${userId}
            AND pa.status = 'active'
          ORDER BY
            CASE s.severity
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
              ELSE 4
            END ASC,
            pa.created_at DESC
          LIMIT ${limit}
        `;
    return rows.map((r) => ({
      id: String(r.id),
      signalId: String(r.signal_id),
      institutionId: r.institution_id == null ? null : String(r.institution_id),
      signalType: String(r.signal_type),
      severity: String(r.severity),
      title: String(r.title),
      body: String(r.body),
      status: String(r.status),
      createdAt: String(r.created_at),
      evidencePolicy: r.evidence_policy == null ? null : (String(r.evidence_policy) as HamiltonEvidencePolicy),
      providerCallQueued: r.provider_call_queued === true,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch all signal/alert data for the Executive Briefing home screen.
 * Called fresh on every page load (NOT ISR cached, per D-11).
 * Parallel fetch for performance (T-42-06: LIMIT clauses prevent unbounded results).
 */
export async function fetchHomeBriefingSignals(
  userId: number,
  options: { institutionIds?: string[] } = {},
): Promise<HomeBriefingSignals> {
  const institutionIds = normalizeHomeInstitutionScope(options.institutionIds ?? []);
  const [recentFive, alerts, recentThree] = await Promise.all([
    fetchRecentSignals(5, institutionIds),
    fetchPriorityAlerts(userId, 3, institutionIds),
    fetchRecentSignals(3, institutionIds),
  ]);
  return {
    whatChanged: recentFive,
    priorityAlerts: alerts,
    monitorFeed: recentThree,
  };
}
