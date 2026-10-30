import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { amountEnvelopeFor, BOX_LATE_FEE_ENVELOPE, ESCHEAT_ENVELOPE, type AmountEnvelope } from "@/lib/agents/darwin/envelopes";
import { inSavepoint } from "@/lib/agents/savepoint";
import { restoreCategoryVerdict } from "@/lib/agents/hamilton/restore-guard";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

/** `ESCHEAT_NAME` as a Postgres regex (word start, any case via ~*). */
const ESCHEAT_SQL_PATTERN = "\\mescheat";
/** `BOX_LATE_FEE_NAME` as a Postgres regex (whole word, any case via ~*). */
const BOX_LATE_SQL_PATTERN = "\\mlate\\M";

/**
 * The ranges Darwin gives a fee by its own name as well as its category (`handEnvelopeFor`):
 * escheat processing (`ESCHEAT_ENVELOPE`) and a box late fee (`BOX_LATE_FEE_ENVELOPE`, #1912: the
 * box floor is a rent floor). The takedown and the restore read the same table, so a fee is judged
 * against the same range on the way down and on the way back.
 */
export const NAME_ENVELOPES: ReadonlyArray<{ key: string; sqlPattern: string; envelope: AmountEnvelope }> = [
  { key: "dormant_account", sqlPattern: ESCHEAT_SQL_PATTERN, envelope: ESCHEAT_ENVELOPE },
  { key: "safe_deposit_box", sqlPattern: BOX_LATE_SQL_PATTERN, envelope: BOX_LATE_FEE_ENVELOPE },
];

/**
 * SQL: true when `fp`'s amount sits inside its Darwin range, read by its name where a name range
 * applies (`NAME_ENVELOPES`), else by its category's range from the `env` join.
 */
export function inNameAwareEnvelopeSql(): string {
  const byName = NAME_ENVELOPES.map(
    ({ key, sqlPattern, envelope }) =>
      `WHEN fp.canonical_fee_key = '${key}' AND fp.fee_name ~* '${sqlPattern}' ` +
      `THEN fp.amount BETWEEN ${envelope.min} AND ${envelope.max}`,
  ).join("\n             ");
  return `CASE
             ${byName}
             ELSE fp.amount BETWEEN (env.bounds->>'min')::numeric AND (env.bounds->>'max')::numeric
           END`;
}

type SqlTag = typeof sql;

/** Live rows rolled back per publish step; later steps pick up the rest. */
export const OUTLIER_ROLLBACK_LIMIT = 500;
export const OUTLIER_ROLLBACK_REASON = "amount_outside_category_range";

