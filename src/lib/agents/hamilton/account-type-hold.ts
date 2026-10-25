import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { ACCOUNT_TYPE_HOLD_RELEASED_KIND, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { accountTypeFlag, accountTypeOf, ACCOUNT_TYPE_FLAG_PREFIX, type AccountType } from "@/lib/account-type";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { recordStepWarning } from "@/lib/agents/hamilton/step-warning";

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
/**
 * The flag a checked row with no type carries, so parts 1 and 2 read it once per version. Only a
 * row with a lineup product takes it: Knox fills an empty `product_name` on a later read
 * (`COALESCE(fr.product_name, EXCLUDED.product_name)`) and never changes one already set, so a
 * product's answer is final but a row with no product can still gain one.
 */
export const ACCOUNT_TYPE_CHECKED_FLAG = "account_type_checked:v1";
/**
 * Rows each part reads per step. A checked row is not read again; a row with no product is read on
 * every step (2,183 live and 5,059 waiting on Oct 16: a pure read, 0.12 s and 0.20 s warm on
 * prod, up to 1.6 s cold). The limit sits above the whole unchecked set, so rows with no product never crowd out new
 * ones; if that set ever passes it, checked rows drain first and the rest follow on later steps.
 */
export const ACCOUNT_TYPE_HOLD_LIMIT = 20_000;
export const HOLD_CATEGORY = "monthly_maintenance";

/** The account words set aside before part 3's checks ("Business Checking Monthly Fee" is a "Monthly Fee"). */
const ACCOUNT_WORDS = /\b(?:business|commercial|small\s*biz|non-?profit|corporate|analy[sz]\w*|money\s*market|mmda|christmas|holiday|vacation|club|savings?|saver|share|passbook|statement|ira|hsa|health|checking|accounts?)\b/gi;

export interface HoldRow {
  fee_published_id?: number | string | null;
  fee_verified_id: number | string;
  institution_id: number | string;
  fee_name: string | null;
  product_name: string | null;
  /** The bank's own name, which never names an account ("Bangor Savings Bank"). */
  institution_name?: string | null;
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
  /** Parts 1 and 2: rows with a product checked and left as they are (no type), flagged checked. */
  checkedUntyped: number;
  /** Parts 1 and 2: rows with no product and no type, left unflagged so the next step reads them again. */
  recheckNoProduct: number;
  /** Part 3: guard-refused rows back to verified, held. */
  restoredHeld: PlannedHold[];
  /** Part 3: guard-refused rows typed but left rejected (a check other than the account words fails). */
  typedRejected: PlannedHold[];
  /** A failed read or write (nothing written); also a `step.warning` run event. */
  error: string | null;
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

/**
 * Fees the hold leaves live although their stored product reads as another kind of account,
 * because a hand check against the bank's own text found the product wrong. One line per fee, keyed
 * by the institution, the fee's name, its price and the stored document the hand check read, so a
 * new published or verified row from a re-read of that document is left live too, and the same name
 * and price on another document (another account's list) is not; read as untyped.
 */
export interface KeepLiveFee {
  institutionId: number;
  feeName: string;
  amount: number;
  /** The stored document (`source_documents.id`) the hand check read the fee on. */
  sourceDocumentId: number;
  reason: string;
}

export const ACCOUNT_TYPE_KEEP_LIVE: readonly KeepLiveFee[] = [
  // Ontario Public Employees FCU (fee 28834): the $5 "Monthly Service Fee" row sits under "SHARE
  // DRAFT FEES"; the v55 product "REGULAR SHARE FEES" is the heading of the share section above it.
  { institutionId: 5800, feeName: "Monthly Service Fee", amount: 5, sourceDocumentId: 3633, reason: "a share draft (checking) fee; the stored product \"REGULAR SHARE FEES\" is wrong" },
];

const keepLiveKey = (institutionId: number, feeName: string, amount: number, sourceDocumentId: number) =>
  `${institutionId}|${feeName.toLowerCase().replace(/\s+/g, " ").trim()}|${Math.round(amount * 100)}|${sourceDocumentId}`;
const KEEP_LIVE_KEYS = new Set(
  ACCOUNT_TYPE_KEEP_LIVE.map((fee) => keepLiveKey(fee.institutionId, fee.feeName, fee.amount, fee.sourceDocumentId)),
);

/** Pure: whether a row is a listed fee the hold leaves live. */
export function isKeptLive(row: Pick<HoldRow, "institution_id" | "fee_name" | "amount" | "source_document_id">): boolean {
  const amount = amountOf(row.amount);
  if (amount == null || !row.fee_name || row.source_document_id == null) return false;
  return KEEP_LIVE_KEYS.has(keepLiveKey(Number(row.institution_id), row.fee_name, amount, Number(row.source_document_id)));
}

/** Pure: the typed rows of a list, each with its type. */
export function planHolds(rows: HoldRow[]): { typed: PlannedHold[]; untyped: HoldRow[] } {
  const typed: PlannedHold[] = [];
  const untyped: HoldRow[] = [];
  for (const row of rows) {
    const type = isKeptLive(row) ? null : accountTypeOf(row.product_name, row.fee_name, row.institution_name);
    if (type) typed.push(planned(row, type));
    else untyped.push(row);
  }
  return { typed, untyped };
}

const hasProduct = (row: HoldRow) => Boolean(row.product_name?.trim());

/**
 * Pure: the untyped rows that take the checked flag (a product is set, so the answer is final) and
 * the ones read again next step (no product yet; a later Knox read may fill it).
 */
export function splitUntyped(untyped: HoldRow[]): { check: HoldRow[]; recheck: HoldRow[] } {
  return { check: untyped.filter(hasProduct), recheck: untyped.filter((row) => !hasProduct(row)) };
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
  // `institutionId` scopes all three reads to one bank (a Read-now publish once the publish-sweeps
  // split is on, hamilton/publish-sweeps.ts); unset, every institution, as before.
  options: { runId: number; stepId?: number | null; batchId: string; dryRun: boolean; institutionId?: number },
): Promise<AccountTypeHoldResult> {
  const onlyInstitution = options.institutionId ?? null;
  const result: AccountTypeHoldResult = { dryRun: options.dryRun, heldLive: [], heldWaiting: [], checkedUntyped: 0, recheckNoProduct: 0, restoredHeld: [], typedRejected: [], error: null };
  let live: HoldRow[];
  let waiting: HoldRow[];
  let refused: HoldRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<HoldRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fr.product_name, fp.amount,
             fr.source_document_id, inst.institution_name
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN institution_sources inst ON inst.id = fp.institution_id
       WHERE fp.rolled_back_at IS NULL
         AND (${onlyInstitution}::bigint IS NULL OR fp.institution_id = ${onlyInstitution}::bigint)
         AND fp.canonical_fee_key = ${HOLD_CATEGORY}
         AND NOT (COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${ACCOUNT_TYPE_CHECKED_FLAG})
       ORDER BY fp.fee_published_id
       LIMIT ${ACCOUNT_TYPE_HOLD_LIMIT}
    `);
    waiting = await inSavepoint(db, (scope) => scope<HoldRow[]>`
      SELECT fv.fee_verified_id, fv.institution_id, fv.fee_name, fr.product_name, fv.amount, fr.source_document_id, inst.institution_name
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN institution_sources inst ON inst.id = fv.institution_id
       WHERE fv.canonical_fee_key = ${HOLD_CATEGORY}
         AND (${onlyInstitution}::bigint IS NULL OR fv.institution_id = ${onlyInstitution}::bigint)
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
      SELECT fv.fee_verified_id, fv.institution_id, fr.fee_name, fr.product_name, fr.amount, fr.source_document_id, txt.normalized_text,
             inst.institution_name
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN institution_sources inst ON inst.id = fv.institution_id
        LEFT JOIN LATERAL (
          SELECT t.normalized_text FROM agent_source_texts t
           WHERE t.source_document_id = fr.source_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC LIMIT 1
        ) txt ON TRUE
       WHERE fv.canonical_fee_key = ${HOLD_CATEGORY}
         AND (${onlyInstitution}::bigint IS NULL OR fv.institution_id = ${onlyInstitution}::bigint)
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
    return { ...result, error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: ACCOUNT_TYPE_HOLD_CHECK, what: "Account type hold read", error }) };
  }
  const livePlan = planHolds(live);
  const waitingPlan = planHolds(waiting);
  const refusedPlan = planHolds(refused);
  const liveUntyped = splitUntyped(livePlan.untyped);
  const waitingUntyped = splitUntyped(waitingPlan.untyped);
  const refusedById = new Map(refused.map((row) => [Number(row.fee_verified_id), row]));
  const restored = refusedPlan.typed.filter((hold) => passesWithoutAccountWords(refusedById.get(hold.feeVerifiedId)!));
  const restoredIds = new Set(restored.map((hold) => hold.feeVerifiedId));
  const plan: AccountTypeHoldResult = {
    dryRun: options.dryRun,
    error: null,
    heldLive: livePlan.typed,
    heldWaiting: waitingPlan.typed,
    checkedUntyped: liveUntyped.check.length + waitingUntyped.check.length,
    recheckNoProduct: liveUntyped.recheck.length + waitingUntyped.recheck.length,
    restoredHeld: restored,
    typedRejected: refusedPlan.typed.filter((hold) => !restoredIds.has(hold.feeVerifiedId)),
  };
  if (options.dryRun) return plan;
  const changed = plan.heldLive.length + plan.heldWaiting.length + plan.restoredHeld.length + plan.typedRejected.length;
  result.recheckNoProduct = plan.recheckNoProduct;
  if (changed === 0 && plan.checkedUntyped === 0) return result;

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
        const reasons = plan.heldLive.map((hold) => `${ACCOUNT_TYPE_HOLD_REASON}: ${hold.accountType} (#1100)`);
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
      // A fee of a checking product is marked checked, so the next step reads the rest. A fee with
      // no product is left unflagged and read again next step, in case Knox fills its product.
      result.heldWaiting = plan.heldWaiting;
      await addFlags(plan.heldWaiting.map((hold) => hold.feeVerifiedId), plan.heldWaiting.map((hold) => accountTypeFlag(hold.accountType)), "keep");
      const checkedIds = [...liveUntyped.check, ...waitingUntyped.check].map((row) => Number(row.fee_verified_id));
      await addFlags(checkedIds, checkedIds.map(() => ACCOUNT_TYPE_CHECKED_FLAG), "keep");
      result.checkedUntyped = checkedIds.length;
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
              recheck_no_product: result.recheckNoProduct,
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("account type hold write failed:", error);
    return {
      ...result, heldLive: [], heldWaiting: [], restoredHeld: [], typedRejected: [], checkedUntyped: 0, recheckNoProduct: 0,
      error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: ACCOUNT_TYPE_HOLD_CHECK, what: "Account type hold write", error }),
    };
  }
  if (result.heldLive.length > 0) invalidatePublicReadCache();
  return result;
}

/**
 * One `pipeline_feedback` row per changed fee, weight 0. A live takedown (part 1) reads as
 * `wrong` / `wrong_category`: the fee was published under the consumer checking category. A release
 * (part 3) is the opposite judgement, a guard refusal undone, so it reads as `restored` /
 * `account_type_hold_released` (#1680); labelled `wrong_category` it would count as a wrong category
 * to any reader keyed on kind or signal. Both are filed at publish, so a re-run's upsert on the same
 * dedupe key never needs to move the stage.
 */
export function feedbackRow(hold: PlannedHold, part: "live" | "restored", runId: number): FeedbackRow {
  const released = part === "restored";
  return {
    aboutStage: "publish",
    signal: released ? "restored" : "wrong",
    kind: released ? ACCOUNT_TYPE_HOLD_RELEASED_KIND : "wrong_category",
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
