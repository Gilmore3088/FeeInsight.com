/**
 * Admin hold (H03 step 1, #978): an operator takes one published fee out of every
 * customer-facing read without SQL or a code release. A hold sets the existing quarantine
 * flag, which `published_fee_catalog` already excludes; nothing is deleted and no
 * replacement value is invented. Release clears only a hold placed here, never a
 * quarantine set by an agent. Every hold and release is logged in `pipeline_feedback`, recorded
 * as a completed Hamilton run, and rebuilds the national index (`fee_index_cache`) straight away
 * (James, 2026-10-16), so Hamilton's national figures drop or regain the fee at once.
 *
 * A hold names its cause (`fee-error-cause.ts`, #2057): the hold's feedback row is filed against
 * the stage that made the mistake (a wrong document against discover, which Magellan's stale-link
 * search reads), not always against publishing. A release is filed against publishing.
 */

import type { sql as Sql } from "@/lib/data-store/connection";
import { recordFeedback } from "@/lib/agents/learning/feedback";
import { rebuildIndexAfterAdminAction, recordAdminFeeRun } from "@/lib/fee-admin-run";
import { feeErrorStage, wrongDocument, type FeeErrorCause } from "@/lib/fee-error-cause";

import {
  ADMIN_HOLD_PREFIX,
  FEE_HOLD_CHECK,
  holdReasonText,
  readHoldReason,
  type FeeHoldActor,
  type FeeHoldResult,
  type HeldFee,
} from "./fee-hold-rules";

export * from "./fee-hold-rules";

type SqlTag = typeof Sql;

interface FeeRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  amount: number | string | null;
  fee_name: string;
  lineage_ref: number | string | null;
}

async function logHoldEvent(
  tx: SqlTag,
  row: FeeRow,
  action: "hold" | "release",
  actor: FeeHoldActor,
  reason: string | null,
  cause: FeeErrorCause | null,
): Promise<{ indexRefreshed: boolean; runId: number }> {
  // A wrong document names the document the fee was read from, for Magellan's link search.
  let wrong: ReturnType<typeof wrongDocument> = {};
  // A correction version keeps the pipeline's lineage, so its value's document is the current
  // correction's cited one.
  if (action === "hold" && cause === "wrong_document") {
    const [doc] = await tx<Array<{ id: number | string; document_url: string | null }>>`
      SELECT sd.id, sd.document_url
        FROM source_documents sd
       WHERE sd.id = COALESCE(
               (SELECT cur.source_document_id FROM published_fee_corrections cur
                 WHERE cur.fee_published_id = ${row.fee_published_id} AND cur.status = 'current' LIMIT 1),
               (SELECT fr.source_document_id FROM verified_fee_observations fv
                  JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
                 WHERE fv.fee_verified_id = ${row.lineage_ref}))
    `;
    if (doc) wrong = wrongDocument(doc.id, doc.document_url);
  }
  const at = new Date().toISOString();
  const run = await recordAdminFeeRun(tx, {
    action,
    title: action === "hold" ? "Admin fee hold" : "Admin fee release",
    summary: `${action === "hold" ? "Held" : "Released"} ${row.fee_name} (fee #${row.fee_published_id})${reason ? `: ${reason}` : "."}`,
    actor,
    institutionId: Number(row.institution_id),
    detail: { fee_published_id: Number(row.fee_published_id), reason },
  });
  await recordFeedback(tx, [{
    aboutStage: action === "hold" && cause ? feeErrorStage(cause) : "publish",
    signal: action === "hold" ? "wrong" : "restored",
    kind: action === "hold" ? "admin_hold" : "admin_release",
    reportedBy: "human",
    checkName: FEE_HOLD_CHECK,
    institutionId: Number(row.institution_id),
    feePublishedId: Number(row.fee_published_id),
    canonicalFeeKey: row.canonical_fee_key,
    amount: row.amount == null ? null : Number(row.amount),
    evidence: { action, actor_id: actor.id, actor: actor.name, reason, ...(cause ? { cause } : {}), ...wrong, fee_name: row.fee_name, at },
    runId: run.runId,
    dedupeKey: `${FEE_HOLD_CHECK}:${row.fee_published_id}:${action}:${at}`,
  }]);
  const refresh = await rebuildIndexAfterAdminAction(tx, run);
  return { indexRefreshed: refresh.refreshed, runId: run.runId };
}

