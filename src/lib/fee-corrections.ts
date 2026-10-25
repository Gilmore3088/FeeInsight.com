/**
 * Admin fee corrections (H03, #978). A correction publishes a NEW published row with the corrected
 * values, quarantines the row it replaces (kept, marked superseded, never overwritten or deleted),
 * and records one version in `published_fee_corrections`, in one transaction with its
 * `pipeline_feedback` audit row, a completed Hamilton run and an immediate national index rebuild.
 * A reversal is a new version back to the values the current one replaced. Only an admin may
 * correct or reverse; analysts may still hold (`fee-hold.ts`). The lifecycle and the evidence each
 * step needs are in docs/plans/hamilton-h03-corrections.md.
 *
 * The corrected value must be stated by the source document the operator names: the excerpt must
 * be in that document's stored text, and the shared source check (`checkFeeAgainstSource`) and the
 * category guard must pass on it.
 *
 * A correction names its cause (`fee-error-cause.ts`, #2057), suggested from what it changes when
 * the form sends none: its feedback row is filed against the stage that made the mistake (a wrong
 * document against discover, which Magellan's stale-link search reads), not always against
 * publishing. A reversal is filed against publishing.
 *
 * Publishing (`correctionBlockFor`, called by Hamilton's `insertPublishedFee`) never republishes a
 * corrected line from the old or the same source, and records a newer source that disagrees as a
 * conflict for an admin to review.
 */

import type { sql as Sql } from "@/lib/data-store/connection";
import { recordFeedback } from "@/lib/agents/learning/feedback";
import { releaseCategoryPattern } from "@/lib/agents/darwin/release-held";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { rebuildIndexAfterAdminAction, recordAdminFeeRun } from "@/lib/fee-admin-run";
import { correctionsReady } from "./fee-correction-guard";
import { captureCorrectiveSource } from "@/lib/agents/deming/corrective-source-store";
import type { CorrectiveDocument } from "@/lib/agents/deming/corrective-source";
import { feeErrorStage, suggestCorrectionCause, wrongDocument, type FeeErrorCause } from "@/lib/fee-error-cause";

import {
  CORRECTION_BATCH_PREFIX,
  FEE_CORRECTION_CHECK,
  canCorrectFees,
  correctionQuarantineReason,
  excerptInText,
  sameFeeValues,
  treatmentConflict,
  validateCorrectionInput,
  validateReversalInput,
  type FeeCorrectionActor,
  type FeeCorrectionConflict,
  type FeeCorrectionResult,
  type FeeCorrectionVersion,
  type FeeValues,
  type InstitutionCorrections,
} from "./fee-correction-rules";

export * from "./fee-correction-rules";
export { correctionBlockFor, correctionsReady, resetCorrectionsReadyCache, type CorrectionBlock, type CorrectionCandidate } from "./fee-correction-guard";

type SqlTag = typeof Sql;

interface LiveFeeRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  frequency: string | null;
  variant_type: string | null;
  fee_audience: string | null;
  amount_kind: string | null;
  fee_treatment: string | null;
  conditions: string | null;
  lineage_source_document_id: number | string | null;
  /** The address of the document the live fee was read from. */
  lineage_document_url: string | null;
  source_url: string | null;
}

interface CurrentVersionRow {
  id: number | string;
  fee_chain_id: number | string;
  version: number | string;
  fee_published_id: number | string;
  previous_fee_published_id: number | string;
  before_canonical_fee_key: string;
  before_fee_name: string;
  before_amount: number | string | null;
  before_frequency: string | null;
  before_conditions: string | null;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string;
  frequency: string | null;
  conditions: string | null;
  source_document_id: number | string | null;
}

