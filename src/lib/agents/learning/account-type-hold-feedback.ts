import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * #1100: before the feedback sync skipped `account_type_hold:` takedowns, it wrote one `wrong` row
 * about Knox's read and one about Darwin's verdict for each fee the account type hold took down
 * (1,432 rows on Oct 16: 1,428 for 714 fees written 04:35-04:36 UTC and 4 at 05:55, before the skip
 * merged; kind `account_type_hold`, weight 1). The hold is publish
 * policy, not a wrong read, and the hold's own rows carry weight 0. This step sets those rows to
 * weight 0 too, keeping each row and its old weight in `evidence.weight_was`. Idempotent: a row at
 * weight 0 is never read again. Off until James switches it on (a prod data change). Off, it does
 * nothing at all (the count is a ~250 ms scan, so it runs only with the switch on); on, a dry run
 * only counts the rows it would change. Once it has run, the step can be removed.
 */
export const ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON: boolean = false;
export const ACCOUNT_TYPE_HOLD_FEEDBACK_CHECK = "learning.account_type_hold_feedback";
export const ACCOUNT_TYPE_HOLD_FEEDBACK_KIND = "account_type_hold";

export interface AccountTypeHoldFeedbackResult {
  on: boolean;
  dryRun: boolean;
  /** Rows at a weight other than 0 that the step would set to 0; null while the switch is off. */
  due: number | null;
  /** Rows set to weight 0 this run. */
  zeroed: number;
  error: string | null;
}

export async function repairAccountTypeHoldFeedback(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; on?: boolean },
): Promise<AccountTypeHoldFeedbackResult> {
  const on = options.on ?? ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON;
  const result: AccountTypeHoldFeedbackResult = { on, dryRun: options.dryRun, due: null, zeroed: 0, error: null };
  if (!on) return result;
  try {
    const [row] = await inSavepoint(db, (scope) => scope<Array<{ due: number | string }>>`
      SELECT COUNT(*)::int AS due
        FROM pipeline_feedback
       WHERE kind = ${ACCOUNT_TYPE_HOLD_FEEDBACK_KIND}
         AND reported_by = 'gutenberg'
         AND weight <> 0
    `);
    result.due = Number(row?.due ?? 0);
    if (options.dryRun || result.due === 0) return result;
    await inSavepoint(db, async (scope) => {
      const updated = await scope<Array<{ id: number | string }>>`
        UPDATE pipeline_feedback
           SET weight = 0,
               evidence = COALESCE(evidence, '{}'::jsonb)
                          || jsonb_build_object('weight_was', weight, 'weight_zeroed_by_run', ${options.runId}::bigint, 'issue', 1100),
               updated_at = NOW()
         WHERE kind = ${ACCOUNT_TYPE_HOLD_FEEDBACK_KIND}
           AND reported_by = 'gutenberg'
           AND weight <> 0
        RETURNING id
      `;
      result.zeroed = updated.length;
      if (updated.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${ACCOUNT_TYPE_HOLD_FEEDBACK_CHECK}, 'completed',
            ${`Set ${updated.length} feedback row(s) the sync wrote for account type holds to weight 0: the hold is publish policy, not a wrong read (#1100)`},
            ${JSON.stringify({ zeroed: updated.length, ids: updated.map((item) => Number(item.id)) })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("account type hold feedback repair failed:", error);
    return { ...result, zeroed: 0, error: error instanceof Error ? error.message : String(error) };
  }
  return result;
}
