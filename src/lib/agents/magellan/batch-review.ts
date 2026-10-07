import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

import { LINK_YIELD_CHECK } from "./outcomes";

type SqlTag = typeof sql;

/**
 * Magellan's error review, run after every chunk of BATCH_SIZE judged links.
 *
 * The outcome ledger (`outcomes.ts`) judges each link Magellan handed downstream. Every
 * time BATCH_SIZE more links have a judgement, this review scores that chunk against
 * everything later agents said about it:
 *   - the ledger's own verdict (live fees, thin, ruled out by Rosetta, dead, business-only,
 *     fees a second look confirmed wrong);
 *   - Darwin's verdicts on fees read from the link (`darwin` rows on the same address):
 *     a link whose fees Darwin mostly rejected (at least DARWIN_MIN_WRONG) is an error;
 *   - the answer key: a bank with a confirmed answer key whose document is a different
 *     address is an error, the same address is a match.
 * It writes one `pipeline_feedback` row per finder strategy in the chunk (check
 * `magellan.batch_review`, signal `wrong` when at least WRONG_SHARE of that finder's links
 * were errors), with the error kinds and sample links as evidence. Discovery reads those
 * rows back (`loadDemotedFinders`): a finder whose last two reviews were both `wrong`
 * runs after the others until a review comes back right. Nothing here changes a link or
 * a fee.
 */
export const BATCH_REVIEW_CHECK = "magellan.batch_review";
export const BATCH_SIZE = 50;
/** At most this many chunks are reviewed per step, so a backlog drains over a few steps. */
export const MAX_BATCHES_PER_STEP = 4;
/** A finder is marked wrong in a chunk when this share of its links were errors. */
export const WRONG_SHARE = 0.4;
/** A finder needs this many links in a chunk for its verdict to count toward demotion. */
export const MIN_LINKS_FOR_VERDICT = 5;
/** A link is a Darwin error with at least this many rejected fees, outnumbering the passed ones. */
export const DARWIN_MIN_WRONG = 3;
const SAMPLE_ERRORS = 5;

export interface BatchLinkRow {
  id: number | string;
  institution_id: number | string | null;
  source_url: string | null;
  about_strategy: string | null;
  signal: string;
  kind: string;
  darwin_right: number | string | null;
  darwin_wrong: number | string | null;
  answer_key_url: string | null;
}

export interface FinderBatchScore {
  strategy: string | null;
  links: number;
  errors: number;
  errorShare: number;
  byKind: Record<string, number>;
  darwinErrors: number;
  answerKey: { matched: number; mismatched: number };
  samples: Array<{ institutionId: number | null; url: string | null; error: string }>;
}

export interface BatchReviewResult {
  ready: boolean;
  batches: number;
  links: number;
  errors: number;
  /** Finders marked wrong in a reviewed chunk. */
  wrongFinders: string[];
  written: number;
  /** Judged links still waiting for a full chunk. */
  waiting: number;
}

const num = (value: number | string | null | undefined) => (value == null ? 0 : Number(value));

function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const clean = (url: string) => url.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  return clean(a) === clean(b);
}

/** The error a link counts as, or null when later agents found nothing wrong with it. */
export function linkError(row: BatchLinkRow): string | null {
  if (row.signal === "wrong") return row.kind;
  const darwinWrong = num(row.darwin_wrong);
  if (darwinWrong >= DARWIN_MIN_WRONG && darwinWrong > num(row.darwin_right)) return "darwin_rejected_fees";
  if (row.answer_key_url && !sameAddress(row.answer_key_url, row.source_url)) return "answer_key_other_document";
  return null;
}

/** Scores one chunk of judged links, grouped by the finder that found each. */
export function scoreBatch(rows: BatchLinkRow[]): FinderBatchScore[] {
  const byStrategy = new Map<string | null, FinderBatchScore>();
  for (const row of rows) {
    const strategy = row.about_strategy ?? null;
    let score = byStrategy.get(strategy);
    if (!score) {
      score = { strategy, links: 0, errors: 0, errorShare: 0, byKind: {}, darwinErrors: 0, answerKey: { matched: 0, mismatched: 0 }, samples: [] };
      byStrategy.set(strategy, score);
    }
    score.links += 1;
    if (row.answer_key_url) {
      if (sameAddress(row.answer_key_url, row.source_url)) score.answerKey.matched += 1;
      else score.answerKey.mismatched += 1;
    }
    const error = linkError(row);
    if (!error) continue;
    score.errors += 1;
    score.byKind[error] = (score.byKind[error] ?? 0) + 1;
    if (error === "darwin_rejected_fees") score.darwinErrors += 1;
    if (score.samples.length < SAMPLE_ERRORS) {
      score.samples.push({ institutionId: row.institution_id == null ? null : Number(row.institution_id), url: row.source_url, error });
    }
  }
  for (const score of byStrategy.values()) score.errorShare = score.links ? score.errors / score.links : 0;
  return [...byStrategy.values()].sort((a, b) => b.links - a.links);
}

export function finderMarkedWrong(score: FinderBatchScore): boolean {
  return score.links >= MIN_LINKS_FOR_VERDICT && score.errorShare >= WRONG_SHARE;
}

