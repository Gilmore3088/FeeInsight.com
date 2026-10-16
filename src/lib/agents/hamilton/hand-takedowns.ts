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
          reportedBy: "hamilton" as const,
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
          INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${HAND_TAKEDOWN_CHECK}, 'completed',
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
