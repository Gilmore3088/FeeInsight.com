"use server";

import { sql } from "@/lib/data-store/connection";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getNationalIndex } from "@/lib/data-store/fee-index";
import { getInstitutionById } from "@/lib/data-store";
import { computeConfidenceTier, canSimulate } from "@/lib/hamilton/confidence";
import { valuePerInstitution } from "@/lib/data-store/fee-stats";
import { getHamiltonScenarioById } from "@/lib/hamilton/pro-tables";
import { resolveHamiltonPeerIndex } from "@/lib/hamilton/peer-index";
import { completeHamiltonRefreshJobsForInstitution } from "@/lib/hamilton/refresh-jobs";
import {
  getHamiltonContextSourceLabel,
  normalizeHamiltonContextSource,
  normalizeHamiltonPersistedContextSource,
  type HamiltonContextSource,
  type HamiltonPersistedContextSource,
} from "@/lib/hamilton/context-source";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import type { DistributionData } from "@/lib/hamilton/simulation";
import type { ConfidenceTier } from "@/lib/hamilton/confidence";
import type { HamiltonEvidencePolicy } from "@/lib/hamilton/request-contract";

interface SimulationPeerContextParams {
  institutionId?: string | null;
  peerSetId?: string | null;
}

/** Server actions are public POST endpoints: every Pro benchmark read checks access itself. */
async function hasProAccess(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user && canAccessPremium(user));
}

async function resolveSimulationPeerContext(params?: SimulationPeerContextParams) {
  const user = await getCurrentUser();
  const numericInstitutionId = params?.institutionId ? Number(params.institutionId) : null;
  const selectedInstitution =
    numericInstitutionId && Number.isInteger(numericInstitutionId) && numericInstitutionId > 0
      ? await getInstitutionById(numericInstitutionId).catch(() => null)
      : null;

  return resolveHamiltonPeerIndex({
    userId: user?.id ?? null,
    peerSetId: params?.peerSetId ?? null,
    selectedInstitution,
    approvedOnly: true,
    minUsableCategories: 1,
  });
}

/**
 * Fetch distribution data for a fee category.
 * Returns null if category not found or data insufficient for display.
 * Used to hydrate the slider range and compute confidence tier.
 */
export async function getDistributionForCategory(
  feeCategory: string,
  peerContext?: SimulationPeerContextParams,
): Promise<{ distribution: DistributionData; confidenceTier: ConfidenceTier } | { error: string }> {
  if (!(await hasProAccess())) return { error: "Pro subscription required" };
  try {
    const peerIndex = await resolveSimulationPeerContext(peerContext);
    let entry = peerIndex.entries.find((e) => e.fee_category === feeCategory);
    let peerLabel = peerIndex.label;
    let peerSource = peerIndex.source;
    let peerSetId = peerIndex.peerSetId;
    let peerFallbackReason = peerIndex.fallbackReason;

    if (!entry && peerIndex.source !== "national") {
      const nationalIndex = await getNationalIndex();
      entry = nationalIndex.find((e) => e.fee_category === feeCategory);
      peerLabel = "Verified national index";
      peerSource = "national";
      peerSetId = null;
      peerFallbackReason =
        `The selected peer baseline did not have usable ${feeCategory.replace(/_/g, " ")} data, so this simulation uses the verified national index.`;
    }

    if (!entry) {
      return { error: `No data found for category: ${feeCategory}` };
    }

    if (
      entry.median_amount === null ||
      entry.p25_amount === null ||
      entry.p75_amount === null ||
      entry.min_amount === null ||
      entry.max_amount === null
    ) {
      return { error: "Insufficient distribution data for this category" };
    }

    const distribution: DistributionData = {
      fee_category: entry.fee_category,
      median_amount: entry.median_amount,
      p25_amount: entry.p25_amount,
      p75_amount: entry.p75_amount,
      min_amount: entry.min_amount,
      max_amount: entry.max_amount,
      approved_count: entry.approved_count,
      institution_count: entry.institution_count,
      peer_label: peerLabel,
      peer_source: peerSource,
      peer_set_id: peerSetId,
      peer_fallback_reason: peerFallbackReason,
    };

    const confidenceTier = computeConfidenceTier(entry.institution_count);
    return { distribution, confidenceTier };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return { error: message };
  }
}

/**
 * Look up the institution's actual fee for a category.
 * Returns the fee amount if found, null if the institution has no fee in this category.
 */
