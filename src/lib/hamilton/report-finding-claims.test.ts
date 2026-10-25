/** @vitest-environment node */
/**
 * #1077 Cycle A trace defect 7 (V5 T4, "report fails closed"): a saved answer that becomes a report
 * finding carries its checked claims and their sources, and the answer section may restate a
 * finding's figure only when it matches the finding's carried facts or the section's own data.
 * Synthetic institutions only (Research CU 2945, Bank B 9002); not a claim about any real one.
 */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { filingFactId } from "./claim-evidence";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonEvidenceBundle, type HamiltonEvidenceFact } from "./evidence-contract";
import { checkNarrativeFigures } from "./figure-check";
import { bindNarrative } from "./narrative-bound";
import type { ReportBasketItem } from "./report-basket";
import {
  HELD_FINDING_FIGURE, REPORT_FINDING_MAX_FACTS, readerFindingsSection, reportAddedFindings, reportFindingClaims,
} from "./report-finding-claims";
import { savedAnswerFinding } from "./report-saved-finding";
import { savedClaimsFrom } from "./saved-claims";
import type { AnalyzeResponse, ReportSummaryResponse } from "./types";

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
const identityContext = { version: 1 as const, researchInstitutionId: RESEARCH, accountInstitutionId: null, accountStatus: "unlinked" as const, researchInstitutionName: "Research CU" };

function savedAnswer(withEvidence = true): AnalyzeResponse {
  const binding = bindNarrative({ text: `${supported} ${swapped} ${reading} ${qualitative}`, evidence, names, researchInstitutionId: RESEARCH });
  return {
    title: "Service charge income at Research CU", confidence: { level: "medium", basis: [] },
    hamiltonView: `${supported} ${reading}`, whatThisMeans: qualitative,
    whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [],
    answerEvidence: { passed: true, problems: [] }, narrativeBinding: binding,
    claims: savedClaimsFrom(binding, withEvidence ? [evidence] : []) ?? undefined,
    identityContext,
  };
}

/** The basket item the report action resolves from a saved answer, server side. */
function askFinding(answer = savedAnswer()): ReportBasketItem {
  const { detail, reading: lines, claims } = savedAnswerFinding(answer);
  return {
    id: "a1", source: "Ask", title: answer.title, detail, feeCategory: null, institutionId: String(RESEARCH), addedAt: "2026-10-25",
    savedAnalysisId: "00000000-0000-4000-8000-000000000001",
    ...(claims ? { savedClaims: claims } : {}), ...(lines.length ? { reading: lines } : {}),
    identityContext,
  };
}

const positionFinding = (detail: string): ReportBasketItem => ({
  id: "p1", source: "Position", title: "Overdraft position", detail, feeCategory: "overdraft", institutionId: String(RESEARCH), addedAt: "2026-10-25",
});

// The answer section's own data: one pooled median.
const sectionData = { categories: [{ fee_category: "overdraft", median_amount: 30, institution_count: 40 }] };

describe("a report finding carries its saved answer's checked claims (#1077 defect 7)", () => {
  it("keeps the supported sentences in its detail and the facts they cite, and words their sources", () => {
    const [finding] = reportAddedFindings([askFinding()], false);
    expect(finding.detail).toBe(`${supported} ${qualitative}`);
    expect(finding.claims?.supported).toEqual([{ text: supported, factIds: [OWN.id] }, { text: qualitative, factIds: [] }]);
    expect(finding.claims?.facts.map((f) => [f.id, f.value])).toEqual([[OWN.id, 1_100_000]]);
    expect(finding.claims?.factsTruncated).toBe(false);
    // Never the left-out sentence or the other bank's filing.
    expect(JSON.stringify(finding)).not.toContain("2.3 million");
    expect(JSON.stringify(finding)).not.toContain(OTHER.id);
    expect(finding.sources).toEqual([expect.objectContaining({ id: OWN.id, label: expect.stringContaining("Research CU"), value: "$1,100,000" })]);
    // The reading stays apart and prints only with its switch on.
    expect(finding.reading).toBeUndefined();
    expect(reportAddedFindings([askFinding()], true)[0].reading).toEqual([reading]);
  });

  it("carries nothing for a Position finding or an answer saved before claims, which still render", () => {
    const old = askFinding({ ...savedAnswer(), claims: undefined, narrativeBinding: undefined });
    const [position, legacy] = reportAddedFindings([positionFinding("Overdraft is $35."), old], false);
    expect(position).toEqual({ source: "Position", title: "Overdraft position", detail: "Overdraft is $35." });
    expect(legacy.claims).toBeUndefined();
    expect(legacy.sources).toBeUndefined();
  });

  it("bounds the facts it carries and says when it did", () => {
    const set = savedAnswer().claims!;
    const many = Array.from({ length: REPORT_FINDING_MAX_FACTS + 3 }, (_, i) => ({ ...set.facts[0], id: `${OWN.id}:${i}` }));
    const claims = reportFindingClaims({ ...set, claims: [{ text: supported, outcome: "supported", factIds: many.map((f) => f.id) }], facts: many }, supported)!;
    expect(claims.facts).toHaveLength(REPORT_FINDING_MAX_FACTS);
    expect(claims.factsTruncated).toBe(true);
  });
});

