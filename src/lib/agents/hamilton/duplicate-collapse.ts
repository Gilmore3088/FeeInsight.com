import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { linesApartOnPage, nearNames, printedAtPrice, printedInPersonalAndBusinessSchedules } from "@/lib/agents/hamilton/publish";

type SqlTag = typeof sql;

/** Live duplicates closed per publish step; later steps pick up the rest. */
export const DUPLICATE_COLLAPSE_LIMIT = 500;
export const DUPLICATE_COLLAPSE_REASON_PREFIX = "duplicate of #";
const FREQUENCY_CLASS = `CASE
  WHEN fp.frequency IN ('per_item', 'per_occurrence', 'per_transaction', 'one_time') THEN 'each'
  WHEN fp.frequency = 'other' THEN NULL
  ELSE fp.frequency
END`;

export interface DuplicateCollapse {
  feePublishedId: number;
  keptFeePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
}

interface DuplicateRow {
  fee_published_id: number | string;
  kept_fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

/**
 * Close live published rows that repeat another live row exactly: same institution,
 * canonical key, variant, amount and fee name, with frequencies that agree (see
 * `FREQUENCY_CLASS`). Before content-level dedupe,
 * re-verifying a fee published it again, so the catalog lists some fees two or more
 * times. The newest copy stays live; the others get `rolled_back_at`, the run's batch
 * id and `duplicate of #<kept id>`. Rows that differ in name or amount are separate
 * fee lines and are left alone. Nothing is deleted; clearing `rolled_back_at` restores
 * a row. A dry run reports what it would close and writes nothing.
 */
export async function collapsePublishedDuplicates(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<DuplicateCollapse[]> {
  const params: Array<number | string> = [DUPLICATE_COLLAPSE_LIMIT];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  // Frequencies that name the same thing count as one: per item, per occurrence, per
  // transaction and one-time all mean "each time it happens", and an unstated (or "other")
  // frequency matches any stated one. Two copies of a line differing only that way are one
  // fee read from two documents (Extraco's "Early Account Closure (by customer)").
  // The copy kept states its audience when one does (#1069: an "unknown" re-read closed the
  // "business" copy of the same line, 140465 on Oct 13), then its frequency, then is newest.
  const duplicates = `
        SELECT ranked.fee_published_id, ranked.kept_fee_published_id
          FROM (
            SELECT fp.fee_published_id,
                   first_value(fp.fee_published_id) OVER line AS kept_fee_published_id,
                   row_number() OVER line AS copy_rank,
                   min(${FREQUENCY_CLASS}) OVER part AS min_class,
                   max(${FREQUENCY_CLASS}) OVER part AS max_class
              FROM published_fee_records fp
             WHERE fp.rolled_back_at IS NULL
               ${institutionFilter}
            WINDOW part AS (
              PARTITION BY fp.institution_id,
                           fp.canonical_fee_key,
                           COALESCE(fp.variant_type, ''),
                           fp.amount,
                           fp.rate_percent,
                           lower(btrim(fp.fee_name))
            ),
            line AS (part ORDER BY (COALESCE(fp.fee_audience, 'unknown') = 'unknown'), (fp.frequency IS NULL), fp.published_at DESC, fp.fee_published_id DESC)
          ) ranked
         WHERE ranked.copy_rank > 1
           AND (ranked.min_class IS NULL OR ranked.min_class = ranked.max_class)
         ORDER BY ranked.fee_published_id
         LIMIT $1`;

  let rows: DuplicateRow[];
  try {
    rows = await inSavepoint(db, (scope) => {
      if (options.dryRun) {
        return scope.unsafe<DuplicateRow[]>(
          `SELECT fp.fee_published_id, dup.kept_fee_published_id, fp.institution_id,
                  fp.canonical_fee_key, fp.fee_name, fp.amount
             FROM published_fee_records fp
             JOIN (${duplicates}) dup ON dup.fee_published_id = fp.fee_published_id`,
          params,
        );
      }
      return scope.unsafe<DuplicateRow[]>(
        `UPDATE published_fee_records fp
            SET rolled_back_at = NOW(),
                rolled_back_by_batch_id = $${params.length + 1},
                rolled_back_reason = '${DUPLICATE_COLLAPSE_REASON_PREFIX}' || dup.kept_fee_published_id::text
           FROM (${duplicates}) dup
          WHERE fp.fee_published_id = dup.fee_published_id
        RETURNING fp.fee_published_id, dup.kept_fee_published_id, fp.institution_id,
                  fp.canonical_fee_key, fp.fee_name, fp.amount`,
        [...params, options.batchId],
      );
    });
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("collapsePublishedDuplicates failed:", error);
    return [];
  }

  const collapsed = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    keptFeePublishedId: Number(row.kept_fee_published_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: row.amount == null ? null : Math.round(Number(row.amount) * 100) / 100,
  }));

