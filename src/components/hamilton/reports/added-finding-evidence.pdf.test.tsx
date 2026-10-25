/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { positionFinding, savedAnswerEvidence, testFinding } from "@/lib/hamilton/report-finding-evidence";
import { PdfDocument } from "./PdfDocument";
import { ReportOutput } from "./ReportOutput";

const peer = { fee_category: "nsf", median_amount: 30, p25_amount: 25, p75_amount: 34, institution_count: 12, maturity_tier: "strong" as const, last_updated: "2026-10-12" };
const base = { feeCategory: "nsf", institutionName: "Lakeshore Test Credit Union", peerLabel: "Similar credit unions", readAt: "2026-10-25T14:00:00.000Z", peer };
const position = positionFinding({ ...base, own: { price: 27, low: 27, high: 27, fees: [{ name: "NSF", amount: 27 }] } });
const tested = testFinding({ ...base, own: { price: 27, low: 27, high: 27, fees: [{ name: "NSF", amount: 27 }] }, proposedFee: 32 });
const ask = savedAnswerEvidence({
  title: "Overdraft at Lakeshore", confidence: { level: "medium", basis: ["Published schedule"] },
  hamiltonView: "Lakeshore charges $32.", whatThisMeans: "", whyItMatters: [], exploreFurther: [],
  evidence: { metrics: [{ label: "Overdraft fee", value: "$32" }] },
}, "2026-10-20T09:00:00.000Z");

const report: ReportSummaryResponse = {
  title: "Lakeshore Test Credit Union: board brief",
  boardBrief: { sourceAnalysisId: "a", teamNote: "", includeEvidence: true },
  answer: { headline: "Lakeshore charges $27 for an NSF item.", decisions: [] },
  executiveSummary: ["Lakeshore charges $27 for an NSF item."],
  snapshot: [], strategicRationale: "", tradeoffs: [], recommendation: "Hamilton recorded no limits for this answer.",
  implementationNotes: ["Built from a saved Hamilton answer."],
  addedFindings: [
    { source: "Position", title: position.title, detail: position.detail, evidence: position.evidence },
    { source: "Test", title: tested.title, detail: tested.detail, evidence: tested.evidence },
    { source: "Ask", title: "Overdraft at Lakeshore", detail: "Lakeshore charges $32.", evidence: ask },
  ],
  exportControls: { pdfEnabled: true, shareEnabled: false },
};

const squash = (text: string) => text.replace(/\s+/g, " ");

describe("an added finding's chart, sources, method, dates and limits reach the report (#1899)", () => {
  it("prints each one in the PDF, with the figures the server read", async () => {
    const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
    const text = squash((await extractText(new Uint8Array(buffer), { mergePages: true })).text);
    expect(text).toContain("NSF / Returned Item: $27.00 against a peer group median of $30.00");
    expect(text).toContain("peer group median $30.00 across 12 institutions; middle half $25.00 to $34.00.");
    expect(text).toContain("Tested fee $32.00; current fee $27.00");
    expect(text).toContain("Sources: Bank Fee Index published fee catalog");
    expect(text).toContain("Dates: Read from published fee schedules on Oct 25, 2026");
    expect(text).toContain("Limits: The tested fee is a figure you entered in Test.");
    expect(text).toContain("Overdraft fee: $32");
    expect(text).toContain("Answer saved Oct 20, 2026.");
    expect(text).not.toMatch(/—/);
  }, 30000);

  it("shows the same fields on screen in site tokens", () => {
    const html = renderToStaticMarkup(createElement(ReportOutput, { report, reportType: "board_brief" }));
    expect(html).toContain("Method");
    expect(html).toContain("Bank Fee Index published fee catalog");
    expect(html).toContain("Dot: Lakeshore Test Credit Union&#x27;s fee.");
    expect(html).toContain("Ring: current fee.");
    const findings = html.slice(html.indexOf("Findings you added"), html.indexOf("What is behind it"));
    expect(findings).toContain("Method: </span>");
    expect(findings).not.toContain("--hamilton-");
  });
});
