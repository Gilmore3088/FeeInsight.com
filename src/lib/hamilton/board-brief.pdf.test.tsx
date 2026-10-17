/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { ReportOutput } from "@/components/hamilton/reports/ReportOutput";
import { boardBriefFromAnalysis, editBoardBrief } from "./board-brief";
import {
  CLAIM_BINDING_LIMITATION,
  STORED_SNAPSHOT_LIMITATION,
  deriveDifference,
  normalizeLegacyAnalyzeConfidence,
  type EvidenceBoundAnalyzeResponse,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import type { AnalyzeResponse } from "./types";

it("exports edited board presentation with original values, sources and separate identities", async () => {
  const analysis: AnalyzeResponse = {
    title: "Wire review", confidence: { level: "medium", basis: ["Historical published schedules"] },
    hamiltonView: "Research CU wire fee is $35.", whatThisMeans: "Original peer median is $30.", whyItMatters: [],
    evidence: { metrics: [{ label: "Research wire", value: "$35", note: "Original schedule, 2026-07-01" }] },
    exploreFurther: ["Review waiver terms."],
    identityContext: { version: 1, researchInstitutionId: 2, researchInstitutionName: "Research CU", accountInstitutionId: 1, accountInstitutionName: "Home CU", accountStatus: "identified" },
  };
  const original = boardBriefFromAnalysis(analysis, "original", { title: "Draft", teamNote: "", includeEvidence: true });
  const report = editBoardBrief(original, { title: "Board review", teamNote: "Discuss waivers at the next meeting.", includeEvidence: true });
  const buffer = await renderToBuffer(createElement(PdfDocument, { report, reportType: "board_brief" }) as unknown as ReactElement<DocumentProps>);
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of ["Board review", "Research institution: Research CU", "Account institution: Home CU", "$35", "$30", "2026-07-01", "Team note (user-authored)", "Discuss waivers at the next meeting."]) expect(normalized).toContain(phrase);
  expect(normalized).toContain("were not saved with this answer");
}, 20000);

// Synthetic fee data only; it is not a claim about any real institution.
function publishedFact(id: number, institutionId: number, value: number): HamiltonEvidenceFact {
  return {
    id: `fee:published:${id}`, kind: "observed", value, unit: "usd", currency: "USD", frequency: "per item", conditions: null, status: "published",
    scope: { institutionId, feeCategory: "overdraft", product: "Synthetic checking", reportingDate: "2026-06-30", effectiveDate: null, accountApplicability: "consumer" },
    source: { label: "Published fee catalog", table: "published_fee_catalog", recordId: id, sourceDocumentIds: [id + 1000], urls: [`https://fixture.invalid/${institutionId}`], asOf: "2026-07-01", documentContentHash: `abcdef123456${id}`, retrievedAt: "2026-06-29T10:00:00Z", lastCheckedAt: "2026-07-02T10:00:00Z", location: "page 2", verificationEventId: null },
  };
}

function evidenceAnalysis(): EvidenceBoundAnalyzeResponse {
  const bankA = publishedFact(501, 2, 10);
  const bankB = publishedFact(502, 3, 35);
  const gap = deriveDifference("derived:difference:a-b", bankA, bankB).fact!;
  return {
    title: "Overdraft review", confidence: { level: "medium", basis: [CLAIM_BINDING_LIMITATION] },
    hamiltonView: "Research CU's overdraft fee is $25 lower than Peer Bank's.", whatThisMeans: "", whyItMatters: [],
    evidence: { metrics: [{ label: "Research overdraft", value: "$10" }] }, exploreFurther: [],
    identityContext: { version: 1, researchInstitutionId: 2, researchInstitutionName: "Research CU", accountInstitutionId: 1, accountInstitutionName: "Home CU", accountStatus: "identified" },
    factEvidence: { version: 1, generatedAt: "2026-07-03T00:00:00Z", facts: [bankA, bankB], derivations: [gap], limitations: [STORED_SNAPSHOT_LIMITATION, CLAIM_BINDING_LIMITATION] },
  };
}