export function batchFeedbackRows(
  scores: FinderBatchScore[],
  batch: { firstId: number; lastId: number; links: number; errors: number },
  runId: number | null,
): FeedbackRow[] {
  return scores.map((score) => ({
    aboutStage: "discover",
    aboutStrategy: score.strategy,
    signal: finderMarkedWrong(score) ? "wrong" : "right",
    kind: "batch_review",
    reportedBy: "magellan",
    checkName: BATCH_REVIEW_CHECK,
    weight: score.errors,
    evidence: {
      // Every row carries the chunk's last ledger id: the next review starts after it.
      last_link_feedback_id: batch.lastId,
      first_link_feedback_id: batch.firstId,
      batch_links: batch.links,
      batch_errors: batch.errors,
      links: score.links,
      errors: score.errors,
      error_share: Math.round(score.errorShare * 1000) / 1000,
      counts_toward_demotion: score.links >= MIN_LINKS_FOR_VERDICT,
      by_kind: score.byKind,
      darwin_errors: score.darwinErrors,
      answer_key: score.answerKey,
      samples: score.samples,
    },
    runId,
    dedupeKey: `${BATCH_REVIEW_CHECK}:${batch.lastId}:${score.strategy ?? "unknown"}`,
  }));
}

/** Reviews every full chunk of newly judged links (at most MAX_BATCHES_PER_STEP). Never throws. */
export async function reviewLinkBatches(
  db: SqlTag,
  options: { runId: number | null; dryRun?: boolean },
): Promise<BatchReviewResult> {
  const result: BatchReviewResult = { ready: false, batches: 0, links: 0, errors: 0, wrongFinders: [], written: 0, waiting: 0 };
  try {
    if (!(await feedbackSchemaReady(db))) return result;
    result.ready = true;
    const [cursorRow] = await inSavepoint(db, (scope) => scope<Array<{ cursor: number | string | null }>>`
      SELECT max((evidence->>'last_link_feedback_id')::bigint) AS cursor
        FROM pipeline_feedback
       WHERE check_name = ${BATCH_REVIEW_CHECK}
    `);
    const cursor = num(cursorRow?.cursor);
    const rows = await inSavepoint(db, (scope) => scope<BatchLinkRow[]>`
      -- next chunks of judged links
      SELECT f.id, f.institution_id, f.source_url, f.about_strategy, f.signal, f.kind,
             darwin.darwin_right, darwin.darwin_wrong,
             ak.document_url AS answer_key_url
        FROM pipeline_feedback f
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE d.signal = 'right') AS darwin_right,
                 count(*) FILTER (WHERE d.signal = 'wrong') AS darwin_wrong
            FROM pipeline_feedback d
           WHERE d.source_url = f.source_url
             AND d.institution_id = f.institution_id
             AND d.reported_by = 'darwin'
        ) darwin ON TRUE
        LEFT JOIN LATERAL (
          SELECT a.document_url FROM answer_key_institutions a
           WHERE a.institution_id = f.institution_id
             AND a.status = 'confirmed'
           ORDER BY a.confirmed_at DESC NULLS LAST
           LIMIT 1
        ) ak ON TRUE
       WHERE f.check_name = ${LINK_YIELD_CHECK}
         AND f.id > ${cursor}
       ORDER BY f.id ASC
       LIMIT ${BATCH_SIZE * MAX_BATCHES_PER_STEP + 1}
    `);
    const full = Math.min(MAX_BATCHES_PER_STEP, Math.floor(rows.length / BATCH_SIZE));
    result.waiting = rows.length - full * BATCH_SIZE;
    const writes: FeedbackRow[] = [];
    for (let index = 0; index < full; index += 1) {
      const chunk = rows.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
      const scores = scoreBatch(chunk);
      const errors = scores.reduce((total, score) => total + score.errors, 0);
      result.batches += 1;
      result.links += chunk.length;
      result.errors += errors;
      for (const score of scores) {
        if (score.strategy && finderMarkedWrong(score) && !result.wrongFinders.includes(score.strategy)) result.wrongFinders.push(score.strategy);
      }
      writes.push(...batchFeedbackRows(scores, {
        firstId: Number(chunk[0].id),
        lastId: Number(chunk[chunk.length - 1].id),
        links: chunk.length,
        errors,
      }, options.runId));
    }
    if (!options.dryRun && writes.length > 0) {
      result.written = await inSavepoint(db, (scope) => recordFeedback(scope, writes));
    }
  } catch (error) {
    // The review must never block the discovery step it runs in.
    console.error("reviewLinkBatches failed:", error);
  }
  return result;
}

/**
 * Finders whose last two chunk reviews (with enough links to count) both came back
 * wrong. Discovery runs them after the other finders until a review comes back right.
 */
export async function loadDemotedFinders(db: SqlTag): Promise<Set<string>> {
  try {
    if (!(await feedbackSchemaReady(db))) return new Set();
    const rows = await inSavepoint(db, (scope) => scope<Array<{ strategy: string }>>`
      SELECT about_strategy AS strategy
        FROM (
          SELECT about_strategy, signal,
                 row_number() OVER (PARTITION BY about_strategy ORDER BY id DESC) AS recent
            FROM pipeline_feedback
           WHERE check_name = ${BATCH_REVIEW_CHECK}
             AND about_strategy IS NOT NULL
             AND (evidence->>'counts_toward_demotion')::boolean IS TRUE
        ) reviews
       WHERE recent <= 2
       GROUP BY about_strategy
      HAVING count(*) = 2 AND bool_and(signal = 'wrong')
    `);
    return new Set(rows.map((row) => row.strategy));
  } catch (error) {
    console.error("loadDemotedFinders failed:", error);
    return new Set();
  }
}