describe("the answer section's check on a finding's figure fails closed (#1077 defect 7)", () => {
  it("traces a restated finding figure to the finding's carried fact", () => {
    const { context, data } = readerFindingsSection([askFinding()], sectionData);
    expect(context).toContain("$1.1 million");
    expect(data).toEqual([expect.objectContaining({ numeric_arithmetic_allowed: false, facts: [expect.objectContaining({ fact_id: OWN.id, value: 1_100_000, unit: "usd" })] })]);
    const narrative = "Research CU's service charge income was $1.1 million in the quarter.";
    expect(checkNarrativeFigures(narrative, { ...sectionData, reader_finding_facts: data }).unmatched).toEqual([]);
    // Without the carried facts the same sentence has nothing behind it in the section's data.
    expect(checkNarrativeFigures(narrative, sectionData).unmatched).toEqual(["$1.1 million"]);
  });

  it("holds a finding figure that neither its carried facts nor the section's data support", () => {
    const { context, data } = readerFindingsSection([positionFinding("Research CU charges $35 for an overdraft; peers sit at $30.")], sectionData);
    expect(context).not.toContain("$35");
    expect(context).toContain(`charges ${HELD_FINDING_FIGURE} for an overdraft`);
    // A figure in the section's own data stays.
    expect(context).toContain("$30");
    expect(data).toBeNull();
  });

  it("holds the figure of an answer saved with claims but no facts, and never borrows another finding's fact", () => {
    const legacy = readerFindingsSection([askFinding(savedAnswer(false))], sectionData);
    expect(legacy.context).not.toContain("$1.1 million");
    expect(legacy.data).toBeNull();
    const both = readerFindingsSection([askFinding(), positionFinding("Fee income was $1.1 million.")], sectionData);
    expect(both.context).toContain(supported);
    expect(both.context).toContain(`Fee income was ${HELD_FINDING_FIGURE}.`);
  });
});

describe("the report PDF lists a finding's sources", () => {
  const base: ReportSummaryResponse = {
    title: "Research CU fee report", executiveSummary: ["Summary."], snapshot: [], strategicRationale: "", tradeoffs: [],
    recommendation: "", implementationNotes: [], exportControls: { pdfEnabled: true, shareEnabled: false },
  };
  async function text(report: ReportSummaryResponse) {
    const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "peer_benchmarking" }) as unknown as ReactElement<DocumentProps>);
    return (await extractText(new Uint8Array(buffer), { mergePages: true })).text.replace(/\s+/g, " ");
  }

  it("prints each carried fact's record under the finding, and an old row without them still renders", async () => {
    const printed = await text({ ...base, addedFindings: reportAddedFindings([askFinding()], false) });
    expect(printed).toContain("Each figure shown matches the record or filing listed beside it");
    expect(printed).toContain("$1,100,000");
    expect(printed).toContain(OWN.id);
    const old = await text({ ...base, addedFindings: [{ source: "Ask", title: "Old finding", detail: "Saved before claims." }] });
    expect(old).toContain("Saved before claims.");
    expect(old).not.toContain("Each figure shown matches the record");
  }, 30_000);
});