/**
 * Holds one live fee. Only a fee that is live now can be held, so a double submission or a
 * fee an agent took down in the meantime fails rather than writing a second hold.
 */
export async function holdPublishedFee(
  db: SqlTag,
  feePublishedId: number,
  reason: string,
  actor: FeeHoldActor,
  cause: FeeErrorCause = "not_sure",
): Promise<FeeHoldResult> {
  return db.begin(async (scope) => {
    const tx = scope as unknown as SqlTag;
    const rows = await tx<FeeRow[]>`
      UPDATE published_fee_records
         SET quarantined_at = NOW(),
             quarantine_reason = ${holdReasonText(reason)}
       WHERE fee_published_id = ${feePublishedId}
         AND rolled_back_at IS NULL
         AND quarantined_at IS NULL
      RETURNING fee_published_id, institution_id, canonical_fee_key, amount, fee_name, lineage_ref
    `;
    const row = rows[0];
    if (!row) return { ok: false, error: "That fee is not live, or it is already held." } as const;
    const logged = await logHoldEvent(tx, row, "hold", actor, reason, cause);
    return { ok: true, feePublishedId, institutionId: Number(row.institution_id), ...logged } as const;
  }) as Promise<FeeHoldResult>;
}

/** Releases a hold placed here. An agent's quarantine is never cleared by this. */
export async function releasePublishedFee(
  db: SqlTag,
  feePublishedId: number,
  actor: FeeHoldActor,
): Promise<FeeHoldResult> {
  return db.begin(async (scope) => {
    const tx = scope as unknown as SqlTag;
    const rows = await tx<(FeeRow & { quarantine_reason: string })[]>`
      UPDATE published_fee_records fp
         SET quarantined_at = NULL,
             quarantine_reason = NULL
        FROM published_fee_records before
       WHERE fp.fee_published_id = ${feePublishedId}
         AND before.fee_published_id = fp.fee_published_id
         AND fp.quarantined_at IS NOT NULL
         AND left(fp.quarantine_reason, ${ADMIN_HOLD_PREFIX.length}) = ${ADMIN_HOLD_PREFIX}
      RETURNING fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.amount, fp.fee_name,
                fp.lineage_ref, before.quarantine_reason
    `;
    const row = rows[0];
    if (!row) return { ok: false, error: "That fee is not on an admin hold." } as const;
    const logged = await logHoldEvent(tx, row, "release", actor, readHoldReason(row.quarantine_reason), null);
    return { ok: true, feePublishedId, institutionId: Number(row.institution_id), ...logged } as const;
  }) as Promise<FeeHoldResult>;
}

/** An institution's fees on admin hold, newest first, with who held them. */
export async function getHeldFees(db: SqlTag, institutionId: number): Promise<HeldFee[]> {
  const rows = await db<{
    fee_published_id: number | string;
    institution_id: number | string;
    fee_name: string;
    amount: number | string | null;
    canonical_fee_key: string;
    quarantined_at: Date | string;
    quarantine_reason: string;
    held_by: string | null;
    closed_by_check: boolean;
  }[]>`
    SELECT fp.fee_published_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key,
           fp.quarantined_at, fp.quarantine_reason, fp.rolled_back_at IS NOT NULL AS closed_by_check,
           (SELECT pf.evidence->>'actor' FROM pipeline_feedback pf
             WHERE pf.check_name = ${FEE_HOLD_CHECK} AND pf.kind = 'admin_hold'
               AND pf.fee_published_id = fp.fee_published_id
             ORDER BY pf.created_at DESC LIMIT 1) AS held_by
      FROM published_fee_records fp
     WHERE fp.institution_id = ${institutionId}
       AND fp.quarantined_at IS NOT NULL
       AND left(fp.quarantine_reason, ${ADMIN_HOLD_PREFIX.length}) = ${ADMIN_HOLD_PREFIX}
     ORDER BY fp.quarantined_at DESC
  `;
  return rows.map((row) => ({
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    feeName: row.fee_name,
    amount: row.amount == null ? null : Number(row.amount),
    canonicalFeeKey: row.canonical_fee_key,
    heldAt: row.quarantined_at instanceof Date ? row.quarantined_at.toISOString() : String(row.quarantined_at),
    reason: readHoldReason(row.quarantine_reason) ?? "",
    heldBy: row.held_by,
    closedByCheck: Boolean(row.closed_by_check),
  }));
}