function num(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

function liveValues(row: LiveFeeRow, conditionsOverride?: string | null): FeeValues {
  return {
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: num(row.amount),
    frequency: row.frequency,
    conditions: conditionsOverride !== undefined ? conditionsOverride : row.conditions,
  };
}

/** Locks one published row and returns it when it is live now. */
async function lockLiveFee(tx: SqlTag, feePublishedId: number): Promise<LiveFeeRow | null> {
  const rows = await tx<LiveFeeRow[]>`
    SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
           fp.frequency, fp.variant_type, fp.fee_audience, fp.amount_kind, fp.fee_treatment, fp.source_url,
           fr.conditions, fr.source_document_id AS lineage_source_document_id,
           (SELECT sd.document_url FROM source_documents sd WHERE sd.id = fr.source_document_id) AS lineage_document_url
      FROM published_fee_records fp
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.fee_published_id = ${feePublishedId}
       AND fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       FOR UPDATE OF fp
  `;
  return rows[0] ?? null;
}

async function currentVersionFor(tx: SqlTag, feePublishedId: number): Promise<CurrentVersionRow | null> {
  const rows = await tx<CurrentVersionRow[]>`
    SELECT id, fee_chain_id, version, fee_published_id, previous_fee_published_id,
           before_canonical_fee_key, before_fee_name, before_amount, before_frequency, before_conditions,
           canonical_fee_key, fee_name, amount, frequency, conditions, source_document_id
      FROM published_fee_corrections
     WHERE fee_published_id = ${feePublishedId} AND status = 'current'
     LIMIT 1
  `;
  return rows[0] ?? null;
}

async function replayFor(tx: SqlTag, idempotencyKey: string, feePublishedId: number): Promise<FeeCorrectionResult | null> {
  const rows = await tx<{ id: number | string; version: number | string; fee_published_id: number | string; previous_fee_published_id: number | string; institution_id: number | string; agent_run_id: number | string | null }[]>`
    SELECT id, version, fee_published_id, previous_fee_published_id, institution_id, agent_run_id
      FROM published_fee_corrections
     WHERE idempotency_key = ${idempotencyKey}
  `;
  const row = rows[0];
  if (!row) return null;
  if (Number(row.previous_fee_published_id) !== feePublishedId) {
    return { ok: false, code: "invalid", error: "This form was already used for another fee. Reload the page and try again." };
  }
  return {
    ok: true,
    correctionId: Number(row.id),
    version: Number(row.version),
    feePublishedId: Number(row.fee_published_id),
    previousFeePublishedId: Number(row.previous_fee_published_id),
    institutionId: Number(row.institution_id),
    runId: num(row.agent_run_id),
    indexRefreshed: false,
    replay: true,
  };
}

const STALE = "This fee changed since you opened it (another edit, a hold or a check took it down). Reload the page and try again.";

interface Evidence {
  sourceDocumentId: number;
  documentUrl: string | null;
  documentR2Key: string | null;
  check: Record<string, unknown>;
  learningDocument: CorrectiveDocument;
}

/** Checks the corrected value against the named document's stored text. Null with an error when it fails. */
async function checkEvidence(
  tx: SqlTag,
  institutionId: number,
  input: { sourceDocumentId: number; sourceExcerpt: string; feeName: string; amount: number; canonicalFeeKey: string; conditions: string | null },
): Promise<{ ok: true; evidence: Evidence } | { ok: false; error: string; field: string }> {
  const docs = await tx<{ id: number | string; institution_id: number | string; document_url: string | null; document_r2_key: string | null; content_hash: string | null; ast_id: number | string | null; ast_institution_id: number | string | null; text_hash: string | null; source_hash: string | null; normalized_text: string | null }[]>`
    SELECT sd.id, sd.institution_id, sd.document_url, sd.document_r2_key, sd.content_hash, t.normalized_text, t.ast_id, t.ast_institution_id, t.text_hash, t.source_hash
      FROM source_documents sd
      LEFT JOIN LATERAL (
        SELECT ast.normalized_text, ast.id AS ast_id, ast.institution_id AS ast_institution_id, ast.text_hash, ast.source_hash FROM agent_source_texts ast
         WHERE ast.source_document_id = sd.id
           AND ast.status = 'completed' AND ast.normalized_text IS NOT NULL
         ORDER BY ast.id DESC LIMIT 1
      ) t ON true
     WHERE sd.id = ${input.sourceDocumentId}
  `;
  const doc = docs[0];
  if (!doc || Number(doc.institution_id) !== institutionId) {
    return { ok: false, field: "sourceDocumentId", error: "That document is not one of this institution's source documents." };
  }
  if (!doc.normalized_text) {
    return { ok: false, field: "sourceDocumentId", error: "We have no stored text for that document, so the value cannot be checked against it. Re-read the document first." };
  }
  if (!excerptInText(input.sourceExcerpt, doc.normalized_text)) {
    return { ok: false, field: "sourceExcerpt", error: "That excerpt is not in the stored text of the document. Copy it from the document exactly." };
  }
  const guard = checkFeeCategory(input.canonicalFeeKey, input.feeName, { amount: input.amount, conditions: input.conditions });
  if (!guard.ok) return { ok: false, field: "canonicalFeeKey", error: `The category guard refuses this: ${guard.reason}` };
  const check = checkFeeAgainstSource(
    doc.normalized_text,
    input.feeName,
    input.amount,
    releaseCategoryPattern(input.canonicalFeeKey) ?? ".",
    input.canonicalFeeKey,
  );
  if (!check.ok) {
    return { ok: false, field: "amount", error: `The source check could not find this fee at this amount in the document (${check.reason.replace(/_/g, " ")}).` };
  }
  return {
    ok: true,
    evidence: {
      sourceDocumentId: Number(doc.id),
      documentUrl: doc.document_url,
      documentR2Key: doc.document_r2_key,
      check: { check: "checkFeeAgainstSource", ok: true, source_line: check.sourceLine },
      // Freeze exactly the normalization actually checked above, never a later convenient read.
      learningDocument: { id: Number(doc.id), institutionId: Number(doc.institution_id), astId: Number(doc.ast_id),
        astInstitutionId: Number(doc.ast_institution_id), status: "completed", documentUrl: doc.document_url ?? "",
        contentHash: doc.content_hash ?? "", sourceHash: doc.source_hash ?? "", textHash: doc.text_hash ?? "", normalizedText: doc.normalized_text },
    },
  };
}

/** Publishes the new version's row: the old row's lineage and events, the new values. */
async function insertVersionRow(
  tx: SqlTag,
  oldId: number,
  values: { canonicalFeeKey: string; feeName: string; amount: number; frequency: string | null },
  batchId: string,
  evidence: { documentUrl: string | null; documentR2Key: string | null } | null,
): Promise<number> {
  const [row] = await tx<{ fee_published_id: number | string }[]>`
    INSERT INTO published_fee_records (
      lineage_ref, institution_id, canonical_fee_key, source_url, document_r2_key,
      extraction_confidence, agent_event_id, verified_by_agent_event_id,
      published_by_adversarial_event_id, fee_name, amount, frequency, variant_type,
      coverage_tier, batch_id, amount_kind
    )
    SELECT lineage_ref, institution_id, ${values.canonicalFeeKey},
           COALESCE(${evidence?.documentUrl ?? null}, source_url),
           COALESCE(${evidence?.documentR2Key ?? null}, document_r2_key),
           extraction_confidence, agent_event_id, verified_by_agent_event_id,
           published_by_adversarial_event_id, ${values.feeName}, ${values.amount}, ${values.frequency},
           variant_type, coverage_tier, ${batchId}, 'flat'
      FROM published_fee_records
     WHERE fee_published_id = ${oldId}
    RETURNING fee_published_id
  `;
  return Number(row.fee_published_id);
}

/**
 * Marks the replaced row superseded: quarantined (which no agent restore clears) and closed the way
 * Hamilton closes a superseded price, so the agent checks that scan rows with `rolled_back_at IS
 * NULL` never pair it with the new version as a duplicate.
 */
async function supersedeOldRow(tx: SqlTag, oldId: number, version: number, newId: number, batchId: string): Promise<void> {
  const reason = correctionQuarantineReason(version, newId);
  const rows = await tx`
    UPDATE published_fee_records
       SET quarantined_at = NOW(),
           quarantine_reason = ${reason},
           rolled_back_at = NOW(),
           rolled_back_by_batch_id = ${batchId},
           rolled_back_reason = ${reason}
     WHERE fee_published_id = ${oldId}
       AND quarantined_at IS NULL
       AND rolled_back_at IS NULL
    RETURNING fee_published_id
  `;
  if (rows.length !== 1) throw new Error(`fee ${oldId} could not be marked superseded`);
}

interface WriteVersion {
  action: "correct" | "reverse";
  actor: FeeCorrectionActor;
  idempotencyKey: string;
  reason: string;
  live: LiveFeeRow;
  current: CurrentVersionRow | null;
  before: FeeValues;
  after: { canonicalFeeKey: string; feeName: string; amount: number; frequency: string | null; conditions: string | null };
  evidence: (Evidence & { excerpt: string; location: string }) | null;
  reversedToDocumentId: number | null;
  /** The stage the error came from (#2057); null for a reversal, filed against publishing. */
  cause: FeeErrorCause | null;
}

async function writeVersion(tx: SqlTag, w: WriteVersion): Promise<FeeCorrectionResult> {
  const oldId = Number(w.live.fee_published_id);
  const institutionId = Number(w.live.institution_id);
  const chainId = w.current ? Number(w.current.fee_chain_id) : oldId;
  const version = (w.current ? Number(w.current.version) : 0) + 1;
  const batchId = `${CORRECTION_BATCH_PREFIX}${chainId}-v${version}`;
  const verb = w.action === "correct" ? "Corrected" : "Reversed";
  const summary = `${verb} ${w.before.feeName} (fee #${oldId}): ${w.before.canonicalFeeKey} $${w.before.amount ?? "?"} to ${w.after.canonicalFeeKey} $${w.after.amount.toFixed(2)}, version ${version}.`;

  const run = await recordAdminFeeRun(tx, {
    action: w.action,
    title: w.action === "correct" ? "Admin fee correction" : "Admin correction reversal",
    summary,
    actor: w.actor,
    institutionId,
    detail: { fee_published_id: oldId, fee_chain_id: chainId, version, reason: w.reason, before: w.before, after: w.after },
  });

  const newId = await insertVersionRow(tx, oldId, w.after, batchId, w.evidence);
  await supersedeOldRow(tx, oldId, version, newId, batchId);
  if (w.current) {
    await tx`
      UPDATE published_fee_corrections SET status = 'superseded', superseded_at = NOW()
       WHERE id = ${Number(w.current.id)} AND status = 'current'
    `;
  }
  const sourceDocumentId = w.evidence?.sourceDocumentId ?? w.reversedToDocumentId;
  const [inserted] = await tx<{ id: number | string }[]>`
    INSERT INTO published_fee_corrections (
      fee_chain_id, version, action, status, institution_id, fee_audience, variant_type,
      previous_fee_published_id, fee_published_id,
      before_canonical_fee_key, before_fee_name, before_amount, before_frequency, before_conditions,
      canonical_fee_key, fee_name, amount, frequency, conditions,
      source_document_id, source_excerpt, source_location, source_check,
      reason, actor_user_id, actor_name, idempotency_key, agent_run_id
    ) VALUES (
      ${chainId}, ${version}, ${w.action}, 'current', ${institutionId}, ${w.live.fee_audience ?? "unknown"}, ${w.live.variant_type},
      ${oldId}, ${newId},
      ${w.before.canonicalFeeKey}, ${w.before.feeName}, ${w.before.amount}, ${w.before.frequency}, ${w.before.conditions},
      ${w.after.canonicalFeeKey}, ${w.after.feeName}, ${w.after.amount}, ${w.after.frequency}, ${w.after.conditions},
      ${sourceDocumentId}, ${w.evidence?.excerpt ?? null}, ${w.evidence?.location ?? null},
      ${JSON.stringify(w.evidence?.check ?? { check: "none", note: "a reversal returns to values already on record" })}::jsonb,
      ${w.reason}, ${w.actor.id}, ${w.actor.name}, ${w.idempotencyKey}, ${run.runId}
    )
    RETURNING id
  `;
  const correctionId = Number(inserted.id);
  if (w.current) {
    await tx`UPDATE published_fee_corrections SET superseded_by_id = ${correctionId} WHERE id = ${Number(w.current.id)}`;
  }
  // A newer source that disagreed is settled by a version read from it.
  if (w.evidence) {
    await tx`
      UPDATE published_fee_correction_conflicts
         SET status = 'accepted', resolved_at = NOW(), resolved_by_user_id = ${w.actor.id},
             resolved_by_name = ${w.actor.name}, resolution_reason = ${w.reason},
             resolved_by_correction_id = ${correctionId}
       WHERE fee_chain_id = ${chainId} AND status = 'open'
         AND source_document_id = ${w.evidence.sourceDocumentId}
    `;
  }
  const at = new Date().toISOString();
  await recordFeedback(tx, [{
    aboutStage: w.cause ? feeErrorStage(w.cause) : "publish",
    signal: w.action === "correct" ? "wrong" : "restored",
    kind: w.action === "correct" ? "admin_correction" : "admin_correction_reversed",
    reportedBy: "human",
    checkName: FEE_CORRECTION_CHECK,
    institutionId,
    sourceDocumentId: sourceDocumentId ?? null,
    feePublishedId: oldId,
    canonicalFeeKey: w.before.canonicalFeeKey,
    amount: w.before.amount,
    evidence: {
      action: w.action,
      correction_id: correctionId,
      fee_chain_id: chainId,
      version,
      new_fee_published_id: newId,
      actor_id: w.actor.id,
      actor: w.actor.name,
      reason: w.reason,
      ...(w.cause ? { cause: w.cause } : {}),
      ...(w.cause === "wrong_document" ? wrongDocument(w.live.lineage_source_document_id, w.live.lineage_document_url) : {}),
      before: w.before,
      after: w.after,
      source_excerpt: w.evidence?.excerpt ?? null,
      source_location: w.evidence?.location ?? null,
      at,
    },
    runId: run.runId,
    dedupeKey: `${FEE_CORRECTION_CHECK}:${correctionId}`,
  }]);
  if (w.action === "correct" && w.evidence) {
    await captureCorrectiveSource(tx, { correctionId, runId: run.runId, stepId: run.stepId, document: w.evidence.learningDocument });
  }
  const refresh = await rebuildIndexAfterAdminAction(tx, run);
  return {
    ok: true,
    correctionId,
    version,
    feePublishedId: newId,
    previousFeePublishedId: oldId,
    institutionId,
    runId: run.runId,
    indexRefreshed: refresh.refreshed,
    replay: false,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error != null && (error as { code?: string }).code === "23505";
}

/** Shared start for both commands: permission, readiness, idempotent replay, lock and version. */
async function begin<T extends { feePublishedId: number; expectedVersion: number; idempotencyKey: string }>(
  db: SqlTag,
  actor: FeeCorrectionActor,
  input: T,
  write: (tx: SqlTag, live: LiveFeeRow, current: CurrentVersionRow | null) => Promise<FeeCorrectionResult>,
): Promise<FeeCorrectionResult> {
  if (!canCorrectFees(actor.role)) return { ok: false, code: "forbidden", error: "Only an admin can correct a published fee." };
  if (!(await correctionsReady(db))) {
    return { ok: false, code: "unavailable", error: "Corrections are not switched on yet: their database migration has not been applied." };
  }
  try {
    return (await db.begin(async (scope) => {
      const tx = scope as unknown as SqlTag;
      const replay = await replayFor(tx, input.idempotencyKey, input.feePublishedId);
      if (replay) return replay;
      const live = await lockLiveFee(tx, input.feePublishedId);
      if (!live) {
        // A double submission that committed while this one waited on the lock.
        return (await replayFor(tx, input.idempotencyKey, input.feePublishedId)) ?? { ok: false, code: "stale", error: STALE };
      }
      const current = await currentVersionFor(tx, input.feePublishedId);
      const version = current ? Number(current.version) : 0;
      if (version !== input.expectedVersion) return { ok: false, code: "stale", error: STALE };
      if (live.amount_kind && live.amount_kind !== "flat") {
        return { ok: false, code: "invalid", error: "Only a dollar fee can be corrected here; a fee stated as a rate cannot yet." };
      }
      return write(tx, live, current);
    })) as FeeCorrectionResult;
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Two submissions raced past the lock (same key, or the same version from two editors).
      const replay = await replayFor(db, input.idempotencyKey, input.feePublishedId);
      return replay ?? { ok: false, code: "stale", error: STALE };
    }
    throw error;
  }
}

/** Corrects one live fee to a new version, checked against the source document named. */
export async function correctPublishedFee(
  db: SqlTag,
  raw: Record<string, unknown>,
  actor: FeeCorrectionActor,
): Promise<FeeCorrectionResult> {
  if (!canCorrectFees(actor.role)) return { ok: false, code: "forbidden", error: "Only an admin can correct a published fee." };
  const parsed = validateCorrectionInput(raw);
  if (!parsed.ok) return { ok: false, code: "invalid", error: "Check the highlighted fields.", errors: parsed.errors };
  const input = parsed.value;
  return begin(db, actor, input, async (tx, live, current) => {
    const before = liveValues(live, current ? current.conditions : live.conditions);
    const after = {
      canonicalFeeKey: input.canonicalFeeKey,
      feeName: input.feeName,
      amount: input.amount,
      frequency: input.frequency,
      conditions: input.conditions,
    };
    if (sameFeeValues(before, after)) return { ok: false, code: "invalid", error: "Nothing changed: the values are the ones already live." };
    const treatment = treatmentConflict(live.fee_treatment, input.amount);
    if (treatment) return { ok: false, code: "invalid", error: treatment, errors: { amount: treatment } };
    const checked = await checkEvidence(tx, Number(live.institution_id), input);
    if (!checked.ok) return { ok: false, code: "evidence", error: checked.error, errors: { [checked.field]: checked.error } };
    return writeVersion(tx, {
      action: "correct",
      actor,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      live,
      current,
      before,
      after,
      evidence: { ...checked.evidence, excerpt: input.sourceExcerpt, location: input.sourceLocation },
      reversedToDocumentId: null,
      cause: input.cause ?? suggestCorrectionCause({
        liveDocumentUrl: live.lineage_document_url,
        sourceDocumentUrl: checked.evidence.documentUrl,
        beforeCategory: before.canonicalFeeKey,
        afterCategory: after.canonicalFeeKey,
        beforeAmount: before.amount,
        afterAmount: after.amount,
      }),
    });
  });
}

/** Reverses the current correction: a new version back to the values it replaced. */
export async function reverseFeeCorrection(
  db: SqlTag,
  raw: Record<string, unknown>,
  actor: FeeCorrectionActor,
): Promise<FeeCorrectionResult> {
  if (!canCorrectFees(actor.role)) return { ok: false, code: "forbidden", error: "Only an admin can reverse a correction." };
  const parsed = validateReversalInput(raw);
  if (!parsed.ok) return { ok: false, code: "invalid", error: "Check the highlighted fields.", errors: parsed.errors };
  const input = parsed.value;
  return begin(db, actor, input, async (tx, live, current) => {
    if (!current) return { ok: false, code: "invalid", error: "This fee has no correction to reverse." };
    if (current.before_amount == null) return { ok: false, code: "invalid", error: "The earlier value has no dollar amount, so it cannot be restored here." };
    const before = liveValues(live, current.conditions);
    const after = {
      canonicalFeeKey: current.before_canonical_fee_key,
      feeName: current.before_fee_name,
      amount: Number(current.before_amount),
      frequency: current.before_frequency,
      conditions: current.before_conditions,
    };
    const treatment = treatmentConflict(live.fee_treatment, after.amount);
    if (treatment) return { ok: false, code: "invalid", error: treatment };
    // The document the restored values were read from: the version before, or the original lineage.
    const prior = await tx<{ source_document_id: number | string | null }[]>`
      SELECT source_document_id FROM published_fee_corrections
       WHERE fee_chain_id = ${Number(current.fee_chain_id)} AND version = ${Number(current.version) - 1}
    `;
    const reversedToDocumentId = num(prior[0]?.source_document_id ?? null) ?? num(live.lineage_source_document_id);
    return writeVersion(tx, {
      action: "reverse",
      actor,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      live,
      current,
      before,
      after,
      evidence: null,
      reversedToDocumentId,
      cause: null,
    });
  });
}

/** Dismisses a newer-source conflict with a reason: the correction stays as it is. Admin only. */
export async function dismissCorrectionConflict(
  db: SqlTag,
  conflictId: number,
  reasonText: string,
  actor: FeeCorrectionActor,
): Promise<{ ok: true; institutionId: number } | { ok: false; error: string }> {
  if (!canCorrectFees(actor.role)) return { ok: false, error: "Only an admin can dismiss a conflict." };
  const reason = reasonText.replace(/\s+/g, " ").trim();
  if (reason.length < 5 || reason.length > 500) return { ok: false, error: "Give a reason of 5 to 500 characters." };
  if (!(await correctionsReady(db))) return { ok: false, error: "Corrections are not switched on yet." };
  const rows = await db<{ institution_id: number | string }[]>`
    UPDATE published_fee_correction_conflicts
       SET status = 'dismissed', resolved_at = NOW(), resolved_by_user_id = ${actor.id},
           resolved_by_name = ${actor.name}, resolution_reason = ${reason}
     WHERE id = ${conflictId} AND status = 'open'
    RETURNING institution_id
  `;
  if (!rows[0]) return { ok: false, error: "That conflict is already settled." };
  return { ok: true, institutionId: Number(rows[0].institution_id) };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** An institution's corrections (every version) and open newer-source conflicts, for the admin page. */
export async function getInstitutionCorrections(db: SqlTag, institutionId: number): Promise<InstitutionCorrections> {
  const empty: InstitutionCorrections = { enabled: false, versions: {}, history: [], conflicts: [] };
  if (!(await correctionsReady(db))) return empty;
  const rows = await db<(CurrentVersionRow & {
    action: "correct" | "reverse";
    status: "current" | "superseded";
    created_at: Date | string;
    source_excerpt: string | null;
    source_location: string | null;
    reason: string;
    actor_name: string;
    agent_run_id: number | string | null;
  })[]>`
    SELECT id, fee_chain_id, version, action, status, created_at, fee_published_id, previous_fee_published_id,
           before_canonical_fee_key, before_fee_name, before_amount, before_frequency, before_conditions,
           canonical_fee_key, fee_name, amount, frequency, conditions,
           source_document_id, source_excerpt, source_location, reason, actor_name, agent_run_id
      FROM published_fee_corrections
     WHERE institution_id = ${institutionId}
     ORDER BY created_at DESC, id DESC
     LIMIT 200
  `;
  const history: FeeCorrectionVersion[] = rows.map((row) => ({
    id: Number(row.id),
    feeChainId: Number(row.fee_chain_id),
    version: Number(row.version),
    action: row.action,
    status: row.status,
    createdAt: iso(row.created_at),
    feePublishedId: Number(row.fee_published_id),
    previousFeePublishedId: Number(row.previous_fee_published_id),
    before: {
      canonicalFeeKey: row.before_canonical_fee_key,
      feeName: row.before_fee_name,
      amount: num(row.before_amount),
      frequency: row.before_frequency,
      conditions: row.before_conditions,
    },
    after: {
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: num(row.amount),
      frequency: row.frequency,
      conditions: row.conditions,
    },
    sourceDocumentId: num(row.source_document_id),
    sourceExcerpt: row.source_excerpt,
    sourceLocation: row.source_location,
    reason: row.reason,
    actorName: row.actor_name,
    agentRunId: num(row.agent_run_id),
  }));
  const versions: Record<number, number> = {};
  for (const version of history) if (version.status === "current") versions[version.feePublishedId] = version.version;
  const conflictRows = await db<{
    id: number | string;
    fee_chain_id: number | string;
    correction_id: number | string;
    created_at: Date | string;
    fee_verified_id: number | string;
    source_document_id: number | string | null;
    canonical_fee_key: string;
    fee_name: string;
    amount: number | string | null;
    frequency: string | null;
    cur_canonical_fee_key: string | null;
    cur_fee_name: string | null;
    cur_amount: number | string | null;
    cur_frequency: string | null;
    cur_conditions: string | null;
  }[]>`
    SELECT c.id, c.fee_chain_id, c.correction_id, c.created_at, c.fee_verified_id, c.source_document_id,
           c.canonical_fee_key, c.fee_name, c.amount, c.frequency,
           cur.canonical_fee_key AS cur_canonical_fee_key, cur.fee_name AS cur_fee_name,
           cur.amount AS cur_amount, cur.frequency AS cur_frequency, cur.conditions AS cur_conditions
      FROM published_fee_correction_conflicts c
      LEFT JOIN published_fee_corrections cur ON cur.fee_chain_id = c.fee_chain_id AND cur.status = 'current'
     WHERE c.institution_id = ${institutionId} AND c.status = 'open'
     ORDER BY c.created_at DESC
  `;
  const conflicts: FeeCorrectionConflict[] = conflictRows.map((row) => ({
    id: Number(row.id),
    feeChainId: Number(row.fee_chain_id),
    correctionId: Number(row.correction_id),
    createdAt: iso(row.created_at),
    feeVerifiedId: Number(row.fee_verified_id),
    sourceDocumentId: num(row.source_document_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: num(row.amount),
    frequency: row.frequency,
    current: {
      canonicalFeeKey: row.cur_canonical_fee_key ?? "",
      feeName: row.cur_fee_name ?? "",
      amount: num(row.cur_amount),
      frequency: row.cur_frequency,
      conditions: row.cur_conditions,
    },
  }));
  return { enabled: true, versions, history, conflicts };
}