export interface OutlierRollback {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

interface OutlierRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

/** Every canonical key with its Darwin range, as JSON for the SQL-side check. */
export function amountEnvelopesJson(): string {
  const out: Record<string, { min: number; max: number }> = {};
  for (const key of new Set(Object.values(CANONICAL_KEY_MAP))) out[key] = amountEnvelopeFor(key);
  return JSON.stringify(out);
}

function formatDollars(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function outlierReason(canonicalFeeKey: string, amount: number | null, feeName?: string | null): string {
  const envelope = amountEnvelopeFor(canonicalFeeKey, feeName);
  if (amount == null) return `Amount outside the ${canonicalFeeKey} range`;
  const side = amount > envelope.max ? "above" : "below";
  return (
    `Amount ${formatDollars(amount)} is ${side} the ${canonicalFeeKey} range ` +
    `(${formatDollars(envelope.min)}-${formatDollars(envelope.max)})`
  );
}

/**
 * Roll back live published rows whose amount is outside the Darwin range for their
 * category. Darwin and Hamilton now refuse such rows on the way in; this clears the
 * ones published before the ranges existed, so the catalog, benchmarks and reports
 * stop reading them. Rows are kept, not deleted: `rolled_back_at`, the run's batch id
 * and the reason say why, and clearing `rolled_back_at` restores a row a human
 * confirms is real (widen its range in the same change). Explicit $0 fees are left
 * alone. A dry run reports what it would roll back and writes nothing.
 */
export async function rollBackPublishedOutliers(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<OutlierRollback[]> {
  const params: Array<number | string> = [amountEnvelopesJson(), OUTLIER_ROLLBACK_LIMIT];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const outlierIds = `
        SELECT fp.fee_published_id
          FROM published_fee_records fp
          JOIN jsonb_each($1::jsonb) AS env(key, bounds) ON env.key = fp.canonical_fee_key
         WHERE fp.rolled_back_at IS NULL
           AND fp.amount > 0
           -- Escheat processing and a box late fee keep their own ranges (\`NAME_ENVELOPES\`), as Darwin verifies them.
           AND NOT (${inNameAwareEnvelopeSql()})
           ${institutionFilter}
         ORDER BY fp.fee_published_id
         LIMIT $2`;

  let rows: OutlierRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<OutlierRow[]>(
          `SELECT fee_published_id, institution_id, canonical_fee_key, fee_name, amount
             FROM published_fee_records
            WHERE fee_published_id IN (${outlierIds})`,
          params,
        );
      }
      return scope.unsafe<OutlierRow[]>(
        `UPDATE published_fee_records
            SET rolled_back_at = NOW(),
                rolled_back_by_batch_id = $${params.length + 1},
                rolled_back_reason = '${OUTLIER_ROLLBACK_REASON}'
          WHERE fee_published_id IN (${outlierIds})
        RETURNING fee_published_id, institution_id, canonical_fee_key, fee_name, amount`,
        [...params, options.batchId],
      );
    });
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("rollBackPublishedOutliers failed:", error);
    return [];
  }

  const rollbacks = rows.map((row) => {
    const amount = row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100;
    return {
      feePublishedId: Number(row.fee_published_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount,
      reason: outlierReason(row.canonical_fee_key, amount, row.fee_name),
    };
  });

  if (!options.dryRun && rollbacks.length > 0) {
    // Public benchmark reads are cached between publishes; drop rows that just left.
    invalidatePublicReadCache();
    const byCategory: Record<string, number> = {};
    for (const rollback of rollbacks) {
      byCategory[rollback.canonicalFeeKey] = (byCategory[rollback.canonicalFeeKey] ?? 0) + 1;
    }
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.outliers_rolled_back', 'completed',
          ${`Rolled back ${rollbacks.length} published fee(s) with amounts outside their category range`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: rollbacks.length,
            by_category: byCategory,
            samples: rollbacks.slice(0, 20).map((rollback) => ({
              fee_published_id: rollback.feePublishedId,
              institution_id: rollback.institutionId,
              canonical_fee_key: rollback.canonicalFeeKey,
              fee_name: rollback.feeName,
              amount: rollback.amount,
              reason: rollback.reason,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("outlier rollback event failed:", error);
    }
  }
  return rollbacks;
}

/** How many replacing copies the restore follows from a fee's own document to the bank's current copy. */
const SUPERSEDED_CHAIN_MAX_DEPTH = 20;

interface OutlierRestoreCandidate extends OutlierRow {
  source_document_id: number | string | null;
  /** The bank's current copy of that document (itself when nothing replaced it). */
  current_document_id?: number | string | null;
  /** The newest completed stored text of the current copy. */
  normalized_text: string | null;
}

export type OutlierRestoreVerdict = { restore: true } | { restore: false; reason: string };

/**
 * #1912: whether an outlier takedown now inside its range clears the restore bar, the same steps
 * every other restore path takes: (a) its source document has stored text (the newest completed text
 * of the bank's current copy of that document, the caller follows `superseded_by_id`), (b) the restore bar's
 * category step passes on that text (`restoreCategoryVerdict`, with `restoreGuardContext`), and
 * (c) the shared source check finds its name and amount on it (`checkFeeAgainstSource`). Pure.
 */
export function outlierRestoreVerdict(
  row: Pick<OutlierRestoreCandidate, "canonical_fee_key" | "fee_name" | "amount" | "source_document_id" | "normalized_text">,
): OutlierRestoreVerdict {
  const amount = row.amount == null ? null : Number(row.amount);
  if (row.source_document_id == null) return { restore: false, reason: "no_source_document" };
  if (!row.normalized_text?.trim()) return { restore: false, reason: "no_stored_text" };
  if (amount == null || !Number.isFinite(amount)) return { restore: false, reason: "no_amount" };
  const fee = { feeName: row.fee_name, amount, canonicalFeeKey: row.canonical_fee_key };
  const category = restoreCategoryVerdict(row.normalized_text, fee);
  if (!category.restore) return { restore: false, reason: category.reason };
  const traced = checkFeeAgainstSource(row.normalized_text, row.fee_name, amount, ".", row.canonical_fee_key);
  if (!traced.ok) return { restore: false, reason: `source_trace:${traced.reason}` };
  return { restore: true };
}

/**
 * The way back (James, Oct 7: a takedown is never final): an earlier outlier takedown
 * whose amount is inside today's range for its category (a range widened after review)
 * is restored, unless the institution already shows a live fee with that category and
 * amount. A dry run reports what it would restore and writes nothing.
 * #1912: "today's range" is read by the fee's name as the takedown reads it
 * (`inNameAwareEnvelopeSql`), so a box late fee taken down under the box's $5 rent floor, or escheat
 * processing above the monthly dormant ceiling, comes back once its own range takes it.
 * #1912 (coordinator, Oct 27): a range alone never brings a fee back. Like every other restore path,
 * a candidate comes back only over `outlierRestoreVerdict`: the bank's current copy of its source
 * document (followed through `superseded_by_id`) has stored text, the
 * restore bar's category step passes on that text (`restoreCategoryVerdict`), and the shared source
 * check finds its name and amount there (`checkFeeAgainstSource`). One that fails any step stays down.
 */
export async function restoreOutliersNowInRange(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number },
): Promise<OutlierRollback[]> {
  const params: Array<number | string> = [amountEnvelopesJson(), OUTLIER_ROLLBACK_LIMIT, OUTLIER_ROLLBACK_REASON];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  const inRangeIds = `
        SELECT fp.fee_published_id
          FROM published_fee_records fp
          JOIN jsonb_each($1::jsonb) AS env(key, bounds) ON env.key = fp.canonical_fee_key
         WHERE fp.rolled_back_at IS NOT NULL
           AND fp.rolled_back_reason = $3
           AND (${inNameAwareEnvelopeSql()})
           AND NOT EXISTS (
             SELECT 1 FROM published_fee_records live
              WHERE live.rolled_back_at IS NULL
                AND live.institution_id = fp.institution_id
                AND live.canonical_fee_key = fp.canonical_fee_key
                AND live.amount IS NOT DISTINCT FROM fp.amount
           )
           ${institutionFilter}
         ORDER BY fp.fee_published_id
         LIMIT $2`;
  let rows: OutlierRow[];
  const held: Array<{ feePublishedId: number; reason: string }> = [];
  try {
    // The candidates with the newest stored text of the bank's current copy of the source document
    // their lineage names: a superseded copy is followed (`superseded_by_id`) to the copy that
    // replaced it, so a fee comes back only on what the bank serves now, never on an old copy.
    const candidates = await inSavepoint(db, (scope) => scope.unsafe<OutlierRestoreCandidate[]>(
      `SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
              fr.source_document_id, cur.current_document_id, txt.normalized_text
         FROM published_fee_records fp
         LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         LEFT JOIN LATERAL (
           WITH RECURSIVE chain AS (
             SELECT sd.id, sd.superseded_by_id, 0 AS depth
               FROM source_documents sd
              WHERE sd.id = fr.source_document_id
             UNION ALL
             SELECT nxt.id, nxt.superseded_by_id, chain.depth + 1
               FROM chain
               JOIN source_documents nxt ON nxt.id = chain.superseded_by_id
              WHERE chain.depth < ${SUPERSEDED_CHAIN_MAX_DEPTH}
           )
           SELECT chain.id AS current_document_id FROM chain ORDER BY chain.depth DESC LIMIT 1
         ) cur ON TRUE
         LEFT JOIN LATERAL (
           SELECT ast.normalized_text
             FROM agent_source_texts ast
            WHERE ast.source_document_id = cur.current_document_id
              AND ast.status = 'completed'
              AND ast.normalized_text IS NOT NULL
            ORDER BY ast.id DESC
            LIMIT 1
         ) txt ON TRUE
        WHERE fp.fee_published_id IN (${inRangeIds})
        ORDER BY fp.fee_published_id`,
      params,
    ));
    const passing: OutlierRow[] = [];
    for (const candidate of candidates) {
      const verdict = outlierRestoreVerdict(candidate);
      if (verdict.restore) passing.push(candidate);
      else held.push({ feePublishedId: Number(candidate.fee_published_id), reason: verdict.reason });
    }
    if (options.dryRun || passing.length === 0) {
      rows = passing;
    } else {
      rows = await inSavepoint(db, (scope) => scope.unsafe<OutlierRow[]>(
        `UPDATE published_fee_records
            SET rolled_back_at = NULL,
                rolled_back_by_batch_id = NULL,
                rolled_back_reason = NULL
          WHERE fee_published_id = ANY($1::bigint[])
            AND rolled_back_at IS NOT NULL
            AND rolled_back_reason = $2
        RETURNING fee_published_id, institution_id, canonical_fee_key, fee_name, amount`,
        [passing.map((row) => Number(row.fee_published_id)), OUTLIER_ROLLBACK_REASON],
      ));
    }
  } catch (error) {
    console.error("restoreOutliersNowInRange failed:", error);
    return [];
  }
  const restores = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
    reason: `Amount is inside the ${row.canonical_fee_key} range today`,
  }));
  if (!options.dryRun && restores.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.outliers_restored', 'completed',
          ${`Restored ${restores.length} earlier outlier takedown(s) now inside their category range`},
          ${JSON.stringify({
            restored: restores.length,
            // In range but refused by the restore bar, with the step that refused each (#1912).
            held_by_restore_bar: held.length,
            held_samples: held.slice(0, 20).map((fee) => ({ fee_published_id: fee.feePublishedId, reason: fee.reason })),
            samples: restores.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("outlier restore event failed:", error);
    }
  }
  return restores;
}
