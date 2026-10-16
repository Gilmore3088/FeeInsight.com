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

export const APPENDIX_LINEAGE_LIMITATION =
  "This appendix records saved input lineage; it does not independently verify the written claims.";
export const NO_RECORD_EVIDENCE_LIMITATION = "No record-bound evidence was saved with this answer.";
export const INCOMPLETE_RECORDS_LIMITATION = "Some recorded inputs are incomplete or not independently inspectable.";

function copySource(source: HamiltonFactSource): HamiltonFactSource {
  return {
    ...source,
    sourceDocumentIds: Array.isArray(source.sourceDocumentIds) ? [...source.sourceDocumentIds] : [],
    urls: Array.isArray(source.urls) ? [...source.urls] : [],
    documentContentHash: source.documentContentHash ?? null,
    retrievedAt: source.retrievedAt ?? null,
    lastCheckedAt: source.lastCheckedAt ?? null,
    location: source.location ?? null,
  };
}

function inspectableSourceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function sourceProblems(fact: HamiltonEvidenceFact): string[] {
  const problems: string[] = [];
  if (!Number.isSafeInteger(fact.scope.institutionId) || (fact.scope.institutionId ?? 0) <= 0) {
    problems.push("unknown_institution");
  }
  if (!fact.scope.feeCategory?.trim()) problems.push("unknown_fee_category");
  if (!fact.scope.product?.trim()) problems.push("unknown_product");
  if (fact.scope.accountApplicability === "unknown") problems.push("unknown_account_applicability");
  if (!fact.frequency?.trim()) problems.push("unknown_frequency");
  if (typeof fact.value === "number" && !Number.isFinite(fact.value)) problems.push("invalid_numeric_value");
  if (fact.value === null) problems.push("unknown_observed_value");
  if (typeof fact.value === "string" && fact.unit !== "text") problems.push("non_numeric_observed_value");
  if (fact.status !== "published" && fact.status !== "verified") problems.push("unverified_observation_status");
  if (fact.unit === "usd" && typeof fact.value === "number" && fact.value < 0) problems.push("negative_fee_amount");
  if (fact.unit === "count" && typeof fact.value === "number"
    && (!Number.isSafeInteger(fact.value) || fact.value < 0)) {
    problems.push("invalid_count");
  }
  if ((fact.unit === "usd" && fact.currency !== "USD")
    || (fact.unit !== "usd" && fact.currency !== null)) problems.push("currency_mismatch");
  const recordId = fact.source.recordId;
  if (recordId === null || String(recordId).trim() === "") problems.push("missing_record_id");
  if (!fact.source.table) problems.push("missing_source_table");
  const documentIds = Array.isArray(fact.source.sourceDocumentIds) ? fact.source.sourceDocumentIds : [];
  if (documentIds.length === 0 || documentIds.some(
    (id) => !Number.isSafeInteger(id) || id <= 0
  )) problems.push("missing_source_document_id");
  const sourceUrls = Array.isArray(fact.source.urls) ? fact.source.urls : [];
  if (!sourceUrls.some(inspectableSourceUrl)) problems.push("uninspectable_source_url");
  return problems;
}

/**
 * Recompute supported saved derivations from their frozen numeric inputs.
 * This is an arithmetic integrity check, NOT evidence that the text describing
 * the result, the source schedule, or the audience has been verified.
 * Unknown formulas fail closed rather than assuming the displayed number is true.
 */
