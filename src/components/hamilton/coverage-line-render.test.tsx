/** @vitest-environment node */
/**
 * #1891 (V5 §4A): the coverage and freshness line on the command center, the brief on screen and
 * the brief's PDF cover, from one set of words. Synthetic data only; no claim about a real institution.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { coverageWords, type InstitutionCoverage } from "@/lib/hamilton/coverage-line";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { CoverageLine } from "./CoverageLine";
import { PdfDocument } from "./reports/PdfDocument";
import { ReportOutput } from "./reports/ReportOutput";

const coverage: InstitutionCoverage = {
  institutionId: 9701940,
  institutionName: "Harbor Ridge Test Bank",
  readAt: "2026-10-27T15:00:00Z",
  fees: 41,
  categories: ["monthly_maintenance", "overdraft", "nsf", "atm_non_network", "card_foreign_txn", "wire_domestic_outgoing", "stop_payment", "wire_intl_outgoing", "wire_domestic_incoming", "od_protection_transfer", "card_replacement", "deposited_item_return"],
  documents: [{ id: 5001, statedDate: "2026-08-01", statedBasis: "effective_statement" }],
  lastVerifiedAt: "2026-10-24T01:20:46Z",
  peer: { label: "Texas banks with $1B to $10B in assets", institutions: 38 },
};

const AGENT_NAMES = /\b(Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie|Deming)\b|Hamilton Pro/;

const brief = {
  title: "Harbor Ridge Test Bank: overdraft position",
  identityContext: { version: 1, researchInstitutionId: 9701940, researchInstitutionName: "Harbor Ridge Test Bank", accountInstitutionId: null, accountStatus: "unlinked", peerBaselineLabel: "Texas banks with $1B to $10B in assets" },
  boardBrief: { sourceAnalysisId: "analysis-1", teamNote: "", includeEvidence: false },
  coverage: JSON.parse(JSON.stringify(coverage)),
  answer: { headline: "Its overdraft fee sits within the middle half of peer prices.", decisions: [] },
  exhibits: [],
  watchlist: [],
  sources: [{ label: "Published fee schedules", detail: "Synthetic fixture", url: null }],
  executiveSummary: [],
  snapshot: [],
  strategicRationale: "Synthetic rationale.",
  tradeoffs: [],
  recommendation: "Synthetic limits.",
  implementationNotes: [],
  exportControls: { pdfEnabled: true, shareEnabled: false },
} as unknown as ReportSummaryResponse;

async function pdfText(element: ReactElement) {
  const buffer = await renderToBuffer(element as unknown as ReactElement<DocumentProps>);
  return (await extractText(new Uint8Array(buffer), { mergePages: true })).text.replace(/\s+/g, " ");
}

describe("CoverageLine (#1891)", () => {
  it("prints the words and their source, with no em dash or agent name", () => {
    const html = renderToStaticMarkup(<CoverageLine coverage={coverage} />);
    for (const sentence of coverageWords(coverage).sentences) expect(html).toContain(sentence.replace(/'/g, "&#x27;"));
    expect(html).toContain("Source: Bank Fee Index live published fees");
    expect(html).toContain('aria-label="Coverage and freshness"');
    expect(html).not.toContain("—");
    expect(html).not.toMatch(AGENT_NAMES);
  });

  it("says when the read failed instead of showing nothing", () => {
    expect(renderToStaticMarkup(<CoverageLine coverage={null} />)).toContain("Coverage for this institution could not be read just now.");
  });
});

describe("board brief carries its saved coverage (#1891)", () => {
  it("on screen, under the identity lines, sizing the baseline the cover already names", () => {
    const html = renderToStaticMarkup(<ReportOutput report={brief} reportType="board_brief" />);
    expect(html).toContain("Peer baseline: Texas banks with $1B to $10B in assets");
    expect(html).toContain("The peer baseline has 38 institutions with published fees on file.");
    expect(html).not.toContain("Peer set: Texas banks");
  });

  it("on the PDF cover, before the answer", async () => {
    const text = await pdfText(createElement(PdfDocument, { report: brief, reportType: "board_brief" }));
    const at = text.indexOf("Coverage. 41 published fees on file across 12 fee types, read from its fee schedule dated Aug 1, 2026.");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(text.indexOf("Its overdraft fee sits within"));
    expect(text).toContain("Last verified against its schedule Oct 24, 2026.");
    expect(text).toContain("The peer baseline has 38 institutions with published fees on file.");
    expect(text).toContain("No published fee was found for 3 of the 15 headline fee types");
    expect(text).toContain("Source: Bank Fee Index live published fees and the fee schedules they were read from, read Oct 27, 2026.");
  }, 20000);

  it("a brief saved before the line prints no coverage", async () => {
    const { coverage: _unused, ...old } = brief;
    void _unused;
    expect(await pdfText(createElement(PdfDocument, { report: old, reportType: "board_brief" }))).not.toContain("Coverage.");
    expect(renderToStaticMarkup(<ReportOutput report={old} reportType="board_brief" />)).not.toContain("Coverage and freshness");
  }, 20000);
});
