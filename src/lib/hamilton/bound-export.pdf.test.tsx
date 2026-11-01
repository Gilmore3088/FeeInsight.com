/** @vitest-environment node */
/**
 * Export parity for a bound written answer (#981 H06-T08, #980 H05-T07): the analysis PDF, the
 * board brief screen and its PDF print what the Analyze screen shows. A left-out sentence never
 * prints; Hamilton's reading prints only under its label, apart from the findings.
 */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { AnalysisPdfDocument } from "@/components/hamilton/reports/AnalysisPdfDocument";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { ReportOutput } from "@/components/hamilton/reports/ReportOutput";
import { boardBriefFromAnalysis, editBoardBrief } from "./board-brief";
import { bindNarrative, INTERPRETATION_LABEL, INTERPRETATION_LIMITATION, NARRATIVE_BINDING_VERSION, type NarrativeBinding } from "./narrative-bound";
import { applyNarrativeBinding, exportedAnswer, READING_ONLY_LEAD } from "./written-answer-binding";
import { filingFactId } from "./claim-evidence";
import { HAMILTON_EVIDENCE_CONTRACT_VERSION, type HamiltonEvidenceBundle, type HamiltonEvidenceFact } from "./evidence-contract";
import { savedAnswerFinding } from "./report-saved-finding";
import { savedClaimsFrom } from "./saved-claims";
import type { AnalyzeResponse, ReportSummaryResponse } from "./types";

// Synthetic answer; not a claim about any real institution.
const supported = "Research CU charges $35 for an overdraft.";
const reading = "Peers sit near $30.";
const left = "Research CU charges $10 for an NSF item.";
const binding: NarrativeBinding = {
  version: NARRATIVE_BINDING_VERSION,
  supported: [{ text: supported, factIds: ["fee:published:9"] }, { text: "That is the highest in its group.", factIds: [] }],
  interpretation: [reading],
  omitted: [{ text: left, reason: "wrong_institution" }],
  limitations: [INTERPRETATION_LIMITATION],
};
const analysis: AnalyzeResponse = {
  title: "Overdraft at Research CU", confidence: { level: "medium", basis: ["Historical published schedules"] },
  // As saved: the left-out sentence is already gone; the reading is still inline.
  hamiltonView: `${supported} ${reading}`,
  whatThisMeans: `That is the highest in its group. ${left}`,
  whyItMatters: [],
  evidence: { metrics: [] }, exploreFurther: [],
  narrativeBinding: binding,
};
const norm = (text: string) => text.replace(/\s+/g, " ");