const RECORD_PHRASES = [
  "fee:published:501", "fee:published:502", "derived:difference:a-b", "Research CU", "Institution 3",
  "document 1501", "version abcdef123456", "reporting date Jun 30, 2026", "published Jul 1, 2026", "source last checked Jul 2, 2026",
  "-$25", "the first record minus the second, from fee:published:501 and fee:published:502", "Recalculated from the saved records",
  "Overdraft (OD), Synthetic checking, Research CU", "Overdraft (OD), calculated", "record fee:published:501",
  "Matches the stored source", "not re-checked against the bank's current live schedule",
];

async function pdfText(element: unknown): Promise<string> {
  const buffer = await renderToBuffer(element as ReactElement<DocumentProps>);
  return (await extractText(new Uint8Array(buffer), { mergePages: true })).text.replace(/\s+/g, " ");
}

it("keeps fact IDs, source versions, dates, limits and calculations through save, reopen and export (H06-T08)", async () => {
  const analysis = evidenceAnalysis();
  // Save (JSON), reopen and edit (JSON again): the frozen records never change.
  const saved = JSON.parse(JSON.stringify(boardBriefFromAnalysis(JSON.parse(JSON.stringify(analysis)), "a1", { title: "", teamNote: "", includeEvidence: true })));
  const reopened = JSON.parse(JSON.stringify(editBoardBrief(saved, { title: "Board review", teamNote: "Note", includeEvidence: true })));
  expect(reopened.exhibits).toEqual(saved.exhibits);
  expect(reopened.boardBrief.factEvidence).toEqual(analysis.factEvidence);

  const pdf = await pdfText(createElement(PdfDocument, { report: reopened, reportType: "board_brief" }));
  const screen = renderToStaticMarkup(createElement(ReportOutput, { report: reopened, reportType: "board_brief" })).replace(/&quot;/g, "\"").replace(/&#x27;/g, "'");
  // The Analyze PDF prints its own Evidence Record (#1636); the board brief prints this table.
  for (const output of [pdf, screen]) {
    for (const phrase of RECORD_PHRASES) expect(output).toContain(phrase);
    expect(output).not.toMatch(/verified against the (current )?live/i);
  }
}, 20000);

it("exports a legacy high answer with its limit and no stored-source claim (H06-AC4)", async () => {
  const legacy = normalizeLegacyAnalyzeConfidence({
    title: "Legacy wire review", confidence: { level: "high", basis: ["Figures matched"] }, hamiltonView: "Research CU wire fee is $35.",
    whatThisMeans: "", whyItMatters: [], evidence: { metrics: [{ label: "Wire", value: "$35" }] }, exploreFurther: [],
  });
  expect(legacy.confidence.level).toBe("medium");
  const report = boardBriefFromAnalysis(legacy, "legacy", { title: "", teamNote: "", includeEvidence: true });
  for (const pdf of [await pdfText(createElement(PdfDocument, { report, reportType: "board_brief" }))]) {
    expect(pdf).toContain("saved before Hamilton kept a source for each figure");
    expect(pdf).not.toContain("Matches the stored source");
    expect(pdf).not.toContain("Records behind the saved answer");
  }
}, 20000);

it("prints an incomplete saved record as incomplete, never as matching its source", async () => {
  const analysis = evidenceAnalysis();
  const [first, second] = analysis.factEvidence!.facts;
  analysis.factEvidence!.facts = [{ ...first, source: { ...first.source, sourceDocumentIds: [], documentContentHash: null } }, second];
  const report = boardBriefFromAnalysis(analysis, "a1", { title: "", teamNote: "", includeEvidence: true });
  const pdf = await pdfText(createElement(PdfDocument, { report, reportType: "board_brief" }));
  expect(pdf).toContain("document not recorded · version not recorded");
  expect(pdf).toContain("Incomplete record: missing source document id");
  expect(pdf).toContain("Cannot be recalculated: incomplete input:fee:published:501");
  expect(pdf).toContain("Some records behind this answer are incomplete");
}, 20000);
