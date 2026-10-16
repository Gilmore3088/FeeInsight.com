import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackKind, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { recordStepWarning } from "@/lib/agents/hamilton/step-warning";

type SqlTag = typeof sql;

/**
 * Hand takedowns: a short, reviewed list of live fees confirmed wrong against their bank's own
 * stored text. James, Oct 16 (DECISIONS.md): up to about 25 such fees, each confirmed wrong on
 * amount or category against the bank's stored text and checked by a reviewer, come down this way
 * without a per-fee approval; a ledger line goes on #1026. Category or policy questions, large
 * batches, migrations and switches still go to him.
 *
 * A fixed list, not a takedown tool. A row comes down only while it still reads as listed (live,
 * same institution, category, name and price). Its verified row is rejected too, so no later
 * publish brings it back. Archived, never deleted: `rolled_back_reason` is the entry's reason
 * (`source_mismatch: #1496`); clearing `rolled_back_at` (and the verified row's status) restores
 * it. Each takedown records the row in `pipeline_feedback`, and the run gets one event naming every
 * row. Running it again changes nothing: a row already down is skipped. Add later rows below as
 * one entry each, never edit a past one. A failed read or write never fails the publish: it is
 * kept in the result (`error`) and as a `step.warning` run event, so the run ledger shows it.
 */
export const HAND_TAKEDOWN_CHECK = "hamilton.hand_takedown";
export const HAND_TAKEDOWN_FLAG = "hand_rejected:hand_takedown";

export interface HandTakedown {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number;
  /** The name the live row carries now. */
  feeName: string;
  /** `rolled_back_reason`, e.g. `source_mismatch: #1496`. */
  reason: string;
  /** The issue that holds the evidence. */
  issue: number;
  kind: Extract<FeedbackKind, "wrong_amount" | "wrong_category" | "not_a_fee">;
  /** What the bank's own text says, in one line. */
  evidence: string;
}

