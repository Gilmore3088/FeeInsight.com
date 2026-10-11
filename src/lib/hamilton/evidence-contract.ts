import type { AnalyzeResponse } from "./types";
import type { FeeResearch, OwnFeeRow } from "./workspace/types";

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

/**
 * Canonical arithmetic is not proof that a generic category median names a
 * particular product. Only allow a claim-bound aggregate when every sourced
 * input shares a product, frequency and one source document identity.
 * This does not assert that the document is current or verify narrative text.
 */
function supportedOwnAggregate(
  facts: HamiltonEvidenceFact[],
  current: number | null,
  feeCategory: string,
): boolean {
  if (current === null || !Number.isFinite(current) || current < 0 || facts.length === 0) return false;
  const first = facts[0];
  const product = first.scope.product?.trim().toLowerCase();
  const frequency = first.frequency?.trim().toLowerCase();
  const documentId = first.source.sourceDocumentIds[0];
  if (!product || !frequency || first.source.sourceDocumentIds.length !== 1
    || !Number.isSafeInteger(documentId) || documentId <= 0) return false;

  const amounts: number[] = [];
  for (const fact of facts) {
    if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || fact.value < 0) return false;
    if (fact.scope.product?.trim().toLowerCase() !== product) return false;
    if (fact.frequency?.trim().toLowerCase() !== frequency) return false;
    if (fact.scope.accountApplicability !== "consumer" && fact.scope.accountApplicability !== "both") return false;
    if (!Number.isSafeInteger(Number(fact.source.recordId)) || Number(fact.source.recordId) <= 0) return false;
    if (fact.source.sourceDocumentIds.length !== 1 || fact.source.sourceDocumentIds[0] !== documentId) return false;
    amounts.push(fact.value);
  }
  amounts.sort((left, right) => left - right);
  const middle = (amounts.length - 1) / 2;
  const lower = Math.floor(middle);
  const expected = feeCategory === "overdraft"
    ? amounts[amounts.length - 1]
    : amounts[lower] + (amounts[Math.ceil(middle)] - amounts[lower]) * (middle - lower);
  return Math.abs(expected - current) <= 0.0000001;
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
  // Source-document IDs are insufficient to identify the fee rows behind
  // each peer's collapsed category statistic; never save them as observations.
  const currentEvidenceSupported = supportedOwnAggregate(ownFacts, research.current, research.feeCategory);
  const derivations: HamiltonDerivedFact[] = [];

  if (currentEvidenceSupported) {
    derivations.push(derivedFact({
      id: `derived:current:${research.institutionId}:${research.feeCategory}`,
      scope: {
        institutionId: research.institutionId,
        feeCategory: research.feeCategory,
        product: ownFacts[0].scope.product,
        reportingDate: null,
        effectiveDate: null,
        accountApplicability: "consumer",
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


  return {
    version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
    generatedAt: research.provenance.generatedAt,
    facts: ownFacts,
    derivations,
    limitations: [
      "Evidence snapshot reflects stored records at answer time; it is not a live-source recheck.",
      ...(research.current !== null && !currentEvidenceSupported
        ? ["Own category aggregate has incompatible, incomplete or untraceable product/frequency/source rows; it is not a claim-bound individual fee."]
        : []),
      ...(research.peers.length > 0
        ? ["Peer category aggregates lack contributing published fee-row IDs; figures are directional and omitted from claim-bound evidence."]
        : []),
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