function arithmeticProblems(
  fact: HamiltonDerivedFact,
  inputs: SavedEvidenceFactRow[],
): string[] {
  const recipe = fact.derivation;
  if (fact.value === null || !Number.isFinite(fact.value)
    || inputs.length !== recipe.inputFactIds.length
    || inputs.some((row) => typeof row.value !== "number" || !Number.isFinite(row.value))) return [];
  const values = inputs.map((row) => row.value as number);
  const formula = recipe.formula.trim().toLowerCase().replace(/\s+/g, " ");
  let expected: number;

  if (recipe.kind === "difference") {
    if (values.length !== 2) return ["invalid_derivation_input_count"];
    if (formula !== "left - right") return ["unrecognized_derivation_formula"];
    expected = Math.round((values[0] - values[1]) * 100) / 100;
  } else if (recipe.kind === "percent_change") {
    if (values.length !== 2) return ["invalid_derivation_input_count"];
    if (recipe.denominatorFactId !== recipe.inputFactIds[1]) return ["wrong_percent_denominator"];
    if (formula !== "(current - prior) / prior * 100"
      && formula !== "(current-prior)/prior*100") return ["unrecognized_derivation_formula"];
    if (values[1] === 0) return ["zero_denominator"];
    expected = Math.round((((values[0] - values[1]) / values[1]) * 100) * 10) / 10;
  } else if (recipe.kind === "institution_value" || recipe.kind === "peer_median") {
    if (values.length === 0) return ["invalid_derivation_input_count"];
    if (recipe.kind === "institution_value"
      && (formula === "max" || formula === "highest published tier for the institution")) {
      expected = Math.max(...values);
    } else if (formula === "median" || formula === "median of published institution amounts"
      || formula === "median of published peer amounts") {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = (sorted.length - 1) / 2;
      const lower = Math.floor(middle);
      expected = sorted[lower] + (sorted[Math.ceil(middle)] - sorted[lower]) * (middle - lower);
    } else return ["unrecognized_derivation_formula"];
  } else return ["unrecognized_derivation_kind"];

  return !Number.isFinite(expected) || Math.abs(fact.value - expected) > 0.0000001
    ? ["derived_value_mismatch"] : [];
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
    // A saved derivation may contain valid-looking input IDs that belong to a
    // different bank, fee category, currency or reporting period. Record these
    // contradictions without claiming that any surrounding prose was checked.
    const inputs = fact.derivation.inputFactIds
      .map((id) => byId.get(id))
      .filter((row): row is SavedEvidenceFactRow => row !== undefined);
    const first = inputs[0];
    const scopeMismatched = inputs.some((row) => row.scope.feeCategory !== fact.scope.feeCategory);
    const institutionMismatched = (fact.derivation.kind === "institution_value"
      || fact.derivation.kind === "percent_change")
      && (fact.scope.institutionId === null
        || inputs.some((row) => row.scope.institutionId !== fact.scope.institutionId));
    const unitMismatched = inputs.some((row) => row.unit !== first?.unit)
      || (fact.derivation.kind === "percent_change"
        ? fact.unit !== "percent" || fact.currency !== null
        : inputs.some((row) => row.unit !== fact.unit || row.currency !== fact.currency));
    const currencyMismatched = inputs.some((row) => row.currency !== first?.currency);
    const frequencies = inputs.map((row) => row.frequency?.trim().toLowerCase() ?? null);
    const frequencyMismatched = frequencies.length > 1 && frequencies.some((frequency) => frequency !== frequencies[0]);
    const comparisonPeriodMismatched = fact.derivation.kind === "difference"
      && (inputs.length !== 2 || !inputs[0].scope.reportingDate || !inputs[1].scope.reportingDate
        || inputs[0].scope.reportingDate !== inputs[1].scope.reportingDate);
    const changePeriodMismatched = fact.derivation.kind === "percent_change"
      && (inputs.length !== 2 || !inputs[0].scope.reportingDate || !inputs[1].scope.reportingDate
        || inputs[0].scope.reportingDate <= inputs[1].scope.reportingDate);
    const denominatorNotInput = fact.derivation.denominatorFactId !== null
      && !fact.derivation.inputFactIds.includes(fact.derivation.denominatorFactId);
    const sourceValueProblems = inputs.some((row) => row.value === null
      || (typeof row.value === "number" && !Number.isFinite(row.value)));
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
        ...(denominatorNotInput ? ["denominator_not_input"] : []),
        ...(scopeMismatched ? ["input_fee_category_mismatch"] : []),
        ...(institutionMismatched ? ["input_institution_mismatch"] : []),
        ...(unitMismatched ? ["input_unit_mismatch"] : []),
        ...(currencyMismatched ? ["input_currency_mismatch"] : []),
        ...(frequencyMismatched ? ["input_frequency_mismatch"] : []),
        ...(comparisonPeriodMismatched ? ["comparison_period_mismatch"] : []),
        ...(changePeriodMismatched ? ["change_period_invalid"] : []),
        ...(sourceValueProblems ? ["invalid_input_value"] : []),
        ...arithmeticProblems(fact, inputs),
      ],
    };
  });

  const limitations = new Set([
    ...(evidence?.limitations ?? []),
    CLAIM_BINDING_LIMITATION,
    APPENDIX_LINEAGE_LIMITATION,
  ]);
  if (!evidence || (facts.length === 0 && derivations.length === 0)) {
    limitations.add(NO_RECORD_EVIDENCE_LIMITATION);
  }
  if (facts.some((fact) => fact.problems.length > 0) || derivations.some((fact) => fact.problems.length > 0)) {
    limitations.add(INCOMPLETE_RECORDS_LIMITATION);
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
