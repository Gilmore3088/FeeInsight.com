/** @vitest-environment node */
/**
 * Claim contract step 6 (#1077, #1899): a written answer's claims are saved with it and travel to
 * the report; the report reads them, not joined prose; report sections get the one output gate in
 * shadow. Synthetic institutions only (Research CU 2945, Bank B 9002); not a claim about any real one.
 */
import { describe, expect, it } from "vitest";
import { filingFactId } from "./claim-evidence";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonDerivedFact, type HamiltonEvidenceBundle, type HamiltonEvidenceFact } from "./evidence-contract";
import { reportSectionGateShadow } from "./generate";
import { bindNarrative, type NarrativeBinding } from "./narrative-bound";
import { readGateShadowRecord } from "./output-gate-shadow";
import { reportFindingReadingEnabled, savedAnswerFinding } from "./report-saved-finding";
import { bindingFromClaims, readSavedClaims, SAVED_CLAIM_MAX_FACTS, SAVED_CLAIM_MAX_IDS, savedClaimsFrom } from "./saved-claims";
import type { AnalyzeResponse } from "./types";

const RESEARCH = 2945;
const BANK_B = 9002;
const names = new Map([[RESEARCH, "Research CU"], [BANK_B, "Bank B"]]);

function filing(institutionId: number, value: number): HamiltonEvidenceFact {
  const id = filingFactId("fdic", institutionId, "2026-06-30", "service_charge_income", "standalone_quarter");
  return {
    id, kind: "observed",
    scope: { institutionId, feeCategory: null, product: null, reportingDate: "2026-06-30", effectiveDate: null, accountApplicability: "unknown", metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey: null },
    value, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
    source: { label: "FDIC call report", table: "institution_financial_records", recordId: null, recordKey: id, evidenceClass: "filing", sourceDocumentIds: [], urls: [], asOf: "2026-06-30", verificationEventId: null },
  };
}

const OWN = filing(RESEARCH, 1_100_000);
const OTHER = filing(BANK_B, 2_300_000);
const evidence: HamiltonEvidenceBundle = { version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts: [OWN, OTHER], derivations: [], limitations: [] };

const supported = "Research CU's service charge income was $1.1 million in Q2 2026.";
const swapped = "Research CU's service charge income was $2.3 million in Q2 2026.";
const reading = "Peers sit near $30.";
const qualitative = "That puts its fee income in the middle of its group.";

function financialAnswer(): { answer: AnalyzeResponse; binding: NarrativeBinding } {
  const binding = bindNarrative({ text: `${supported} ${swapped} ${reading} ${qualitative}`, evidence, names, researchInstitutionId: RESEARCH });
  const answer: AnalyzeResponse = {
    title: "Service charge income at Research CU", confidence: { level: "medium", basis: [] },
    // As saved: the left-out sentence is already gone from the prose, the reading is inline.
    hamiltonView: `${supported} ${reading}`,
    whatThisMeans: qualitative,
    whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [],
    answerEvidence: { passed: true, problems: [] },
    narrativeBinding: binding,
    claims: savedClaimsFrom(binding, [evidence]) ?? undefined,
  };
  return { answer, binding };
}

describe("the fixture binds as the claim contract says", () => {
  it("supports the bank's own filing, leaves out the other bank's, and keeps the peer figure as a reading", () => {
    const { binding } = financialAnswer();
    expect(binding.supported.find((s) => s.text === supported)?.factIds).toEqual([OWN.id]);
    expect(binding.omitted).toEqual([{ text: swapped, reason: "wrong_institution" }]);
    expect(binding.interpretation).toEqual([reading]);
  });
});

