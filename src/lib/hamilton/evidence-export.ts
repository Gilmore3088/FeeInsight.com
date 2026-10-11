/**
 * Printable audit appendix for a SAVED Hamilton answer. This is deliberately a
 * snapshot adapter, not an accuracy classifier: evidence IDs and matching figures
 * do not prove that the surrounding narrative is true.
 *
 * The Analysis PDF/UI owners can consume this read-only contract without querying
 * today's fee schedule, account membership, or a different research institution.
 */
import {
  CLAIM_BINDING_LIMITATION,
  normalizeLegacyAnalyzeConfidence,
  type EvidenceBoundAnalyzeResponse,
  type HamiltonDerivedFact,
  type HamiltonEvidenceFact,
  type HamiltonFactSource,
} from "./evidence-contract";

export interface SavedEvidenceFactRow {
  id: string;
  scope: HamiltonEvidenceFact["scope"];
  value: HamiltonEvidenceFact["value"];
  unit: HamiltonEvidenceFact["unit"];
  currency: HamiltonEvidenceFact["currency"];
  status: HamiltonEvidenceFact["status"];
  frequency: string | null;
  conditions: string | null;
  audienceEvidence: string | null;
  source: HamiltonFactSource;
  /** Inspectability problems are not silently treated as verified statements. */
  problems: string[];
}

export interface SavedEvidenceDerivationRow {
  id: string;
  scope: HamiltonDerivedFact["scope"];
  value: number | null;
  unit: HamiltonDerivedFact["unit"];
  inputFactIds: string[];
  denominatorFactId: string | null;
  formula: string;
  rounding: string;
  problems: string[];
}

export interface SavedEvidenceAppendix {
  version: number | null;
  generatedAt: string | null;
  confidence: EvidenceBoundAnalyzeResponse["confidence"];
  /** Never true until a separate claim-by-claim semantic review is persisted. */
  narrativeClaimsVerified: false;
  facts: SavedEvidenceFactRow[];
  derivations: SavedEvidenceDerivationRow[];
  limitations: string[];
}

function copySource(source: HamiltonFactSource): HamiltonFactSource {
  return {
    ...source,
    sourceDocumentIds: [...source.sourceDocumentIds],
    urls: [...source.urls],
    documentContentHash: source.documentContentHash ?? null,
    retrievedAt: source.retrievedAt ?? null,
    lastCheckedAt: source.lastCheckedAt ?? null,
    location: source.location ?? null,
  };
}

function sourceProblems(fact: HamiltonEvidenceFact): string[] {
  const problems: string[] = [];
  if (!Number.isSafeInteger(fact.scope.institutionId) || (fact.scope.institutionId ?? 0) <= 0) {
    problems.push("unknown_institution");
  }
  if (!fact.scope.feeCategory) problems.push("unknown_fee_category");
  if (!fact.scope.product) problems.push("unknown_product");
  if (fact.scope.accountApplicability === "unknown") problems.push("unknown_account_applicability");
  if (!fact.frequency) problems.push("unknown_frequency");
  if (typeof fact.value === "number" && !Number.isFinite(fact.value)) problems.push("invalid_numeric_value");
  if (fact.unit === "usd" && fact.currency !== "USD") problems.push("currency_mismatch");
  const recordId = fact.source.recordId;
  if (recordId === null || String(recordId).trim() === "") problems.push("missing_record_id");
  if (!fact.source.table) problems.push("missing_source_table");
  if (fact.source.sourceDocumentIds.length === 0 || fact.source.sourceDocumentIds.some(
    (id) => !Number.isSafeInteger(id) || id <= 0
  )) problems.push("missing_source_document_id");
  if (!fact.source.urls.some((url) => /^https?:\/\//i.test(url))) problems.push("uninspectable_source_url");
  return problems;
}

/**
 * Reproduce the SOURCE SNAPSHOT, not a fresh market query. Unknown dates remain
 * null, zero stays zero, and a legacy saved high never becomes a verified PDF claim.
 */
export function savedEvidenceAppendix(
  response: EvidenceBoundAnalyzeResponse,
): SavedEvidenceAppendix {
  const view = normalizeLegacyAnalyzeConfidence(response);
  const evidence = response.factEvidence;
  const ids = new Map<string, number>();
  for (const fact of evidence?.facts ?? []) ids.set(fact.id, (ids.get(fact.id) ?? 0) + 1);

  const facts: SavedEvidenceFactRow[] = (evidence?.facts ?? []).map((fact) => ({
    id: fact.id,
    scope: { ...fact.scope },
    value: typeof fact.value === "number" && !Number.isFinite(fact.value) ? null : fact.value,
    unit: fact.unit,
    currency: fact.currency,
    status: fact.status,
    frequency: fact.frequency,
    conditions: fact.conditions,
    audienceEvidence: fact.audienceEvidence ?? null,
    source: copySource(fact.source),
    problems: [
      ...sourceProblems(fact),
      ...(ids.get(fact.id) === 1 ? [] : ["duplicate_fact_id"]),
    ],
  }));

  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const derivations: SavedEvidenceDerivationRow[] = (evidence?.derivations ?? []).map((fact) => {
    const missingInputs = fact.derivation.inputFactIds.filter((id) => !byId.has(id));
    const incompleteInputs = fact.derivation.inputFactIds.filter((id) =>
      byId.has(id) && (byId.get(id)?.problems.length ?? 0) > 0
    );
    return {
      id: fact.id,
      scope: { ...fact.scope },
      value: typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null,
      unit: fact.unit,
      inputFactIds: [...fact.derivation.inputFactIds],
      denominatorFactId: fact.derivation.denominatorFactId,
      formula: fact.derivation.formula,
      rounding: fact.derivation.rounding,
      problems: [
        ...(fact.value === null || !Number.isFinite(fact.value) ? ["unknown_derived_value"] : []),
        ...(fact.derivation.inputFactIds.length === 0 ? ["missing_derivation_inputs"] : []),
        ...missingInputs.map((id) => `missing_input:${id}`),
        ...incompleteInputs.map((id) => `incomplete_input:${id}`),
        ...(fact.derivation.denominatorFactId && !byId.has(fact.derivation.denominatorFactId)
          ? ["missing_denominator"] : []),
      ],
    };
  });

  const limitations = new Set([
    ...(evidence?.limitations ?? []),
    CLAIM_BINDING_LIMITATION,
    "This appendix records saved input lineage; it does not independently verify the written claims.",
  ]);
  if (!evidence || (facts.length === 0 && derivations.length === 0)) {
    limitations.add("No record-bound evidence was saved with this answer.");
  }
  if (facts.some((fact) => fact.problems.length > 0) || derivations.some((fact) => fact.problems.length > 0)) {
    limitations.add("Some recorded inputs are incomplete or not independently inspectable.");
  }

  return {
    version: evidence?.version ?? null,
    generatedAt: evidence?.generatedAt ?? null,
    confidence: { ...view.confidence, basis: [...view.confidence.basis] },
    narrativeClaimsVerified: false,
    facts,
    derivations,
    limitations: [...limitations],
  };
}
