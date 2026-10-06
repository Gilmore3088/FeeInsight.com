import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import {
  emptyPaidPassResult,
  PAID_PASS_MODELS,
  paidModelCall,
  paidResponseJson,
  type PaidMessageCreator,
  type PaidPassResult,
  type PaidStepOptions,
} from "@/lib/agents/paid-pass";
import { CANONICAL_KEY_MAP, DISPLAY_NAMES } from "@/lib/fee-taxonomy";

import {
  DARWIN_RELEASE_ACTS,
  DARWIN_RELEASE_STRATEGY,
  releaseHeldFee,
  type HeldFeeRow,
} from "./release-held";
import { rawFeeFingerprint } from "./verify";

type SqlTag = typeof sql;

/**
 * The last gate before a held fee is released (release-held.ts): Claude reads each fee
 * the free checks would release beside the line of the bank's schedule it came from, and
 * says whether it is a price the bank charges, whether it belongs in the category it was
 * filed under, and whether the amount is the price (not a cap, limit, threshold or a
 * misread number). Only a fee that passes all three is released.
 *
 * Runs in Darwin's `verify-paid` provider step, before the layer 3 adjudicator, with
 * every call budget-checked and cost-logged under Darwin's own policy (`agent:darwin`).
 * With DARWIN_RELEASE_ACTS off it records verdicts only.
 */
export const DARWIN_RELEASE_REVIEW_STRATEGY = {
  strategy: "verify.release_review",
  version: DARWIN_RELEASE_STRATEGY.version,
} as const;
export const RELEASE_REVIEW_FEES_PER_CALL = 25;
const MAX_OUTPUT_TOKENS = 4_000;
const TRANSIENT_OUTCOMES = ["timeout", "network_error", "http_429", "http_5xx", "budget_blocked"];
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);

export interface ReleaseReviewCandidate {
  row: HeldFeeRow;
  sourceLine: string;
}

export interface ReleaseReviewVerdict {
  isFee: boolean;
  categoryFits: boolean;
  amountIsPrice: boolean;
  reason: string | null;
}

export function reviewPasses(verdict: ReleaseReviewVerdict | undefined): boolean {
  return Boolean(verdict?.isFee && verdict.categoryFits && verdict.amountIsPrice);
}

/** Names the taxonomy files under each category, so "fits" is judged by this index's own rules. */
const ALIASES_BY_KEY: ReadonlyMap<string, string[]> = (() => {
  const byKey = new Map<string, string[]>();
  for (const [alias, key] of Object.entries(CANONICAL_KEY_MAP)) {
    if (alias === key) continue;
    const list = byKey.get(key) ?? [];
    if (list.length < 12) list.push(alias.replace(/_/g, " "));
    byKey.set(key, list);
  }
  return byKey;
})();

export function releaseReviewPrompt(candidates: ReleaseReviewCandidate[]): string {
  const items = candidates.map(({ row, sourceLine }) => ({
    id: Number(row.fee_raw_id),
    fee_name: row.fee_name,
    amount: row.amount == null ? null : Number(row.amount),
    filed_as: `${row.held_canonical_fee_key} (${DISPLAY_NAMES[row.held_canonical_fee_key] ?? row.held_canonical_fee_key})`,
    filed_as_includes: ALIASES_BY_KEY.get(row.held_canonical_fee_key) ?? [],
    schedule_line: sourceLine.slice(0, 300),
  }));
  return [
    "You check fees read from bank and credit union fee schedules before they are published.",
    "Each item has the fee as it was read, the category it was filed under, and the line of the bank's schedule it came from.",
    "For each item decide, from the schedule line:",
    "- is_fee: true only if the line names a price the institution charges a customer.",
    "  False for balance requirements, minimum deposits, limits, rates, reimbursements or garbled text.",
    "- category_fits: true only if this fee is what `filed_as` means in this index; `filed_as_includes` lists fee names it files there.",
    "  A fee named for something else (an official check filed as NSF, an overdraft-protection transfer filed as overdraft) does not fit.",
    "- amount_is_price: true only if `amount` is the price the line charges for this fee.",
    "  False for a cap or maximum (\"5% of amount owed, $100 maximum\"), a threshold, another fee's price,",
    "  or a number misread from spaced or broken text (\"$ 5 5 . 0 0\" is $55).",
    "Return only JSON: {\"verdicts\": [{\"id\", \"is_fee\", \"category_fits\", \"amount_is_price\", \"reason\"}]} with one entry per item and a reason of at most 12 words.",
    "",
    "Items:",
    JSON.stringify(items),
  ].join("\n");
}

