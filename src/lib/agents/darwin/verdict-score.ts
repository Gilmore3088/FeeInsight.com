import type { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

import answerKeyTexts from "./answer-key-fees.json";

type SqlTag = typeof sql;

/**
 * Darwin's paid reviews scored against the hand-keyed answer keys, after every chunk of
 * SCORE_CHUNK verdicts the keys can decide. Each chunk is one `verify.verdict_score`
 * attempt with its hit rate (and Knox's on the same fees), so a review's accuracy is a
 * live number rather than a hand check. Every miss is written to the learning store
 * (kind `review_wrong`), and the category review reads those misses as lessons before
 * its next call (`loadReviewMisses`).
 *
 * The keys are the 81 hand-keyed schedules in `src/lib/agents/knox/__fixtures__/`,
 * compacted to `answer-key-fees.json` (fee key, amount, first 100 characters of the line;
 * `verdict-score.test.ts` keeps the two in step). They are matched by institution: a
 * verdict on any fee of an institution whose schedule was keyed is scored.
 */

export const DARWIN_VERDICT_SCORE_STRATEGY = { strategy: "verify.verdict_score", version: 1 } as const;
/** Decided verdicts per scored chunk, so a chunk reads like the 20-fee hand checks. */
export const SCORE_CHUNK = 20;
export const REVIEW_MISS_KIND = "review_wrong";
export const REVIEW_MISS_CHECK = "darwin.verdict_score";
/**
 * The answer-key set whose misses never become lessons. A `holdout` key was never used while
 * writing rules, and a review that read its own holdout misses before the next call would score
 * on fees it had already been corrected on, so the holdout hit rate would overstate how the
 * review does on fees it has not seen. Holdout misses are still recorded (weight 0,
 * `lesson: false`) so the measurement keeps every miss; only `loadReviewMisses` skips them.
 */
export const HOLDOUT_SET = "holdout";
/** Attempts read per run while looking for verdicts at keyed institutions. */
const SCAN_LIMIT = 5_000;
const MISSES_PER_KEY = 3;

/** The reviews that are scored, with how each one's verdict reads. */
export const SCORED_REVIEWS = ["verify.adjudicate", "verify.release_review"] as const;
export type ScoredReview = (typeof SCORED_REVIEWS)[number];

type KeyFee = [key: string, amount: number | null, line: string];
interface KeyText {
  tid: number;
  set: string;
  fees: KeyFee[];
}

export const ANSWER_KEY_TEXTS = answerKeyTexts as KeyText[];

/** What a review said about one fee: is it a fee, and if so in which category (null: none fits). */
export interface ReviewClaim {
  feeName: string;
  amount: number | null;
  isFee: boolean;
  category: string | null;
}

export type ScoreResult = "right" | "wrong" | "unclear";

export interface ScoredClaim {
  result: ScoreResult;
  /** The key's categories for this fee's amount (related lines first), for the lesson. */
  keySays: string[];
  keyLine: string | null;
}

const STOP_WORDS = new Set(
  "the and for fee fees per each from with your that this will charge charged charges item items account accounts monthly month".split(" "),
);

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !STOP_WORDS.has(word)).map((word) => word.slice(0, 6)));
}

function related(feeName: string, line: string): boolean {
  const name = words(feeName);
  for (const word of words(line)) if (name.has(word)) return true;
  return false;
}

const sameAmount = (left: number | null, right: number | null) =>
  left != null && right != null && Math.abs(left - right) < 0.005;

/**
 * Pure: is a claim right by the bank's answer key? The key lists every fee on the schedule,
 * so a price the key does not have at that amount is not a fee. Several key fees often share
 * an amount ($5, $10), so the key's line must share a word with the fee's name before a
 * category it does not match counts as wrong; otherwise the claim is unclear.
 */
