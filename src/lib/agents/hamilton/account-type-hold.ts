import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { accountTypeFlag, accountTypeOf, ACCOUNT_TYPE_FLAG_PREFIX, type AccountType } from "@/lib/account-type";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * #1100 gap 1 (James, Oct 16, option 1): `monthly_maintenance` is the consumer checking account's
 * monthly fee. A monthly fee of a savings, money market, club, business or IRA/HSA/CD account is
 * kept, stored as verified with its type (`account_type:<type>`), and never published under
 * `monthly_maintenance` (`publishSkipReason` skips it). Runs in the publish step, before new rows
 * publish. Three parts, each idempotent:
 *
 * 1. Live: a live `monthly_maintenance` fee whose account is not checking (its lineup product,
 *    `raw_fee_observations.product_name`, else its own name; `accountTypeOf`) comes down with
 *    `account_type_hold: <type>`. Its verified row stays verified and takes the flag.
 * 2. Waiting: a verified, unpublished `monthly_maintenance` row of such an account takes the flag
 *    before publish reads it, so a new read is held the same way.
 * 3. Refused: a row the category guard refused (`category_guard:name_contradicts`) only for its
 *    account words takes the flag too. It goes back to verified (held) when it passes every check
 *    once the account words are set aside (`passesDarwinChecks`) and its name and price trace in
 *    its own stored text (`checkFeeAgainstSource`); otherwise it stays rejected, typed.
 *
 * Archived, never deleted: clearing `rolled_back_at` and the flag restores a fee. Each run that
 * changes a row writes one event naming every row, and each row a `pipeline_feedback` row. A dry
 * run reports what it would do and writes nothing.
 */
export const ACCOUNT_TYPE_HOLD_CHECK = "hamilton.account_type_hold";
export const ACCOUNT_TYPE_HOLD_REASON = "account_type_hold";
/** The flag a checked row with no type carries, so part 2 reads each row once per version. */
export const ACCOUNT_TYPE_CHECKED_FLAG = "account_type_checked:v1";
/** Rows each part reads per run; a checked row is not read again, so later runs read the rest. */
export const ACCOUNT_TYPE_HOLD_LIMIT = 5_000;
export const HOLD_CATEGORY = "monthly_maintenance";

/** The account words set aside before part 3's checks ("Business Checking Monthly Fee" is a "Monthly Fee"). */
const ACCOUNT_WORDS = /\b(?:business|commercial|small\s*biz|non-?profit|corporate|analy[sz]\w*|money\s*market|mmda|christmas|holiday|vacation|club|savings?|saver|share|passbook|statement|ira|hsa|health|checking|accounts?)\b/gi;

export interface HoldRow {
  fee_published_id?: number | string | null;
  fee_verified_id: number | string;
  institution_id: number | string;
  fee_name: string | null;
  product_name: string | null;
  amount: number | string | null;
  source_document_id?: number | string | null;
  normalized_text?: string | null;
}

export interface PlannedHold {
  feePublishedId: number | null;
  feeVerifiedId: number;
  institutionId: number;
  accountType: AccountType;
  feeName: string;
  productName: string | null;
  amount: number | null;
}

export interface AccountTypeHoldResult {
  dryRun: boolean;
  /** Part 1: live fees taken down, held as verified. */
  heldLive: PlannedHold[];
  /** Part 2: verified, unpublished rows flagged before publish. */
  heldWaiting: PlannedHold[];
  /** Part 2: verified rows checked and left as they are (no type). */
  checkedUntyped: number;
  /** Part 3: guard-refused rows back to verified, held. */
  restoredHeld: PlannedHold[];
  /** Part 3: guard-refused rows typed but left rejected (a check other than the account words fails). */
  typedRejected: PlannedHold[];
}

const amountOf = (value: number | string | null) => (value == null || value === "" ? null : Number(value));

function planned(row: HoldRow, accountType: AccountType): PlannedHold {
  return {
    feePublishedId: row.fee_published_id == null ? null : Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    accountType,
    feeName: row.fee_name ?? "",
    productName: row.product_name,
    amount: amountOf(row.amount),
  };
}

/** Pure: the typed rows of a list, each with its type. */
export function planHolds(rows: HoldRow[]): { typed: PlannedHold[]; untyped: HoldRow[] } {
  const typed: PlannedHold[] = [];
  const untyped: HoldRow[] = [];
  for (const row of rows) {
    const type = accountTypeOf(row.product_name, row.fee_name);
    if (type) typed.push(planned(row, type));
    else untyped.push(row);
  }
  return { typed, untyped };
}