/** Pure: verdicts by fee id. A missing or non-true field reads as false. */
export function parseReleaseReviews(parsed: unknown): Map<number, ReleaseReviewVerdict> {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { verdicts?: unknown })?.verdicts)
      ? (parsed as { verdicts: unknown[] }).verdicts
      : [];
  const verdicts = new Map<number, ReleaseReviewVerdict>();
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    verdicts.set(id, {
      isFee: row.is_fee === true,
      categoryFits: row.category_fits === true,
      amountIsPrice: row.amount_is_price === true,
      reason: typeof row.reason === "string" ? row.reason.slice(0, 160) : null,
    });
  }
  return verdicts;
}

type CandidateRow = HeldFeeRow & { source_line: string };

async function selectReviewCandidates(db: SqlTag, limit: number, stateCode?: string): Promise<ReleaseReviewCandidate[]> {
  const params: Array<string | number> = [
    limit,
    DARWIN_RELEASE_STRATEGY.strategy,
    DARWIN_RELEASE_STRATEGY.version,
    DARWIN_RELEASE_REVIEW_STRATEGY.strategy,
    DARWIN_RELEASE_REVIEW_STRATEGY.version,
  ];
  const state = normalizeStateCode(stateCode);
  const stateFilter = state ? `AND upper(btrim(inst.state_code)) = $${params.push(state)}` : "";
  const rows = await db.unsafe<CandidateRow[]>(
    `
      SELECT fr.fee_raw_id,
             fr.institution_id,
             fr.source_url,
             fr.document_r2_key,
             fr.extraction_confidence,
             fr.fee_name,
             fr.amount,
             fr.frequency,
             fr.outlier_flags,
             fr.conditions,
             inst.institution_name,
             fr.source_document_id,
             upper(btrim(inst.state_code)) AS state_code,
             rel.detail->>'held_reason' AS held_reason,
             rel.detail->>'canonical_fee_key' AS held_canonical_fee_key,
             rel.detail->>'source_line' AS source_line
        FROM pipeline_attempts rel
        JOIN raw_fee_observations fr ON fr.fee_raw_id = substring(rel.input_fingerprint from 5)::bigint
        JOIN institution_sources inst ON inst.id = fr.institution_id
       WHERE rel.stage = 'verify'
         AND rel.strategy = $2
         AND rel.strategy_version = $3
         AND rel.detail->>'verdict' = 'review'
         AND rel.detail->>'source_line' IS NOT NULL
         ${stateFilter}
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts done
            WHERE done.input_fingerprint = rel.input_fingerprint
              AND done.strategy = $4
              AND done.strategy_version = $5
              AND done.outcome NOT IN (${TRANSIENT_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})
         )
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       ORDER BY rel.created_at ASC, fr.fee_raw_id ASC
       LIMIT $1
    `,
    params,
  );
  return (rows ?? []).map(({ source_line, ...row }) => ({ row: row as HeldFeeRow, sourceLine: source_line }));
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

export interface ReleaseReviewResult extends PaidPassResult {
  calls: number;
  passed: number;
  released: number;
}

/** Review up to `calls` batches of release candidates; release the ones that pass when acting. */
export async function runDarwinReleaseReview(
  options: PaidStepOptions & { create?: PaidMessageCreator; calls: number },
): Promise<ReleaseReviewResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result: ReleaseReviewResult = { ...emptyPaidPassResult(dryRun), calls: 0, passed: 0, released: 0 };
  if (options.calls <= 0 || !(await learningSchemaReady(db))) return result;

  const candidates = await selectReviewCandidates(db, options.calls * RELEASE_REVIEW_FEES_PER_CALL, options.stateCode);
  result.selected = candidates.length;
  if (dryRun) {
    result.results = candidates.slice(0, 50).map(({ row }) => ({
      fee_raw_id: Number(row.fee_raw_id),
      canonical_fee_key: row.held_canonical_fee_key,
      review: "would_review",
    }));
    return result;
  }

  const acts = DARWIN_RELEASE_ACTS;
  const model = PAID_PASS_MODELS.verify();
  for (let start = 0; start < candidates.length; start += RELEASE_REVIEW_FEES_PER_CALL) {
    const batch = candidates.slice(start, start + RELEASE_REVIEW_FEES_PER_CALL);
    const startedAt = Date.now();
    const common = ({ row }: ReleaseReviewCandidate) => ({
      institutionId: Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      stage: "verify" as const,
      strategy: DARWIN_RELEASE_REVIEW_STRATEGY.strategy,
      version: DARWIN_RELEASE_REVIEW_STRATEGY.version,
      fingerprint: rawFeeFingerprint(Number(row.fee_raw_id)),
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
    });
    let call: Awaited<ReturnType<typeof paidModelCall>>;
    try {
      call = await paidModelCall({
        agent: "darwin",
        operation: "release_review",
        runId: options.runId,
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: releaseReviewPrompt(batch) }],
        },
        create: options.create,
        metadata: { fee_raw_ids: batch.map(({ row }) => Number(row.fee_raw_id)) },
      });
    } catch (error) {
      if (isStopError(error)) {
        result.budgetStopped = true;
        result.budgetReason = error instanceof Error ? error.message : String(error);
        break;
      }
      result.calls += 1;
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
          detail: { fee_raw_id: Number(candidate.row.fee_raw_id), model, error: message },
        });
      }
      continue;
    }

    result.calls += 1;
    result.costMicrousd += call.costMicrousd;
    const verdicts = parseReleaseReviews(paidResponseJson(call.message));
    const share = Math.floor(call.costMicrousd / batch.length);
    for (const candidate of batch) {
      const feeRawId = Number(candidate.row.fee_raw_id);
      result.processed += 1;
      const verdict = verdicts.get(feeRawId);
      if (!verdict) {
        result.failed += 1;
        await recordAttempt(db, {
          ...common(candidate),
          outcome: "parse_error",
          yieldCount: 0,
          costMicrousd: share,
          durationMs: Date.now() - startedAt,
          detail: { fee_raw_id: feeRawId, model },
        });
        continue;
      }
      result.succeeded += 1;
      const passes = reviewPasses(verdict);
      if (passes) result.passed += 1;
      let feeVerifiedId: number | null = null;
      if (passes && acts) {
        feeVerifiedId = (await releaseHeldFee(db, { runId: options.runId, row: candidate.row, sourceLine: candidate.sourceLine })).feeVerifiedId;
        if (feeVerifiedId != null) result.released += 1;
      }
      await recordAttempt(db, {
        ...common(candidate),
        outcome: passes ? "ok" : "rejected",
        yieldCount: feeVerifiedId != null ? 1 : 0,
        costMicrousd: share,
        durationMs: Date.now() - startedAt,
        detail: {
          fee_raw_id: feeRawId,
          fee_name: candidate.row.fee_name,
          canonical_fee_key: candidate.row.held_canonical_fee_key,
          amount: candidate.row.amount == null ? null : Number(candidate.row.amount),
          held_reason: candidate.row.held_reason,
          source_line: candidate.sourceLine.slice(0, 300),
          is_fee: verdict.isFee,
          category_fits: verdict.categoryFits,
          amount_is_price: verdict.amountIsPrice,
          passes,
          reason: verdict.reason,
          fee_verified_id: feeVerifiedId,
          acted: acts,
          model,
        },
      });
      if (result.results.length < 50) {
        result.results.push({ fee_raw_id: feeRawId, passes, reason: verdict.reason });
      }
    }
  }
  return result;
}
