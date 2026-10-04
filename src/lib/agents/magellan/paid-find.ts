import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import {
  emptyPaidPassResult,
  PAID_PASS_ITEMS_PER_RUN,
  PAID_PASS_MODELS,
  paidModelCall,
  paidResponseJson,
  type PaidMessageCreator,
  type PaidPassResult,
  type PaidStepOptions,
} from "@/lib/agents/paid-pass";

import { DISCOVERY_METHOD_VERSION, recordDiscoveryResult, type CandidateDiscoveryResult } from "./discovery";
import { validateFeeCandidate } from "./find-validate";
import { urlIdentity } from "./finders";

type Fetcher = typeof fetch;

/**
 * Pass 3 for Magellan: one paid web search per bank that every free finder missed.
 * Selects banks in the state whose last search with the current discovery method found
 * nothing and that have had no paid search this month, asks the model (with
 * Anthropic's server web_search tool) for the consumer fee schedule on the bank's own
 * domain, and stores the answer only after the same fee-page check the free finders
 * use. Every call is budget-checked and cost-logged by `paidModelCall`; a budget cap or
 * the automation stop ends the step cleanly.
 */

export const PAID_FIND_STRATEGY = { strategy: "discover.paid_web_search", version: 1 } as const;
const WEB_SEARCH_MAX_USES = 3;
const MAX_OUTPUT_TOKENS = 1024;
/** Link score given to the model's answer: strong enough to accept a scanned PDF. */
const PAID_ANSWER_SCORE = 0.85;
/** Paid outcomes that do not count as this month's paid try (nothing was learned). */
const TRANSIENT_PAID_OUTCOMES = ["network_error", "timeout", "http_5xx", "http_429", "budget_blocked"];

interface PaidFindRow {
  id: number | string;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  website_url: string;
  profile_consecutive_failures?: number | string | null;
}

interface PaidFindAnswer {
  url?: unknown;
  confidence?: unknown;
  evidence?: unknown;
}

export interface RunMagellanPaidFindOptions extends PaidStepOptions {
  /** Test seam for the model call. */
  create?: PaidMessageCreator;
  /** Test seam for the fee-page check. */
  fetchImpl?: Fetcher;
}

async function selectBanks(db: typeof sql, stateCode: string | null, limit: number): Promise<PaidFindRow[]> {
  const currentMethod = JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION });
  return db<PaidFindRow[]>`
    SELECT inst.id, inst.institution_name, inst.city, inst.state_code, inst.website_url,
           profile.consecutive_failures AS profile_consecutive_failures
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (inst.fee_schedule_url IS NULL OR btrim(inst.fee_schedule_url) = '')
       AND inst.website_url IS NOT NULL AND btrim(inst.website_url) <> ''
       AND inst.rescue_status = 'dead'
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode})
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND COALESCE(profile.locked_by_correction, false) = false
       -- Every free finder ran with the current method and none found a link.
       AND EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.detail @> ${currentMethod}::jsonb
       )
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'discover'
            AND pa.strategy = ${PAID_FIND_STRATEGY.strategy}
            AND pa.created_at >= date_trunc('month', NOW())
            AND pa.outcome <> ALL(${TRANSIENT_PAID_OUTCOMES})
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit}
  `;
}

