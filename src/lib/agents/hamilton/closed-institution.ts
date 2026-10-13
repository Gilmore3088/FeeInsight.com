import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Live fees of an institution that no longer operates (#1200, James approved option (a), Oct 13).
 * Atlas marks a closed or merged charter `institution_sources.status = 'inactive'` (most with a
 * `closed_date`). Magellan stops searching them, but `published_fee_catalog` does not filter on
 * status, so their fees stayed live, in medians, reports and institution pages: 475 live fees at
 * 21 inactive institutions on Oct 13 (Flushing, Northfield, Webster, Bank of the Pacific, ...).
 *
 * Each publish step closes them (`rolled_back_reason = 'closed_institution: inactive[, closed
 * <date>]'`) and publish no longer selects an inactive institution's verified rows
 * (`CLOSED_INSTITUTION_SQL`). Nothing is deleted: the verified rows stay as they are, and
 * clearing `rolled_back_at` restores a fee. 'dormant' (a bank whose website link went quiet) is not
 * closed and is left alone. The fees were right for the bank when it operated, so this is no lesson
 * against Knox or Darwin (the feedback sync skips it) and no publish error on the scorecard.
 */
export const CLOSED_INSTITUTION_REASON = "closed_institution";
export const CLOSED_INSTITUTION_LIMIT = 1_000;

/** An institution that no longer operates, as SQL on an `institution_sources` alias. */
export function closedInstitutionSql(alias: string): string {
  return `(${alias}.status = 'inactive' OR ${alias}.closed_date IS NOT NULL)`;
}

export interface ClosedInstitutionTakedown {
  feePublishedId: number;
  institutionId: number;
  institutionName: string;
  reason: string;
}

export interface ClosedInstitutionResult {
  liveFees: number;
  institutions: number;
  rolledBack: ClosedInstitutionTakedown[];
  dryRun: boolean;
}

interface ClosedFeeRow {
  fee_published_id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  status: string | null;
  closed_date: string | Date | null;
}

/** Pure: the takedown reason for one institution's state. */
export function closedInstitutionReason(status: string | null, closedDate: string | Date | null): string {
  const day = closedDate == null ? null : (closedDate instanceof Date ? closedDate.toISOString() : String(closedDate)).slice(0, 10);
  return `${CLOSED_INSTITUTION_REASON}: ${status ?? "unknown"}${day ? `, closed ${day}` : ""}`;
}

/** Closes the live fees of institutions that no longer operate. A dry run reports and writes nothing. Never throws. */
export async function retireClosedInstitutionFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<ClosedInstitutionResult> {
  const limit = Math.max(1, Math.min(options.limit ?? CLOSED_INSTITUTION_LIMIT, 5_000));
  const result: ClosedInstitutionResult = { liveFees: 0, institutions: 0, rolledBack: [], dryRun: options.dryRun };
  let rows: ClosedFeeRow[];
  try {
    rows = await inSavepoint(db, (scope) => scope.unsafe<ClosedFeeRow[]>(
      `SELECT fp.fee_published_id, fp.institution_id, inst.institution_name, inst.status, inst.closed_date
         FROM published_fee_records fp
         JOIN institution_sources inst ON inst.id = fp.institution_id
        WHERE fp.rolled_back_at IS NULL
          AND ${closedInstitutionSql("inst")}
          ${options.institutionId ? "AND fp.institution_id = $2" : ""}
        ORDER BY fp.fee_published_id
        LIMIT $1`,
      options.institutionId ? [limit, options.institutionId] : [limit],
    ));
  } catch (error) {
    console.error("retireClosedInstitutionFees read failed:", error);
    return result;
  }
  const failing: ClosedInstitutionTakedown[] = rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    institutionName: row.institution_name ?? "",
    reason: closedInstitutionReason(row.status, row.closed_date),
  }));
  result.liveFees = failing.length;
  result.institutions = new Set(failing.map((fee) => fee.institutionId)).size;
  if (options.dryRun) {
    result.rolledBack = failing;
    return result;
  }
  if (failing.length === 0) return result;
  try {
    result.rolledBack = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${options.batchId},
               rolled_back_reason = v.reason
          FROM unnest(${failing.map((fee) => fee.feePublishedId)}::bigint[], ${failing.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const closed = failing.filter((fee) => ids.has(fee.feePublishedId));
      if (closed.length === 0) return closed;
      const byInstitution = new Map<number, { name: string; fees: number; reason: string }>();
      for (const fee of closed) {
        const entry = byInstitution.get(fee.institutionId) ?? { name: fee.institutionName, fees: 0, reason: fee.reason };
        entry.fees += 1;
        byInstitution.set(fee.institutionId, entry);
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.closed_institution_rolled_back', 'completed',
          ${`Archived ${closed.length} live fee(s) of ${byInstitution.size} institution(s) that no longer operate`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: closed.length,
            institutions: [...byInstitution.entries()].map(([id, entry]) => ({
              institution_id: id,
              institution_name: entry.name,
              fees: entry.fees,
              reason: entry.reason,
            })),
          })}::jsonb
        )
      `;
      return closed;
    });
  } catch (error) {
    console.error("closed institution rollback failed:", error);
    return { ...result, rolledBack: [] };
  }
  if (result.rolledBack.length > 0) invalidatePublicReadCache();
  return result;
}