export function scoreClaim(claim: ReviewClaim, keyFees: KeyFee[]): ScoredClaim {
  const atAmount = claim.amount == null
    ? keyFees.filter(([, amount]) => amount == null)
    : keyFees.filter(([, amount]) => sameAmount(amount, claim.amount));
  const near = atAmount.filter(([, , line]) => related(claim.feeName, line));
  const pool = near.length > 0 ? near : atAmount;
  const keySays = [...new Set(pool.map(([key]) => key))];
  const keyLine = pool[0]?.[2] ?? null;
  const out = (result: ScoreResult): ScoredClaim => ({ result, keySays, keyLine });

  if (!claim.isFee) {
    // A cap or limit the review names in its own category (od_daily_cap) is keyed that way too.
    if (claim.category && pool.some(([key]) => key === claim.category)) return out("right");
    if (claim.amount === 0) return out("right");
    if (atAmount.length === 0) return out(claim.amount == null ? "unclear" : "right");
    if (atAmount.every(([, amount]) => amount === 0)) return out("right");
    if (near.some(([key]) => key !== "unmapped")) return out("wrong");
    return out("unclear");
  }
  if (claim.amount === 0) return out("wrong");
  if (atAmount.length === 0) return out(claim.amount == null ? "unclear" : "wrong");
  const category = claim.category ?? "unmapped";
  if (pool.some(([key]) => key === category)) return out("right");
  return out(near.length > 0 ? "wrong" : "unclear");
}

/** One stored verdict, read from its `pipeline_attempts` row. */
export interface StoredVerdict {
  attemptId: number;
  strategy: ScoredReview;
  version: number;
  institutionId: number;
  sourceDocumentId: number | null;
  feeRawId: number;
  feeName: string;
  amount: number | null;
  knoxKey: string | null;
  claim: ReviewClaim;
}

interface VerdictRow {
  id: number | string;
  strategy: string;
  strategy_version: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  detail: Record<string, unknown>;
}

const num = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Pure: the claim a stored attempt makes. A release review that passes says "a fee, in its held category". */
export function verdictFromRow(row: VerdictRow): StoredVerdict | null {
  const detail = row.detail ?? {};
  const feeRawId = num(detail.fee_raw_id);
  if (feeRawId == null) return null;
  const feeName = String(detail.fee_name ?? "");
  const amount = num(detail.amount);
  const strategy = row.strategy as ScoredReview;
  let claim: ReviewClaim;
  let knoxKey: string | null;
  if (strategy === "verify.adjudicate") {
    knoxKey = typeof detail.knox_key === "string" ? detail.knox_key : null;
    claim = { feeName, amount, isFee: detail.is_fee === true, category: typeof detail.verdict_key === "string" ? detail.verdict_key : null };
  } else if (strategy === "verify.release_review") {
    knoxKey = typeof detail.canonical_fee_key === "string" ? detail.canonical_fee_key : null;
    // A failed review only says "not this fee in this category", so it is scored as not a fee
    // when it judged the line not a fee or the amount not its price, and skipped otherwise.
    if (detail.passes === true) claim = { feeName, amount, isFee: true, category: knoxKey };
    else if (detail.is_fee === false || detail.amount_is_price === false) claim = { feeName, amount, isFee: false, category: null };
    else return null;
  } else {
    return null;
  }
  return {
    attemptId: Number(row.id),
    strategy,
    version: Number(row.strategy_version),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    feeRawId,
    feeName,
    amount,
    knoxKey,
    claim,
  };
}

export interface ChunkScore {
  fromAttemptId: number;
  toAttemptId: number;
  right: number;
  wrong: number;
  unclear: number;
  knoxRight: number;
  holdoutRight: number;
  holdoutWrong: number;
  misses: Array<{ verdict: StoredVerdict; scored: ScoredClaim; set: string }>;
  /** Closed short because its review version was retired; `right + wrong` is under `size`. */
  partial?: boolean;
}

/**
 * Pure: verdicts (in attempt order) cut into chunks of `size` decided verdicts. A chunk
 * that has not filled yet is left for the next run, so every chunk is the same size,
 * unless `closeOpen` is set: then the open chunk is returned too, marked `partial`, for a
 * review version that will get no more verdicts (the release review went v11 to v17 on
 * 2026-10-08 and no version reached 20 keyed verdicts, so no chunk was ever recorded).
 */
