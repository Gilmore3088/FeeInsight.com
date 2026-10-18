/** @vitest-environment node */
/**
 * #1924 step 4: Hamilton's report PDFs print the stamp saved with the report, in the evidence
 * appendix, as prose. Synthetic data only; no claim about a real institution.
 */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { makeStamp, type DatasetStampInput } from "@/lib/dataset-stamp";
import { readStampedFigures, type StampedFigure } from "@/lib/dataset-note";
import { boardBriefFromAnalysis, SAVED_DATASET_SOURCE_LABEL } from "@/lib/hamilton/board-brief";
import { savedEvidenceAppendix } from "@/lib/hamilton/evidence-export";
import type { EvidenceBoundAnalyzeResponse } from "@/lib/hamilton/evidence-contract";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { AnalysisPdfDocument } from "./AnalysisPdfDocument";
import { PdfDocument } from "./PdfDocument";

const SOURCED = { key: "sourced", label: "Only fees traced to a stored copy of the institution's own fee schedule" };
const LEFT_OUT = { key: "exclude:institution:1", label: "The institution being compared left out" };
const read: DatasetStampInput = {
  dataset: "published_fee_catalog",
  mode: "live",
  readAt: "2026-10-18T14:10:00Z",
  runId: null,
  newestRecordAt: "2026-10-01T00:00:00Z",
  methodVersion: 13,
  counting: "counted_once",
  filters: [SOURCED, LEFT_OUT],
};
const peerStamp = makeStamp({ ...read, filters: [SOURCED, { key: "peers:state:TN", label: "Institutions in Tennessee" }, LEFT_OUT] });
const nationalStamp = makeStamp(read);
const stamps: StampedFigure[] = [
  { label: "your peer group", stamp: peerStamp },
  { label: "National", stamp: nationalStamp },
];

const AGENT_NAMES = /\b(Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie|Deming)\b|Hamilton Pro/;

const answer: EvidenceBoundAnalyzeResponse = {
  title: "Synthetic overdraft position",
  confidence: { level: "medium", basis: ["Published schedule"] },
  hamiltonView: "The synthetic bank charges $30 for a paid overdraft item.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [{ label: "Peer median", value: "$29" }] },
  exploreFurther: [],
  factEvidence: {
    version: 1,
    generatedAt: "2026-10-18T14:11:00Z",
    facts: [{
      id: "fee:published:10001", kind: "observed",
      scope: { institutionId: 8109, feeCategory: "overdraft", product: null, reportingDate: null, effectiveDate: null, accountApplicability: "consumer" },
      value: 30, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
      source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: 10001, sourceDocumentIds: [5001], urls: ["https://fixture.invalid/fee-schedule"], asOf: "2026-10-01", verificationEventId: null },
    }],
    derivations: [],
    limitations: ["Synthetic record only."],
  },
};
// What the database hands back: the saved JSON, parsed.
const stamped = JSON.parse(JSON.stringify({ ...answer, datasetStamps: stamps })) as EvidenceBoundAnalyzeResponse;

const report: ReportSummaryResponse = {
  title: "Synthetic competitive fee position",
  datasetStamps: [{ label: "Tennessee peers", stamp: peerStamp }],
  answer: { headline: "Your overdraft fee sits $1 above the synthetic peer median.", decisions: [] },
  exhibits: [{ id: "peer_range", title: "Peers charge $25 to $35", subtitle: "Synthetic peers", columns: ["Fee", "Median"], rows: [["Overdraft", "$29"]], note: null }],
  watchlist: [],
  sources: [{ label: "Published fee schedules", detail: "Synthetic fixture", url: null }],
  executiveSummary: ["Your overdraft fee sits $1 above the synthetic peer median."],
  snapshot: [],
  strategicRationale: "Synthetic rationale.",
  tradeoffs: [],
  recommendation: "Synthetic trade-off.",
  implementationNotes: [],
  exportControls: { pdfEnabled: true, shareEnabled: false },
} as ReportSummaryResponse;

async function renderedText(element: ReactElement) {
  const buffer = await renderToBuffer(element as unknown as ReactElement<DocumentProps>);
  const result = await extractText(new Uint8Array(buffer), { mergePages: true });
  return result.text.replace(/\s+/g, " ");
}

