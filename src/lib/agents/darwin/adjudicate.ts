import { sql } from "@/lib/data-store/connection";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
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
import { CANONICAL_KEY_MAP, DISPLAY_NAMES, FEE_FAMILIES } from "@/lib/fee-taxonomy";

import { DARWIN_CATEGORY_MODEL_STRATEGY } from "./category-model";
import { runDarwinReleaseReview } from "./release-review";
import { rawFeeFingerprint } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin v2, layer 3 (`verify-paid`, a provider step): Claude reads only the fees the
 * free layers disagree on, as the last resort. Two kinds qualify, from the layer 2
 * category model's attempts:
 *   - an approved fee whose category the model disputes (a live-fee risk), and
 *   - a fee the category guard rejected where the model is confident
 *     (CONFIDENT_SUGGESTION) of another category the guard accepts (a real fee that
 *     may have been filed under the wrong category and thrown away).
 * Fees go in batches of FEES_PER_CALL; each verdict says whether it is a fee the bank
 * charges and which category it belongs to.
 *
 * Shadow: verdicts are recorded as `verify.adjudicate` attempts and never change a
 * decision, so agreement can be measured before they act. Every call is budget-checked
 * and cost-logged through paidModelCall under Darwin's own policy (`agent:darwin`) and
 * key; the policy is fail-closed until its caps are set.
 */

export const DARWIN_ADJUDICATE_STRATEGY = { strategy: "verify.adjudicate", version: 1 } as const;
/** The model's probability for its own suggestion at or above which a reject qualifies. */
export const CONFIDENT_SUGGESTION = 0.9;
export const FEES_PER_CALL = 25;
const MAX_OUTPUT_TOKENS = 4_000;
const TRANSIENT_OUTCOMES = ["timeout", "network_error", "http_429", "http_5xx", "budget_blocked"];
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);
const VALID_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));

export interface AdjudicationCandidate {
  feeRawId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  feeName: string;
  amount: number | null;
  conditions: string | null;
  knoxKey: string;
  suggestedKey: string;
  suggestedProbability: number;
  decision: "verified" | "rejected";
}

interface CandidateRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
  knox_key: string;
  suggested_key: string;
  suggested_probability: number | string;
  decision: string;
}

/** What the model says about one fee. */
export interface AdjudicationVerdict {
  isFee: boolean;
  /** A canonical key, or null for "none fits". */
  category: string | null;
  reason: string | null;
}

/** How the verdict sides: with Knox's category, with the model's, another, or not a fee. */
export type AdjudicationSide = "knox" | "model" | "other" | "not_a_fee";

export function verdictSide(candidate: AdjudicationCandidate, verdict: AdjudicationVerdict): AdjudicationSide {
  if (!verdict.isFee) return "not_a_fee";
  if (verdict.category === candidate.knoxKey) return "knox";
  if (verdict.category === candidate.suggestedKey) return "model";
  return "other";
}

/** Pure: a rejected candidate only qualifies when the guard accepts the model's category. */
export function qualifies(candidate: AdjudicationCandidate): boolean {
  if (candidate.decision === "verified") return true;
  return candidate.suggestedProbability >= CONFIDENT_SUGGESTION
    && candidate.suggestedKey !== candidate.knoxKey
    && checkFeeCategory(candidate.suggestedKey, candidate.feeName).ok;
}

function canonicalFeeList(): string {
  return Object.entries(FEE_FAMILIES)
    .map(([family, keys]) => `${family}: ${keys.map((key) => `${key} (${DISPLAY_NAMES[key] ?? key})`).join(", ")}`)
    .join("\n");
}

export function adjudicatePrompt(candidates: AdjudicationCandidate[]): string {
  const items = candidates.map((candidate) => ({
    id: candidate.feeRawId,
    fee_name: candidate.feeName,
    amount: candidate.amount,
    conditions: candidate.conditions,
    filed_as: candidate.knoxKey,
    alternative: candidate.suggestedKey,
  }));
  return [
    "You check fees read from bank and credit union fee schedules. For each item decide:",
    "- is_fee: true only if the text names a price the institution charges a customer.",
    "  False for balance requirements, minimum deposits, limits, caps, rates, reimbursements or sentence fragments.",
    "- category: the one canonical key below that the fee belongs to, or null if none fits.",
    "  `filed_as` and `alternative` are two guesses; either may be wrong.",
    "Return only JSON: {\"verdicts\": [{\"id\", \"is_fee\", \"category\", \"reason\"}]} with one entry per item and a reason of at most 12 words.",
    "",
    "Canonical keys:",
    canonicalFeeList(),
    "",
    "Items:",
    JSON.stringify(items),
  ].join("\n");
}

