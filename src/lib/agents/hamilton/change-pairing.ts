import { sql } from "@/lib/data-store/connection";
import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { sameSchedule } from "@/lib/agents/hamilton/schedule-edition";
import { listsBothPrices, selectListedFeeLines, type ListedFeeLine } from "@/lib/agents/hamilton/publish";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Names the two published rows behind each recorded fee change and says whether they are like
 * for like (coordinator, 8 Oct). Until PR 591 `supersedePriorFee` recorded a change whenever
 * any newer read of a fee closed the live row, so on prod 22 changes since
 * `FEE_MOVES_TRACKED_SINCE` mostly paired a consumer disclosure with the same bank's business
 * schedule (FINDINGS, 8 Oct). Publish now records the pair and `like_for_like` itself; this
 * pass fills the older records, a batch per step, once each:
 *   - the new row has the change's new amount, and the row it superseded ("superseded by #id")
 *     has the old amount;
 *   - like for like when both were read on the same page (`feePageKey`, the rule publish
 *     supersedes by), or the new one is a newer dated edition of the same audience's schedule
 *     on a moved page (`sameSchedule`), and neither document lists the fee at both prices
 *     (`listsBothPrices`);
 *   - a change with no such pair is not like for like.
 * Readers count a change only when `like_for_like` is true. Nothing is deleted.
 */
export const CHANGE_PAIRING_LIMIT = 500;

export interface ChangePairRow {
  change_id: number | string;
  new_fee_published_id: number | string | null;
  previous_fee_published_id: number | string | null;
  fee_name: string | null;
  new_amount: number | string | null;
  previous_amount: number | string | null;
  new_url: string | null;
  previous_url: string | null;
  new_document_id: number | string | null;
  previous_document_id: number | string | null;
  /** The two schedules' texts, for a pair read on two pages (schedule-edition.ts). */
  new_text?: string | null;
  previous_text?: string | null;
}

export type ChangePairVerdict = "like_for_like" | "no_pair" | "cross_page" | "lists_both";

/** Pure: is this recorded change one schedule's price against an older copy of itself? */
export function judgeChangePair(pair: ChangePairRow, lines: ListedFeeLine[]): ChangePairVerdict {
  if (pair.new_fee_published_id == null || pair.previous_fee_published_id == null) return "no_pair";
  const newPage = feePageKey(pair.new_url);
  const samePage = newPage != null && newPage === feePageKey(pair.previous_url);
  // Two pages are one schedule only as a newer dated edition for the same audience.
  if (!samePage && sameSchedule({ oldUrl: pair.previous_url, newUrl: pair.new_url, oldText: pair.previous_text, newText: pair.new_text }) !== "new_edition") return "cross_page";
  const name = pair.fee_name ?? "";
  const listed = listsBothPrices(
    lines,
    { fee_name: name, amount: pair.new_amount, source_document_id: pair.new_document_id },
    { fee_name: name, amount: pair.previous_amount, source_document_id: pair.previous_document_id },
  );
  return listed ? "lists_both" : "like_for_like";
}

export interface ChangePairingResult {
  unpaired: number;
  likeForLike: number;
  crossPage: number;
  listsBoth: number;
  noPair: number;
  written: number;
  dryRun: boolean;
}

