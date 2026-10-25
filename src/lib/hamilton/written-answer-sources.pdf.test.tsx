/** @vitest-environment node */
/**
 * A written answer's sources in its exports (#1077, Cycle A defect 5): the analysis PDF and the
 * board brief list the record or filing behind each supported sentence, from the binding's fact ids
 * and the saved claims. A reading or left-out sentence gets no line; an answer that failed the
 * evidence gate gets none; the storyline path keeps its own saved record.
 */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { AnalysisPdfDocument, evidenceRecordSection } from "@/components/hamilton/reports/AnalysisPdfDocument";
import { boardBriefFromAnalysis, evidenceRecordsExhibit, WRITTEN_SOURCES_NOTE, writtenAnswerSources } from "./board-brief";
import { INTERPRETATION_LIMITATION, NARRATIVE_BINDING_VERSION, type NarrativeBinding } from "./narrative-bound";
import { filingFactId } from "./claim-evidence";
import { buildFeeResearchEvidence, HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonEvidenceBundle, type HamiltonEvidenceFact } from "./evidence-contract";
import { savedClaimsFrom } from "./saved-claims";
import { fallbackSaveSections } from "./saved-analysis-record";
import { buildFeeAnswer } from "./workspace/answer";
import { storylineAnalysis } from "./workspace/analysis-record";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { AnalyzeResponse } from "./types";

// Synthetic answer and records; not a claim about any real institution.
const feeFact: HamiltonEvidenceFact = {
  id: "fee:published:9", kind: "observed",
  scope: { institutionId: 2945, feeCategory: "overdraft", product: "Overdraft fee", reportingDate: null, effectiveDate: null, accountApplicability: "unknown" },
  value: 37, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
  source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 9, sourceDocumentIds: [77], urls: ["https://example.test/schedule.pdf"], asOf: null, verificationEventId: null },
};
const filingId = filingFactId("fdic", 2945, "2026-06-30", "service_charge_income", "standalone_quarter");
const filingFact: HamiltonEvidenceFact = {
  id: filingId, kind: "observed",
  scope: { institutionId: 2945, feeCategory: null, product: null, reportingDate: "2026-06-30", effectiveDate: null, accountApplicability: "unknown", metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey: null },
  value: 1_100_000, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
  source: { label: "FDIC call report", table: "institution_financial_records", recordId: null, recordKey: filingId, evidenceClass: "filing", sourceDocumentIds: [], urls: [], asOf: "2026-06-30", verificationEventId: null },
};
const bundle = (facts: HamiltonEvidenceFact[]): HamiltonEvidenceBundle => ({ version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts, derivations: [], limitations: [] });

const feeSentence = "Research Bank charges $37 for an overdraft.";
const filingSentence = "Its service charge income was $1.1 million in Q2 2026.";
const reading = "That likely reflects a pricing choice.";
const left = "Research Bank charges $12 for a stop payment.";
const identityContext = { version: 1 as const, researchInstitutionId: 2945, accountInstitutionId: 1, accountStatus: "identified" as const, researchInstitutionName: "Research Bank", accountInstitutionName: "Home Bank" };

function writtenAnswer(binding: NarrativeBinding, extra: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    identityContext,
    title: "Overdraft at Research Bank", confidence: { level: "medium", basis: [] },
    hamiltonView: `${feeSentence} ${filingSentence} ${reading}`,
    whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [],
    answerEvidence: { passed: true, problems: [] },
    narrativeBinding: binding,
    claims: savedClaimsFrom(binding, [bundle([feeFact]), bundle([filingFact])]) ?? undefined,
    ...extra,
  };
}

const bound: NarrativeBinding = {
  version: NARRATIVE_BINDING_VERSION,
  supported: [{ text: feeSentence, factIds: [feeFact.id] }, { text: filingSentence, factIds: [filingId] }],
  interpretation: [reading],
  omitted: [{ text: left, reason: "wrong_category" }],
  limitations: [INTERPRETATION_LIMITATION],
};
const readingOnly: NarrativeBinding = { ...bound, supported: [], omitted: [], interpretation: [feeSentence, filingSentence, reading] };

const edits = { title: "", teamNote: "", includeEvidence: true };
const norm = (text: string) => text.replace(/\s+/g, " ");
async function pdfText(analysis: AnalyzeResponse): Promise<string> {
  const buffer = await renderToBuffer(createElement(AnalysisPdfDocument, { analysis, analysisFocus: "Overdraft" }) as unknown as ReactElement<DocumentProps>);
  return norm((await extractText(new Uint8Array(buffer), { mergePages: true })).text);
}