export const HAND_TAKEDOWNS: readonly HandTakedown[] = [
  // #1496 (James approved, Oct 16): Barksdale FCU's two-column fee schedule (text 17003) read line by line.
  { feePublishedId: 80423, institutionId: 5433, canonicalFeeKey: "document_reproduction", amount: 15, feeName: "Fax (Local)",
    reason: "source_mismatch: #1496", issue: 1496, kind: "wrong_amount",
    evidence: "Fax (Local) is $5.00 for 2 pages, $2.00 for additional pages; the $15.00 is the next column's Duplicate Key by mail." },
  { feePublishedId: 102440, institutionId: 5433, canonicalFeeKey: "document_reproduction", amount: 2, feeName: "Fax (Long Distance) Minimum Balance",
    reason: "source_mismatch: #1496", issue: 1496, kind: "wrong_amount",
    evidence: "Fax (Long Distance) is $7.00 for 2 pages, $2.00 for additional pages; \"Minimum Balance:\" is the next column's heading." },
  // #1549: Flagstar's overdraft terms (doc 21228, read-only, Oct 16): the $20 is a worked example's remainder.
  { feePublishedId: 83118, institutionId: 33, canonicalFeeKey: "overdraft", amount: 20, feeName: "we may use Overdraft Protection Coverage to pay the remaining",
    reason: "source_mismatch: #1549", issue: 1549, kind: "wrong_amount",
    evidence: "Example: \"…$20 is transferred from your linked account, we may use Overdraft Protection Coverage to pay the remaining $20\"; the same document's price is \"Overdraft Charge $30.00 per Item\"." },
  // #1512: Utility District FCU's two-column fee schedule (doc 3497, read-only, Oct 16).
  { feePublishedId: 45619, institutionId: 7229, canonicalFeeKey: "check_printing", amount: 20, feeName: "Check printing…………………………………………………......…...…(varies by style) | Domestic",
    reason: "source_mismatch: #1512", issue: 1512, kind: "wrong_amount",
    evidence: "Check printing has no price (\"varies by style\"); the $20.00 is the next column's \"Domestic\" line under outgoing wire transfers." },
  // #1370: two subordination fees the switched re-file holds (SUBORDINATION_REFILE_HELD_VERIFIED_IDS),
  // each read from a two-column fee schedule (read-only, Oct 16). Both prices belong to another row.
  { feePublishedId: 116720, institutionId: 8459, canonicalFeeKey: "other_lending_fee", amount: 20, feeName: "SUBORDINATION REQUEST & PARTIAL: WIRE TRANSFER",
    reason: "source_mismatch: #1370", issue: 1370, kind: "wrong_amount",
    evidence: "Crow Wing Power CU (doc 26125): \"SUBORDINATION REQUEST & PARTIAL RELEASE – $250\"; the $20 is the next row's \"WIRE TRANSFER – $20, Charged per outgoing domestic wire transfer\"." },
  { feePublishedId: 134129, institutionId: 4815, canonicalFeeKey: "other_lending_fee", amount: 10, feeName: "Subordination Fee: Business",
    reason: "source_mismatch: #1370", issue: 1370, kind: "wrong_amount",
    evidence: "Ume FCU (doc 7849): the $10 is the next column's \"Checking Accounts | Business | $10 per month\"; the \"Subordination Fee\" line carries no $10." },
  // #1534 review (read-only, Oct 16): three loan-payment fees filed under other categories.
  { feePublishedId: 48113, institutionId: 7483, canonicalFeeKey: "safe_deposit_box", amount: 25, feeName: "Returned loan payment",
    reason: "source_mismatch: #1534", issue: 1534, kind: "wrong_amount",
    evidence: "Together CU (doc 2048): \"Returned loan payment (excludes credit cards) … $15/payment\"; the $25/year is the next column's \"Size 3x5 $25/year\" safe deposit box." },
  { feePublishedId: 87307, institutionId: 5054, canonicalFeeKey: "ach_return", amount: 25, feeName: "Returned Loan Payment (check or ACH returned unpaid; per item)",
    reason: "source_mismatch: #1534", issue: 1534, kind: "wrong_category",
    evidence: "WF FCU (doc 30721), under \"Loan Account Fees\": \"Returned Loan Payment (check or ACH returned unpaid; per item) | $25.00\", a loan fee; the ACH return fee is its own tiered row (\"ACH Returns: $5 … $15 … $25\")." },
  { feePublishedId: 134962, institutionId: 8566, canonicalFeeKey: "account_research", amount: 29.5, feeName: "Loan Payment with Debit Card - Chargeback",
    reason: "source_mismatch: #1534", issue: 1534, kind: "wrong_category",
    evidence: "Texell CU (doc 29092): \"Loan Payment with Debit Card - Chargeback $29.50 per item\", next to \"Loan Payment with Debit Card - Return Item\": a loan payment fee, not account research." },
  // #1571 (read-only, Oct 16): live $0s whose own schedule row prices them under a condition; each
  // re-read against the stored text by the advisor session and checked by a separate reviewer.
  { feePublishedId: 43512, institutionId: 4669, canonicalFeeKey: "dormant_account", amount: 0, feeName: "Dormant Account Fee Accounts with no activity for 12 months. Dormant accounts with",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Jersey Central FCU (doc 3614): \"Dormant Account Fee ... Dormant accounts with $0.00 balance will be closed. | $10.00 per quarter\"; the fee is $10.00 a quarter, $0.00 is the closing balance." },
  { feePublishedId: 54014, institutionId: 8259, canonicalFeeKey: "cashiers_check", amount: 0, feeName: "CASHIER’S CHECKS: first three (3)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Southeast Missouri Community FCU (doc 16700): \"CASHIER’S CHECKS: first three (3) FREE per month, $1.50 thereafter; members only\"." },
  { feePublishedId: 61335, institutionId: 6219, canonicalFeeKey: "monthly_maintenance", amount: 0, feeName: "Standard Checking Monthly Fee - Balance over",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Irco Community FCU (doc 18184): \"Balance over $250 | FREE\" and the next row \"Balance under $250 | $10.00\"; a balance band, not the price." },
  { feePublishedId: 68893, institutionId: 8536, canonicalFeeKey: "overdraft", amount: 0, feeName: "Courtesy Pay fees are",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Downeast FCU (doc 20241): \"Courtesy Pay fees are $0 for transactions $15 and under and then just $15 per item over $15\"." },
  { feePublishedId: 70121, institutionId: 4197, canonicalFeeKey: "card_replacement", amount: 0, feeName: "Lost Card",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Carrollton Federal Bank (doc 25216): \"ATM or Debit Card No Charge For First Card --- $10.00 For Lost Card\"; a lost card is $10.00." },
  { feePublishedId: 73737, institutionId: 6300, canonicalFeeKey: "coin_counting", amount: 0, feeName: "Coin Counting (Mbr up to /Mbr over /Non-Mbr)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Aurora FCU (doc 20537): \"Coin Counting (Mbr up to $100/Mbr over $100/Non-Mbr) | FREE/5%/10%\"; free only for members up to $100." },
  { feePublishedId: 77121, institutionId: 5313, canonicalFeeKey: "check_image", amount: 0, feeName: "Check copy that has cleared (per item) - Online copies are",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Lakeshore FCU (doc 18957): \"Check copy that has cleared (per item) - Online copies are FREE up to 12 months old | $5.00\"." },
  { feePublishedId: 77122, institutionId: 5313, canonicalFeeKey: "document_reproduction", amount: 0, feeName: "Statement copies (per statement) - Online copies are",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Lakeshore FCU (doc 18957): \"Statement copies (per statement) - Online copies are FREE up to 18 months | $5.00\"." },
  { feePublishedId: 77618, institutionId: 7383, canonicalFeeKey: "coin_counting", amount: 0, feeName: "Coin Counting, Free for Kids Club Member or for amounts less than",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Members First FCU (doc 16105): \"2.00% of amount | Coin Counting, Free for Kids Club Member or for amounts less than $50.00\"." },
  { feePublishedId: 84553, institutionId: 8221, canonicalFeeKey: "collection_item", amount: 0, feeName: "Foreign Check Deposit (below $10,000)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "First Community FCU (doc 6206): \"Foreign Check Deposit (below $10,000) ....FREE\" and \"Foreign Check Deposit ($10,000 or more) .... $125.00\"; an amount band." },
  { feePublishedId: 87079, institutionId: 7736, canonicalFeeKey: "notary_fee", amount: 0, feeName: "Notary Public – (per notarized document)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Del Norte FCU (doc 21594): \"Notary Public – (per notarized document)- FREE for members $5.00\"." },
  { feePublishedId: 87461, institutionId: 8259, canonicalFeeKey: "document_reproduction", amount: 0, feeName: "FAX TRANSMISSION: first five (5) pages",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Southeast Missouri Community FCU (doc 16700): \"FAX TRANSMISSION: first five (5) pages FREE per month, $1.00 per page thereafter\"." },
  { feePublishedId: 88213, institutionId: 4236, canonicalFeeKey: "monthly_maintenance", amount: 0, feeName: "Service charge",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Citizens State Bank (doc 19551): \"No Charge\" only \"if a minimum balance of $100.00 is maintained\"; \"$5.00\" if it is NOT maintained." },
  { feePublishedId: 91505, institutionId: 4808, canonicalFeeKey: "cashiers_check", amount: 0, feeName: "Third-Party Official Check – Over",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "NCPD FCU (doc 21964): \"Third-Party Official Check – Over $3,000 | No Charge\" and \"Under $3,000 | $3.00\"; an amount band." },
  { feePublishedId: 120559, institutionId: 5313, canonicalFeeKey: "cashiers_check", amount: 0, feeName: "Cashier's checks - One",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Lakeshore FCU (doc 3367): \"Cashier's checks - One FREE check per month (additonal checks each) | $1.00\"." },
  // #1512 (James approved, Oct 16 03:37 UTC, roadmap item 3.8): a joined row whose own price is
  // not the overdraft fee. The other seven #1512/#1513 rows are renamed or re-filed in place
  // (taxonomy-fold HAND_REFILES).
  { feePublishedId: 142965, institutionId: 4965, canonicalFeeKey: "overdraft", amount: 10, feeName: "Courtesy Pay Fee (per transaction) Research & Reconcilement (per hour)",
    reason: "source_mismatch: #1512", issue: 1512, kind: "wrong_amount",
    evidence: "Access FCU (doc 33871): \"Courtesy Pay Fee (per transaction) ……Research & Reconcilement (per hour)…. $10.00$25.00\" joins two lines; the bank's fee table (doc 26372) prints \"Courtesy Pay Fee | $25.00\" and \"Research & Reconcilement (per hour) | $10.00\", so $10 is not the courtesy pay fee." },
];