/** Pure: whether a guard-refused typed row is a real monthly fee once its account words are set aside. */
export function passesWithoutAccountWords(row: HoldRow): boolean {
  const amount = amountOf(row.amount);
  if (amount == null || !Number.isFinite(amount) || !row.fee_name || !row.normalized_text) return false;
  const bare = row.fee_name.replace(ACCOUNT_WORDS, " ").replace(/\s+/g, " ").trim();
  if (!bare || !passesDarwinChecks(HOLD_CATEGORY, bare, amount)) return false;
  return checkFeeAgainstSource(row.normalized_text, row.fee_name, amount, ".", null).ok;
}

export async function applyAccountTypeHold(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean },
): Promise<AccountTypeHoldResult> {
  const result: AccountTypeHoldResult = { dryRun: options.dryRun, heldLive: [], heldWaiting: [], checkedUntyped: 0, restoredHeld: [], typedRejected: [] };
  let live: HoldRow[];
  let waiting: HoldRow[];
  let refused: HoldRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<HoldRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fr.product_name, fp.amount
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.canonical_fee_key = ${HOLD_CATEGORY}
         AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${ACCOUNT_TYPE_CHECKED_FLAG})
       ORDER BY fp.fee_published_id
       LIMIT ${ACCOUNT_TYPE_HOLD_LIMIT}
    `);
    waiting = await inSavepoint(db, (scope) => scope<HoldRow[]>`
      SELECT fv.fee_verified_id, fv.institution_id, fv.fee_name, fr.product_name, fv.amount
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fv.canonical_fee_key = ${HOLD_CATEGORY}
         AND fv.review_status IN ('verified', 'approved')
         AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${ACCOUNT_TYPE_CHECKED_FLAG})
         AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(fv.outlier_flags, '[]'::jsonb)) flag
                WHERE flag LIKE ${`${ACCOUNT_TYPE_FLAG_PREFIX}%`}
             )
         AND NOT EXISTS (SELECT 1 FROM published_fee_records p WHERE p.lineage_ref = fv.fee_verified_id AND p.rolled_back_at IS NULL)
       ORDER BY fv.fee_verified_id
       LIMIT ${ACCOUNT_TYPE_HOLD_LIMIT}
    `);
    refused = await inSavepoint(db, (scope) => scope<HoldRow[]>`
      SELECT fv.fee_verified_id, fv.institution_id, fr.fee_name, fr.product_name, fr.amount, fr.source_document_id, txt.normalized_text
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN LATERAL (
          SELECT t.normalized_text FROM agent_source_texts t
           WHERE t.source_document_id = fr.source_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC LIMIT 1
        ) txt ON TRUE
       WHERE fv.canonical_fee_key = ${HOLD_CATEGORY}
         AND fv.review_status = 'rejected'
         AND COALESCE(fv.outlier_flags, '[]'::jsonb) ? 'category_guard:name_contradicts'
         AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(fv.outlier_flags, '[]'::jsonb)) flag
                WHERE flag LIKE ${`${ACCOUNT_TYPE_FLAG_PREFIX}%`}
             )
       ORDER BY fv.fee_verified_id
       LIMIT ${ACCOUNT_TYPE_HOLD_LIMIT}
    `);
  } catch (error) {
    console.error("account type hold read failed:", error);
    return result;
  }
  const livePlan = planHolds(live);
  const waitingPlan = planHolds(waiting);
  const refusedPlan = planHolds(refused);
  const refusedById = new Map(refused.map((row) => [Number(row.fee_verified_id), row]));
  const restored = refusedPlan.typed.filter((hold) => passesWithoutAccountWords(refusedById.get(hold.feeVerifiedId)!));
  const restoredIds = new Set(restored.map((hold) => hold.feeVerifiedId));
  const plan: AccountTypeHoldResult = {
    dryRun: options.dryRun,
    heldLive: livePlan.typed,
    heldWaiting: waitingPlan.typed,
    checkedUntyped: waitingPlan.untyped.length,
    restoredHeld: restored,
    typedRejected: refusedPlan.typed.filter((hold) => !restoredIds.has(hold.feeVerifiedId)),
  };
  if (options.dryRun) return plan;
  const changed = plan.heldLive.length + plan.heldWaiting.length + plan.restoredHeld.length + plan.typedRejected.length;
  if (changed === 0 && plan.checkedUntyped === 0 && livePlan.untyped.length === 0) return result;

  try {
    await inSavepoint(db, async (scope) => {
      const addFlags = async (ids: number[], types: string[], status: "keep" | "verified") => {
        if (ids.length === 0) return;
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = CASE WHEN ${status} = 'verified' THEN 'verified' ELSE fv.review_status END,
                 outlier_flags = CASE WHEN COALESCE(fv.outlier_flags, '[]'::jsonb) ? v.flag THEN fv.outlier_flags
                                      ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag) END
            FROM unnest(${ids}::bigint[], ${types}::text[]) AS v(fee_verified_id, flag)
           WHERE fv.fee_verified_id = v.fee_verified_id
        `;
      };
      // Part 1: live fees down, their verified rows flagged and kept verified.
      if (plan.heldLive.length > 0) {
        const ids = plan.heldLive.map((hold) => hold.feePublishedId!);
        const reasons = plan.heldLive.map((hold) => `${ACCOUNT_TYPE_HOLD_REASON}: ${hold.accountType}`);
        const down = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(), rolled_back_by_batch_id = ${options.batchId}, rolled_back_reason = v.reason
            FROM unnest(${ids}::bigint[], ${reasons}::text[]) AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
             AND fp.canonical_fee_key = ${HOLD_CATEGORY}
          RETURNING fp.fee_published_id
        `;
        const done = new Set(down.map((row) => Number(row.fee_published_id)));
        result.heldLive = plan.heldLive.filter((hold) => done.has(hold.feePublishedId!));
        await addFlags(result.heldLive.map((hold) => hold.feeVerifiedId), result.heldLive.map((hold) => accountTypeFlag(hold.accountType)), "keep");
      }
      // A live fee of a checking account (or of no stated type) is marked checked, so the next run
      // reads the rest of the catalog.
      const liveUntyped = livePlan.untyped.map((row) => Number(row.fee_verified_id));
      await addFlags(liveUntyped, liveUntyped.map(() => ACCOUNT_TYPE_CHECKED_FLAG), "keep");
      // Part 2: waiting rows flagged; untyped ones marked checked.
      result.heldWaiting = plan.heldWaiting;
      await addFlags(plan.heldWaiting.map((hold) => hold.feeVerifiedId), plan.heldWaiting.map((hold) => accountTypeFlag(hold.accountType)), "keep");
      const untypedIds = waitingPlan.untyped.map((row) => Number(row.fee_verified_id));
      await addFlags(untypedIds, untypedIds.map(() => ACCOUNT_TYPE_CHECKED_FLAG), "keep");
      result.checkedUntyped = untypedIds.length;
      // Part 3: refused rows typed; the ones that pass go back to verified, held.
      result.restoredHeld = plan.restoredHeld;
      await addFlags(plan.restoredHeld.map((hold) => hold.feeVerifiedId), plan.restoredHeld.map((hold) => accountTypeFlag(hold.accountType)), "verified");
      result.typedRejected = plan.typedRejected;
      await addFlags(plan.typedRejected.map((hold) => hold.feeVerifiedId), plan.typedRejected.map((hold) => accountTypeFlag(hold.accountType)), "keep");

      const feedback: FeedbackRow[] = [
        ...result.heldLive.map((hold) => feedbackRow(hold, "live", options.runId)),
        ...result.restoredHeld.map((hold) => feedbackRow(hold, "restored", options.runId)),
      ];
      if (feedback.length > 0) await recordFeedback(scope, feedback);
      if (result.heldLive.length + result.heldWaiting.length + result.restoredHeld.length + result.typedRejected.length > 0) {
        const rows = (holds: PlannedHold[]) => holds.map((hold) => ({
          fee_published_id: hold.feePublishedId,
          fee_verified_id: hold.feeVerifiedId,
          institution_id: hold.institutionId,
          account_type: hold.accountType,
          product_name: hold.productName,
          fee_name: hold.feeName,
          amount: hold.amount,
        }));
        await scope`
          INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${ACCOUNT_TYPE_HOLD_CHECK}, 'completed',
            ${`Held ${result.heldLive.length} live and ${result.heldWaiting.length} waiting monthly maintenance fee(s) of non-checking accounts as verified with their account type; ${result.restoredHeld.length} guard-refused row(s) back to verified, held; ${result.typedRejected.length} left rejected, typed (#1100)`},
            ${JSON.stringify({
              held_live: rows(result.heldLive),
              held_waiting: rows(result.heldWaiting),
              restored_held: rows(result.restoredHeld),
              typed_rejected: rows(result.typedRejected),
              checked_untyped: result.checkedUntyped,
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("account type hold write failed:", error);
    return { ...result, heldLive: [], heldWaiting: [], restoredHeld: [], typedRejected: [], checkedUntyped: 0 };
  }
  if (result.heldLive.length > 0) invalidatePublicReadCache();
  return result;
}

function feedbackRow(hold: PlannedHold, part: "live" | "restored", runId: number): FeedbackRow {
  return {
    aboutStage: "publish",
    signal: "wrong",
    kind: "wrong_category",
    reportedBy: "hamilton",
    checkName: ACCOUNT_TYPE_HOLD_CHECK,
    institutionId: hold.institutionId,
    feeVerifiedId: hold.feeVerifiedId,
    feePublishedId: hold.feePublishedId,
    canonicalFeeKey: HOLD_CATEGORY,
    amount: hold.amount,
    weight: 0,
    runId,
    dedupeKey: `${ACCOUNT_TYPE_HOLD_CHECK}:${part}:${hold.feeVerifiedId}`,
    evidence: { account_type: hold.accountType, product_name: hold.productName, fee_name: hold.feeName, part, issue: 1100 },
  };
}