describe("bound answer export parity", () => {
  it("matches the screen's sections: supported text inline, reading apart, left-out sentence gone", () => {
    const shown = exportedAnswer(analysis);
    const screen = applyNarrativeBinding(analysis, binding);
    expect(shown).toEqual({ hamiltonView: screen.sections.hamiltonView, whatThisMeans: screen.sections.whatThisMeans, whyItMatters: screen.sections.whyItMatters, reading: screen.reading, readingBasis: screen.basis });
    expect(shown.hamiltonView).toBe(supported);
    expect(shown.whatThisMeans).toBe("That is the highest in its group.");
    expect(shown.reading).toEqual([reading]);
    // A view with nothing supported opens on the screen's plain lead.
    expect(exportedAnswer({ ...analysis, hamiltonView: reading }).hamiltonView).toBe(READING_ONLY_LEAD);
    // An answer with no binding prints as saved.
    expect(exportedAnswer({ ...analysis, narrativeBinding: undefined }).hamiltonView).toBe(analysis.hamiltonView);
  });
  it("prints the analysis PDF the same way", async () => {
    const buffer = await renderToBuffer(createElement(AnalysisPdfDocument, { analysis, analysisFocus: "Peer Position" }) as unknown as ReactElement<DocumentProps>);
    const text = norm((await extractText(new Uint8Array(buffer), { mergePages: true })).text);
    expect(text).toContain(INTERPRETATION_LABEL);
    expect(text).toContain(reading);
    expect(text).not.toContain("$10 for an NSF");
    // The reading sits under its label, not in Hamilton's View.
    expect(text.indexOf(reading)).toBeGreaterThan(text.indexOf(INTERPRETATION_LABEL));
    expect(text.split(reading).length - 1).toBe(1);
  }, 20000);
  it("prints the board brief screen and PDF the same way, and keeps the reading through an edit", async () => {
    const brief = editBoardBrief(boardBriefFromAnalysis(analysis, "a1", { title: "", teamNote: "", includeEvidence: true }), { title: "Board review", teamNote: "", includeEvidence: true });
    expect(brief.answer?.headline).toBe(supported);
    expect(brief.strategicRationale).toBe("That is the highest in its group.");
    expect(brief.boardBrief?.reading).toEqual([reading]);
    const html = norm(renderToStaticMarkup(createElement(ReportOutput, { report: brief, reportType: "board_brief" })).replace(/<[^>]+>/g, " ")).replace(/&#x27;/g, "'");
    const buffer = await renderToBuffer(createElement(PdfDocument, { report: brief, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
    const pdf = norm((await extractText(new Uint8Array(buffer), { mergePages: true })).text);
    for (const out of [html, pdf]) {
      // The PDF prints the label in letter-spaced capitals.
      expect(out.replace(/\s/g, "").toLowerCase()).toContain(INTERPRETATION_LABEL.replace(/\s/g, "").toLowerCase());
      expect(out).toContain(reading);
      expect(out.split(reading).length - 1).toBe(1);
      expect(out).not.toContain("$10 for an NSF");
    }
  }, 20000);

  it("prints a saved answer's financial claim in a report's added findings the same on screen and in the PDF (#1077 step 6)", async () => {
    // Synthetic filings for Research CU (2945) and Bank B (9002).
    const filing = (institutionId: number, value: number): HamiltonEvidenceFact => {
      const id = filingFactId("fdic", institutionId, "2026-06-30", "service_charge_income", "standalone_quarter");
      return {
        id, kind: "observed",
        scope: { institutionId, feeCategory: null, product: null, reportingDate: "2026-06-30", effectiveDate: null, accountApplicability: "unknown", metric: "service_charge_income", periodBasis: "standalone_quarter", cohortKey: null },
        value, unit: "usd", currency: "USD", frequency: null, conditions: null, status: "published",
        source: { label: "FDIC call report", table: "institution_financial_records", recordId: null, recordKey: id, evidenceClass: "filing", sourceDocumentIds: [], urls: [], asOf: "2026-06-30", verificationEventId: null },
      };
    };
    const evidence: HamiltonEvidenceBundle = { version: HAMILTON_EVIDENCE_CONTRACT_VERSION, generatedAt: new Date(0).toISOString(), facts: [filing(2945, 1_100_000), filing(9002, 2_300_000)], derivations: [], limitations: [] };
    const financial = "Research CU's service charge income was $1.1 million in Q2 2026.";
    const swapped = "Research CU's service charge income was $2.3 million in Q2 2026.";
    const peerReading = "Peers sit near $30.";
    const financialBinding = bindNarrative({ text: `${financial} ${swapped} ${peerReading}`, evidence, names: new Map([[2945, "Research CU"], [9002, "Bank B"]]), researchInstitutionId: 2945 });
    const saved: AnalyzeResponse = { ...analysis, title: "Income at Research CU", hamiltonView: `${financial} ${peerReading}`, whatThisMeans: "",
      narrativeBinding: financialBinding, claims: savedClaimsFrom(financialBinding, [evidence]) ?? undefined };
    const finding = savedAnswerFinding(saved);
    expect(finding.detail).toBe(financial);
    const report: ReportSummaryResponse = {
      title: "Report", executiveSummary: ["Summary."], snapshot: [], strategicRationale: "Rationale.", tradeoffs: [], recommendation: "Recommendation.",
      implementationNotes: [], exportControls: { pdfEnabled: true, shareEnabled: false },
      // As generateReport builds it with HAMILTON_REPORT_FINDING_READING on.
      addedFindings: [{ source: "Ask", title: saved.title, detail: finding.detail, reading: finding.reading }],
    };
    const html = norm(renderToStaticMarkup(createElement(ReportOutput, { report, reportType: "peer_benchmarking" })).replace(/<[^>]+>/g, " ")).replace(/&#x27;/g, "'");
    const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "peer_benchmarking" }) as unknown as ReactElement<DocumentProps>);
    const pdf = norm((await extractText(new Uint8Array(buffer), { mergePages: true })).text);
    for (const out of [html, pdf]) {
      expect(out).toContain(financial);
      expect(out).not.toContain("$2.3 million");
      expect(out.replace(/\s/g, "").toLowerCase()).toContain(INTERPRETATION_LABEL.replace(/\s/g, "").toLowerCase());
      expect(out.split(peerReading).length - 1).toBe(1);
      // The reading sits under its label, after the supported finding.
      const label = out.replace(/\s/g, "").toLowerCase().indexOf(INTERPRETATION_LABEL.replace(/\s/g, "").toLowerCase());
      expect(out.replace(/\s/g, "").indexOf(peerReading.replace(/\s/g, ""))).toBeGreaterThan(label);
      expect(out.indexOf(peerReading)).toBeGreaterThan(out.indexOf(financial));
    }
    // With the switch off the finding carries no reading, and neither print shows the label for it.
    const off = { ...report, addedFindings: [{ source: "Ask" as const, title: saved.title, detail: finding.detail }] };
    const offHtml = norm(renderToStaticMarkup(createElement(ReportOutput, { report: off, reportType: "peer_benchmarking" })).replace(/<[^>]+>/g, " ")).replace(/&#x27;/g, "'");
    const offPdf = norm((await extractText(new Uint8Array(await renderToBuffer(createElement(PdfDocument, { report: off, reportType: "peer_benchmarking" }) as unknown as ReactElement<DocumentProps>)), { mergePages: true })).text);
    for (const out of [offHtml, offPdf]) {
      expect(out).toContain(financial);
      expect(out).not.toContain(peerReading);
      expect(out).not.toContain("$2.3 million");
    }
  }, 30000);
});
