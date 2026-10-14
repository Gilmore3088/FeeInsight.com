/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import type { AnalyzeResponse, ReportSummaryResponse } from "@/lib/hamilton/types";
import type { AnswerBrief } from "@/lib/hamilton/answer-brief";
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
  it("names the frozen research institution on public filing charts rather than claiming account ownership", async () => {
    const brief: AnswerBrief = {
      positions: [{ feeCategory: "wire_transfer", displayName: "Wire transfer", current: 35, peerMedian: 30, peerCount: 6, peerLabel: "Original A cohort", direction: "higher" }],
      bands: { wire_transfer: { p25: 20, median: 30, p75: 40 } },
      competitors: [{ feeCategory: "wire_transfer", displayName: "Wire transfer", own: 35, competitors: [{ name: "Your Community Bank", amount: 25 }], place: "Original local market" }],
      uncompared: 0,
      financials: { source: "fdic", label: "Service charges on deposit accounts", quarters: [{ quarterEnd: "2026-06-30", amount: 400000 }, { quarterEnd: "2026-03-31", amount: 350000 }], latestTtm: null, priorTtm: null, yoyPct: null, quarterEnd: "2026-06-30", sourceRef: { label: "FDIC public call report" }, peerMedian: null },
      income: null,
      context: { economy: null, localIncome: null, market: { places: ["Original county"], sodYear: 2026, institutions: 2, hhi: 5000, top3Share: 100, shares: [{ name: "Research Bank A", share: 50, isSubject: true }, { name: "Your Community Bank", share: 50, isSubject: false }], subjectInSod: true, commentary: [] } },
      studies: { items: [], dependence: { groupLabel: "banks", series: [{ year: 2025, median: 4, p25: 2, p75: 5 }, { year: 2026, median: 4.5, p25: 3, p75: 6 }], own: [{ year: 2025, value: 4 }, { year: 2026, value: 5 }], peerGroup: "Original A cohort", peerMedian: 4.5, asOf: "2026-06-30" } },
    };
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis, analysisFocus: "Fees", institutionName: "Current Bank B", brief }));
    expect(text).toContain("Research Bank A fee");
    expect(text).toContain("Research Bank A service charges by quarter");
    expect(text).toContain("Research Bank A local market");
    expect(text).toContain("Research Bank A in Hamilton's studies");
    expect(text).toContain("FDIC public call report");
    expect(text).toContain("Your Community Bank");
    expect(text).not.toContain("Your fee");
    expect(text).not.toContain("Your service charges");
    expect(text).not.toContain("Your local market");
    expect(text).not.toContain("Where you sit");
    expect(text).not.toContain("Current Bank B");
  }, 20000);

  it("labels a saved report's snapshot as research institution evidence", async () => {
    const legacyReport = { ...report, answer: undefined, snapshot: [{ label: "Wire fee", current: "$35", proposed: "$30 peer median" }] };
    const text = await renderedText(createElement(PdfDocument, { report: legacyReport, reportType: "competitive_positioning" }));
    expect(text).toContain("Snapshot: research institution against its benchmark");
    expect(text).not.toContain("Snapshot: your figure");
  }, 20000);

});