/** Pure: the model's verdicts by fee id, unknown keys read as "none fits". */
export function parseVerdicts(parsed: unknown): Map<number, AdjudicationVerdict> {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { verdicts?: unknown })?.verdicts)
      ? (parsed as { verdicts: unknown[] }).verdicts
      : [];
  const verdicts = new Map<number, AdjudicationVerdict>();
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    const raw = typeof row.category === "string" ? row.category.trim() : "";
    const category = CANONICAL_KEY_MAP[raw] ?? (VALID_KEYS.has(raw) ? raw : null);
    verdicts.set(id, {
      isFee: row.is_fee === true,
      category,
      reason: typeof row.reason === "string" ? row.reason.slice(0, 160) : null,
    });
  }
  return verdicts;
}

async function selectCandidates(db: SqlTag, scan: number, stateCode?: string): Promise<AdjudicationCandidate[]> {
  const params: Array<string | number> = [];
  const modelStrategy = `$${params.push(DARWIN_CATEGORY_MODEL_STRATEGY.strategy)}`;
  const adjudicateStrategy = `$${params.push(DARWIN_ADJUDICATE_STRATEGY.strategy)}`;
  const confident = `$${params.push(CONFIDENT_SUGGESTION)}`;
  const limit = `$${params.push(scan)}`;
  const normalizedState = normalizeStateCode(stateCode);
  const stateFilter = normalizedState ? `AND upper(btrim(inst.state_code)) = $${params.push(normalizedState)}` : "";
  const rows = await db.unsafe<CandidateRow[]>(
    `
      SELECT * FROM (
        SELECT DISTINCT ON (fr.fee_raw_id)
               fr.fee_raw_id, fr.institution_id, fr.source_document_id, fr.fee_name, fr.amount, fr.conditions,
               cm.detail->>'canonical_fee_key' AS knox_key,
               cm.detail->>'suggested_key' AS suggested_key,
               cm.detail->>'suggested_probability' AS suggested_probability,
               cm.detail->>'decision' AS decision
          FROM pipeline_attempts cm
          JOIN raw_fee_observations fr ON fr.fee_raw_id = (cm.detail->>'fee_raw_id')::bigint
          JOIN institution_sources inst ON inst.id = fr.institution_id
         WHERE cm.stage = 'verify'
           AND cm.strategy = ${modelStrategy}
           AND cm.outcome = 'evidence_mismatch'
           AND (
             cm.detail->>'decision' = 'verified'
             OR (
               cm.detail->>'decision' = 'rejected'
               AND (cm.detail->>'suggested_probability')::numeric >= ${confident}
               AND EXISTS (
                 SELECT 1 FROM pipeline_attempts rr
                  WHERE rr.stage = 'verify'
                    AND rr.strategy = 'verify.rules'
                    AND rr.input_fingerprint = cm.input_fingerprint
                    AND rr.detail->>'reason_code' = 'category_mismatch'
               )
             )
           )
           ${stateFilter}
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts done
              WHERE done.stage = 'verify'
                AND done.strategy = ${adjudicateStrategy}
                AND done.input_fingerprint = cm.input_fingerprint
                AND done.outcome NOT IN (${TRANSIENT_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})
           )
         ORDER BY fr.fee_raw_id, cm.created_at DESC
      ) latest
      -- Approved fees first: a wrong category there is already live or about to be.
      ORDER BY (decision = 'verified') DESC, fee_raw_id DESC
      LIMIT ${limit}
    `,
    params,
  );
  return rows.map((row) => ({
    feeRawId: Number(row.fee_raw_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    feeName: row.fee_name,
    amount: row.amount == null ? null : Number(row.amount),
    conditions: row.conditions,
    knoxKey: row.knox_key,
    suggestedKey: row.suggested_key,
    suggestedProbability: Number(row.suggested_probability),
    decision: row.decision === "verified" ? "verified" : "rejected",
  }));
}

function failureOutcome(error: unknown): AttemptOutcome {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  if (Number.isFinite(status) && status > 0) return "http_other";
  return /abort|timed? ?out|timeout/i.test(error instanceof Error ? error.message : String(error)) ? "timeout" : "network_error";
}

function isStopError(error: unknown): boolean {
  return error instanceof Error && STOP_ERRORS.has(error.name);
}

export async function runDarwinAdjudicate(
  options: PaidStepOptions & { create?: PaidMessageCreator },
): Promise<PaidPassResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  let calls = Math.min(Math.max(Math.floor(Number(options.limit) || PAID_PASS_ITEMS_PER_RUN), 1), PAID_PASS_ITEMS_PER_RUN);
  if (!(await learningSchemaReady(db))) return result;

  // Held fees waiting on their release review (release-review.ts) go first, from the same call budget.
  const review = await runDarwinReleaseReview({ ...options, db, calls });
  result.selected += review.selected;
  result.processed += review.processed;
  result.succeeded += review.succeeded;
  result.failed += review.failed;
  result.costMicrousd += review.costMicrousd;
  result.results.push(...review.results.slice(0, 10).map((entry) => ({ ...entry, pass: "release_review" })));
  if (review.calls > 0) result.results.push({ pass: "release_review", lessons: review.lessons });
  if (review.budgetStopped) {
    result.budgetStopped = true;
    result.budgetReason = review.budgetReason;
    return result;
  }
  calls -= review.calls;
  if (calls <= 0) return result;

  // Rejects are re-checked in code (the guard must accept the model's category), so scan extra.
  const candidates = (await selectCandidates(db, calls * FEES_PER_CALL * 2, options.stateCode))
    .filter(qualifies)
    .slice(0, calls * FEES_PER_CALL);
  result.selected += candidates.length;
  if (dryRun) {
    result.results.push(...candidates.slice(0, 50).map((candidate) => ({
      fee_raw_id: candidate.feeRawId,
      knox_key: candidate.knoxKey,
      suggested_key: candidate.suggestedKey,
      decision: candidate.decision,
    })));
    return result;
  }

  const model = PAID_PASS_MODELS.verify();
  for (let start = 0; start < candidates.length; start += FEES_PER_CALL) {
    const batch = candidates.slice(start, start + FEES_PER_CALL);
    const startedAt = Date.now();
    const common = (candidate: AdjudicationCandidate) => ({
      institutionId: candidate.institutionId,
      sourceDocumentId: candidate.sourceDocumentId,
      stage: "verify" as const,
      strategy: DARWIN_ADJUDICATE_STRATEGY.strategy,
      version: DARWIN_ADJUDICATE_STRATEGY.version,
      fingerprint: rawFeeFingerprint(candidate.feeRawId),
      runId: options.runId,
      stepId: options.stepId ?? null,
      // A side check on one fee; it must not reset the institution's playbook.
      foldIntoPlaybook: false,
    });
    let call: Awaited<ReturnType<typeof paidModelCall>>;
    try {
      call = await paidModelCall({
        agent: "darwin",
        operation: "adjudicate",
        runId: options.runId,
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: adjudicatePrompt(batch) }],
        },
        create: options.create,
        metadata: { fee_raw_ids: batch.map((candidate) => candidate.feeRawId) },
      });
    } catch (error) {
      if (isStopError(error)) {
        // Nothing was spent: no attempt rows, so the fees stay eligible.
        result.budgetStopped = true;
        result.budgetReason = error instanceof Error ? error.message : String(error);
        break;
      }
      const outcome = failureOutcome(error);
      const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
      for (const candidate of batch) {
        result.processed += 1;
        result.failed += 1;
        await recordAttempt(db, {
          ...common(candidate),
          outcome,
          yieldCount: 0,
          costMicrousd: 0,
          durationMs: Date.now() - startedAt,
          detail: { fee_raw_id: candidate.feeRawId, model, error: message },
        });
      }
      result.results.push({ fee_raw_ids: batch.map((candidate) => candidate.feeRawId), outcome, error: message });
      continue;
    }

    result.costMicrousd += call.costMicrousd;
    const verdicts = parseVerdicts(paidResponseJson(call.message));
    const share = Math.floor(call.costMicrousd / batch.length);
    for (const candidate of batch) {
      result.processed += 1;
      const verdict = verdicts.get(candidate.feeRawId);
      if (!verdict) {
        result.failed += 1;
        await recordAttempt(db, {
          ...common(candidate),
          outcome: "parse_error",
          yieldCount: 0,
          costMicrousd: share,
          durationMs: Date.now() - startedAt,
          detail: { fee_raw_id: candidate.feeRawId, model },
        });
        continue;
      }
      result.succeeded += 1;
      const side = verdictSide(candidate, verdict);
      await recordAttempt(db, {
        ...common(candidate),
        // Shadow: agreeing with Knox's category is ok; anything else is evidence for a change.
        outcome: side === "knox" ? "ok" : "evidence_mismatch",
        yieldCount: side === "knox" ? 1 : 0,
        costMicrousd: share,
        durationMs: Date.now() - startedAt,
        detail: {
          fee_raw_id: candidate.feeRawId,
          fee_name: candidate.feeName,
          amount: candidate.amount,
          decision: candidate.decision,
          knox_key: candidate.knoxKey,
          suggested_key: candidate.suggestedKey,
          suggested_probability: candidate.suggestedProbability,
          is_fee: verdict.isFee,
          verdict_key: verdict.category,
          side,
          reason: verdict.reason,
          model,
        },
      });
      if (result.results.length < 50) {
        result.results.push({ fee_raw_id: candidate.feeRawId, decision: candidate.decision, knox_key: candidate.knoxKey, verdict_key: verdict.category, side });
      }
    }
  }
  return result;
}
