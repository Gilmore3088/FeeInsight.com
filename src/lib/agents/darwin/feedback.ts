import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady, knoxStrategyFromFlags, recordFeedback, type FeedbackKind, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";

import type { DarwinReasonCode, DarwinVerificationResult, RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's side of the shared learning store: each verify decision becomes a judgement
 * on the Knox read it checked, so Knox (and any agent reading `pipeline_feedback`)
 * learns which reads Darwin passed and why it stopped the rest.
 *
 * Category rejects are left out: the publish-step sync already writes them as
 * `darwin.category_guard`. Duplicates say nothing about the read and are left out too.
 * An approval is Darwin's opinion, not proof (the 2026-10-06 audit found 34 of 40
 * approvals right), so it carries half weight; a source-confirmed second document
 * raises it to full.
 */

export const DARWIN_FEEDBACK_CHECK = "darwin.verify";

const REJECT_KINDS: Partial<Record<DarwinReasonCode, { kind: FeedbackKind; weight: number }>> = {
  not_in_source: { kind: "not_on_schedule", weight: 1 },
  invalid_amount: { kind: "wrong_amount", weight: 1 },
  missing_canonical: { kind: "off_taxonomy", weight: 1 },
  missing_name: { kind: "not_a_fee", weight: 1 },
  missing_lineage: { kind: "missing_lineage", weight: 1 },
  // Held for a person, not proven wrong.
  outside_envelope: { kind: "outside_range", weight: 0.5 },
  peer_outlier: { kind: "outside_range", weight: 0.5 },
};

function flagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      return flagsOf(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function darwinFeedbackRows(
  results: DarwinVerificationResult[],
  rowByRawFeeId: Map<number, RawFeeRow>,
  options: { runId: number; verifyVersion: number },
): FeedbackRow[] {
  const rows: FeedbackRow[] = [];
  for (const result of results) {
    let signal: FeedbackRow["signal"];
    let kind: FeedbackKind;
    let weight: number;
    if (result.decision === "verified") {
      signal = "right";
      kind = "darwin_verified";
      weight = result.secondSource?.verdict === "agrees" ? 1 : 0.5;
    } else {
      const mapped = result.reasonCode ? REJECT_KINDS[result.reasonCode] : undefined;
      if (!mapped) continue;
      signal = "wrong";
      ({ kind, weight } = mapped);
    }
    const raw = rowByRawFeeId.get(result.feeRawId);
    rows.push({
      aboutStage: "extract",
      aboutStrategy: knoxStrategyFromFlags(flagsOf(raw?.outlier_flags)),
      signal,
      kind,
      reportedBy: "darwin",
      checkName: DARWIN_FEEDBACK_CHECK,
      institutionId: result.institutionId,
      sourceDocumentId: num(raw?.source_document_id),
      sourceUrl: raw?.source_url ?? null,
      feeRawId: result.feeRawId,
      feeVerifiedId: result.feeVerifiedId,
      canonicalFeeKey: result.canonicalFeeKey,
      amount: result.amount,
      weight,
      evidence: {
        fee_name: result.feeName,
        decision: result.decision,
        reason_code: result.reasonCode,
        reason: result.reason,
        verify_version: options.verifyVersion,
        second_source: result.secondSource?.verdict ?? null,
      },
      runId: options.runId,
      dedupeKey: `${DARWIN_FEEDBACK_CHECK}:decision:raw:${result.feeRawId}`,
    });
  }
  return rows;
}

/**
 * Writes Darwin's judgements. Returns the rows written, or null when the store is not
 * there yet. A failure is logged and never fails the verify step.
 */
export async function recordDarwinFeedback(db: SqlTag, rows: FeedbackRow[]): Promise<number | null> {
  if (rows.length === 0) return 0;
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return null;
    return await inSavepoint(db, (scope) => recordFeedback(scope, rows));
  } catch (error) {
    console.error("recordDarwinFeedback failed:", error);
    return null;
  }
}