describe("saved claims (#1077 step 6)", () => {
  it("record each sentence's outcome and the cited filing's value, and read back unchanged", () => {
    const { answer, binding } = financialAnswer();
    const claims = answer.claims!;
    expect(claims.version).toBe(1);
    expect(claims.claims.find((c) => c.text === supported)).toEqual({ text: supported, outcome: "supported", factIds: [OWN.id] });
    expect(claims.claims.find((c) => c.text === swapped)).toEqual({ text: swapped, outcome: "omitted", factIds: [], reason: "wrong_institution" });
    expect(claims.claims.find((c) => c.text === reading)?.outcome).toBe("reading");
    // Only cited facts are kept, with value and dates: Bank B's filing is not cited by a supported sentence.
    expect(claims.facts).toEqual([{ id: OWN.id, kind: "observed", value: 1_100_000, unit: "usd", institutionId: RESEARCH, feeCategory: null,
      metric: "service_charge_income", reportingDate: "2026-06-30", periodBasis: "standalone_quarter", asOf: "2026-06-30",
      source: { table: "institution_financial_records", recordId: null, recordKey: OWN.id, evidenceClass: "filing", sourceDocumentIds: [] } }]);
    expect(readSavedClaims(JSON.parse(JSON.stringify(claims)))).toEqual(claims);
    // The claims describe the binding they came from.
    const back = bindingFromClaims(claims);
    expect(back.supported).toEqual(binding.supported);
    expect(back.interpretation).toEqual(binding.interpretation);
    expect(back.omitted).toEqual(binding.omitted);
  });

  it("read anything malformed or of another version as none", () => {
    const claims = financialAnswer().answer.claims!;
    expect(readSavedClaims(null)).toBeNull();
    expect(readSavedClaims({ ...claims, version: 2 })).toBeNull();
    expect(readSavedClaims({ ...claims, claims: [{ text: swapped, outcome: "omitted", factIds: [], reason: "made_up" }] })).toBeNull();
    expect(readSavedClaims({ ...claims, claims: [{ text: supported, outcome: "proven", factIds: [] }] })).toBeNull();
    expect(savedClaimsFrom(null)).toBeNull();
  });

  it("keep at most 40 cited facts and say when more were cited", () => {
    const facts = Array.from({ length: SAVED_CLAIM_MAX_FACTS + 2 }, (_, i) => ({ ...OWN, id: `${OWN.id}:${i}` }));
    const binding: NarrativeBinding = { version: 1, supported: [{ text: supported, factIds: facts.map((f) => f.id) }], interpretation: [], omitted: [], limitations: [] };
    const set = savedClaimsFrom(binding, [{ ...evidence, facts }])!;
    expect(set.facts).toHaveLength(SAVED_CLAIM_MAX_FACTS);
    expect(set.factsTruncated).toBe(true);
  });

  it("keep every supported sentence's first fact before any sentence's second, so the bound never drops a late sentence's only fact", () => {
    const many = Array.from({ length: SAVED_CLAIM_MAX_FACTS + 5 }, (_, i) => ({ ...OWN, id: `${OWN.id}:${i}` }));
    const late = { ...OTHER, id: `${OTHER.id}:late` };
    const binding: NarrativeBinding = { version: 1, interpretation: [], omitted: [], limitations: [],
      supported: [{ text: supported, factIds: many.map((f) => f.id) }, { text: "Bank B's was $2.3 million.", factIds: [late.id] }] };
    const set = savedClaimsFrom(binding, [{ ...evidence, facts: [...many, late] }])!;
    expect(set.facts).toHaveLength(SAVED_CLAIM_MAX_FACTS);
    expect(set.facts.map((f) => f.id).slice(0, 2)).toEqual([many[0].id, late.id]);
    expect(set.factsTruncated).toBe(true);
  });
});

