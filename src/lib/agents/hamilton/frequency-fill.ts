import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { frequencyFromLine, type FilledFrequency } from "@/lib/fee-frequency";

type SqlTag = typeof sql;

/**
 * A live fee with no frequency whose own schedule line states one (Darwin's eval, Oct 8: 48%
 * of sampled live fees had none, and most of the wrong ones were blanks where the line says
 * "each", "per item" or "quarterly"). The line is the excerpt Knox read the fee from; the
 * words right after the fee's own price decide (`frequencyFromLine`), and only when they point
 * one way. A stated frequency is never changed.
 *
 * Each fill is logged to `pipeline_feedback` (check `hamilton.frequency_fill`, kind
 * `frequency_filled`, evidence `from: null`), so a fill is reversed by setting the row's
 * frequency back to null. The verified row gets the same frequency when it has none, so a
 * republish keeps it.
 */
export const FREQUENCY_FILL_CHECK = "hamilton.frequency_fill";
export const FREQUENCY_FILL_VERSION = 1;
export const FREQUENCY_FILL_LIMIT = 2_000;
/** Postgres pre-filter: an excerpt with any frequency word (`frequencyFromLine` decides). */
const CANDIDATE_WORDING = String.raw`excerpt=.*(each|per |monthly|annual|quarterly|yearly|a month|a year|/\s?(mo|month|yr|year|item|check|transaction)\y)`;

interface BlankFrequencyRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  fee_raw_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  amount: number | string | null;
  conditions: string | null;
}

export interface FrequencyFill {
  feePublishedId: number;
  feeVerifiedId: number | null;
  feeRawId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number;
  frequency: FilledFrequency;
  sourceLine: string;
}

export interface FrequencyFillResult {
  scanned: number;
  filled: FrequencyFill[];
  dryRun: boolean;
}

/** The schedule line Knox read the fee from (`excerpt="..."` at the end of its conditions). */
export function excerptOf(conditions: string | null | undefined): string | null {
  const match = conditions?.match(/\bexcerpt="([\s\S]*)"\s*$/) ?? conditions?.match(/\bexcerpt=([\s\S]*)$/);
  return match ? match[1] : null;
}

export async function fillBlankFrequencies(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<FrequencyFillResult> {
  const limit = Math.max(1, Math.min(options.limit ?? FREQUENCY_FILL_LIMIT, 10_000));
  const result: FrequencyFillResult = { scanned: 0, filled: [], dryRun: options.dryRun };
  let rows: BlankFrequencyRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<BlankFrequencyRow[]>(
      `SELECT fp.fee_published_id, fv.fee_verified_id, fr.fee_raw_id, fp.institution_id, fr.source_document_id,
              fp.canonical_fee_key, fp.amount, fr.conditions
         FROM published_fee_records fp
         LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        WHERE fp.rolled_back_at IS NULL
          AND fp.frequency IS NULL
          AND fp.amount_kind = 'flat'
          AND fp.amount IS NOT NULL
          AND fr.conditions LIKE '%excerpt=%'
          -- Only lines with frequency wording are read; the rest can state none.
          AND fr.conditions ~* '${CANDIDATE_WORDING}'
          ${options.institutionId ? "AND fp.institution_id = $1" : ""}
        ORDER BY fp.fee_published_id`,
      options.institutionId ? [options.institutionId] : [],
    ));
  } catch (error) {
    console.error("fillBlankFrequencies read failed:", error);
    return result;
  }
  result.scanned = rows.length;
  for (const row of rows) {
    const amount = Number(row.amount);
    const sourceLine = excerptOf(row.conditions);
    const frequency = Number.isFinite(amount) ? frequencyFromLine(sourceLine, amount) : null;
    if (!frequency || !sourceLine) continue;
    if (result.filled.length >= limit) break;
    result.filled.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      feeRawId: num(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount,
      frequency,
      sourceLine: sourceLine.slice(0, 300),
    });
  }
  if (options.dryRun) return result;

  if (result.filled.length > 0) {
    try {
      const filled = result.filled;
      const updated = await inSavepoint(db, async (scope) => {
        const rows = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET frequency = v.frequency
            FROM unnest(${filled.map((fee) => fee.feePublishedId)}::bigint[], ${filled.map((fee) => fee.frequency)}::text[])
                 AS v(fee_published_id, frequency)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NULL
          RETURNING fp.fee_published_id
        `;
        const verified = filled.filter((fee) => fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET frequency = v.frequency
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId!)}::bigint[], ${verified.map((fee) => fee.frequency)}::text[])
                   AS v(fee_verified_id, frequency)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.frequency IS NULL
          `;
        }
        return new Set(rows.map((row) => Number(row.fee_published_id)));
      });
      result.filled = filled.filter((fee) => updated.has(fee.feePublishedId));
    } catch (error) {
      console.error("frequency fill failed:", error);
      result.filled = [];
    }
  }

  const lessons: FeedbackRow[] = result.filled.map((fee): FeedbackRow => ({
    aboutStage: "extract",
    signal: "wrong",
    kind: "frequency_filled",
    reportedBy: "hamilton",
    checkName: FREQUENCY_FILL_CHECK,
    aboutVersion: FREQUENCY_FILL_VERSION,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feeRawId: fee.feeRawId,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    evidence: { from: null, to: fee.frequency, source_line: fee.sourceLine },
    runId: options.runId,
    dedupeKey: `${FREQUENCY_FILL_CHECK}:fill:${fee.feePublishedId}`,
  }));
  if (lessons.length > 0) {
    try {
      await inSavepoint(db, (scope) => recordFeedback(scope as SqlTag, lessons));
    } catch (error) {
      console.error("frequency fill feedback failed:", error);
    }
  }
  if (result.filled.length > 0) invalidatePublicReadCache();
  return result;
}

function num(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}