function websiteHost(website: string): string | null {
  for (const candidate of [website.trim(), `https://${website.trim()}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
  }
  return null;
}

/** The bank's own domain: the website host or one of its subdomains. */
export function onBankDomain(url: string, website: string): boolean {
  const host = websiteHost(website);
  if (!host) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const candidate = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return candidate === host || candidate.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

export function paidFindPrompt(row: Pick<PaidFindRow, "institution_name" | "city" | "state_code" | "website_url">): string {
  const host = websiteHost(row.website_url) ?? row.website_url;
  return [
    "Find the URL of this bank's consumer fee schedule: the document (PDF or web page) that lists",
    "account service fees with dollar amounts, such as overdraft, NSF/returned item, stop payment,",
    "wire transfer, and monthly maintenance fees. It is often titled \"Schedule of Fees\",",
    "\"Fee Schedule\", or \"Truth in Savings / Fee Disclosure\".",
    "",
    `Bank: ${row.institution_name}`,
    `Location: ${[row.city, row.state_code].filter(Boolean).join(", ") || "unknown"}`,
    `Website: ${row.website_url}`,
    "",
    "Rules:",
    `- The URL must be on the bank's own domain (${host} or a subdomain of it).`,
    "- Do not return rate sheets, press releases, account agreements without fee amounts, or other sites.",
    "- If you cannot find it, answer with url null. Do not guess a URL you have not seen.",
    "",
    "Answer with JSON only:",
    "{\"url\": string | null, \"confidence\": number between 0 and 1, \"evidence\": \"one short sentence\"}",
  ].join("\n");
}

function budgetStop(error: unknown): string | null {
  if (error instanceof ProviderBudgetBlockedError) return error.message || error.reasonCode;
  if (error instanceof EmergencyStopActiveError) return error.message;
  return null;
}

function paidDiscovery(row: PaidFindRow, fields: Partial<CandidateDiscoveryResult> & Pick<CandidateDiscoveryResult, "outcome" | "reason">): CandidateDiscoveryResult {
  return {
    institutionId: Number(row.id),
    institutionName: row.institution_name,
    stateCode: normalizeStateCode(row.state_code),
    code: "found_paid_search",
    url: null,
    documentType: null,
    confidence: null,
    method: "magellan_paid_web_search",
    attemptedUrls: 1,
    foundBy: null,
    movedTo: null,
    platform: null,
    homepageHash: null,
    finders: [],
    durationMs: 0,
    ...fields,
  };
}

export async function runMagellanPaidFind(options: RunMagellanPaidFindOptions): Promise<PaidPassResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  if (!(await learningSchemaReady(db))) return result;

  const limit = Math.max(1, Math.min(Math.floor(Number(options.limit ?? PAID_PASS_ITEMS_PER_RUN)) || PAID_PASS_ITEMS_PER_RUN, PAID_PASS_ITEMS_PER_RUN));
  const rows = await selectBanks(db, normalizeStateCode(options.stateCode), limit);
  result.selected = rows.length;
  if (dryRun) {
    result.results = rows.map((row) => ({ institution_id: Number(row.id), institution_name: row.institution_name, would_search: true }));
    return result;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = PAID_PASS_MODELS.find();
  for (const row of rows) {
    const institutionId = Number(row.id);
    const startedAt = Date.now();
    let costMicrousd = 0;
    let outcome: AttemptOutcome;
    let url: string | null = null;
    let reason: string;
    let documentType: string | null = null;
    let confidence: number | null = null;
    let answer: PaidFindAnswer | null = null;
    let verdict: string | null = null;
    try {
      const call = await paidModelCall({
        agent: "magellan",
        operation: "paid_find",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null },
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
          messages: [{ role: "user", content: paidFindPrompt(row) }],
        },
      });
      costMicrousd = call.costMicrousd;
      result.costMicrousd += costMicrousd;
      answer = paidResponseJson<PaidFindAnswer>(call.message);
      const proposed = typeof answer?.url === "string" ? answer.url.trim() : "";
      if (!proposed) {
        outcome = "no_candidates";
        reason = "Web search found no fee schedule";
      } else if (!onBankDomain(proposed, row.website_url)) {
        outcome = "invalid_url";
        reason = `Answer is not on the bank's domain: ${proposed}`;
      } else {
        // The same check the free finders use: a rates page or press release is never stored.
        try {
          const validation = await validateFeeCandidate({ url: proposed, score: PAID_ANSWER_SCORE, reasons: ["paid web search"] }, fetchImpl);
          verdict = validation.verdict;
          if (validation.ok) {
            outcome = "ok";
            url = proposed;
            documentType = validation.documentType;
            confidence = validation.confidence;
            reason = `Paid web search: ${validation.reason}`;
          } else {
            outcome = validation.status != null && validation.status >= 400 ? classifyFetchFailure(validation.status) : "wrong_document";
            reason = `Answer failed the fee-page check (${validation.reason}): ${proposed}`;
          }
        } catch (error) {
          outcome = classifyFetchFailure(null, error);
          reason = `Answer could not be opened: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    } catch (error) {
      const stopped = budgetStop(error);
      if (stopped) {
        // Nothing was spent on this bank: it stays due for the next paid pass.
        result.budgetStopped = true;
        result.budgetReason = stopped;
        break;
      }
      outcome = classifyFetchFailure(null, error);
      reason = `Model call failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    result.processed += 1;
    if (url) result.succeeded += 1;
    else result.failed += 1;
    if (url) {
      await recordDiscoveryResult(db, paidDiscovery(row, {
        outcome: "discovered",
        url,
        documentType,
        confidence,
        reason,
        durationMs: Date.now() - startedAt,
      }));
    }
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: PAID_FIND_STRATEGY.strategy,
      version: PAID_FIND_STRATEGY.version,
      fingerprint: urlIdentity(row.website_url),
      outcome,
      yieldCount: url ? 1 : 0,
      costMicrousd,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 3,
        method_version: DISCOVERY_METHOD_VERSION,
        model,
        url,
        proposed_url: typeof answer?.url === "string" ? answer.url : null,
        model_confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
        evidence: typeof answer?.evidence === "string" ? answer.evidence.slice(0, 300) : null,
        verdict,
        document_type: documentType,
        reason,
      },
    });
    result.results.push({ institution_id: institutionId, outcome, url, cost_microusd: costMicrousd, reason });
  }
  return result;
}
