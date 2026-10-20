import { sql } from "@/lib/data-store/connection";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { lessonsForModel } from "@/lib/agents/learning/lesson-reader";
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
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

import { DARWIN_CATEGORY_MODEL_STRATEGY } from "./category-model";
import { DARWIN_RELEASE_ACTS, scheduleContext } from "./release-held";
import { stageDarwinReleaseReview, type StagedReleaseReview } from "./release-review";
import { loadReviewMisses, runDarwinVerdictScore, type ReviewMiss } from "./verdict-score";
import { loadSourceTexts, rawFeeFingerprint } from "./verify";
import { capturePaidSourceInputs, requireCurrentPaidInput, type SelectedPaidInput } from "./paid-input";
import { withLockedCurrentRawSource } from "./locked-raw-source";
import { VerificationAudienceDeferred } from "./verification-audience";
import { inSavepoint } from "@/lib/agents/savepoint";

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

/**
 * v2 (2026-10-07): each fee goes with the schedule rows around it and whether its amount
 * is stated as its price there. Scored against the answer keys, v1 was right on 27 of the
 * 37 disagreements at key banks, and three of its misses took a price from a neighbouring
 * row or a balance threshold ("Check Printing (fee depends on style)" at $3). v2 re-reads
 * the fees v1 disagreed on, so the two versions can be compared fee for fee.
 */
export const DARWIN_ADJUDICATE_STRATEGY = { strategy: "verify.adjudicate", version: 2 } as const;
/** Characters of the fee name used to find its row when the amount does not trace. */
const NAME_PROBE_CHARS = 40;
/** The model's probability for its own suggestion at or above which a reject qualifies. */
export const CONFIDENT_SUGGESTION = 0.9;
export const FEES_PER_CALL = 25;
/**
 * Pay for the adjudicator's shadow verdicts on every run. Off (#1111): its verdicts never
 * change a decision, so the calls bought nothing ($3.98 for 778 in October). A run passed
 * `measure: true` (a capped answer-key sample) still makes them.
 */
export const DARWIN_ADJUDICATE_SHADOW = false;
const MAX_OUTPUT_TOKENS = 4_000;
const TRANSIENT_OUTCOMES = ["timeout", "network_error", "http_429", "http_5xx", "budget_blocked"];
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);
const VALID_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));

export interface AdjudicationCandidate extends SelectedPaidInput {
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
  /** The rows around the fee in its stored schedule, when the fee is found there. */
  sourceContext?: string | null;
  /** "stated" when the amount is the fee's price on its row, else the source check's reason. */
  priceCheck?: string | null;
}

interface CandidateRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
  selected_attempt_id: number | string;
  selected_policy_state: string;
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

/**
 * Pure: the schedule rows around a fee and whether its amount is its price there
 * (the shared `checkFeeAgainstSource`). A fee whose amount does not trace is still
 * located by the start of its name, so the reviewer can see where the number came from.
 */
export function adjudicationSource(
  text: string | null | undefined,
  candidate: Pick<AdjudicationCandidate, "feeName" | "amount" | "knoxKey">,
): { sourceContext: string | null; priceCheck: string | null } {
  if (!text) return { sourceContext: null, priceCheck: "no_source_text" };
  if (candidate.amount != null && candidate.amount > 0) {
    const check = checkFeeAgainstSource(text, candidate.feeName, candidate.amount, ".", candidate.knoxKey);
    if (check.ok) return { sourceContext: scheduleContext(text, check.sourceLine), priceCheck: "stated" };
    const probe = candidate.feeName.trim().slice(0, NAME_PROBE_CHARS);
    return { sourceContext: probe ? scheduleContext(text, probe) : null, priceCheck: check.reason };
  }
  const probe = candidate.feeName.trim().slice(0, NAME_PROBE_CHARS);
  return { sourceContext: probe ? scheduleContext(text, probe) : null, priceCheck: null };
}

