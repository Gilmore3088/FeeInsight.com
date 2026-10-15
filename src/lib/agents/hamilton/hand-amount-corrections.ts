import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * #1334 (James approved, Oct 15: "yes. approved. fix it"): eight live fees Knox read with their
 * cents cut off, from pages whose PDF text dropped the decimal point ("$29. 95", "$1 50*",
 * "$ 004 50"). Each is corrected in place to its line's own price, published and verified rows
 * together, instead of coming down for a fresh read: a fresh read of the same document publishes
 * beside the wrong row (`decidePriorFee` gives "additional_line"), so two prices would be live
 * until the wrong one's second look. After the correction the v67 re-read lands as "identical".
 *
 * A fixed list, not an amount editor. A row is corrected only while it still reads as labelled
 * (live, same category, same document, the cut amount) and only when the shared source check
 * (`checkFeeAgainstSource`, reading dropped decimal points since #1334) traces the corrected price
 * under the corrected name on the row's own stored text and no longer traces the cut amount.
 * Each correction records its old amount and name in `pipeline_feedback` (rollback) and a run
 * event. Add later checks below, never edit a past one.
 */
export const HAND_AMOUNT_CHECK = "hamilton.hand_amount_correction";
export const HAND_AMOUNT_CORRECTED_FLAG = "hand_amount_corrected";

export interface HandAmountCorrection {
  feePublishedId: number;
  institution: string;
  institutionId: number;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  from: number;
  to: number;
  /** The fee's name as its line prints it (the cut cents taken off the front where they were). */
  feeName: string;
  why: string;
}

export const HAND_AMOUNT_CORRECTIONS: readonly HandAmountCorrection[] = [
  {
    feePublishedId: 49175, institution: "Xplore Federal Credit Union", institutionId: 6636, sourceDocumentId: 12872,
    canonicalFeeKey: "other_lending_fee", from: 29, to: 29.95, feeName: "Loan Skip A Pay Fee",
    why: "\"Loan Skip A Pay Fee .... $29. 95/ea ch\": the point is kept with a space after it",
  },
  {
    feePublishedId: 29166, institution: "Members1St Community Federal Credit Union", institutionId: 7517, sourceDocumentId: 13851,
    canonicalFeeKey: "atm_non_network", from: 1, to: 1.5, feeName: "ATM Transactions (per item)",
    why: "\"ATM Transactions (per item) | $1 50* after 8/mo\": the cents end at the footnote star",
  },
  {
    feePublishedId: 141772, institution: "Members1St Community Federal Credit Union", institutionId: 7517, sourceDocumentId: 32358,
    canonicalFeeKey: "atm_non_network", from: 1, to: 1.5, feeName: "ATM Transactions (per item)",
    why: "The May 2025 copy of the same schedule: \"ATM Transactions (per item) | $1 50* after 8/mo\"",
  },
  {
    feePublishedId: 97435, institution: "HomeTrust Bank", institutionId: 303, sourceDocumentId: 8040,
    canonicalFeeKey: "paper_statement", from: 1, to: 1.5, feeName: "Mailed paper statement fee, per month",
    why: "Personal schedule: \"Mailed paper statement fee, per month | $1 50\" (the business schedule's $3.50 is another line)",
  },
  {
    feePublishedId: 61650, institution: "Main Street Bank", institutionId: 683, sourceDocumentId: 18254,
    canonicalFeeKey: "atm_non_network", from: 1, to: 1.5, feeName: "Non-Main Street Bank ATM Transaction",
    why: "\"Non-Main Street Bank ATM Transaction | $1 50\", printed under each account",
  },
  {
    feePublishedId: 61934, institution: "Civista Bank", institutionId: 332, sourceDocumentId: 18387,
    canonicalFeeKey: "atm_non_network", from: 4, to: 4.5, feeName: "Non-Civista ATM Transaction",
    why: "\"Non-Civista ATM Transaction | $ 004 50\" (the page pads every price: \"$ 035 00\" is $35)",
  },
  {
    feePublishedId: 79234, institution: "American Heritage Federal Credit Union", institutionId: 4972, sourceDocumentId: 20917,
    canonicalFeeKey: "card_replacement", from: 7, to: 7.5, feeName: "Replacement Card – EMV Chip Card",
    why: "\"Replacement Card – EMV Chip Card | $7 50\"",
  },
  {
    feePublishedId: 79237, institution: "American Heritage Federal Credit Union", institutionId: 4972, sourceDocumentId: 20917,
    canonicalFeeKey: "gift_card_purchase", from: 3, to: 3.5, feeName: "Gift Card",
    why: "\"Gift Card | $3 50 | Late Payment Fee\"",
  },
];

/**
 * Verified rows of the same wrong reads that never published (skipped as identical behind a live
 * row above). Rejected so no later step can publish the cut price: a rules re-check takedown of
 * the live row would select them again. Only while each still reads as labelled.
 */
export interface HandRejectedTwin {
  feeVerifiedId: number;
  /** The corrected live fee it repeats. */
  ofFeePublishedId: number;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  amount: number;
  feeName: string;
  why: string;
}

export const HAND_REJECTED_TWINS: readonly HandRejectedTwin[] = [
  {
    feeVerifiedId: 113133, ofFeePublishedId: 49175, sourceDocumentId: 12872, canonicalFeeKey: "other_lending_fee", amount: 29,
    feeName: "Loan Skip A Pay Fee", why: "The same $29. 95 line read as $29",
  },
  {
    feeVerifiedId: 112658, ofFeePublishedId: 29166, sourceDocumentId: 13851, canonicalFeeKey: "atm_non_network", amount: 1,
    feeName: "ATM Transactions (per item)", why: "The same $1 50* line read as $1",
  },
  {
    feeVerifiedId: 157467, ofFeePublishedId: 61650, sourceDocumentId: 29399, canonicalFeeKey: "atm_non_network", amount: 1,
    feeName: "Non-Main Street Bank ATM Transaction",
    why: "Doc 29399 prints \"Non-Main Street Bank ATM Transaction | $1 50\" too; it has only two \"$N 00\" prices, too few for the dropped-point reading, so the check cannot catch it",
  },
  {
    feeVerifiedId: 125738, ofFeePublishedId: 79234, sourceDocumentId: 20917, canonicalFeeKey: "card_replacement", amount: 7,
    feeName: "Card Replacement Fee", why: "\"Card Replacement Fee | $7 50\" read as $7",
  },
];
export const HAND_REJECTED_TWIN_FLAG = "hand_rejected:cut_cents_twin";

interface LiveRow {
  fee_published_id: number | string;
  lineage_ref: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  source_document_id: number | string | null;
  normalized_text: string | null;
}

interface TwinRow {
  fee_verified_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  review_status: string;
  source_document_id: number | string | null;
  live_published: boolean;
}

export interface PlannedCorrection {
  feePublishedId: number;
  feeVerifiedId: number | null;
  from: number;
  to: number;
  oldName: string;
  newName: string;
  sourceLine: string;
}

export interface HandAmountResult {
  dryRun: boolean;
  corrected: PlannedCorrection[];
  /** Listed fees left alone, with why (already corrected, changed since labelling, or the check disagreed). */
  skipped: Array<{ feePublishedId: number; reason: string }>;
  rejectedTwins: number[];
  skippedTwins: Array<{ feeVerifiedId: number; reason: string }>;
}

const sameAmount = (a: number | string | null, b: number) => a != null && Math.abs(Number(a) - b) < 0.005;

/** Pure: which listed fees are corrected, from their live rows and stored texts. */
export function planHandAmountCorrections(rows: LiveRow[]): Pick<HandAmountResult, "corrected" | "skipped"> {
  const byId = new Map(rows.map((row) => [Number(row.fee_published_id), row]));
  const corrected: PlannedCorrection[] = [];
  const skipped: HandAmountResult["skipped"] = [];
  for (const fix of HAND_AMOUNT_CORRECTIONS) {
    const row = byId.get(fix.feePublishedId);
    if (!row) { skipped.push({ feePublishedId: fix.feePublishedId, reason: "not live" }); continue; }
    if (sameAmount(row.amount, fix.to)) { skipped.push({ feePublishedId: fix.feePublishedId, reason: "already corrected" }); continue; }
    if (!sameAmount(row.amount, fix.from) || row.canonical_fee_key !== fix.canonicalFeeKey ||
        Number(row.source_document_id) !== fix.sourceDocumentId || Number(row.institution_id) !== fix.institutionId) {
      skipped.push({ feePublishedId: fix.feePublishedId, reason: "changed since labelling" });
      continue;
    }
    const text = row.normalized_text;
    const traced = checkFeeAgainstSource(text, fix.feeName, fix.to, ".", fix.canonicalFeeKey);
    if (!traced.ok) { skipped.push({ feePublishedId: fix.feePublishedId, reason: `corrected price does not trace: ${traced.reason}` }); continue; }
    if (checkFeeAgainstSource(text, row.fee_name, fix.from, ".", fix.canonicalFeeKey).ok) {
      skipped.push({ feePublishedId: fix.feePublishedId, reason: "cut amount still traces" });
      continue;
    }
    corrected.push({
      feePublishedId: fix.feePublishedId,
      feeVerifiedId: row.lineage_ref == null ? null : Number(row.lineage_ref),
      from: fix.from,
      to: fix.to,
      oldName: row.fee_name,
      newName: fix.feeName,
      sourceLine: traced.sourceLine,
    });
  }
  return { corrected, skipped };
}

/** Pure: which listed twins are rejected. */
export function planTwinRejections(rows: TwinRow[]): Pick<HandAmountResult, "rejectedTwins" | "skippedTwins"> {
  const byId = new Map(rows.map((row) => [Number(row.fee_verified_id), row]));
  const rejectedTwins: number[] = [];
  const skippedTwins: HandAmountResult["skippedTwins"] = [];
  for (const twin of HAND_REJECTED_TWINS) {
    const row = byId.get(twin.feeVerifiedId);
    if (!row) { skippedTwins.push({ feeVerifiedId: twin.feeVerifiedId, reason: "not found" }); continue; }
    if (!["verified", "approved"].includes(row.review_status)) { skippedTwins.push({ feeVerifiedId: twin.feeVerifiedId, reason: `already ${row.review_status}` }); continue; }
    if (row.live_published) { skippedTwins.push({ feeVerifiedId: twin.feeVerifiedId, reason: "published" }); continue; }
    if (!sameAmount(row.amount, twin.amount) || row.canonical_fee_key !== twin.canonicalFeeKey ||
        Number(row.source_document_id) !== twin.sourceDocumentId || row.fee_name !== twin.feeName) {
      skippedTwins.push({ feeVerifiedId: twin.feeVerifiedId, reason: "changed since labelling" });
      continue;
    }
    rejectedTwins.push(twin.feeVerifiedId);
  }
  return { rejectedTwins, skippedTwins };
}

/**
 * Runs in the publish step. A dry run reports what it would do and writes nothing. Never blocks
 * the step it runs in. Rollback per fee: `pipeline_feedback` (check `hamilton.hand_amount_correction`)
 * holds `old_amount` and `old_name`.
 */
export async function applyHandAmountCorrections(
  db: SqlTag,
  options: { runId: number; dryRun: boolean },
): Promise<HandAmountResult> {
  const result: HandAmountResult = { dryRun: options.dryRun, corrected: [], skipped: [], rejectedTwins: [], skippedTwins: [] };
  let live: LiveRow[];
  let twins: TwinRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<LiveRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
             fr.source_document_id, txt.normalized_text
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN LATERAL (
          SELECT t.normalized_text FROM agent_source_texts t
           WHERE t.source_document_id = fr.source_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC LIMIT 1
        ) txt ON TRUE
       WHERE fp.fee_published_id = ANY(${HAND_AMOUNT_CORRECTIONS.map((fix) => fix.feePublishedId)}::bigint[])
         AND fp.rolled_back_at IS NULL
    `);
    twins = await inSavepoint(db, (scope) => scope<TwinRow[]>`
      SELECT fv.fee_verified_id, fv.canonical_fee_key, fv.fee_name, fv.amount, fv.review_status, fr.source_document_id,
             EXISTS (SELECT 1 FROM published_fee_records p WHERE p.lineage_ref = fv.fee_verified_id AND p.rolled_back_at IS NULL) AS live_published
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fv.fee_verified_id = ANY(${HAND_REJECTED_TWINS.map((twin) => twin.feeVerifiedId)}::bigint[])
    `);
  } catch (error) {
    console.error("hand amount corrections read failed:", error);
    return result;
  }
  const plan = planHandAmountCorrections(live);
  const twinPlan = planTwinRejections(twins);
  result.skipped = plan.skipped;
  result.skippedTwins = twinPlan.skippedTwins;
  if (options.dryRun) return { ...result, corrected: plan.corrected, rejectedTwins: twinPlan.rejectedTwins };
  if (plan.corrected.length === 0 && twinPlan.rejectedTwins.length === 0) return result;

  try {
    await inSavepoint(db, async (scope) => {
      for (const fix of plan.corrected) {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records
             SET amount = ${fix.to}, fee_name = ${fix.newName}
           WHERE fee_published_id = ${fix.feePublishedId}
             AND rolled_back_at IS NULL
             AND amount = ${fix.from}
          RETURNING fee_published_id
        `;
        if (updated.length === 0) continue;
        if (fix.feeVerifiedId != null) {
          await scope`
            UPDATE verified_fee_observations
               SET amount = ${fix.to}, fee_name = ${fix.newName},
                   outlier_flags = CASE WHEN outlier_flags ? ${HAND_AMOUNT_CORRECTED_FLAG} THEN outlier_flags
                                        ELSE COALESCE(outlier_flags, '[]'::jsonb) || jsonb_build_array(${HAND_AMOUNT_CORRECTED_FLAG}::text) END
             WHERE fee_verified_id = ${fix.feeVerifiedId}
               AND amount = ${fix.from}
          `;
        }
        result.corrected.push(fix);
      }
      if (twinPlan.rejectedTwins.length > 0) {
        const rejected = await scope<{ fee_verified_id: number | string }[]>`
          UPDATE verified_fee_observations
             SET review_status = 'rejected',
                 outlier_flags = CASE WHEN outlier_flags ? ${HAND_REJECTED_TWIN_FLAG} THEN outlier_flags
                                      ELSE COALESCE(outlier_flags, '[]'::jsonb) || jsonb_build_array(${HAND_REJECTED_TWIN_FLAG}::text) END
           WHERE fee_verified_id = ANY(${twinPlan.rejectedTwins}::bigint[])
             AND review_status IN ('verified', 'approved')
          RETURNING fee_verified_id
        `;
        result.rejectedTwins = rejected.map((row) => Number(row.fee_verified_id));
      }
      const feedback: FeedbackRow[] = [
        ...result.corrected.map((fix) => {
          const entry = HAND_AMOUNT_CORRECTIONS.find((item) => item.feePublishedId === fix.feePublishedId)!;
          return {
            aboutStage: "extract" as const,
            signal: "wrong" as const,
            kind: "wrong_amount",
            reportedBy: "hamilton" as const,
            checkName: HAND_AMOUNT_CHECK,
            institutionId: entry.institutionId,
            sourceDocumentId: entry.sourceDocumentId,
            feeVerifiedId: fix.feeVerifiedId,
            feePublishedId: fix.feePublishedId,
            canonicalFeeKey: entry.canonicalFeeKey,
            amount: fix.to,
            runId: options.runId,
            dedupeKey: `${HAND_AMOUNT_CHECK}:pub:${fix.feePublishedId}`,
            evidence: { old_amount: fix.from, new_amount: fix.to, old_name: fix.oldName, new_name: fix.newName, source_line: fix.sourceLine, why: entry.why, pattern: "cut_cents", issue: 1334 },
          };
        }),
        ...result.rejectedTwins.map((id) => {
          const twin = HAND_REJECTED_TWINS.find((item) => item.feeVerifiedId === id)!;
          return {
            aboutStage: "extract" as const,
            signal: "wrong" as const,
            kind: "wrong_amount",
            reportedBy: "hamilton" as const,
            checkName: HAND_AMOUNT_CHECK,
            sourceDocumentId: twin.sourceDocumentId,
            feeVerifiedId: id,
            canonicalFeeKey: twin.canonicalFeeKey,
            amount: twin.amount,
            runId: options.runId,
            dedupeKey: `${HAND_AMOUNT_CHECK}:twin:${id}`,
            evidence: { rejected_twin_of: twin.ofFeePublishedId, previous_review_status: "verified", why: twin.why, pattern: "cut_cents", issue: 1334 },
          };
        }),
      ];
      if (feedback.length > 0) await recordFeedback(scope, feedback);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${HAND_AMOUNT_CHECK}, 'completed',
          ${`Corrected ${result.corrected.length} live fee(s) read with their cents cut off and rejected ${result.rejectedTwins.length} unpublished copies of those reads (#1334)`},
          ${JSON.stringify({
            corrected: result.corrected.map((fix) => ({ fee_published_id: fix.feePublishedId, from: fix.from, to: fix.to, old_name: fix.oldName, new_name: fix.newName })),
            rejected_twins: result.rejectedTwins,
            skipped: result.skipped,
            skipped_twins: result.skippedTwins,
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("hand amount corrections write failed:", error);
    return { ...result, corrected: [], rejectedTwins: [] };
  }
  if (result.corrected.length > 0) invalidatePublicReadCache();
  return result;
}
