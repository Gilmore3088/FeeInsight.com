import type { sql } from "@/lib/data-store/connection";
import { checkFeeAgainstSource, type SourceCheckFailure } from "@/lib/custom-report/source-check";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { categoryOpinion, loadCategoryModel, type CategoryModel } from "./category-model";
import { withinAmountEnvelope } from "./envelopes";
import { recordDarwinFeedback } from "./feedback";
import { knoxStrategyFromFlags, type FeedbackRow } from "@/lib/agents/learning/feedback";
import {
  DARWIN_VERIFY_STRATEGY,
  insertVerifiedFee,
  loadSourceTexts,
  rawFeeFingerprint,
  type RawFeeRow,
} from "./verify";

type SqlTag = typeof sql;

/**
 * The way out for fees Darwin holds for review (James, 2026-10-06: "close all those
 * gaps"; the held-fees card's recommended option). A fee is held when its amount is
 * outside its category's range (`outside_envelope`) or far outside its state's peers
 * (`peer_outlier`), and until now nothing ever looked at it again.
 *
 * Each held fee is checked against the bank's own stored schedule with the shared
 * accuracy check (`checkFeeAgainstSource`):
 * - not stated: `reject`, with the source check's reason recorded.
 * - stated, but outside the category's hand-set range: `keep` for a person. Hamilton's
 *   publish gate uses the same range, so releasing it would not publish it.
 * - stated only as a tier (no single schedule line to show), or filed under a category
 *   Darwin's category model disputes: `keep`.
 * - otherwise `review`: Claude reads the fee beside its schedule line in the next
 *   `verify-paid` step (release-review.ts), and only a fee it confirms as a price the
 *   bank charges, in the category it was filed under, at that amount, is released.
 *
 * Version 1's dry run released on the schedule check alone, and a hand check of 20 of
 * its releases found 10 right: a name and amount on the schedule say nothing about the
 * category, and being far from peers was often a sign of a wrong category. Version 2
 * adds the gates above. Both versions record verdicts only until DARWIN_RELEASE_ACTS is
 * switched on, which bumps the version so every held fee is judged again.
 */
export const DARWIN_RELEASE_STRATEGY = { strategy: "verify.release", version: 2 } as const;
export const DARWIN_RELEASE_ACTS = false;
/**
 * Every fee the release publishes carries this flag on its verified row, so the whole
 * release can be found and rolled back.
 */
export const DARWIN_RELEASED_HOLD_FLAG = "darwin_released_hold";
export const DARWIN_RELEASE_BATCH = 200;

export type HeldReason = "outside_envelope" | "peer_outlier";
export type ReleaseVerdict = "review" | "reject" | "keep" | "duplicate";

export interface HeldFeeRow extends RawFeeRow {
  held_reason: HeldReason;
  held_canonical_fee_key: string;
}

export type ReleaseSourceCheck = "stated" | SourceCheckFailure | "no_amount" | "tiered_unconfirmed" | "category_disputed";

export interface ReleaseDecision {
  feeRawId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number | null;
  heldReason: HeldReason;
  verdict: ReleaseVerdict;
  sourceCheck: ReleaseSourceCheck;
  sourceLine: string | null;
  feeVerifiedId: number | null;
}

export interface RunDarwinReleaseResult {
  selected: number;
  acted: boolean;
  verdicts: Partial<Record<ReleaseVerdict, number>>;
  released: number;
  feedbackWritten: number | null;
  decisions: ReleaseDecision[];
}