export function scoreChunks(
  verdicts: StoredVerdict[],
  keysByInstitution: Map<number, KeyText[]>,
  size = SCORE_CHUNK,
  closeOpen = false,
): ChunkScore[] {
  const chunks: ChunkScore[] = [];
  let current: ChunkScore | null = null;
  for (const verdict of verdicts) {
    const texts = keysByInstitution.get(verdict.institutionId);
    if (!texts || texts.length === 0) continue;
    const fees = texts.flatMap((text) => text.fees);
    const set = texts.some((text) => text.set === "holdout") ? "holdout" : "tuning";
    current ??= { fromAttemptId: verdict.attemptId, toAttemptId: verdict.attemptId, right: 0, wrong: 0, unclear: 0, knoxRight: 0, holdoutRight: 0, holdoutWrong: 0, misses: [] };
    current.toAttemptId = verdict.attemptId;
    const scored = scoreClaim(verdict.claim, fees);
    if (scored.result === "unclear") {
      current.unclear += 1;
      continue;
    }
    if (scored.result === "right") {
      current.right += 1;
      if (set === "holdout") current.holdoutRight += 1;
    } else {
      current.wrong += 1;
      if (set === "holdout") current.holdoutWrong += 1;
      current.misses.push({ verdict, scored, set });
    }
    if (verdict.knoxKey) {
      const knox = scoreClaim({ feeName: verdict.feeName, amount: verdict.amount, isFee: true, category: verdict.knoxKey }, fees);
      if (knox.result === "right") current.knoxRight += 1;
    }
    if (current.right + current.wrong >= size) {
      chunks.push(current);
      current = null;
    }
  }
  if (closeOpen && current && current.right + current.wrong > 0) chunks.push({ ...current, partial: true });
  return chunks;
}

let institutionKeys: { at: number; map: Map<number, KeyText[]> } | null = null;

/** The keyed texts by institution, read once an hour from `agent_source_texts`. */
async function loadKeysByInstitution(db: SqlTag): Promise<Map<number, KeyText[]>> {
  if (institutionKeys && Date.now() - institutionKeys.at < 60 * 60 * 1000) return institutionKeys.map;
  const byTid = new Map(ANSWER_KEY_TEXTS.map((text) => [text.tid, text]));
  const rows = await db<{ id: number | string; institution_id: number | string }[]>`
    SELECT id, institution_id FROM agent_source_texts WHERE id = ANY(${[...byTid.keys()]}::bigint[])
  `;
  const map = new Map<number, KeyText[]>();
  for (const row of rows) {
    const text = byTid.get(Number(row.id));
    if (!text || row.institution_id == null) continue;
    const list = map.get(Number(row.institution_id)) ?? [];
    list.push(text);
    map.set(Number(row.institution_id), list);
  }
  institutionKeys = { at: Date.now(), map };
  return map;
}

export interface VerdictScoreResult {
  chunks: Array<{ review: string; version: number; right: number; wrong: number; unclear: number; knox_right: number; to_attempt_id: number; partial: boolean }>;
  lessons: number;
}

/**
 * Score every review's verdicts since its last scored chunk, record each full chunk as a
 * `verify.verdict_score` attempt, and write each miss to the learning store. Deterministic
 * (no model call); a failure is logged and never blocks the step it runs in.
 */
