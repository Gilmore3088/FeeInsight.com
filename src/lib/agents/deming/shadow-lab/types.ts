/** Types for the pipeline shadow lab: frozen cases, stage traces and pipeline variants. */

export type ScenarioId =
  | "limit_as_fee"
  | "not_a_fee"
  | "wrong_category"
  | "duplicate_lines"
  | "hourly_as_flat"
  | "missed_fees"
  | "wrong_document";

export const SCENARIO_IDS: readonly ScenarioId[] = [
  "limit_as_fee",
  "not_a_fee",
  "wrong_category",
  "duplicate_lines",
  "hourly_as_flat",
  "missed_fees",
  "wrong_document",
];

export type StageId = "document_gate" | "extract" | "verify" | "publish_gate";

export const STAGE_IDS: readonly StageId[] = ["document_gate", "extract", "verify", "publish_gate"];

/**
 * A fee as an expectation names it. A null amount matches on category alone; a frequency that
 * starts with "!" matches any frequency except the one named.
 */
export interface FeeRef {
  canonicalFeeKey: string | null;
  feeName: string | null;
  amountCents: number | null;
  frequency?: string | null;
  /** The schedule line the expectation was keyed from, when the fixture keeps one. */
  sourceLine?: string | null;
}

export interface ShadowCase {
  caseKey: string;
  scenario: ScenarioId;
  provenance: { fixture: string; fixtureCaseKey: string; textHash: string | null; issue: string };
  document: { url: string | null; text: string | null };
  expected: {
    publish: FeeRef[];
    forbid: FeeRef[];
    publishCount?: { canonicalFeeKey: string; amountCents: number; count: number };
    documentIsSchedule?: boolean;
  };
  status: "ok" | "corrupt" | "not_replayable";
  statusReason?: string;
}

export interface StageFee extends FeeRef {
  excerpt: string | null;
  reason: string | null;
}

export interface PublishedFee extends StageFee {
  sourceLine: string | null;
  attributed: boolean;
}

export interface StageOutput {
  passed: StageFee[];
  dropped: StageFee[];
}

export interface CaseTrace {
  caseKey: string;
  scenario: ScenarioId;
  stages: Record<StageId, StageOutput>;
  published: PublishedFee[];
  documentAccepted: boolean | null;
  durationsMs: Record<StageId, number>;
}

export type VerifyResult = { ok: true; fee: StageFee } | { ok: false; reason: string };

export interface PipelineVariant {
  id: string;
  description: string;
  documentGate(c: ShadowCase): { accepted: boolean; reason: string | null };
  extract(text: string): StageOutput;
  verify(fee: StageFee, text: string): VerifyResult;
  publishGate(fee: StageFee, text: string, live: StageFee[]): { publish: boolean; reason: string | null };
}