/** The printed passage alone: from its heading to the end of its reference line. */
function passage(text: string): string {
  const start = text.indexOf("About these figures");
  const end = text.indexOf(".", text.indexOf("Data reference (for support)", start));
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const SUMMARY = "Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.";

describe("analysis PDF prints the saved stamp (#1924 step 4)", () => {
  it("sets the appendix's dataset words as an About these figures passage after the evidence record", async () => {
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis: stamped, analysisFocus: "Fees" }));
    expect(savedEvidenceAppendix(stamped).dataset?.summary).toBe(SUMMARY);
    expect(text).toContain("About these figures");
    expect(text).toContain(SUMMARY);
    expect(text).toContain("Who is counted for your peer group: institutions in Tennessee, with the institution being compared left out, under the index's standard rules (the full list is in the saved answer in Hamilton).");
    expect(text).toContain("How your peer group and National differ: only your peer group is limited to institutions in Tennessee.");
    expect(text).toContain(`Data reference (for support): ${peerStamp.id}, ${nationalStamp.id}.`);
    expect(text.indexOf("About these figures")).toBeGreaterThan(text.indexOf("Evidence Record"));
    expect(passage(text)).not.toContain("\u2014");
    expect(passage(text)).not.toMatch(AGENT_NAMES);
  }, 20000);

  it("prints an answer saved without stamps as before, with no passage and no made-up stamp", async () => {
    const text = await renderedText(createElement(AnalysisPdfDocument, { analysis: answer, analysisFocus: "Fees" }));
    expect(text).toContain("Evidence Record");
    expect(text).not.toContain("About these figures");
    expect(text).not.toContain("Data reference");
    const damaged = { ...answer, datasetStamps: [{ label: "your peer group", stamp: { ...peerStamp, readAt: "not a time" } }] } as unknown as EvidenceBoundAnalyzeResponse;
    expect(await renderedText(createElement(AnalysisPdfDocument, { analysis: damaged, analysisFocus: "Fees" }))).not.toContain("About these figures");
  }, 20000);
});

describe("report PDF prints the saved stamp (#1924 step 4)", () => {
  it("puts the passage in the appendix, after the evidence and before the sources, never in the brief", async () => {
    const text = await renderedText(createElement(PdfDocument, { report, reportType: "competitive_snapshot" }));
    const at = text.indexOf("About these figures");
    expect(at).toBeGreaterThan(text.indexOf("The Evidence"));
    expect(at).toBeGreaterThan(text.indexOf("Your overdraft fee sits $1 above"));
    expect(at).toBeLessThan(text.indexOf("Method and Sources"));
    expect(text).toContain(SUMMARY);
    expect(text).toContain("Who is counted: institutions in Tennessee, with the institution being compared left out, under the index's standard rules (open the report in Hamilton for the full list).");
    expect(text).toContain(`Data reference (for support): ${peerStamp.id}.`);
    expect(passage(text)).not.toContain("\u2014");
    expect(passage(text)).not.toMatch(AGENT_NAMES);
  }, 20000);

  it("prints a report saved without stamps as before", async () => {
    const { datasetStamps: _unused, ...old } = report;
    void _unused;
    const text = await renderedText(createElement(PdfDocument, { report: old, reportType: "competitive_snapshot" }));
    expect(text).not.toContain("About these figures");
    expect(text).not.toContain("Data reference");
    expect(text).toContain("Published fee schedules · Synthetic fixture");
  }, 20000);

  it("prints a stamped report in the older layout too, at its end", async () => {
    const { answer: _unused, ...legacy } = report;
    void _unused;
    const text = await renderedText(createElement(PdfDocument, { report: legacy, reportType: "competitive_snapshot" }));
    expect(text.indexOf("About these figures")).toBeGreaterThan(text.indexOf("Synthetic trade-off."));
    expect(text).toContain(`Data reference (for support): ${peerStamp.id}.`);
  }, 20000);
});

describe("board brief PDF prints the saved stamp once (#1924 step 4)", () => {
  it("sets the brief's stamp source as the passage, so the stamp prints once, with the screen's words", async () => {
    const brief = boardBriefFromAnalysis(stamped, "analysis-1", { title: "Board review", teamNote: "", includeEvidence: true });
    const source = brief.sources?.find((s) => s.label === SAVED_DATASET_SOURCE_LABEL);
    expect(source).toBeDefined();
    const text = await renderedText(createElement(PdfDocument, { report: brief, reportType: "board_brief" }));
    expect(text).toContain("About these figures");
    expect(text).toContain(source!.detail);
    expect(text).not.toContain(SAVED_DATASET_SOURCE_LABEL);
    // Only the dataset entry leaves the sources; the brief's own source stays.
    for (const other of brief.sources!.filter((s) => s.label !== SAVED_DATASET_SOURCE_LABEL)) expect(text).toContain(other.label);
    expect(count(text, "Data reference (for support)")).toBe(1);
    expect(count(text, SUMMARY)).toBe(1);
    expect(readStampedFigures(brief.datasetStamps)).toEqual(stamps);
  }, 20000);

  it("prints a brief made from an answer saved without stamps as before", async () => {
    const brief = boardBriefFromAnalysis(answer, "analysis-old", { title: "Board review", teamNote: "", includeEvidence: true });
    const text = await renderedText(createElement(PdfDocument, { report: brief, reportType: "board_brief" }));
    expect(text).not.toContain("About these figures");
    expect(text).not.toContain("Data reference");
    expect(text).toContain("Method and Sources");
  }, 20000);
});