export async function runDarwinVerdictScore(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
): Promise<VerdictScoreResult> {
  const result: VerdictScoreResult = { chunks: [], lessons: 0 };
  try {
    const keys = await loadKeysByInstitution(db);
    const institutions = [...keys.keys()];
    if (institutions.length === 0) return result;
    for (const review of SCORED_REVIEWS) {
      const rows = await inSavepoint(db, (scope) => scope<VerdictRow[]>`
        WITH last AS (
          SELECT COALESCE(max((detail->>'to_attempt_id')::bigint), 0) AS id
            FROM pipeline_attempts
           WHERE stage = 'verify'
             AND strategy = ${DARWIN_VERDICT_SCORE_STRATEGY.strategy}
             AND detail->>'review' = ${review}
        )
        SELECT a.id, a.strategy, a.strategy_version, a.institution_id, a.source_document_id, a.detail
          FROM pipeline_attempts a, last
         WHERE a.stage = 'verify'
           AND a.strategy = ${review}
           AND a.id > last.id
           AND a.outcome IN ('ok', 'evidence_mismatch', 'rejected')
           AND a.institution_id = ANY(${institutions}::bigint[])
         ORDER BY a.id
         LIMIT ${SCAN_LIMIT}::int
      `);
      const verdicts = rows.map(verdictFromRow).filter((verdict): verdict is StoredVerdict => verdict != null);
      // Versions are scored apart, so a new prompt starts its own record. A version below
      // the newest one seen gets no more verdicts, so its open chunk is closed as partial.
      const versions = [...new Set(verdicts.map((verdict) => verdict.version))].sort((a, b) => a - b);
      const newest = versions[versions.length - 1];
      for (const version of versions) {
        const retired = version < newest;
        for (const chunk of scoreChunks(verdicts.filter((verdict) => verdict.version === version), keys, SCORE_CHUNK, retired)) {
          await recordChunk(db, options, review, version, chunk);
          result.lessons += await recordMisses(db, options.runId, chunk);
          result.chunks.push({
            review,
            version,
            right: chunk.right,
            wrong: chunk.wrong,
            unclear: chunk.unclear,
            knox_right: chunk.knoxRight,
            to_attempt_id: chunk.toAttemptId,
            partial: chunk.partial === true,
          });
        }
      }
    }
  } catch (error) {
    console.warn("[darwin] verdict score failed", error instanceof Error ? error.message : error);
  }
  return result;
}

async function recordChunk(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  review: string,
  version: number,
  chunk: ChunkScore,
): Promise<void> {
  const decided = chunk.right + chunk.wrong;
  await recordAttempt(db, {
    institutionId: null,
    sourceDocumentId: null,
    stage: "verify",
    strategy: DARWIN_VERDICT_SCORE_STRATEGY.strategy,
    version: DARWIN_VERDICT_SCORE_STRATEGY.version,
    fingerprint: `score:${review}:v${version}:${chunk.toAttemptId}`,
    runId: options.runId,
    stepId: options.stepId ?? null,
    foldIntoPlaybook: false,
    // 19 of 20 is the bar James set for acting on a review's verdicts.
    outcome: chunk.right * 20 >= decided * 19 ? "ok" : "evidence_mismatch",
    yieldCount: chunk.right,
    costMicrousd: 0,
    durationMs: 0,
    detail: {
      review,
      review_version: version,
      from_attempt_id: chunk.fromAttemptId,
      to_attempt_id: chunk.toAttemptId,
      decided,
      // A short chunk closed when its review version was retired; read its hit_rate with `decided`.
      partial: chunk.partial === true,
      right: chunk.right,
      wrong: chunk.wrong,
      unclear: chunk.unclear,
      hit_rate: decided > 0 ? Math.round((chunk.right / decided) * 1000) / 1000 : null,
      knox_right: chunk.knoxRight,
      holdout: {
        right: chunk.holdoutRight,
        wrong: chunk.holdoutWrong,
        hit_rate: chunk.holdoutRight + chunk.holdoutWrong > 0
          ? Math.round((chunk.holdoutRight / (chunk.holdoutRight + chunk.holdoutWrong)) * 1000) / 1000
          : null,
      },
      misses: chunk.misses.map(({ verdict, scored, set }) => ({
        attempt_id: verdict.attemptId,
        fee_raw_id: verdict.feeRawId,
        fee_name: verdict.feeName.slice(0, 120),
        amount: verdict.amount,
        said: verdict.claim.isFee ? verdict.claim.category ?? "none fits" : "not a fee",
        key_says: scored.keySays,
        key_line: scored.keyLine,
        set,
      })),
    },
  });
}