export async function pairFeeChangeRecords(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<ChangePairingResult> {
  const limit = Math.max(1, Math.min(options.limit ?? CHANGE_PAIRING_LIMIT, 2_000));
  const result: ChangePairingResult = { unpaired: 0, likeForLike: 0, crossPage: 0, listsBoth: 0, noPair: 0, written: 0, dryRun: options.dryRun };
  let rows: ChangePairRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<ChangePairRow[]>(
      `SELECT c.id AS change_id,
              p.new_fee_published_id, p.previous_fee_published_id, p.fee_name,
              c.new_amount, COALESCE(c.old_amount::float8, c.previous_amount) AS previous_amount,
              p.new_url, p.previous_url, p.new_document_id, p.previous_document_id,
              (SELECT t.normalized_text FROM agent_source_texts t
                WHERE t.source_document_id = p.new_document_id AND t.status = 'completed'
                ORDER BY t.id DESC LIMIT 1) AS new_text,
              (SELECT t.normalized_text FROM agent_source_texts t
                WHERE t.source_document_id = p.previous_document_id AND t.status = 'completed'
                ORDER BY t.id DESC LIMIT 1) AS previous_text
         FROM fee_change_records c
         LEFT JOIN LATERAL (
           SELECT n.fee_published_id AS new_fee_published_id,
                  o.fee_published_id AS previous_fee_published_id,
                  n.fee_name,
                  COALESCE(nsd.document_url, n.source_url) AS new_url,
                  COALESCE(osd.document_url, o.source_url) AS previous_url,
                  nfr.source_document_id AS new_document_id,
                  ofr.source_document_id AS previous_document_id
             FROM published_fee_records n
             JOIN published_fee_records o
               ON o.institution_id = n.institution_id
              AND o.rolled_back_reason = 'superseded by #' || n.fee_published_id
              AND o.amount = COALESCE(c.old_amount::float8, c.previous_amount)
             LEFT JOIN verified_fee_observations nfv ON nfv.fee_verified_id = n.lineage_ref
             LEFT JOIN raw_fee_observations nfr ON nfr.fee_raw_id = nfv.fee_raw_id
             LEFT JOIN source_documents nsd ON nsd.id = nfr.source_document_id
             LEFT JOIN verified_fee_observations ofv ON ofv.fee_verified_id = o.lineage_ref
             LEFT JOIN raw_fee_observations ofr ON ofr.fee_raw_id = ofv.fee_raw_id
             LEFT JOIN source_documents osd ON osd.id = ofr.source_document_id
            WHERE n.institution_id = c.institution_id
              AND n.canonical_fee_key = COALESCE(c.canonical_fee_key, c.fee_category)
              AND n.amount = c.new_amount
            ORDER BY abs(extract(epoch FROM n.published_at - c.detected_at))
            LIMIT 1
         ) p ON TRUE
        WHERE c.like_for_like IS NULL
          ${options.institutionId ? "AND c.institution_id = $2" : ""}
        ORDER BY c.id
        LIMIT $1`,
      options.institutionId ? [limit, options.institutionId] : [limit],
    ));
  } catch (error) {
    // Before the pairing columns exist there is nothing to fill.
    console.error("pairFeeChangeRecords read failed:", error);
    return result;
  }
  result.unpaired = rows.length;
  if (rows.length === 0) return result;

  const lines = await selectListedFeeLines(db, rows.flatMap((row) => [row.new_document_id, row.previous_document_id]));
  const verdicts = rows.map((row) => ({ row, verdict: judgeChangePair(row, lines) }));
  for (const { verdict } of verdicts) {
    if (verdict === "like_for_like") result.likeForLike += 1;
    else if (verdict === "cross_page") result.crossPage += 1;
    else if (verdict === "lists_both") result.listsBoth += 1;
    else result.noPair += 1;
  }
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      const updates = verdicts.map(({ row, verdict }) => ({
        id: Number(row.change_id),
        previous: row.previous_fee_published_id == null ? null : Number(row.previous_fee_published_id),
        next: row.new_fee_published_id == null ? null : Number(row.new_fee_published_id),
        like: verdict === "like_for_like",
      }));
      const written = await scope`
        UPDATE fee_change_records c
           SET previous_fee_published_id = u.previous,
               new_fee_published_id = u.next,
               like_for_like = u.like
          FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS u(id bigint, previous bigint, next bigint, "like" boolean)
         WHERE c.id = u.id
           AND c.like_for_like IS NULL
        RETURNING c.id
      `;
      result.written = written.length;
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.change_pairing', 'completed',
          ${`Fee change pairing: ${result.likeForLike} of ${result.unpaired} recorded change(s) compare one page with itself; ${result.crossPage} pair two pages, ${result.listsBoth} are a page listing the fee at both prices, ${result.noPair} have no published pair`},
          ${JSON.stringify({
            unpaired: result.unpaired,
            like_for_like: result.likeForLike,
            cross_page: result.crossPage,
            lists_both: result.listsBoth,
            no_pair: result.noPair,
            written: result.written,
            changes: verdicts.map(({ row, verdict }) => ({ change_id: Number(row.change_id), verdict })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("pairFeeChangeRecords write failed:", error);
    result.written = 0;
  }
  return result;
}