export async function getInstitutionFee(
  institutionId: string,
  feeCategory: string
): Promise<{ amount: number } | null> {
  if (!(await hasProAccess())) return null;
  const canonicalInstitutionId = normalizeCanonicalInstitutionId(institutionId);
  if (!canonicalInstitutionId) return null;
  const numericInstitutionId = Number(canonicalInstitutionId);

  try {
    const rows = await sql<{ amount: string }[]>`
      SELECT ef.amount::text
      FROM published_fee_catalog ef
      WHERE ef.institution_id = ${numericInstitutionId}
        AND ef.fee_category = ${feeCategory}
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL
    `;

    // The institution's value under the statistics contract: the median of its amounts.
    const value = valuePerInstitution(
      rows.map((row) => ({ institution_id: numericInstitutionId, amount: row.amount })),
    ).get(numericInstitutionId);
    if (value !== undefined) {
      return { amount: value };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save a scenario to hamilton_scenarios.
 * Requires premium/admin role.
 * Returns the new scenario UUID on success.
 * confidence_tier is snapshotted at save time (D-04 from Phase 39).
 */
export async function saveScenario(params: {
  institutionId: string;
  feeCategory: string;
  currentValue: number;
  proposedValue: number;
  resultJson: object;
  confidenceTier: ConfidenceTier;
  peerSetId?: string | null;
  evidencePolicy?: HamiltonEvidencePolicy;
  peerBaselineSource?: DistributionData["peer_source"] | null;
  peerBaselineLabel?: string | null;
  peerFallbackReason?: string | null;
  selectedSource?: HamiltonContextSource;
  selectedSourceLabel?: string | null;
}): Promise<{ id: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return { error: "Active subscription required" };
  }

  const institutionId = normalizeCanonicalInstitutionId(params.institutionId) ?? "";
  // The tier is recomputed here from the database; the client's value is never trusted.
  const recomputed = await getDistributionForCategory(params.feeCategory, {
    institutionId: institutionId || null,
    peerSetId: params.peerSetId ?? null,
  });
  if ("error" in recomputed) {
    return { error: recomputed.error };
  }
  const confidenceTier = recomputed.confidenceTier;
  // Insufficient tier must not be saved — canSimulate enforces the gate
  const check = canSimulate(confidenceTier);
  if (!check.allowed) {
    return { error: check.reason };
  }

  try {
    const fallbackSource: HamiltonPersistedContextSource = institutionId ? "manual" : "profile";
    const rawSource = normalizeHamiltonContextSource(params.selectedSource, fallbackSource);
    const selectedSource = normalizeHamiltonPersistedContextSource(
      rawSource,
      fallbackSource,
    );
    const selectedSourceLabel =
      rawSource === selectedSource && params.selectedSourceLabel
        ? params.selectedSourceLabel
        : getHamiltonContextSourceLabel(selectedSource);

    const rows = await sql<{ id: string }[]>`
      INSERT INTO hamilton_scenarios (
        user_id,
        institution_id,
        fee_category,
        peer_set_id,
        evidence_policy,
        peer_baseline_source,
        peer_baseline_label,
        peer_fallback_reason,
        selected_source,
        selected_source_label,
        current_value,
        proposed_value,
        result_json,
        confidence_tier,
        status
      ) VALUES (
        ${user.id},
        ${institutionId},
        ${params.feeCategory},
        ${params.peerSetId ?? null},
        ${params.evidencePolicy ?? "verified-only"},
        ${params.peerBaselineSource ?? null},
        ${params.peerBaselineLabel ?? null},
        ${params.peerFallbackReason ?? null},
        ${selectedSource},
        ${selectedSourceLabel},
        ${params.currentValue},
        ${params.proposedValue},
        ${JSON.stringify(params.resultJson)},
        ${confidenceTier},
        'active'
      )
      RETURNING id::text
    `;

    const id = rows[0]?.id;
    if (!id) return { error: "Failed to save scenario" };
    const numericInstitutionId = Number(institutionId);
    if (Number.isInteger(numericInstitutionId) && numericInstitutionId > 0) {
      await completeHamiltonRefreshJobsForInstitution({
        institutionId: numericInstitutionId,
        jobTypes: ["scenario_refresh"],
        completedByUserId: user.id,
      }).catch(() => {});
    }
    return { id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return { error: message };
  }
}

/**
 * List saved scenarios for the current user (active only — soft-deleted excluded).
 */
export async function listScenarios(limit = 20): Promise<
  Array<{
    id: string;
    fee_category: string;
    institution_id: string;
    current_value: string;
    proposed_value: string;
    confidence_tier: string;
    peer_set_id: string | null;
    evidence_policy: HamiltonEvidencePolicy;
    peer_baseline_source: DistributionData["peer_source"] | null;
    peer_baseline_label: string | null;
    peer_fallback_reason: string | null;
    selected_source: string | null;
    selected_source_label: string | null;
    created_at: string;
  }>
> {
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const rows = await sql<
      Array<{
        id: string;
        fee_category: string;
        institution_id: string;
        current_value: string;
        proposed_value: string;
        confidence_tier: string;
        peer_set_id: string | null;
        evidence_policy: HamiltonEvidencePolicy;
        peer_baseline_source: DistributionData["peer_source"] | null;
        peer_baseline_label: string | null;
        peer_fallback_reason: string | null;
        selected_source: string | null;
        selected_source_label: string | null;
        created_at: string;
      }>
    >`
      SELECT
        id::text,
        fee_category,
        institution_id,
        current_value::text,
        proposed_value::text,
        confidence_tier,
        peer_set_id,
        evidence_policy,
        peer_baseline_source,
        peer_baseline_label,
        peer_fallback_reason,
        selected_source,
        selected_source_label,
        created_at::text
      FROM hamilton_scenarios
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows;
  } catch {
    return [];
  }
}

/**
 * Load one saved scenario for direct deep links from the left rail.
 */
export async function getScenario(
  scenarioId: string,
): Promise<{
  id: string;
  fee_category: string;
  institution_id: string;
  current_value: string;
  proposed_value: string;
    confidence_tier: string;
    peer_set_id: string | null;
    evidence_policy: HamiltonEvidencePolicy;
    peer_baseline_source: DistributionData["peer_source"] | null;
    peer_baseline_label: string | null;
    peer_fallback_reason: string | null;
    selected_source: string | null;
    selected_source_label: string | null;
    created_at: string;
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  try {
    const scenario = await getHamiltonScenarioById(scenarioId, user.id);
    if (!scenario) return null;
    return {
      id: scenario.id,
      fee_category: scenario.fee_category,
      institution_id: scenario.institution_id,
      current_value: String(scenario.current_value),
      proposed_value: String(scenario.proposed_value),
      confidence_tier: scenario.confidence_tier,
      peer_set_id: scenario.peer_set_id,
      evidence_policy: scenario.evidence_policy,
      peer_baseline_source: scenario.peer_baseline_source,
      peer_baseline_label: scenario.peer_baseline_label,
      peer_fallback_reason: scenario.peer_fallback_reason,
      selected_source: scenario.selected_source,
      selected_source_label: scenario.selected_source_label,
      created_at: scenario.created_at,
    };
  } catch {
    return null;
  }
}

/**
 * Load the fee categories available for simulation (those with distribution data).
 * Returns array of { fee_category, display_name, approved_count, confidence_tier }.
 * Sorted by approved_count descending so strongest-data categories appear first.
 */
export async function getSimulationCategories(peerContext?: SimulationPeerContextParams): Promise<
  Array<{
    fee_category: string;
    display_name: string;
    approved_count: number;
    confidence_tier: ConfidenceTier;
  }>
> {
  if (!(await hasProAccess())) return [];
  try {
    const peerIndex = await resolveSimulationPeerContext(peerContext);
    const entriesByCategory = new Map(peerIndex.entries.map((entry) => [entry.fee_category, entry]));
    if (peerIndex.source !== "national") {
      const nationalIndex = await getNationalIndex();
      for (const nationalEntry of nationalIndex) {
        if (!entriesByCategory.has(nationalEntry.fee_category)) {
          entriesByCategory.set(nationalEntry.fee_category, nationalEntry);
        }
      }
    }
    const resolvedIndex = Array.from(entriesByCategory.values());
    return resolvedIndex
      .filter(
        (e) =>
          e.median_amount !== null &&
          e.p25_amount !== null &&
          e.p75_amount !== null
      )
      .map((e) => ({
        fee_category: e.fee_category,
        display_name: e.fee_category
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        approved_count: e.approved_count,
        confidence_tier: computeConfidenceTier(e.institution_count),
      }))
      .sort((a, b) => b.approved_count - a.approved_count);
  } catch {
    return [];
  }
}