/**
 * Pure: the learning-store rows for a chunk's misses. A tuning miss is a lesson (weight 1);
 * a holdout miss is kept for the record at weight 0 with `lesson: false`, and
 * `loadReviewMisses` never reads it back into a prompt.
 */
export function missRows(chunk: ChunkScore, runId: number): FeedbackRow[] {
  return chunk.misses.map(({ verdict, scored, set }) => ({
    aboutStage: "verify",
    aboutStrategy: verdict.strategy,
    aboutVersion: verdict.version,
    aboutAttemptId: verdict.attemptId,
    signal: "wrong",
    kind: REVIEW_MISS_KIND,
    reportedBy: "darwin",
    checkName: REVIEW_MISS_CHECK,
    institutionId: verdict.institutionId,
    sourceDocumentId: verdict.sourceDocumentId,
    feeRawId: verdict.feeRawId,
    canonicalFeeKey: verdict.knoxKey,
    amount: verdict.amount,
    weight: set === HOLDOUT_SET ? 0 : 1,
    evidence: {
      fee_name: verdict.feeName.slice(0, 160),
      said: verdict.claim.isFee ? verdict.claim.category ?? "none fits" : "not a fee",
      key_says: scored.keySays,
      key_line: scored.keyLine,
      answer_key_set: set,
      lesson: set !== HOLDOUT_SET,
    },
    runId,
    dedupeKey: `${REVIEW_MISS_CHECK}:attempt:${verdict.attemptId}`,
  }));
}

async function recordMisses(db: SqlTag, runId: number, chunk: ChunkScore): Promise<number> {
  if (chunk.misses.length === 0) return 0;
  if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return 0;
  return recordFeedback(db, missRows(chunk, runId));
}

/** A past miss of a Darwin review, in the words its prompt uses. */
export interface ReviewMiss {
  filedAs: string | null;
  feeName: string;
  amount: number | null;
  said: string;
  keySays: string[];
  keyLine: string | null;
}

/**
 * The most recent misses of one review on fees filed in these categories, newest first,
 * at most MISSES_PER_KEY per category. Holdout-key misses are never read: they are the
 * measurement, not the lesson (`HOLDOUT_SET`). Empty when the store is missing or unreadable.
 */
export async function loadReviewMisses(db: SqlTag, review: ScoredReview, keys: string[]): Promise<ReviewMiss[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return [];
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return [];
    const rows = await inSavepoint(db, (scope) => scope<{
      canonical_fee_key: string | null;
      amount: number | string | null;
      evidence: Record<string, unknown>;
    }[]>`
      SELECT canonical_fee_key, amount, evidence
        FROM (
          SELECT pf.canonical_fee_key, pf.amount, pf.evidence,
                 row_number() OVER (PARTITION BY pf.canonical_fee_key ORDER BY pf.created_at DESC) AS rank
            FROM pipeline_feedback pf
           WHERE pf.kind = ${REVIEW_MISS_KIND}
             AND pf.check_name = ${REVIEW_MISS_CHECK}
             AND pf.about_strategy = ${review}
             AND pf.canonical_fee_key = ANY(${unique}::text[])
             AND COALESCE(pf.evidence->>'answer_key_set', 'tuning') <> ${HOLDOUT_SET}
        ) ranked
       WHERE rank <= ${MISSES_PER_KEY}::int
    `);
    return rows.map((row) => ({
      filedAs: row.canonical_fee_key,
      feeName: String(row.evidence?.fee_name ?? "").slice(0, 120),
      amount: num(row.amount),
      said: String(row.evidence?.said ?? ""),
      keySays: Array.isArray(row.evidence?.key_says) ? (row.evidence.key_says as unknown[]).map(String) : [],
      keyLine: typeof row.evidence?.key_line === "string" ? row.evidence.key_line : null,
    }));
  } catch (error) {
    console.warn("[darwin] review misses unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}
