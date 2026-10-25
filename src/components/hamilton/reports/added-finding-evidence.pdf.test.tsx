/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { positionFinding, savedAnswerEvidence, testFinding } from "@/lib/hamilton/report-finding-evidence";
import { reportAddedFindings } from "@/lib/hamilton/report-finding-claims";
import { SAVED_CLAIMS_VERSION } from "@/lib/hamilton/saved-claims";
import { NARRATIVE_BINDING_VERSION } from "@/lib/hamilton/narrative-bound";
import { PdfDocument } from "./PdfDocument";
import { ReportOutput } from "./ReportOutput";

const peer = { fee_category: "nsf", median_amount: 30, p25_amount: 25, p75_amount: 34, institution_count: 12, maturity_tier: "strong" as const, last_updated: "2026-10-12" };
const base = { feeCategory: "nsf", institutionName: "Lakeshore Test Credit Union", peerLabel: "Similar credit unions", readAt: "2026-10-25T14:00:00.000Z", peer };
const position = positionFinding({ ...base, own: { price: 27, low: 27, high: 27, fees: [{ name: "NSF", amount: 27 }] } });
const tested = testFinding({ ...base, own: { price: 27, low: 27, high: 27, fees: [{ name: "NSF", amount: 27 }] }, proposedFee: 32 });
// Synthetic saved answer: one supported sentence citing one fee fact ($35). Its parsed metrics hold
// that traced $35 and an untraced $41 the model wrote that no record supports.
const askSentence = "Lakeshore charges $35 for an overdraft.";
const factId = "fee:published:9701001";
const ask = savedAnswerEvidence({
  title: "Overdraft at Lakeshore", confidence: { level: "medium", basis: ["Published schedule"] },
  hamiltonView: askSentence, whatThisMeans: "", whyItMatters: [], exploreFurther: [],
  evidence: { metrics: [{ label: "Overdraft fee", value: "$35" }, { label: "Peer overdraft median", value: "$41" }] },
}, "2026-10-20T09:00:00.000Z");
const [askFinding] = reportAddedFindings([{
  id: "ask-1", source: "Ask", title: "Overdraft at Lakeshore", detail: askSentence, institutionId: "9701001", evidence: ask,
  savedClaims: {
    version: SAVED_CLAIMS_VERSION, bindingVersion: NARRATIVE_BINDING_VERSION,
    claims: [{ text: askSentence, outcome: "supported", factIds: [factId] }],
    facts: [{ id: factId, kind: "observed", value: 35, unit: "usd", institutionId: 9701001, feeCategory: "overdraft", metric: null, reportingDate: null, periodBasis: null, asOf: "2026-10-05" }],
    factsTruncated: false, corrections: [],
  },
}], false);
const askSource = askFinding.sources?.[0];

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
    askFinding,
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
    // Figures as saved: the $35 its record supports is printed; the model's untraced $41 is not.
    expect(text).toContain("Overdraft fee: $35");
    expect(text).not.toContain("$41");
    expect(text).not.toContain("Peer overdraft median");
    expect(text).toContain("Answer saved Oct 20, 2026.");
    expect(text).not.toMatch(/—/);
    // The Test chart draws the current fee as a ring; only that chart has one.
    expect(text.match(/Current fee/g)).toHaveLength(1);
    // One Sources block per finding: the saved answer's record lines replace the generic line, printed once.
    expect(askSource).toBeDefined();
    expect(text.split(squash(`${askSource!.label}: ${askSource!.value}`)).length - 1).toBe(1);
    expect(text).not.toContain("Records behind this finding");
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
    expect(findings.split(askSource!.note.replace(/'/g, "&#x27;")).length - 1).toBe(1);
    expect(findings).toContain("Overdraft fee: $35");
    expect(findings).not.toContain("$41");
    expect(findings).not.toContain("Records behind this finding");
  });
});
