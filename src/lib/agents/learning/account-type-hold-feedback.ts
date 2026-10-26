import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { ACCOUNT_TYPE_HOLD_CHECK } from "@/lib/agents/hamilton/account-type-hold";
import { ACCOUNT_TYPE_HOLD_RELEASED_KIND } from "@/lib/agents/learning/feedback";

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

/**
 * #1680: before the account type hold gave its releases their own label (#2594), it wrote each
 * release (a guard-refused row put back to verified, held) with its takedown's label, signal
 * `wrong` and kind `wrong_category`: 5 rows on Oct 16 04:35:32 UTC, weight 0, no
 * `fee_published_id`, dedupe `hamilton.account_type_hold:restored:<fee_verified_id>`. This part
 * relabels them `restored` / `account_type_hold_released`, the label the hold writes a release
 * with today, keeping the old signal and kind in `evidence.relabeled_from`. Idempotent: a
 * relabelled row no longer matches. On since James's yes (2026-10-26; a prod data change). Off, a
 * dry run still counts the rows it would relabel (a read on the check's own rows) and a
 * real run reads nothing; on, a real run relabels them. Once it has run, the part can be removed.
 */
export const ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_ON: boolean = true;
export const ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_CHECK = "learning.account_type_hold_release_relabel";
/**
 * The dedupe-key prefix of the hold's release rows, matched with `left(...) = prefix`. Not a
 * `>= prefix AND < next` range: prod sorts text in en_US.UTF-8, which ignores punctuation at the
 * first level, so `...:restored:4436` sorts above `...:restored;` there and the range matched 0 of
 * the 5 rows (it matched all 5 only on the C-collated test database).
 */
const RELEASE_KEY_PREFIX = `${ACCOUNT_TYPE_HOLD_CHECK}:restored:`;

export interface AccountTypeHoldFeedbackResult {
  on: boolean;
  dryRun: boolean;
  /** Rows at a weight other than 0 that the step would set to 0; null while the switch is off. */
  due: number | null;
  /** Rows set to weight 0 this run. */
  zeroed: number;
  /** #1680: the hold's old release rows still labelled as a wrong category. */
  release: {
    on: boolean;
    /** Rows the relabel would change; null when nothing was read (switch off, real run). */
    due: number | null;
    /** Rows relabelled this run. */
    relabeled: number;
  };
  error: string | null;
}

export async function repairAccountTypeHoldFeedback(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; on?: boolean; relabelOn?: boolean },
): Promise<AccountTypeHoldFeedbackResult> {
  const on = options.on ?? ACCOUNT_TYPE_HOLD_FEEDBACK_REPAIR_ON;
  const relabelOn = options.relabelOn ?? ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_ON;
  const result: AccountTypeHoldFeedbackResult = {
    on, dryRun: options.dryRun, due: null, zeroed: 0, release: { on: relabelOn, due: null, relabeled: 0 }, error: null,
  };
  try {
    if (on) await zeroSyncRows(db, options, result);
    if (relabelOn || options.dryRun) await relabelReleaseRows(db, options, relabelOn, result);
  } catch (error) {
    console.error("account type hold feedback repair failed:", error);
    return {
      ...result, zeroed: 0, release: { ...result.release, relabeled: 0 },
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return result;
}

/** #1100: the sync's old takedown rows for account type holds go to weight 0. */
async function zeroSyncRows(db: SqlTag, options: { runId: number; dryRun: boolean }, result: AccountTypeHoldFeedbackResult) {
  const [row] = await inSavepoint(db, (scope) => scope<Array<{ due: number | string }>>`
    SELECT COUNT(*)::int AS due
      FROM pipeline_feedback
     WHERE kind = ${ACCOUNT_TYPE_HOLD_FEEDBACK_KIND}
       AND reported_by = 'gutenberg'
       AND weight <> 0
  `);
  result.due = Number(row?.due ?? 0);
  if (options.dryRun || result.due === 0) return;
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
}

/** #1680: the hold's release rows written with its takedown's label become restore records. */
async function relabelReleaseRows(
  db: SqlTag,
  options: { runId: number; dryRun: boolean },
  relabelOn: boolean,
  result: AccountTypeHoldFeedbackResult,
) {
  const [row] = await inSavepoint(db, (scope) => scope<Array<{ due: number | string }>>`
    SELECT COUNT(*)::int AS due
      FROM pipeline_feedback
     WHERE left(dedupe_key, ${RELEASE_KEY_PREFIX.length}::int) = ${RELEASE_KEY_PREFIX}
       AND check_name = ${ACCOUNT_TYPE_HOLD_CHECK}
       AND signal = 'wrong'
       AND kind = 'wrong_category'
  `);
  result.release.due = Number(row?.due ?? 0);
  if (!relabelOn || options.dryRun || result.release.due === 0) return;
  await inSavepoint(db, async (scope) => {
    const updated = await scope<Array<{ id: number | string; fee_verified_id: number | string | null }>>`
      UPDATE pipeline_feedback
         SET signal = 'restored',
             kind = ${ACCOUNT_TYPE_HOLD_RELEASED_KIND},
             evidence = COALESCE(evidence, '{}'::jsonb)
                        || jsonb_build_object(
                             'relabeled_from', jsonb_build_object('signal', signal, 'kind', kind),
                             'relabeled_by_run', ${options.runId}::bigint,
                             'relabel_issue', 1680
                           ),
             updated_at = NOW()
       WHERE left(dedupe_key, ${RELEASE_KEY_PREFIX.length}::int) = ${RELEASE_KEY_PREFIX}
         AND check_name = ${ACCOUNT_TYPE_HOLD_CHECK}
         AND signal = 'wrong'
         AND kind = 'wrong_category'
      RETURNING id, fee_verified_id
    `;
    result.release.relabeled = updated.length;
    if (updated.length > 0) {
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${ACCOUNT_TYPE_HOLD_RELEASE_RELABEL_CHECK}, 'completed',
          ${`Relabelled ${updated.length} account type hold release row(s) from wrong / wrong_category to restored / ${ACCOUNT_TYPE_HOLD_RELEASED_KIND}: a release is a restore record, not a wrong-category verdict (#1680)`},
          ${JSON.stringify({
            relabeled: updated.length,
            ids: updated.map((item) => Number(item.id)),
            fee_verified_ids: updated.map((item) => (item.fee_verified_id == null ? null : Number(item.fee_verified_id))),
          })}::jsonb
        )
      `;
    }
  });
}
