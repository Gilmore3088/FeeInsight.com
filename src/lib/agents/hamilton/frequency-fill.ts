import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { PERIOD_FEE_KEYS, settledFrequency } from "@/lib/fee-frequency";

type SqlTag = typeof sql;

/**
 * A live fee whose frequency is not the one its own schedule line states (Darwin's eval, Oct 8:
 * 48% of sampled live fees had none, and most of the wrong ones were blanks where the line says
 * "each", "per item" or "quarterly"). The line is the excerpt Knox read the fee from; the
 * fee's own row decides (`settledFrequency`), and only when it points one way.
 *
 * v2: a stated frequency read from another fee's row on the same line is corrected to what the
 * fee's own row says, or cleared when its row says nothing ("... per year .. $10.00 | Reverse
 * Stop Payment .. $20.00" gave the $20 fee "annual"; 25 of 131 stated frequencies in the
 * seven-state keys were wrong this way).
 *
 * Each change is logged to `pipeline_feedback` (check `hamilton.frequency_fill`, kind
 * `frequency_filled`, `frequency_corrected` or `frequency_cleared`, evidence `from` and `to`),
 * so it is reversed by setting the row's frequency back to `from`. The verified row gets the
 * same change when it held the same value, so a republish keeps it.
 */
export const FREQUENCY_FILL_CHECK = "hamilton.frequency_fill";
// v3: "ea.", "/page", "/transfer", "/card", "per order" and similar per-item wording.
// v4: "per loan", "per levy", "per stop payment", "/sheet", "/quarter", "per business day" and
// "one-time"; a period the line never states is cleared from a per-event fee; an allowance ("1 free
// per month") is not the fee's period (Darwin's 211-row eval, Oct 9).
// v5: "More than 2 per year" is an allowance, not the fee's period.
// v6: footnote marks ("per month6", "each2"), a cap ("up to a maximum of $5.00") and a second
// price's label ("$1.00/page Business: $3.00/page") no longer hide the fee's own words.
export const FREQUENCY_FILL_VERSION = 6;
export const FREQUENCY_FILL_LIMIT = 2_000;
/** Postgres pre-filter for a blank: an excerpt with any frequency word (`settledFrequency` decides). */
const CANDIDATE_WORDING = String.raw`excerpt=.*(each|every|per |monthly|annual|quarterly|yearly|a month|a year|\$\s?[0-9.,]+\s*ea\y|/\s?[a-z])`;
const PERIOD_KEYS_SQL = `ARRAY[${[...PERIOD_FEE_KEYS].map((key) => `'${key}'`).join(", ")}]::text[]`;
/** Postgres pre-filter for a stated frequency: a line holding more than one cell or price. */
const SHARED_LINE = String.raw`excerpt=.*(\|.*\$|\$.*\$)`;

interface BlankFrequencyRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  fee_raw_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  amount: number | string | null;
  frequency: string | null;
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
  from: string | null;
  frequency: string | null;
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
              fp.canonical_fee_key, fp.amount, fp.frequency, fr.conditions
         FROM published_fee_records fp
         LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        WHERE fp.rolled_back_at IS NULL
          AND fp.amount_kind = 'flat'
          AND fp.amount IS NOT NULL
          AND fr.conditions LIKE '%excerpt=%'
          -- A blank is read only on a line with frequency wording; a stated frequency only on a
          -- line it may have been borrowed across.
          AND ((fp.frequency IS NULL AND fr.conditions ~* '${CANDIDATE_WORDING}')
               OR (fp.frequency IS NOT NULL AND fr.conditions ~ '${SHARED_LINE}')
               -- v4: a stated period on a per-event fee, which the line may never state.
               OR fp.frequency = 'daily'
               OR (fp.frequency IN ('monthly', 'annual', 'quarterly') AND fp.canonical_fee_key <> ALL(${PERIOD_KEYS_SQL})))
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
    if (!sourceLine || !Number.isFinite(amount)) continue;
    const stated = row.frequency ?? null;
    const frequency = settledFrequency(sourceLine, amount, stated, row.canonical_fee_key);
    if (frequency === stated) continue;
    if (result.filled.length >= limit) break;
    result.filled.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      feeRawId: num(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount,
      from: stated,
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
            FROM unnest(${filled.map((fee) => fee.feePublishedId)}::bigint[], ${filled.map((fee) => fee.from)}::text[],
                        ${filled.map((fee) => fee.frequency)}::text[])
                 AS v(fee_published_id, from_frequency, frequency)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NOT DISTINCT FROM v.from_frequency
          RETURNING fp.fee_published_id
        `;
        const verified = filled.filter((fee) => fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET frequency = v.frequency
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId!)}::bigint[], ${verified.map((fee) => fee.from)}::text[],
                          ${verified.map((fee) => fee.frequency)}::text[])
                   AS v(fee_verified_id, from_frequency, frequency)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.frequency IS NOT DISTINCT FROM v.from_frequency
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
    kind: fee.from == null ? "frequency_filled" : fee.frequency == null ? "frequency_cleared" : "frequency_corrected",
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
    evidence: { from: fee.from, to: fee.frequency, source_line: fee.sourceLine },
    runId: options.runId,
    dedupeKey: fee.from == null ? `${FREQUENCY_FILL_CHECK}:fill:${fee.feePublishedId}` : `${FREQUENCY_FILL_CHECK}:fix:${fee.feePublishedId}:${fee.frequency ?? "none"}`,
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
