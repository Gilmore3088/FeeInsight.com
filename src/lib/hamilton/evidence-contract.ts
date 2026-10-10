import type { AnalyzeResponse } from "./types";
import type { FeeResearch, OwnFeeRow, PeerValue } from "./workspace/types";

export const HAMILTON_EVIDENCE_CONTRACT_VERSION = 1 as const;

export const CLAIM_BINDING_LIMITATION =
  "Structured evidence preserves record identity and derivations, but it does not by itself verify every sentence in a narrative.";

export type HamiltonFactUnit = "usd" | "percent" | "count" | "ratio" | "text";
export type HamiltonEvidenceStatus =
  | "published"
  | "verified"
  | "provisional"
  | "user_provided"
  | "inferred"
  | "derived";

export type HamiltonAccountApplicability = "consumer" | "business" | "both" | "unknown";

export interface HamiltonFactScope {
  institutionId: number | null;
  feeCategory: string | null;
  product: string | null;
  reportingDate: string | null;
  effectiveDate: string | null;
  accountApplicability: HamiltonAccountApplicability;
}

export interface HamiltonFactSource {
  label: string | null;
  table: string | null;
  recordId: number | string | null;
  sourceDocumentIds: number[];
  urls: string[];
  asOf: string | null;
  /** Content fingerprint, not an effective or filing date. */
  documentContentHash?: string | null;
  retrievedAt?: string | null;
  lastCheckedAt?: string | null;
  location?: string | null;
  verificationEventId: string | null;
}

export interface HamiltonEvidenceFact {
  id: string;
  kind: "observed";
  scope: HamiltonFactScope;
  value: number | string | null;
  unit: HamiltonFactUnit;
  currency: "USD" | null;
  frequency: string | null;
  conditions: string | null;
  audienceEvidence?: string | null;
  status: Exclude<HamiltonEvidenceStatus, "derived">;
  source: HamiltonFactSource;
}

export type HamiltonDerivationKind =
  | "difference"
  | "percent_change"
  | "institution_value"
  | "peer_median";

export interface HamiltonDerivedFact {
  id: string;
  kind: "derived";
  scope: HamiltonFactScope;
  value: number | null;
  unit: HamiltonFactUnit;
  currency: "USD" | null;
  status: "derived";
  derivation: {
    kind: HamiltonDerivationKind;
    inputFactIds: string[];
    denominatorFactId: string | null;
    formula: string;
    rounding: string;
  };
}

export interface HamiltonEvidenceBundle {
  version: typeof HAMILTON_EVIDENCE_CONTRACT_VERSION;
  generatedAt: string;
  facts: HamiltonEvidenceFact[];
  derivations: HamiltonDerivedFact[];
  limitations: string[];
}

