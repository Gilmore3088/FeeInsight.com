/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import type { AnalyzeResponse, ReportSummaryResponse } from "@/lib/hamilton/types";
import { AnalysisPdfDocument } from "./AnalysisPdfDocument";
import { PdfDocument } from "./PdfDocument";

const identityContext = {
  version: 1 as const,
  researchInstitutionId: 2945,
  accountInstitutionId: 101,
  accountStatus: "identified" as const,
  researchInstitutionName: "Research Bank A",
  accountInstitutionName: "Space Coast CU",
  researchSelectionSource: "Original URL selection",
  peerSetId: 42,
  peerBaselineLabel: "Original A cohort",
  peerBaselineSource: "saved-peer-set",
};
const analysis: AnalyzeResponse = {
  identityContext,
  title: "Research Bank A wire position",
  confidence: { level: "medium", basis: ["Published schedule"] },
  hamiltonView: "Research Bank A charges $35 for a wire.",
  whatThisMeans: "The original peer median is $30.",
  whyItMatters: ["Compare the original schedules."],
  evidence: { metrics: [{ label: "Research Bank A wire", value: "$35" }] },
  exploreFurther: ["Review the published source."],
};
const report: ReportSummaryResponse = {
  identityContext,
  title: "Research Bank A fee report",
  answer: { headline: "Research Bank A wire position", decisions: [] },
  executiveSummary: [analysis.hamiltonView],
  snapshot: [], strategicRationale: analysis.whatThisMeans, tradeoffs: [],
  recommendation: "Management can review the original evidence.",
  implementationNotes: ["Original source selection."],
  addedFindings: [{ source: "Ask", title: analysis.title, detail: analysis.hamiltonView, identityContext }],
  exportControls: { pdfEnabled: true, shareEnabled: false },
};

async function renderedText(element: ReactElement) {
  const buffer = await renderToBuffer(element as unknown as ReactElement<DocumentProps>);
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return result.text.replace(/\s+/g, " ");
}

describe("actual saved artifact PDF identity", () => {
  it("renders frozen analysis A, authenticated account and original cohort", async () => {
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis, analysisFocus: "Fees" }));
    expect(text).toContain("Research institution: Research Bank A");
    expect(text).toContain("Account institution: Space Coast CU");
    expect(text).toContain("Peer baseline: Original A cohort (saved-peer-set)");
    expect(text).not.toContain("Current Bank B");
  }, 20000);

  it("renders the same original identity on a saved report and its added answer", async () => {
    const text = await renderedText(createElement(PdfDocument, { report, reportType: "competitive_positioning" }));
    expect(text).toContain("Research institution: Research Bank A");
    expect(text).toContain("Account institution: Space Coast CU");
    expect(text).toContain("Peer baseline: Original A cohort");
    expect(text.match(/Research institution: Research Bank A/g)).toHaveLength(2);
  }, 20000);

  it("labels a legacy artifact without recorded account or peer context honestly", async () => {
    const { identityContext: unused, ...legacy } = analysis;
    void unused;
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis: legacy, analysisFocus: "Fees" }));
    expect(text).toContain("Historical institution, account and peer context: Not recorded");
    expect(text).not.toContain("Account institution: Space Coast CU");
  }, 20000);
});
