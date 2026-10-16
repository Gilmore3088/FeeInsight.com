import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { recordStepWarning } from "@/lib/agents/hamilton/step-warning";

type SqlTag = typeof sql;

/**
 * #1196 (James approved, Oct 15, comment 6193649019 group 1): five live fees whose names open on a
 * cut price or a row number ("00 Copy of Draft", "13 | Outgoing domestic wire transfer") repeat a
 * clean live row at the same institution, category and price. Knox's name retidy produces the clean
 * name but skips them as `same_name_live`, and the duplicate collapse would keep the newest copy,
 * which here is the cut one, and close the clean row. So each cut row comes down by hand and the
 * clean row stays.
 *
 * A fixed list, not a takedown tool. A row comes down only while it still reads as labelled (live,
 * same institution, category, name and price) and while the row it repeats is still live with its
 * clean name at the same price. Its verified row is rejected too, so no later publish brings it back.
 * Archived, never deleted: `rolled_back_reason = 'cut_name_duplicate: live fee #<kept id>'`;
 * clearing `rolled_back_at` (and the verified row's status) restores it. Each takedown records the
 * row in `pipeline_feedback` and the run gets one event naming every row. Add later rows below,
 * never edit a past one.
 */
export const CUT_NAME_DUPLICATE_CHECK = "hamilton.cut_name_duplicate";
export const CUT_NAME_DUPLICATE_REASON = "cut_name_duplicate";
export const CUT_NAME_DUPLICATE_FLAG = "hand_rejected:cut_name_duplicate";

export interface CutNameDuplicate {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number;
  /** The cut name the row carries now. */
  feeName: string;
  /** The live row it repeats, which stays. */
  keepFeePublishedId: number;
  keepName: string;
}

export const CUT_NAME_DUPLICATES: readonly CutNameDuplicate[] = [
  { feePublishedId: 143045, institutionId: 303, canonicalFeeKey: "early_closure", amount: 25, feeName: "00 Account closing fee",
    keepFeePublishedId: 9647, keepName: "Account closing fee" },
  { feePublishedId: 118050, institutionId: 6710, canonicalFeeKey: "od_protection_transfer", amount: 0.5, feeName: "19 | Overdraft transfer service",
    keepFeePublishedId: 83198, keepName: "Overdraft transfer service" },
  { feePublishedId: 118051, institutionId: 6710, canonicalFeeKey: "wire_domestic_outgoing", amount: 15, feeName: "13 | Outgoing domestic wire transfer",
    keepFeePublishedId: 83201, keepName: "Outgoing domestic wire transfer" },
  { feePublishedId: 143044, institutionId: 7517, canonicalFeeKey: "wire_domestic_outgoing", amount: 20, feeName: "00 Wire Transfer – Outgoing Domestic",
    keepFeePublishedId: 141769, keepName: "Wire Transfer – Outgoing Domestic" },
  { feePublishedId: 143046, institutionId: 7517, canonicalFeeKey: "check_image", amount: 2, feeName: "00 Copy of Draft",
    keepFeePublishedId: 141770, keepName: "Copy of Draft" },
];

export interface LiveFeeRow {
  fee_published_id: number | string;
  lineage_ref: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

export interface PlannedTakedown {
  feePublishedId: number;
  feeVerifiedId: number | null;
  keepFeePublishedId: number;
}

export interface CutNameDuplicateResult {
  dryRun: boolean;
  takenDown: PlannedTakedown[];
  /** Listed rows left alone, with why (already down, changed since labelling, or the kept row is gone). */
  skipped: Array<{ feePublishedId: number; reason: string }>;
  /** A failed read or write (nothing written); also a `step.warning` run event. */
  error: string | null;
}

const sameAmount = (a: number | string | null, b: number) => a != null && Math.abs(Number(a) - b) < 0.005;

/** Pure: which listed rows come down, from the live rows of both the cut rows and the rows they repeat. */
export function planCutNameDuplicates(live: LiveFeeRow[], list: readonly CutNameDuplicate[] = CUT_NAME_DUPLICATES): Pick<CutNameDuplicateResult, "takenDown" | "skipped"> {
  const byId = new Map(live.map((row) => [Number(row.fee_published_id), row]));
  const takenDown: PlannedTakedown[] = [];
  const skipped: CutNameDuplicateResult["skipped"] = [];
  for (const entry of list) {
    const row = byId.get(entry.feePublishedId);
    if (!row) { skipped.push({ feePublishedId: entry.feePublishedId, reason: "not live" }); continue; }
    if (Number(row.institution_id) !== entry.institutionId || row.canonical_fee_key !== entry.canonicalFeeKey ||
        row.fee_name !== entry.feeName || !sameAmount(row.amount, entry.amount)) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "changed since labelling" });
      continue;
    }
    const kept = byId.get(entry.keepFeePublishedId);
    if (!kept || Number(kept.institution_id) !== entry.institutionId || kept.canonical_fee_key !== entry.canonicalFeeKey ||
        kept.fee_name.trim() !== entry.keepName || !sameAmount(kept.amount, entry.amount)) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "kept row not live as labelled" });
      continue;
    }
    takenDown.push({
      feePublishedId: entry.feePublishedId,
      feeVerifiedId: row.lineage_ref == null ? null : Number(row.lineage_ref),
      keepFeePublishedId: entry.keepFeePublishedId,
    });
  }
  return { takenDown, skipped };
}

