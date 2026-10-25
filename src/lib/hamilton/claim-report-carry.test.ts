/** @vitest-environment node */
/**
 * Claim contract step 6 (#1077, #1899): a written answer's claims are saved with it and travel to
 * the report; the report reads them, not joined prose; report sections get the one output gate in
 * shadow. Synthetic institutions only (Research CU 2945, Bank B 9002); not a claim about any real one.
 */
import { describe, expect, it } from "vitest";
import { filingFactId } from "./claim-evidence";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonEvidenceBundle, type HamiltonEvidenceFact } from "./evidence-contract";
import { reportSectionGateShadow } from "./generate";
import { bindNarrative, type NarrativeBinding } from "./narrative-bound";
import { readGateShadowRecord } from "./output-gate-shadow";
import { reportFindingReadingEnabled, savedAnswerFinding } from "./report-saved-finding";
import { bindingFromClaims, readSavedClaims, SAVED_CLAIM_MAX_FACTS, savedClaimsFrom } from "./saved-claims";
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
      metric: "service_charge_income", reportingDate: "2026-06-30", periodBasis: "standalone_quarter", asOf: "2026-06-30" }]);
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