export function adjudicatePrompt(candidates: AdjudicationCandidate[], misses: ReviewMiss[] = []): string {
  const items = candidates.map((candidate) => ({
    id: candidate.feeRawId,
    fee_name: candidate.feeName,
    amount: candidate.amount,
    conditions: candidate.conditions,
    filed_as: candidate.knoxKey,
    alternative: candidate.suggestedKey,
    ...(candidate.sourceContext ? { schedule_rows_around: candidate.sourceContext } : {}),
    ...(candidate.priceCheck && candidate.priceCheck !== "stated" ? { price_check: candidate.priceCheck } : {}),
  }));
  return [
    "You check fees read from bank and credit union fee schedules. For each item decide:",
    "- is_fee: true only if the text names a price the institution charges a customer.",
    "  False for balance requirements, minimum deposits, limits, caps, rates, reimbursements or sentence fragments.",
    "  `schedule_rows_around` holds the fee's row with the rows above and below it in the bank's schedule.",
    "  Read it: is_fee is false when `amount` is not this fee's own price, for example a neighbouring row's price,",
    "  another column's, a balance the fee depends on, or a price the row says varies. `price_check` set means",
    "  an automatic check could not find `amount` as this fee's price on its row; take that as a warning, not proof.",
    "- category: the one canonical key below that the fee belongs to, or null if none fits.",
    "  `filed_as` and `alternative` are two guesses; either may be wrong.",
    "Return only JSON: {\"verdicts\": [{\"id\", \"is_fee\", \"category\", \"reason\"}]} with one entry per item and a reason of at most 12 words.",
    "",
    ...(misses.length > 0
      ? [
          "Your past mistakes on fees filed like these, checked against hand-keyed schedules. Do not repeat them:",
          JSON.stringify(misses.map((miss) => ({
            fee_name: miss.feeName,
            amount: miss.amount,
            filed_as: miss.filedAs,
            you_said: miss.said,
            schedule_says: miss.keySays.length > 0 ? miss.keySays : "no fee at this amount",
            schedule_line: miss.keyLine,
          }))),
          "",
        ]
      : []),
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

async function selectCandidates(db: SqlTag, scan: number, stateCode?: string, standingRawId?: number): Promise<AdjudicationCandidate[]> {
  const params: Array<string | number> = [];
  const modelStrategy = `$${params.push(DARWIN_CATEGORY_MODEL_STRATEGY.strategy)}`;
  const adjudicateStrategy = `$${params.push(DARWIN_ADJUDICATE_STRATEGY.strategy)}`;
  const confident = `$${params.push(CONFIDENT_SUGGESTION)}`;
  const version = `$${params.push(DARWIN_ADJUDICATE_STRATEGY.version)}::int`;
  const limit = `$${params.push(scan)}`;
  const normalizedState = normalizeStateCode(stateCode);
  const stateFilter = normalizedState ? `AND upper(btrim(inst.state_code)) = $${params.push(normalizedState)}` : "";
  // Keep DISTINCT ON's newest QUALIFYING model attempt, not latest-all. Narrowing
  // inside that query avoids changing a row's standing when unrelated scan order moves.
  const standingFilter = standingRawId == null ? "" : ` AND fr.fee_raw_id = $${params.push(standingRawId)}`;
  const rows = await db.unsafe<CandidateRow[]>(
    `
      SELECT * FROM (
        SELECT DISTINCT ON (fr.fee_raw_id)
               fr.fee_raw_id, fr.institution_id, fr.source_document_id, fr.fee_name, fr.amount, COALESCE(fr.extraction_note, fr.conditions) AS conditions,
               cm.id AS selected_attempt_id, jsonb_build_array(to_jsonb(fr),to_jsonb(cm))::text AS selected_policy_state,
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
           ${stateFilter}${standingFilter}
           -- Done at this version, or agreed with Knox at an earlier one; an earlier
           -- disagreement is read again with the schedule rows (v2).
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts done
              WHERE done.stage = 'verify'
                AND done.strategy = ${adjudicateStrategy}
                AND done.input_fingerprint = cm.input_fingerprint
                AND done.outcome NOT IN (${TRANSIENT_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})
                AND (done.strategy_version >= ${version} OR done.outcome <> 'evidence_mismatch')
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
    selectedAttemptId: Number(row.selected_attempt_id), selectedPolicyState: row.selected_policy_state,
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

/**
 * `measure`: make the paid calls even though neither pass can act, for a capped
 * measurement run. `releaseActs` overrides DARWIN_RELEASE_ACTS.
 */
type AdjudicateOptions = PaidStepOptions & { create?: PaidMessageCreator; measure?: boolean; releaseActs?: boolean };

export async function runDarwinAdjudicate(
  options: AdjudicateOptions,
): Promise<PaidPassResult> {
  const result = await reviewAndAdjudicate(options);
  if (options.dryRun) return result;
  // Score the reviews' new verdicts against the answer keys after every chunk (no model call).
  const db = options.db ?? sql;
  if (!(await learningSchemaReady(db))) return result;
  const score = await runDarwinVerdictScore(db, { runId: options.runId, stepId: options.stepId ?? null });
  if (score.chunks.length > 0 || score.reference.unbound > 0) result.results.push({ pass: "verdict_score", chunks: score.chunks, lessons: score.lessons, reference: score.reference });
  return result;
}

async function reviewAndAdjudicate(
  options: AdjudicateOptions,
): Promise<PaidPassResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  let calls = Math.min(Math.max(Math.floor(Number(options.limit) || PAID_PASS_ITEMS_PER_RUN), 1), PAID_PASS_ITEMS_PER_RUN);
  if (!(await learningSchemaReady(db))) return result;

  // Pay only for verdicts that can act (#1111). A dry run spends nothing, so it still lists both.
  const releaseActs = options.releaseActs ?? DARWIN_RELEASE_ACTS;
  const reviewPays = dryRun || releaseActs || Boolean(options.measure);
  const adjudicatePays = dryRun || DARWIN_ADJUDICATE_SHADOW || Boolean(options.measure);
  if (!reviewPays) result.results.push({ pass: "release_review", skipped: "releases are off, so a verdict would change nothing" });
  if (!adjudicatePays) result.results.push({ pass: "adjudicate", skipped: "shadow verdicts are off; they never change a decision" });

  let stagedReview: StagedReleaseReview | undefined;
  let stagedAdjudication: StagedAdjudication | undefined;
  try {
    if (reviewPays) {
      stagedReview = await stageDarwinReleaseReview({ ...options, db, calls, acts: releaseActs });
      if (stagedReview.collectionFailure) throw stagedReview.collectionFailure.error;
      calls -= stagedReview.result.calls;
    }
    if (!stagedReview?.result.budgetStopped && calls > 0 && adjudicatePays) {
      stagedAdjudication = await stageAdjudication({ ...options, db }, calls);
      if (stagedAdjudication.collectionFailure) throw stagedAdjudication.collectionFailure.error;
    }
  } finally {
    // No provider call remains possible. Settle returned work once, in the same
    // review→adjudication order, even if later collection or earlier settlement fails.
    try {
      if (stagedReview) {
        const review = await stagedReview.settle();
        result.selected += review.selected;
        result.processed += review.processed;
        result.succeeded += review.succeeded;
        result.failed += review.failed;
        result.costMicrousd += review.costMicrousd;
        result.results.push(...review.results.slice(0, 10).map((entry) => ({ ...entry, pass: "release_review" })));
        if (review.calls > 0) result.results.push({ pass: "release_review", lessons: review.lessons });
        if (review.deferred) result.results.push({
          pass: "release_review", deferred: review.deferred,
          samples: review.audienceDeferrals?.slice(0, 25) ?? []
        });
        if (review.budgetStopped) { result.budgetStopped = true; result.budgetReason = review.budgetReason; }
      }
    } finally {
      if (stagedAdjudication) {
        const adjudication = await stagedAdjudication.settle();
        result.selected += adjudication.selected;
        result.processed += adjudication.processed;
        result.succeeded += adjudication.succeeded;
        result.failed += adjudication.failed;
        result.costMicrousd += adjudication.costMicrousd;
        result.results.push(...adjudication.results);
        if (adjudication.budgetStopped) { result.budgetStopped = true; result.budgetReason = adjudication.budgetReason; }
      }
    }
  }
  return result;
}

interface StagedAdjudication {
  readonly result: PaidPassResult;
  readonly collectionFailure?: { readonly error: unknown };
  settle(): Promise<PaidPassResult>;
}

async function stageAdjudication(options: AdjudicateOptions, calls: number): Promise<StagedAdjudication> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result = emptyPaidPassResult(dryRun);
  let settlement = async () => result;
  let settled = false;
  let collectionFailure: StagedAdjudication["collectionFailure"];
  const staged = (): StagedAdjudication => ({
    result, collectionFailure, settle: async () => {
      if (settled) throw new Error("Adjudication settlement already consumed");
      settled = true;
      return settlement();
    }
  });

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
    return staged();
  }

  const texts = await loadSourceTexts(db, [
    ...new Set(candidates.flatMap((candidate) => (candidate.sourceDocumentId == null ? [] : [candidate.sourceDocumentId]))),
  ]);
  for (const candidate of candidates) {
    Object.assign(
      candidate,
      adjudicationSource(candidate.sourceDocumentId == null ? null : texts.get(candidate.sourceDocumentId), candidate),
    );
  }

  const sourceInputs = await capturePaidSourceInputs(db, texts);
  const misses = await loadReviewMisses(db, "verify.adjudicate", candidates.map((candidate) => candidate.knoxKey));
  const model = PAID_PASS_MODELS.verify();
  // Darwin's role lessons ride every adjudication as instructions (learning/lesson-reader.ts).
  const roleLessons = lessonsForModel("darwin", "verify-paid");
  const returned: Array<{
    batch: AdjudicationCandidate[]; lessonCount: number; durationMs: number; share: number;
    verdicts: Map<number, AdjudicationVerdict>;
    failure?: { outcome: AttemptOutcome; message: string };
  }> = [];
  settlement = async () => {
    let deferred = 0;
    const samples: Array<{ feeRawId: number; reason: string }> = [];
    for (const { batch, lessonCount, durationMs, share, verdicts, failure } of returned) {
      const failedIds: number[] = [];
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
      for (const candidate of batch) {
        try {
          await inSavepoint(db, async scope => {
            const context = await withLockedCurrentRawSource(scope, candidate.feeRawId);
            await requireCurrentPaidInput(scope, candidate.feeRawId, candidate, context,
              sourceInputs.get(Number(candidate.sourceDocumentId)));
            const [standing] = await selectCandidates(scope, 1, options.stateCode, candidate.feeRawId);
            if (!standing || !qualifies(standing) || standing.selectedAttemptId !== candidate.selectedAttemptId ||
                standing.selectedPolicyState !== candidate.selectedPolicyState) {
              throw new VerificationAudienceDeferred("paid_input:standing_changed");
            }
            result.processed += 1;
            if (failure) {
              result.failed += 1;
              await recordAttempt(scope, {
                ...common(candidate), outcome: failure.outcome, yieldCount: 0,
                costMicrousd: 0, durationMs, detail: { fee_raw_id: candidate.feeRawId, model, error: failure.message }
              });
              failedIds.push(candidate.feeRawId);
              return;
            }
            const verdict = verdicts.get(candidate.feeRawId);
            if (!verdict) {
              result.failed += 1;
              await recordAttempt(scope, {
                ...common(candidate),
                outcome: "parse_error",
                yieldCount: 0,
                costMicrousd: share,
                durationMs,
                detail: { fee_raw_id: candidate.feeRawId, model },
              });
              return;
            }
            result.succeeded += 1;
            const side = verdictSide(candidate, verdict);
            await recordAttempt(scope, {
              ...common(candidate),
              // Shadow: agreeing with Knox's category is ok; anything else is evidence for a change.
              outcome: side === "knox" ? "ok" : "evidence_mismatch",
              yieldCount: side === "knox" ? 1 : 0,
              costMicrousd: share,
              durationMs,
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
                price_check: candidate.priceCheck ?? null,
                lessons: lessonCount,
                source_context: candidate.sourceContext ?? null,
                model,
              },
            });
            if (result.results.length < 50) {
              result.results.push({ fee_raw_id: candidate.feeRawId, decision: candidate.decision, knox_key: candidate.knoxKey, verdict_key: verdict.category, side });
            }
          });
        } catch (error) {
          if (!(error instanceof VerificationAudienceDeferred)) throw error;
          deferred += 1;
          if (samples.length < 25) samples.push({ feeRawId: candidate.feeRawId, reason: error.reason });
        }
      }
      if (failure && failedIds.length) result.results.push({ fee_raw_ids: failedIds, outcome: failure.outcome, error: failure.message });
    }
    if (deferred) result.results.push({ pass: "adjudicate", deferred, samples });
    return result;
  };
  try {
    for (let start = 0; start < candidates.length; start += FEES_PER_CALL) {
      const batch = candidates.slice(start, start + FEES_PER_CALL);
      const batchKeys = new Set(batch.map(candidate => candidate.knoxKey));
      const batchMisses = misses.filter(miss => miss.filedAs != null && batchKeys.has(miss.filedAs));
      const startedAt = Date.now();
      let call: Awaited<ReturnType<typeof paidModelCall>>;
      try {
        call = await paidModelCall({
          agent: "darwin",
          operation: "adjudicate",
          runId: options.runId,
          params: {
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
            ...(roleLessons.system ? { system: roleLessons.system } : {}),
            messages: [{ role: "user", content: adjudicatePrompt(batch, batchMisses) }],
          },
          create: options.create,
          metadata: { fee_raw_ids: batch.map((candidate) => candidate.feeRawId), lessons_applied: roleLessons.lessonIds },
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
        returned.push({
          batch, lessonCount: batchMisses.length, durationMs: Date.now() - startedAt,
          share: 0, verdicts: new Map(), failure: { outcome, message }
        });
        continue;
      }

      result.costMicrousd += call.costMicrousd;
      const durationMs = Date.now() - startedAt;
      returned.push({
        batch, lessonCount: batchMisses.length, durationMs,
        share: Math.floor(call.costMicrousd / batch.length), verdicts: parseVerdicts(paidResponseJson(call.message))
      });

    }
  } catch (error) {
    collectionFailure = { error };
  }
  return staged();
}