export interface LiveTakedownRow {
  fee_published_id: number | string;
  lineage_ref: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

export interface PlannedHandTakedown {
  feePublishedId: number;
  feeVerifiedId: number | null;
  reason: string;
}

export interface HandTakedownResult {
  dryRun: boolean;
  takenDown: PlannedHandTakedown[];
  /** Listed rows left alone, with why (not live, or changed since it was listed). */
  skipped: Array<{ feePublishedId: number; reason: string }>;
  /** A failed read or write (nothing written); also a `step.warning` run event. */
  error: string | null;
}

const sameAmount = (a: number | string | null, b: number) => a != null && Math.abs(Number(a) - b) < 0.005;

/** Pure: which listed rows come down, from their live rows. */
export function planHandTakedowns(live: LiveTakedownRow[], list: readonly HandTakedown[] = HAND_TAKEDOWNS): Pick<HandTakedownResult, "takenDown" | "skipped"> {
  const byId = new Map(live.map((row) => [Number(row.fee_published_id), row]));
  const takenDown: PlannedHandTakedown[] = [];
  const skipped: HandTakedownResult["skipped"] = [];
  for (const entry of list) {
    const row = byId.get(entry.feePublishedId);
    if (!row) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "not live" });
      continue;
    }
    if (Number(row.institution_id) !== entry.institutionId || row.canonical_fee_key !== entry.canonicalFeeKey ||
        row.fee_name !== entry.feeName || !sameAmount(row.amount, entry.amount)) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "changed since listed" });
      continue;
    }
    takenDown.push({ feePublishedId: entry.feePublishedId, feeVerifiedId: row.lineage_ref == null ? null : Number(row.lineage_ref), reason: entry.reason });
  }
  return { takenDown, skipped };
}