export interface HamiltonClaimBinding {
  institutionId?: number | null;
  feeCategory?: string | null;
  unit?: HamiltonFactUnit;
  reportingDate?: string | null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function urls(...values: Array<string | null | undefined>): string[] {
  return unique(values.filter((value): value is string => typeof value === "string" && value.length > 0));
}

function ownFeeFact(institutionId: number, feeCategory: string, row: OwnFeeRow): HamiltonEvidenceFact | null {
  if (row.amount === null || !Number.isFinite(row.amount) || row.amount < 0) return null;
  return {
    id: `fee:published:${row.id}`,
    kind: "observed",
    scope: {
      institutionId,
      feeCategory,
      product: row.feeName,
      reportingDate: null,
      effectiveDate: null,
      accountApplicability: row.feeAudience ?? "unknown",
    },
    value: row.amount,
    unit: "usd",
    currency: "USD",
    frequency: row.frequency ?? null,
    conditions: row.conditions ?? null,
    audienceEvidence: row.audienceEvidence ?? null,
    status: "published",
    source: {
      label: "Published fee catalog",
      table: "published_fee_catalog",
      recordId: row.id,
      sourceDocumentIds: row.sourceDocumentId === null ? [] : [row.sourceDocumentId],
      urls: urls(row.documentUrl, row.sourceUrl),
      asOf: row.publishedAt,
      documentContentHash: row.sourceContentHash ?? null,
      retrievedAt: row.sourceCrawledAt ?? null,
      lastCheckedAt: row.sourceLastCheckedAt ?? null,
      location: null,
      verificationEventId: row.verifiedByEventId,
    },
  };
}

function peerFeeFact(feeCategory: string, peer: PeerValue): HamiltonEvidenceFact {
  const sourceIds = unique(peer.sourceDocumentIds.filter((id) => Number.isSafeInteger(id) && id > 0));
  const sourceKey = sourceIds.length > 0 ? sourceIds.join("-") : "unknown-source";
  return {
    id: `fee:peer:${peer.institutionId}:${feeCategory}:${sourceKey}`,
    kind: "observed",
    scope: {
      institutionId: peer.institutionId,
      feeCategory,
      product: null,
      reportingDate: null,
      effectiveDate: null,
      accountApplicability: "unknown",
    },
    value: peer.amount,
    unit: "usd",
    currency: "USD",
    frequency: null,
    conditions: null,
    status: "published",
    source: {
      label: "Published fee catalog",
      table: "published_fee_catalog",
      recordId: null,
      sourceDocumentIds: sourceIds,
      urls: unique(peer.documentUrls.filter((url) => typeof url === "string" && url.length > 0)),
      asOf: peer.publishedAt,
      verificationEventId: null,
    },
  };
}

function derivedFact(input: {
  id: string;
  scope: HamiltonFactScope;
  value: number | null;
  unit: HamiltonFactUnit;
  currency: "USD" | null;
  kind: HamiltonDerivationKind;
  inputFactIds: string[];
  denominatorFactId?: string | null;
  formula: string;
  rounding: string;
}): HamiltonDerivedFact {
  return {
    id: input.id,
    kind: "derived",
    scope: input.scope,
    value: input.value,
    unit: input.unit,
    currency: input.currency,
    status: "derived",
    derivation: {
      kind: input.kind,
      inputFactIds: unique(input.inputFactIds),
      denominatorFactId: input.denominatorFactId ?? null,
      formula: input.formula,
      rounding: input.rounding,
    },
  };
}

export function claimBindingMatches(
  fact: Pick<HamiltonEvidenceFact | HamiltonDerivedFact, "scope" | "unit">,
  claim: HamiltonClaimBinding,
): boolean {
  if (claim.institutionId !== undefined && fact.scope.institutionId !== claim.institutionId) return false;
  if (claim.feeCategory !== undefined && fact.scope.feeCategory !== claim.feeCategory) return false;
  if (claim.unit !== undefined && fact.unit !== claim.unit) return false;
  if (claim.reportingDate !== undefined && fact.scope.reportingDate !== claim.reportingDate) return false;
  return true;
}

function comparabilityProblems(
  left: HamiltonEvidenceFact | HamiltonDerivedFact,
  right: HamiltonEvidenceFact | HamiltonDerivedFact,
  periodRule: "same_period" | "chronological" = "same_period",
): string[] {
  const problems: string[] = [];
  if (typeof left.value !== "number" || typeof right.value !== "number") problems.push("non_numeric_value");
  if (left.unit !== right.unit) problems.push("unit_mismatch");
  if (left.currency !== right.currency) problems.push("currency_mismatch");
  if (left.scope.feeCategory !== right.scope.feeCategory) problems.push("fee_category_mismatch");
  if (!left.scope.reportingDate || !right.scope.reportingDate) problems.push("reporting_period_unknown");
  else if (periodRule === "same_period" && left.scope.reportingDate !== right.scope.reportingDate) {
    problems.push("reporting_period_mismatch");
  } else if (periodRule === "chronological") {
    // Changes require one institution over two ordered periods, not two banks in one period.
    if (left.scope.institutionId === null || left.scope.institutionId !== right.scope.institutionId) {
      problems.push("institution_mismatch");
    }
    if (left.scope.product !== right.scope.product) problems.push("product_mismatch");
    if (left.scope.reportingDate <= right.scope.reportingDate) problems.push("reporting_period_order_invalid");
  }
  return problems;
}

export function deriveDifference(
  id: string,
  left: HamiltonEvidenceFact | HamiltonDerivedFact,
  right: HamiltonEvidenceFact | HamiltonDerivedFact,
): { fact: HamiltonDerivedFact | null; problems: string[] } {
  const problems = comparabilityProblems(left, right);
  if (problems.length > 0 || typeof left.value !== "number" || typeof right.value !== "number") {
    return { fact: null, problems };
  }
  return {
    fact: derivedFact({
      id,
      scope: {
        institutionId: null,
        feeCategory: left.scope.feeCategory,
        product: null,
        reportingDate: left.scope.reportingDate,
        effectiveDate: null,
        accountApplicability: "unknown",
      },
      value: Math.round((left.value - right.value) * 100) / 100,
      unit: left.unit,
      currency: left.currency,
      kind: "difference",
      inputFactIds: [left.id, right.id],
      formula: "left - right",
      rounding: "nearest cent for USD; otherwise two decimals",
    }),
    problems: [],
  };
}

export function derivePercentChange(
  id: string,
  current: HamiltonEvidenceFact | HamiltonDerivedFact,
  prior: HamiltonEvidenceFact | HamiltonDerivedFact,
): { fact: HamiltonDerivedFact | null; problems: string[] } {
  const problems = comparabilityProblems(current, prior, "chronological");
  if (typeof prior.value === "number" && prior.value === 0) problems.push("zero_denominator");
  if (
    problems.length > 0
    || typeof current.value !== "number"
    || typeof prior.value !== "number"
  ) {
    return { fact: null, problems: unique(problems) };
  }
  return {
    fact: derivedFact({
      id,
      scope: {
        institutionId: current.scope.institutionId === prior.scope.institutionId ? current.scope.institutionId : null,
        feeCategory: current.scope.feeCategory,
        product: null,
        reportingDate: current.scope.reportingDate,
        effectiveDate: null,
        accountApplicability: "unknown",
      },
      value: Math.round((((current.value - prior.value) / prior.value) * 100) * 10) / 10,
      unit: "percent",
      currency: null,
      kind: "percent_change",
      inputFactIds: [current.id, prior.id],
      denominatorFactId: prior.id,
      formula: "(current - prior) / prior * 100",
      rounding: "one decimal percentage point",
    }),
    problems: [],
  };
}

export function structuredEvidenceConfidence(bundle: HamiltonEvidenceBundle | null | undefined): {
  level: "medium";
  basis: string[];
} {
  const count = (bundle?.facts.length ?? 0) + (bundle?.derivations.length ?? 0);
  return {
    level: "medium",
    basis: [
      count > 0
        ? `${count} structured evidence record${count === 1 ? "" : "s"} saved with explicit identity/source context.`
        : "Deterministic storyline saved without claim-level structured evidence records.",
      CLAIM_BINDING_LIMITATION,
    ],
  };
}

export function buildFeeResearchEvidence(research: FeeResearch): HamiltonEvidenceBundle {
  const ownFacts = research.ownRows
    .map((row) => ownFeeFact(research.institutionId, research.feeCategory, row))
    .filter((fact): fact is HamiltonEvidenceFact => fact !== null);
  const peerFacts = research.peers.map((peer) => peerFeeFact(research.feeCategory, peer));
  const derivations: HamiltonDerivedFact[] = [];

  if (research.current !== null && ownFacts.length > 0) {
    derivations.push(derivedFact({
      id: `derived:current:${research.institutionId}:${research.feeCategory}`,
      scope: {
        institutionId: research.institutionId,
        feeCategory: research.feeCategory,
        product: research.displayName,
        reportingDate: null,
        effectiveDate: null,
        accountApplicability: "unknown",
      },
      value: research.current,
      unit: "usd",
      currency: "USD",
      kind: "institution_value",
      inputFactIds: ownFacts.map((fact) => fact.id),
      formula: research.feeCategory === "overdraft"
        ? "highest published tier for the institution"
        : "median of published institution amounts",
      rounding: "stored published amount precision",
    }));
  }

  if (research.band?.median !== null && research.band && peerFacts.length > 0) {
    derivations.push(derivedFact({
      id: `derived:peer-median:${research.institutionId}:${research.feeCategory}`,
      scope: {
        institutionId: null,
        feeCategory: research.feeCategory,
        product: research.displayName,
        reportingDate: null,
        effectiveDate: null,
        accountApplicability: "unknown",
      },
      value: research.band.median,
      unit: "usd",
      currency: "USD",
      kind: "peer_median",
      inputFactIds: peerFacts.map((fact) => fact.id),
      formula: "median of one published value per peer institution",
      rounding: "workspace peer-statistic precision",
    }));
  }

  return {
    version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
    generatedAt: research.provenance.generatedAt,
    facts: [...ownFacts, ...peerFacts],
    derivations,
    limitations: [
      "Evidence snapshot reflects stored records at answer time; it is not a live-source recheck.",
      CLAIM_BINDING_LIMITATION,
    ],
  };
}


export const LEGACY_HIGH_CONFIDENCE_LIMITATION =
  "Legacy high confidence predates record-bound Hamilton evidence and is shown as medium until the artifact is regenerated or separately verified.";

export type EvidenceBoundAnalyzeResponse = AnalyzeResponse & {
  factEvidence?: HamiltonEvidenceBundle;
};

/**
 * Compatibility view only: never rewrite stored history. A structured evidence
 * snapshot is NOT evidence that all of the saved narrative was claim-verified.
 * The current contract has no semantic-proof field that could justify "high".
 */
export function normalizeLegacyAnalyzeConfidence(
  response: EvidenceBoundAnalyzeResponse,
): EvidenceBoundAnalyzeResponse {
  if (response.confidence.level !== "high") return response;
  const limitation = response.factEvidence
    ? CLAIM_BINDING_LIMITATION
    : LEGACY_HIGH_CONFIDENCE_LIMITATION;
  return {
    ...response,
    confidence: {
      level: "medium",
      basis: unique([...response.confidence.basis, limitation]),
    },
  };
}