  if (!options.dryRun && collapsed.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.duplicates_collapsed', 'completed',
          ${`Closed ${collapsed.length} published fee(s) that repeated another live row`},
          ${JSON.stringify({
            batch_id: options.batchId,
            collapsed: collapsed.length,
            samples: collapsed.slice(0, 20).map((row) => ({
              fee_published_id: row.feePublishedId,
              kept_fee_published_id: row.keptFeePublishedId,
              institution_id: row.institutionId,
              canonical_fee_key: row.canonicalFeeKey,
              fee_name: row.feeName,
              amount: row.amount,
            })),
          })}::jsonb
        )
      `);
    } catch (error) {
      console.error("duplicate collapse event failed:", error);
    }
  }
  return collapsed;
}

/**
 * Near-name collapse (#1302) is live: James approved it on 2026-10-15 after the shadow check
 * (19 of 20 right, the miss fixed in #1328). Each publish step closes the repeats it finds.
 * Set false to go back to shadow, where a step reports the rows it would close and changes none.
 */
export const NEAR_NAME_COLLAPSE_LIVE = true;
/** Documents read per publish step; the step's run id picks which, so steps cover them in turn. */
export const NEAR_NAME_COLLAPSE_DOCUMENTS = 25;
export const NEAR_NAME_COLLAPSE_REASON_SUFFIX = " (near name)";

export interface NearNameRow {
  fee_published_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  canonical_fee_key: string;
  variant_type: string | null;
  amount: number | string;
  fee_name: string | null;
  frequency: string | null;
  fee_audience: string | null;
  published_at: string | Date | null;
}

export interface NearNameCollapse extends DuplicateCollapse {
  keptFeeName: string;
  sourceDocumentId: number;
}

export interface NearNameResult {
  live: boolean;
  documents: number;
  /** Near-name pairs of live rows (same document, category, variant and amount). */
  pairs: number;
  /**
   * Kept apart: the page prints both as their own lines at the price, as at publish (#1303), or
   * prints the fee once in its personal and once in its business schedule.
   */
  apartOnPage: number;
  /** Cannot determine: neither name is printed with the price, or the document has no stored text. */
  notPrinted: number;
  noText: number;
  collapses: NearNameCollapse[];
}

function frequencyClass(frequency: string | null): string | null {
  if (frequency == null || frequency === "other") return null;
  return ["per_item", "per_occurrence", "per_transaction", "one_time"].includes(frequency) ? "each" : frequency;
}

/**
 * Pure: the live rows that repeat another live row of their document under a near name
 * (`nearNames`) when the page prints them as one line. The copy kept states its audience, then
 * its frequency, then is the one the page prints at the price, then is newest. A pair the page
 * prints as two lines at the price stays two fees (doc 14695 prints "Stop Payments, each ... $35"
 * and "Stop Payment, each ... $35" in two sections); so does a pair whose stated frequencies or
 * audiences differ, or whose document has no stored text, or whose names the page does not print
 * with the price.
 */
export function nearNameRepeats(rows: NearNameRow[], texts: Map<string, string>): Omit<NearNameResult, "live" | "documents"> {
  const result = { pairs: 0, apartOnPage: 0, notPrinted: 0, noText: 0, collapses: [] as NearNameCollapse[] };
  const groups = new Map<string, NearNameRow[]>();
  for (const row of rows) {
    const key = [row.institution_id, row.source_document_id, row.canonical_fee_key, row.variant_type ?? "", Number(row.amount).toFixed(2)].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const text = texts.get(String(group[0].source_document_id)) ?? null;
    const printed = (row: NearNameRow) => (text ? printedAtPrice(text, row.fee_name ?? "", row.amount) : false);
    const rank = (row: NearNameRow) => [
      (row.fee_audience ?? "unknown") === "unknown" ? 1 : 0,
      row.frequency == null ? 1 : 0,
      printed(row) ? 0 : 1,
      -new Date(row.published_at ?? 0).getTime(),
      -Number(row.fee_published_id),
    ];
    const ordered = group.map((row) => ({ row, rank: rank(row) })).sort((a, b) => {
      const i = a.rank.findIndex((value, index) => value !== b.rank[index]);
      return i < 0 ? 0 : a.rank[i] - b.rank[i];
    });
    const kept: NearNameRow[] = [];
    for (const { row } of ordered) {
      const match = kept.find((keep) => {
        if (!nearNames(keep.fee_name, row.fee_name)) return false;
        const [f1, f2] = [frequencyClass(keep.frequency), frequencyClass(row.frequency)];
        const [a1, a2] = [keep.fee_audience ?? "unknown", row.fee_audience ?? "unknown"];
        return (f1 == null || f2 == null || f1 === f2) && (a1 === "unknown" || a2 === "unknown" || a1 === a2);
      });
      if (!match) {
        kept.push(row);
        continue;
      }
      result.pairs += 1;
      if (!text) {
        result.noText += 1;
        kept.push(row);
      } else if (
        linesApartOnPage(text, row.fee_name ?? "", match.fee_name ?? "", row.amount) ||
        printedInPersonalAndBusinessSchedules(text, [row.fee_name ?? "", match.fee_name ?? ""], row.amount)
      ) {
        result.apartOnPage += 1;
        kept.push(row);
      } else if (!printed(row) && !printed(match)) {
        result.notPrinted += 1;
        kept.push(row);
      } else {
        result.collapses.push({
          feePublishedId: Number(row.fee_published_id),
          keptFeePublishedId: Number(match.fee_published_id),
          institutionId: Number(row.institution_id),
          canonicalFeeKey: row.canonical_fee_key,
          feeName: row.fee_name ?? "",
          keptFeeName: match.fee_name ?? "",
          amount: Math.round(Number(row.amount) * 100) / 100,
          sourceDocumentId: Number(row.source_document_id),
        });
      }
    }
  }
  return result;
}

/**
 * Close live rows that repeat another live row of the same document under a near name ("Research
 * fee" / "Account Research fee", "Stop Payment" / "Stop Payment ......") when the page prints them
 * as one line (`nearNameRepeats`), up to `NEAR_NAME_COLLAPSE_DOCUMENTS` documents per step. While
 * `NEAR_NAME_COLLAPSE_LIVE` is false, or in a dry run, it reports and writes nothing. A closed row
 * gets `duplicate of #<kept id> (near name)` and the run's batch id; clearing `rolled_back_at`
 * restores it.
 */
export async function collapseNearNameDuplicates(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; live?: boolean },
): Promise<NearNameResult> {
  const live = options.live ?? NEAR_NAME_COLLAPSE_LIVE;
  const empty: NearNameResult = { live, documents: 0, pairs: 0, apartOnPage: 0, notPrinted: 0, noText: 0, collapses: [] };
  const params: Array<number | string> = [NEAR_NAME_COLLAPSE_DOCUMENTS, String(options.runId)];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  let rows: NearNameRow[];
  let texts: Map<string, string>;
  try {
    ({ rows, texts } = await inSavepoint(db, async (scope) => {
      // Live dollar rows of one document, category, variant and amount under two or more names.
      const found = await scope.unsafe<NearNameRow[]>(
        `WITH live AS (
           SELECT fp.fee_published_id, fp.institution_id, fr.source_document_id, fp.canonical_fee_key,
                  fp.variant_type, fp.amount, fp.fee_name, fp.frequency, fp.fee_audience, fp.published_at
             FROM published_fee_records fp
             JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
             JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
            WHERE fp.rolled_back_at IS NULL
              AND fp.quarantined_at IS NULL
              AND fp.amount IS NOT NULL
              AND fp.rate_percent IS NULL
              AND fr.source_document_id IS NOT NULL
              ${institutionFilter}
         ), lines AS (
           SELECT institution_id, source_document_id, canonical_fee_key, COALESCE(variant_type, '') AS variant, amount
             FROM live
            GROUP BY 1, 2, 3, 4, 5
           HAVING count(DISTINCT lower(btrim(fee_name))) > 1
         ), picked AS (
           SELECT source_document_id
             FROM (SELECT DISTINCT source_document_id FROM lines) documents
            ORDER BY md5(source_document_id::text || $2)
            LIMIT $1
         )
         SELECT live.*
           FROM live
           JOIN lines ON lines.institution_id = live.institution_id
                     AND lines.source_document_id = live.source_document_id
                     AND lines.canonical_fee_key = live.canonical_fee_key
                     AND lines.variant = COALESCE(live.variant_type, '')
                     AND lines.amount = live.amount
           JOIN picked ON picked.source_document_id = live.source_document_id`,
        params,
      );
      const documentIds = [...new Set(found.map((row) => Number(row.source_document_id)))];
      const stored = documentIds.length === 0 ? [] : await scope<{ source_document_id: number | string; normalized_text: string }[]>`
        SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
          FROM agent_source_texts
         WHERE source_document_id = ANY(${documentIds}::bigint[]) AND normalized_text IS NOT NULL
         ORDER BY source_document_id, id DESC
      `;
      return { rows: found, texts: new Map(stored.map((row) => [String(row.source_document_id), row.normalized_text])) };
    }));
  } catch (error) {
    console.error("collapseNearNameDuplicates failed:", error);
    return empty;
  }

  const found = nearNameRepeats(rows, texts);
  const result: NearNameResult = { live, documents: new Set(rows.map((row) => String(row.source_document_id))).size, ...found };
  if (!live || options.dryRun || found.collapses.length === 0) return result;

  try {
    const closed = await inSavepoint(db, (scope) => scope<{ fee_published_id: number | string }[]>`
      UPDATE published_fee_records fp
         SET rolled_back_at = NOW(),
             rolled_back_by_batch_id = ${options.batchId},
             rolled_back_reason = ${DUPLICATE_COLLAPSE_REASON_PREFIX} || pick.kept::text || ${NEAR_NAME_COLLAPSE_REASON_SUFFIX}
        FROM unnest(${found.collapses.map((row) => row.feePublishedId)}::bigint[], ${found.collapses.map((row) => row.keptFeePublishedId)}::bigint[]) AS pick(id, kept)
       WHERE fp.fee_published_id = pick.id AND fp.rolled_back_at IS NULL
      RETURNING fp.fee_published_id
    `);
    const ids = new Set(closed.map((row) => Number(row.fee_published_id)));
    result.collapses = found.collapses.filter((row) => ids.has(row.feePublishedId));
  } catch (error) {
    console.error("near-name collapse failed:", error);
    return { ...result, collapses: [] };
  }
  if (result.collapses.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.near_name_duplicates_collapsed', 'completed',
          ${`Closed ${result.collapses.length} published fee(s) that repeated another live line of their page under a near name`},
          ${JSON.stringify({ batch_id: options.batchId, collapsed: result.collapses.length, samples: result.collapses.slice(0, 20) })}::jsonb
        )
      `);
    } catch (error) {
      console.error("near-name collapse event failed:", error);
    }
  }
  return result;
}
