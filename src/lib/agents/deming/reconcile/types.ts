/**
 * Types for the full-pipeline reconciliation (James, 2026-11-03: "go back through our pipeline from fee
 * number one and run the pipeline and grade it ... note what's different ... a conflict resolution or
 * reconciliation between the two"). A shadow run reads each bank's current documents with today's
 * pipeline (the shadow lab's `currentVariant`: Knox's free read, Darwin's verify checks, Hamilton's
 * publish gate), never writes a fee row, and is compared fee by fee with what is live.
 */

/** A fee as one side (live or shadow) holds it for one bank. */
export interface SideFee {
  canonicalFeeKey: string;
  feeName: string;
  amountCents: number;
  audience: "consumer" | "business" | "both" | "unknown";
  /** The schedule line the fee was read from (Knox's excerpt or the shadow's traced line). */
  line: string | null;
  sourceDocumentId: number | null;
  /** Live only: the published row. */
  feePublishedId?: number | null;
  /** Live only: its document was superseded by a newer copy of the page. */
  onSupersededCopy?: boolean;
}

export type DiffKind =
  | "same"
  | "amount_changed"
  | "category_changed"
  | "audience_changed"
  | "new_in_shadow"
  | "missing_in_shadow";

export interface DiffEntry {
  kind: DiffKind;
  live: SideFee | null;
  shadow: SideFee | null;
}

/** Which version the reconciliation rule keeps. */
export type Winner = "live" | "shadow" | "both" | "neither" | "review";

/** The rung of the rule that decided it. */
export type DecisionRule =
  | "answer_key"
  | "source_check"
  | "category_guard"
  | "audience_evidence"
  | "tie";

/** What the bank's own document says about one version. */
export interface Evidence {
  /** The shared check (`checkFeeAgainstSource`) passes on one of the bank's current documents. */
  currentDocument: boolean;
  /** Live only: it passes on the document it was read from. */
  ownDocument?: boolean;
  /** The bank has a confirmed answer key; null when it has none. */
  answerKey: boolean | null;
  /** The publish category guard accepts its category for its name and amount. */
  categoryOk: boolean;
  /** The version's audience, for the audience rung. */
  audience?: SideFee["audience"];
}

export type PipelineStep = "magellan" | "rosetta" | "knox" | "darwin" | "hamilton";

export interface Conflict {
  kind: Exclude<DiffKind, "same">;
  winner: Winner;
  rule: DecisionRule;
  step: PipelineStep;
  cause: string;
  live: CompactFee | null;
  shadow: CompactFee | null;
}

/** A fee as it is stored in the run ledger: short, so 4,000 banks stay a few megabytes. */
export interface CompactFee {
  k: string;
  c: number;
  n: string;
  a: SideFee["audience"];
  d: number | null;
  id?: number | null;
  l?: string | null;
}

/** Why the shadow did not publish a fee, by stage: Knox held it, Darwin refused it, Hamilton gated it. */
export interface ShadowDrop {
  stage: "extract" | "verify" | "publish_gate";
  reason: string;
  canonicalFeeKey: string | null;
  amountCents: number | null;
  feeName: string | null;
  line: string | null;
}

/** One bank's result, written as one run event. */
export interface BankReconciliation {
  institutionId: number;
  texts: number;
  /** Texts the shadow could not read (no text, product page). */
  textsSkipped: number;
  liveFees: number;
  shadowFees: number;
  counts: Record<DiffKind, number>;
  winners: Record<Winner, number>;
  /** Live fees whose own document is a superseded copy. */
  liveOnSupersededCopy: number;
  liveUnknownAudience: number;
  shadowUnknownAudience: number;
  /** Live fees the shared check finds on their own document / on a current document. */
  liveSupportedOwn: number;
  liveSupportedCurrent: number;
  shadowSupported: number;
  /** Live fees that lost their reconciliation (the shadow or neither won): wrong after publish. */
  liveLost: number;
  shadowLost: number;
  conflicts: Conflict[];
  /** Both sides' distinct (category, cents), for the answer-key grade. */
  liveSet: Array<[string, number]>;
  shadowSet: Array<[string, number]>;
  ms: number;
}