/**
 * Runs in the publish step. A dry run reports what it would take down and writes nothing. Never
 * blocks the step it runs in.
 */
export async function applyHandTakedowns(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; batchId: string; dryRun: boolean; list?: readonly HandTakedown[] },
): Promise<HandTakedownResult> {
  const list = options.list ?? HAND_TAKEDOWNS;
  const result: HandTakedownResult = { dryRun: options.dryRun, takenDown: [], skipped: [], error: null };
  if (list.length === 0) return result;
  const ids = [...new Set(list.map((entry) => entry.feePublishedId))];
  let live: LiveTakedownRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<LiveTakedownRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
       WHERE fp.fee_published_id = ANY(${ids}::bigint[])
         AND fp.rolled_back_at IS NULL
    `);
  } catch (error) {
    console.error("hand takedowns read failed:", error);
    return { ...result, error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: HAND_TAKEDOWN_CHECK, what: "Hand takedowns read", error }) };
  }
  const plan = planHandTakedowns(live, list);
  result.skipped = plan.skipped;
  if (options.dryRun) return { ...result, takenDown: plan.takenDown };
  if (plan.takenDown.length === 0) return result;

  try {
    await inSavepoint(db, async (scope) => {
      for (const item of plan.takenDown) {
        const entry = list.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${entry.reason}
           WHERE fee_published_id = ${item.feePublishedId}
             AND rolled_back_at IS NULL
             AND institution_id = ${entry.institutionId}
             AND canonical_fee_key = ${entry.canonicalFeeKey}
             AND fee_name = ${entry.feeName}
             AND abs(amount - ${entry.amount}::numeric) < 0.005
          RETURNING fee_published_id
        `;
        if (updated.length === 0) continue;
        if (item.feeVerifiedId != null) {
          await scope`
            UPDATE verified_fee_observations
               SET review_status = 'rejected',
                   outlier_flags = CASE WHEN outlier_flags ? ${HAND_TAKEDOWN_FLAG} THEN outlier_flags
                                        ELSE COALESCE(outlier_flags, '[]'::jsonb) || jsonb_build_array(${HAND_TAKEDOWN_FLAG}::text) END
             WHERE fee_verified_id = ${item.feeVerifiedId}
               AND review_status IN ('verified', 'approved')
          `;
        }
        result.takenDown.push(item);
      }
      const feedback: FeedbackRow[] = result.takenDown.map((item) => {
        const entry = list.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        return {
          aboutStage: "extract" as const,
          signal: "wrong" as const,
          kind: entry.kind,
          reportedBy: "gutenberg" as const,
          checkName: HAND_TAKEDOWN_CHECK,
          institutionId: entry.institutionId,
          feeVerifiedId: item.feeVerifiedId,
          feePublishedId: item.feePublishedId,
          canonicalFeeKey: entry.canonicalFeeKey,
          amount: entry.amount,
          runId: options.runId,
          dedupeKey: `${HAND_TAKEDOWN_CHECK}:pub:${item.feePublishedId}`,
          evidence: { fee_name: entry.feeName, reason: entry.reason, issue: entry.issue, source: entry.evidence },
        };
      });
      if (feedback.length > 0) await recordFeedback(scope, feedback);
      if (result.takenDown.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, ${HAND_TAKEDOWN_CHECK}, 'completed',
            ${`Took down ${result.takenDown.length} listed live fee(s) confirmed wrong against their bank's own text`},
            ${JSON.stringify({
              taken_down: result.takenDown.map((item) => ({ fee_published_id: item.feePublishedId, fee_verified_id: item.feeVerifiedId, reason: item.reason })),
              skipped: result.skipped,
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("hand takedowns write failed:", error);
    return { ...result, takenDown: [], error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: HAND_TAKEDOWN_CHECK, what: "Hand takedowns write", error }) };
  }
  if (result.takenDown.length > 0) invalidatePublicReadCache();
  return result;
}