describe("saved claim facts keep their source identity (#1077, Cycle A trace defect 6)", () => {
  const fee: HamiltonEvidenceFact = {
    id: "fee:published:9", kind: "observed",
    scope: { institutionId: RESEARCH, feeCategory: "overdraft", product: "Overdraft fee", reportingDate: null, effectiveDate: null, accountApplicability: "unknown" },
    value: 37, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
    source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 9,
      sourceDocumentIds: Array.from({ length: SAVED_CLAIM_MAX_IDS + 3 }, (_, i) => 77 + i),
      urls: ["https://example.test/schedule-2026.pdf", "https://example.test/other.pdf"], asOf: "2026-09-01",
      documentContentHash: "sha256:abc123", retrievedAt: "2026-09-02T10:00:00Z", lastCheckedAt: null, verificationEventId: "evt-5" },
  };
  const median: HamiltonDerivedFact = {
    id: "derived:peer_median:2945:overdraft", kind: "derived",
    scope: { institutionId: null, feeCategory: "overdraft", product: null, reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
    value: 30, unit: "usd", currency: "USD", status: "derived",
    derivation: { kind: "peer_median", inputFactIds: [fee.id, "fee:published:404"], denominatorFactId: null, formula: "median of published peer amounts", rounding: "the nearest cent" },
  };
  const bundle: HamiltonEvidenceBundle = { version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts: [fee], derivations: [median], limitations: [] };
  const binding: NarrativeBinding = { version: 1, interpretation: [], omitted: [], limitations: [],
    supported: [{ text: "Peers charge a median $30.", factIds: [median.id] }] };

  it("save the record, document ids (bounded), first URL, content hash and verification event of an observed fact", () => {
    const set = savedClaimsFrom({ ...binding, supported: [{ text: "Research CU charges $37.", factIds: [fee.id] }] }, [bundle])!;
    expect(set.facts[0].source).toEqual({
      table: "published_fee_catalog", recordId: 9, sourceDocumentIds: Array.from({ length: SAVED_CLAIM_MAX_IDS }, (_, i) => 77 + i),
      sourceDocumentIdsTruncated: true, url: "https://example.test/schedule-2026.pdf", documentContentHash: "sha256:abc123",
      retrievedAt: "2026-09-02T10:00:00Z", verificationEventId: "evt-5" });
    expect(readSavedClaims(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });

  it("save a calculated fact's input ids, and its inputs the evidence holds after the cited facts", () => {
    const set = savedClaimsFrom(binding, [bundle])!;
    expect(set.facts.map((f) => f.id)).toEqual([median.id, fee.id]);
    expect(set.facts[0]).toMatchObject({ inputFactIds: [fee.id, "fee:published:404"] });
    expect(set.facts[0]).not.toHaveProperty("source");
    expect(set.facts[1].source?.sourceDocumentIds[0]).toBe(77);
    expect(set.factsTruncated).toBe(false);
    expect(readSavedClaims(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });

  it("read claims saved before the source fields, and a malformed source, without them", () => {
    const set = savedClaimsFrom(binding, [bundle])!;
    const legacy = JSON.parse(JSON.stringify({ ...set, facts: set.facts.map(({ source: _s, inputFactIds: _i, ...fact }) => fact) }));
    const read = readSavedClaims(legacy)!;
    expect(read.facts).toHaveLength(2);
    expect(read.facts.every((f) => !("source" in f) && !("inputFactIds" in f))).toBe(true);
    const odd = readSavedClaims({ ...legacy, facts: [{ ...legacy.facts[1], source: { sourceDocumentIds: ["x", -1, 5], url: 4, table: "t".repeat(600) } }] })!;
    expect(odd.facts[0].source).toEqual({ table: null, recordId: null, sourceDocumentIds: [5] });
  });
});

describe("a saved answer as a report finding (#1899, #1077 step 6)", () => {
  it("states the financial sentence only when supported, and carries the reading apart", () => {
    const { answer } = financialAnswer();
    const finding = savedAnswerFinding(answer);
    expect(finding.detail).toBe(`${supported} ${qualitative}`);
    expect(finding.detail).not.toContain("$2.3 million");
    expect(finding.reading).toEqual([reading]);
    expect(finding.claims).toEqual(answer.claims);
  });

  it("reads an answer saved before the claims through its binding, to the same finding", () => {
    const { answer } = financialAnswer();
    const legacy = savedAnswerFinding({ ...answer, claims: undefined });
    expect(legacy.detail).toBe(savedAnswerFinding(answer).detail);
    expect(legacy.reading).toEqual([reading]);
    // Saved claims of an unknown version fall back to the binding too.
    expect(savedAnswerFinding({ ...answer, claims: { version: 99 } as unknown as AnalyzeResponse["claims"] }).detail).toBe(legacy.detail);
  });

  it("decides by the saved claims: a sentence they leave out never reaches the finding", () => {
    const { answer } = financialAnswer();
    const claims = answer.claims!;
    // A claims record that leaves out the supported sentence wins over the prose.
    const stricter = { ...claims, claims: claims.claims.map((c) => (c.text === supported ? { text: c.text, outcome: "omitted" as const, factIds: [], reason: "wrong_period" as const } : c)) };
    expect(savedAnswerFinding({ ...answer, claims: stricter }).detail).toBe(qualitative);
  });

  it("never prints a sentence the binding left out or read, even when the saved claims are empty or stale (PR #2583 review)", () => {
    const { answer } = financialAnswer();
    // Still-saved prose with the left-out sentence in it, and an empty v1 claims record.
    const stale = { ...answer, hamiltonView: `${supported} ${swapped} ${reading}` };
    const empty = { version: 1, bindingVersion: 1, claims: [], facts: [], factsTruncated: false, corrections: [] } as AnalyzeResponse["claims"];
    const finding = savedAnswerFinding({ ...stale, claims: empty });
    expect(finding.detail).not.toContain("$2.3 million");
    expect(finding.detail).not.toContain(reading);
    expect(finding.detail).toBe(`${supported} ${qualitative}`);
    expect(finding.reading).toEqual([reading]);
    // A stale record that calls the left-out sentence supported loses to the binding too.
    const claims = answer.claims!;
    const wrong = { ...claims, claims: claims.claims.map((c) => (c.text === swapped ? { text: c.text, outcome: "supported" as const, factIds: [] } : c)) };
    expect(savedAnswerFinding({ ...stale, claims: wrong }).detail).not.toContain("$2.3 million");
  });

  it("keeps an answer saved before the binding as saved", () => {
    const { answer } = financialAnswer();
    const finding = savedAnswerFinding({ ...answer, claims: undefined, narrativeBinding: undefined });
    expect(finding).toEqual({ detail: `${supported} ${reading} ${qualitative}`, reading: [], claims: null });
  });

  it("prints the reading only with the switch on, which is off by default", () => {
    expect(reportFindingReadingEnabled({})).toBe(false);
    expect(reportFindingReadingEnabled({ HAMILTON_REPORT_FINDING_READING: "off" })).toBe(false);
    for (const on of ["true", "1", "on", " ON "]) expect(reportFindingReadingEnabled({ HAMILTON_REPORT_FINDING_READING: on })).toBe(true);
  });
});

describe("report sections in the one output gate's shadow (#1077 step 6)", () => {
  const identity = { researchInstitutionId: RESEARCH, accountInstitutionId: null };

  it("records the unified verdict beside the figure check's decision, as its own path", () => {
    const record = reportSectionGateShadow("The peer median is $30.", { median: 30 }, "shown", identity);
    expect(record).toMatchObject({ surface: "report_section", path: "report_section", today: "shown", unified: "validated", agrees: true });
    expect(readGateShadowRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it("counts a section the figure check passes but the gate would hold as a disagreement, and changes nothing else", () => {
    // A stated cause with a figure: the cause rule (shadow input) flags it; today's figure check passes it.
    const record = reportSectionGateShadow("Research CU's fee income rose to $30 because it raised prices.", { amount: 30 }, "shown", identity);
    expect(record.today).toBe("shown");
    expect(record.unified).not.toBe("validated");
    expect(record.cause).toBe(true);
  });

  it("names the gap: a section has no question or fact bundle, so no premise or sentence is checked", () => {
    const record = reportSectionGateShadow("Research CU charges $35 for an overdraft.", { amount: 35 }, "shown", identity);
    expect(record.codes).not.toContain("premise_contradicted");
    expect(record.codes).not.toContain("wrong_institution");
  });
});