function amountOf(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/** Pure: the verdict for one held fee, given its stored schedule text and Darwin's category model. */
export function releaseVerdict(
  row: Pick<HeldFeeRow, "fee_name" | "amount" | "held_reason" | "held_canonical_fee_key">,
  text: string | null | undefined,
  categoryModel: CategoryModel | null = null,
): { verdict: Exclude<ReleaseVerdict, "duplicate">; sourceCheck: ReleaseSourceCheck; sourceLine: string | null } {
  const amount = amountOf(row.amount);
  if (amount == null || amount <= 0) return { verdict: "reject", sourceCheck: "no_amount", sourceLine: null };
  const check = checkFeeAgainstSource(text, row.fee_name, amount, ".", row.held_canonical_fee_key);
  // A tiered price is the bank's real price for its band, as Darwin and Hamilton read it.
  const stated = check.ok || check.reason === "tiered_fee";
  if (!stated) return { verdict: "reject", sourceCheck: check.ok ? "stated" : check.reason, sourceLine: null };
  const sourceLine = check.ok ? check.sourceLine : null;
  if (row.held_reason === "outside_envelope" && !withinAmountEnvelope(row.held_canonical_fee_key, amount)) {
    return { verdict: "keep", sourceCheck: "stated", sourceLine };
  }
  // A tier has no single schedule line for a reviewer to read beside it.
  if (!sourceLine) return { verdict: "keep", sourceCheck: "tiered_unconfirmed", sourceLine: null };
  const opinion = categoryModel ? categoryOpinion(categoryModel, row.fee_name, row.held_canonical_fee_key) : null;
  if (opinion?.disputed) return { verdict: "keep", sourceCheck: "category_disputed", sourceLine };
  return { verdict: "review", sourceCheck: "stated", sourceLine };
}

/**
 * Publish one held fee the review confirmed: a verified row flagged
 * DARWIN_RELEASED_HOLD_FLAG (so the release can be found and rolled back) and a
 * "darwin_verified" note in the learning store. Null when an equal row already exists.
 */
export async function releaseHeldFee(
  db: SqlTag,
  options: { runId: number; row: HeldFeeRow; sourceLine: string | null },
): Promise<{ feeVerifiedId: number | null; feedbackWritten: number | null }> {
  const { row } = options;
  const feeVerifiedId = await insertVerifiedFee(db, {
    runId: options.runId,
    row,
    canonicalFeeKey: row.held_canonical_fee_key,
    extraFlags: [DARWIN_RELEASED_HOLD_FLAG],
  });
  if (feeVerifiedId == null) return { feeVerifiedId: null, feedbackWritten: null };
  const decision: ReleaseDecision = {
    feeRawId: Number(row.fee_raw_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.held_canonical_fee_key,
    amount: amountOf(row.amount),
    heldReason: row.held_reason,
    verdict: "review",
    sourceCheck: "stated",
    sourceLine: options.sourceLine,
    feeVerifiedId,
  };
  const entry = feedbackFor(decision, row, options.runId, "release");
  return { feeVerifiedId, feedbackWritten: entry ? await recordDarwinFeedback(db, [entry]) : null };
}

/** Same institution, category, amount and source as a fee already verified. */
function duplicateKey(institutionId: number, key: string, amount: number | null, source: string | null): string {
  return [institutionId, key, amount, (source ?? "").trim()].join("|");
}

async function selectHeldFees(db: SqlTag, limit: number, stateCode?: string, institutionId?: number): Promise<HeldFeeRow[]> {
  const params: Array<string | number> = [
    limit,
    DARWIN_VERIFY_STRATEGY.strategy,
    DARWIN_VERIFY_STRATEGY.version,
    DARWIN_RELEASE_STRATEGY.strategy,
    DARWIN_RELEASE_STRATEGY.version,
  ];
  const filters: string[] = [];
  const state = normalizeStateCode(stateCode);
  if (state) filters.push(`AND upper(btrim(inst.state_code)) = $${params.push(state)}`);
  if (institutionId) filters.push(`AND fr.institution_id = $${params.push(institutionId)}`);
  return db.unsafe<HeldFeeRow[]>(
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
             pa.detail->>'reason_code' AS held_reason,
             pa.detail->>'canonical_fee_key' AS held_canonical_fee_key
        FROM pipeline_attempts pa
        JOIN raw_fee_observations fr ON fr.fee_raw_id = substring(pa.input_fingerprint from 5)::bigint
        JOIN institution_sources inst ON inst.id = fr.institution_id
       WHERE pa.stage = 'verify'
         AND pa.strategy = $2
         AND pa.strategy_version = $3
         AND pa.input_fingerprint LIKE 'raw:%'
         AND pa.detail->>'decision' = 'needs_review'
         AND pa.detail->>'reason_code' IN ('outside_envelope', 'peer_outlier')
         AND pa.detail->>'canonical_fee_key' IS NOT NULL
         ${filters.join("\n         ")}
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts later
            WHERE later.input_fingerprint = pa.input_fingerprint
              AND later.strategy = pa.strategy
              AND later.strategy_version = pa.strategy_version
              AND later.created_at > pa.created_at
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts done
            WHERE done.input_fingerprint = pa.input_fingerprint
              AND done.strategy = $4
              AND done.strategy_version = $5
         )
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       ORDER BY pa.created_at ASC, fr.fee_raw_id ASC
       LIMIT $1
    `,
    params,
  );
}

async function loadVerifiedKeys(db: SqlTag, institutionIds: number[]): Promise<Set<string>> {
  if (institutionIds.length === 0) return new Set();
  const rows = await db<Array<{ institution_id: number | string; canonical_fee_key: string; amount: number | string | null; source_url: string | null }>>`
    SELECT institution_id, canonical_fee_key, amount, source_url
      FROM verified_fee_observations
     WHERE institution_id = ANY(${institutionIds}::int[])
  `;
  return new Set((rows ?? []).map((row) =>
    duplicateKey(Number(row.institution_id), row.canonical_fee_key, amountOf(row.amount), row.source_url)));
}

function feedbackFor(
  decision: ReleaseDecision,
  row: HeldFeeRow,
  runId: number,
  outcome: "release" | "reject",
): FeedbackRow | null {
  let flags: string[] = [];
  try {
    const parsed: unknown = typeof row.outlier_flags === "string" ? JSON.parse(row.outlier_flags) : row.outlier_flags;
    if (Array.isArray(parsed)) flags = parsed.map(String);
  } catch {
    flags = [];
  }
  return {
    aboutStage: "extract",
    aboutStrategy: knoxStrategyFromFlags(flags),
    signal: outcome === "release" ? "right" : "wrong",
    kind: outcome === "release" ? "darwin_verified" : "not_on_schedule",
    reportedBy: "darwin",
    checkName: "darwin.release",
    institutionId: decision.institutionId,
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    sourceUrl: row.source_url ?? null,
    feeRawId: decision.feeRawId,
    feeVerifiedId: decision.feeVerifiedId,
    canonicalFeeKey: decision.canonicalFeeKey,
    amount: decision.amount,
    weight: outcome === "release" ? 0.5 : 1,
    evidence: {
      fee_name: row.fee_name,
      held_reason: decision.heldReason,
      source_check: decision.sourceCheck,
      source_line: decision.sourceLine,
    },
    runId,
    dedupeKey: `darwin.release:raw:${decision.feeRawId}`,
  };
}

/**
 * Judge up to DARWIN_RELEASE_BATCH held fees. Nothing is published here: a `review`
 * verdict waits for release-review.ts. With DARWIN_RELEASE_ACTS on, a reject writes its
 * "not_on_schedule" note to the learning store (the fee was never live, so nothing comes
 * down). With it off, verdicts are recorded only; a dry-run agent run records nothing.
 */
export async function runDarwinReleaseHeld(options: {
  runId: number;
  stepId?: number;
  stateCode?: string;
  institutionId?: number;
  dryRun?: boolean;
  limit?: number;
  db: SqlTag;
}): Promise<RunDarwinReleaseResult> {
  const { db } = options;
  const learning = !options.dryRun && (await learningSchemaReady(db));
  const acts = DARWIN_RELEASE_ACTS && learning;
  const rows = await selectHeldFees(db, options.limit ?? DARWIN_RELEASE_BATCH, options.stateCode, options.institutionId);
  const texts = await loadSourceTexts(
    db,
    Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))),
  );
  const verified = await loadVerifiedKeys(db, Array.from(new Set(rows.map((row) => Number(row.institution_id)))));
  const categoryModel = rows.length > 0 ? await loadCategoryModel(db).catch(() => null) : null;

  const decisions: ReleaseDecision[] = [];
  const feedback: FeedbackRow[] = [];
  for (const row of rows) {
    const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id));
    const judged = releaseVerdict(row, text, categoryModel);
    const amount = amountOf(row.amount);
    const key = duplicateKey(Number(row.institution_id), row.held_canonical_fee_key, amount, row.source_url);
    let verdict: ReleaseVerdict = judged.verdict;
    if (verdict === "review" && verified.has(key)) verdict = "duplicate";
    else if (verdict === "review") verified.add(key);

    const decision: ReleaseDecision = {
      feeRawId: Number(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.held_canonical_fee_key,
      amount,
      heldReason: row.held_reason,
      verdict,
      sourceCheck: judged.sourceCheck,
      sourceLine: judged.sourceLine,
      feeVerifiedId: null,
    };
    decisions.push(decision);
    if (acts && verdict === "reject") {
      const entry = feedbackFor(decision, row, options.runId, "reject");
      if (entry) feedback.push(entry);
    }

    if (learning) {
      await recordAttempt(db, {
        institutionId: decision.institutionId,
        sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
        stage: "verify",
        strategy: DARWIN_RELEASE_STRATEGY.strategy,
        version: DARWIN_RELEASE_STRATEGY.version,
        fingerprint: rawFeeFingerprint(decision.feeRawId),
        outcome: verdict === "review" ? "ok" : verdict === "reject" ? "rejected" : "unchanged",
        yieldCount: 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        foldIntoPlaybook: false,
        detail: {
          fee_raw_id: decision.feeRawId,
          fee_name: row.fee_name,
          canonical_fee_key: decision.canonicalFeeKey,
          amount: decision.amount,
          held_reason: decision.heldReason,
          verdict,
          source_check: decision.sourceCheck,
          source_line: decision.sourceLine?.slice(0, 300) ?? null,
          acted: acts,
        },
      });
    }
  }

  const verdicts: Partial<Record<ReleaseVerdict, number>> = {};
  for (const decision of decisions) verdicts[decision.verdict] = (verdicts[decision.verdict] ?? 0) + 1;
  return {
    selected: rows.length,
    acted: acts,
    verdicts,
    released: 0,
    feedbackWritten: acts ? await recordDarwinFeedback(db, feedback) : null,
    decisions,
  };
}