describe("a written answer's sources in the PDF and the board brief", () => {
  it("lists the fee record and the filing behind its supported sentences, and nothing for reading or left-out sentences", async () => {
    const answer = writtenAnswer(bound);
    const sources = writtenAnswerSources(answer);
    expect(sources).toEqual([
      { id: "fee:published:9", figure: "Overdraft (OD)", institution: "Research Bank", value: 37, unit: "usd", complete: true,
        detail: "Published fee catalog · record fee:published:9 · date not recorded" },
      { id: filingId, figure: "Service charge income", institution: "Research Bank", value: 1_100_000, unit: "usd", complete: true,
        detail: `FDIC call report · record ${filingId} · reporting date Jun 30, 2026 · quarter` },
    ]);

    // The PDF's record section, from the same lines.
    const section = evidenceRecordSection(answer);
    expect(section?.rows.map((row) => [row.label, row.value])).toEqual([["Overdraft (OD) · Research Bank", "$37"], ["Service charge income · Research Bank", "$1,100,000"]]);
    expect(section?.notes).toContain(WRITTEN_SOURCES_NOTE);
    // A URL or document the claims do not hold is never printed.
    expect(JSON.stringify(section)).not.toContain("example.test");
    expect(JSON.stringify(section)).not.toMatch(/document 77/);

    const text = await pdfText(answer);
    expect(text).toContain("Evidence Record");
    expect(text).toContain("record fee:published:9");
    expect(text).toContain(`FDIC call report · record ${filingId}`);
    expect(text).toContain(WRITTEN_SOURCES_NOTE);

    // The board brief's records exhibit, and its sources entry points to it.
    const brief = boardBriefFromAnalysis(answer, "a1", edits);
    const records = brief.exhibits?.find((e) => e.id === "evidence_records");
    expect(records?.rows).toEqual([
      ["Overdraft (OD), Research Bank", "$37", "Published fee catalog · record fee:published:9 · date not recorded", "Matches the saved record"],
      ["Service charge income, Research Bank", "$1,100,000", `FDIC call report · record ${filingId} · reporting date Jun 30, 2026 · quarter`, "Matches the saved record"],
    ]);
    expect(records?.note).toBe(WRITTEN_SOURCES_NOTE);
    expect(brief.sources?.[0].detail).toBe("Each figure's source is in the records table above.");
    expect(brief.recommendation).not.toContain("saved without a source for each individual figure");
    expect(JSON.stringify(brief.exhibits)).not.toContain(reading);
    expect(JSON.stringify(brief.exhibits)).not.toContain("stop payment");
  }, 20000);

  it("gives a reading-only answer no source line", async () => {
    const answer = writtenAnswer(readingOnly);
    expect(writtenAnswerSources(answer)).toEqual([]);
    expect(evidenceRecordSection(answer)).toBeNull();
    expect(await pdfText(answer)).not.toContain("Evidence Record");
    const brief = boardBriefFromAnalysis(answer, "a1", edits);
    expect(brief.exhibits?.some((e) => e.id === "evidence_records")).toBe(false);
    expect(brief.sources?.[0].detail).toContain("were not saved with this answer");
  }, 20000);

  it("gives an answer that failed the evidence gate no source line, a browser fallback save among them", async () => {
    const failed = writtenAnswer(bound, { answerEvidence: { passed: false, problems: ["Untraced figure"] } });
    const fallback = fallbackSaveSections(writtenAnswer(bound));
    for (const answer of [failed, fallback]) {
      expect(writtenAnswerSources(answer)).toEqual([]);
      expect(evidenceRecordSection(answer)).toBeNull();
      const brief = boardBriefFromAnalysis(answer, "a1", edits);
      expect(brief.exhibits?.some((e) => e.id === "evidence_records")).toBe(false);
    }
    expect(await pdfText(failed)).not.toContain("Evidence Record");
  }, 20000);

  it("leaves the storyline path's saved record as it was", () => {
    const research = overdraftResearch();
    const frozen = storylineAnalysis(buildFeeAnswer(research).storyline!, "test", buildFeeResearchEvidence(research), identityContext);
    expect(writtenAnswerSources(frozen)).toEqual([]);
    const section = evidenceRecordSection(frozen);
    expect(section?.rows.map((row) => row.id)).toEqual([...frozen.factEvidence!.facts, ...frozen.factEvidence!.derivations].map((f) => f.id));
    expect(section?.notes).not.toContain(WRITTEN_SOURCES_NOTE);
    expect(section?.notes).toContain("Each figure matches the bank document Hamilton had stored at the time. It was not re-checked against the bank's current schedule, and the sentences around the figures were not checked one by one.");
    const records = boardBriefFromAnalysis(frozen, "a1", edits).exhibits?.find((e) => e.id === "evidence_records");
    expect(records).toEqual(evidenceRecordsExhibit(frozen));
  });
});