/**
 * Runs in the publish step. A dry run reports what it would take down and writes nothing. Never
 * blocks the step it runs in: a failed read or write is kept in the result (`error`) and as a
 * `step.warning` run event. Running it again changes nothing: a row already down is skipped.
 */
export async function applyCutNameDuplicates(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; batchId: string; dryRun: boolean },
): Promise<CutNameDuplicateResult> {
  const result: CutNameDuplicateResult = { dryRun: options.dryRun, takenDown: [], skipped: [], error: null };
  const ids = [...new Set(CUT_NAME_DUPLICATES.flatMap((entry) => [entry.feePublishedId, entry.keepFeePublishedId]))];
  let live: LiveFeeRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<LiveFeeRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
       WHERE fp.fee_published_id = ANY(${ids}::bigint[])
         AND fp.rolled_back_at IS NULL
    `);
  } catch (error) {
    console.error("cut name duplicates read failed:", error);
    return { ...result, error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: CUT_NAME_DUPLICATE_CHECK, what: "Cut-name duplicates read", error }) };
  }
  const plan = planCutNameDuplicates(live);
  result.skipped = plan.skipped;
  if (options.dryRun) return { ...result, takenDown: plan.takenDown };
  if (plan.takenDown.length === 0) return result;

  try {
    await inSavepoint(db, async (scope) => {
      for (const item of plan.takenDown) {
        const entry = CUT_NAME_DUPLICATES.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${`${CUT_NAME_DUPLICATE_REASON}: live fee #${item.keepFeePublishedId}`}
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
                   outlier_flags = CASE WHEN outlier_flags ? ${CUT_NAME_DUPLICATE_FLAG} THEN outlier_flags
                                        ELSE COALESCE(outlier_flags, '[]'::jsonb) || jsonb_build_array(${CUT_NAME_DUPLICATE_FLAG}::text) END
             WHERE fee_verified_id = ${item.feeVerifiedId}
               AND review_status IN ('verified', 'approved')
          `;
        }
        result.takenDown.push(item);
      }
      const feedback: FeedbackRow[] = result.takenDown.map((item) => {
        const entry = CUT_NAME_DUPLICATES.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        return {
          aboutStage: "extract" as const,
          signal: "wrong" as const,
          kind: "duplicate",
          reportedBy: "gutenberg" as const,
          checkName: CUT_NAME_DUPLICATE_CHECK,
          institutionId: entry.institutionId,
          feeVerifiedId: item.feeVerifiedId,
          feePublishedId: item.feePublishedId,
          canonicalFeeKey: entry.canonicalFeeKey,
          amount: entry.amount,
          runId: options.runId,
          dedupeKey: `${CUT_NAME_DUPLICATE_CHECK}:pub:${item.feePublishedId}`,
          evidence: { fee_name: entry.feeName, kept_fee_published_id: item.keepFeePublishedId, kept_name: entry.keepName, issue: 1196 },
        };
      });
      if (feedback.length > 0) await recordFeedback(scope, feedback);
      // No event when every guarded UPDATE matched nothing (a row changed after the read).
      if (result.takenDown.length === 0) return;
      await scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${CUT_NAME_DUPLICATE_CHECK}, 'completed',
          ${`Took down ${result.takenDown.length} live fee(s) whose cut names repeat a clean live row (#1196)`},
          ${JSON.stringify({
            taken_down: result.takenDown.map((item) => ({
              fee_published_id: item.feePublishedId,
              fee_verified_id: item.feeVerifiedId,
              kept_fee_published_id: item.keepFeePublishedId,
              reason: `${CUT_NAME_DUPLICATE_REASON}: live fee #${item.keepFeePublishedId}`,
            })),
            skipped: result.skipped,
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("cut name duplicates write failed:", error);
    return { ...result, takenDown: [], error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: CUT_NAME_DUPLICATE_CHECK, what: "Cut-name duplicates write", error }) };
  }
  if (result.takenDown.length > 0) invalidatePublicReadCache();
  return result;
}
