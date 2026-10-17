/** @vitest-environment node */
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { extractText } from "unpdf";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfDocument } from "@/components/hamilton/reports/PdfDocument";
import { CommitteePacketView } from "@/components/hamilton/reports/CommitteePacket";
import { buildCommitteePacket, committeePacketReport } from "./committee-packet";
import type { PeerValue } from "./workspace/types";

// Synthetic fee data only; it is not a claim about any real institution's fees.
const peer = (id: number, name: string, amount: number): PeerValue => ({
  institutionId: id, institutionName: name, amount, stateCode: "FL", sourceDocumentIds: [id * 10],
  documentUrls: [`https://example.test/${id}.pdf`], publishedAt: "2026-09-20T00:00:00.000Z",
});

const packet = buildCommitteePacket({
  institutionId: 323,
  institutionName: "Capital City Bank",
  generatedAt: "2026-10-17T12:00:00.000Z",
  peerSetLabel: "Florida peers",
  feeListSource: "watchlist",
  fees: [{
    feeCategory: "overdraft", current: 32, peerLabel: "Florida peers",
    peers: [peer(5, "U.S. Bank", 36), peer(21, "M&T Bank", 37), peer(4956, "Navy Federal Credit Union", 20), peer(6741, "SchoolsFirst Federal Credit Union", 25), peer(9001, "Example Savings Bank", 30)],
    ownRows: [{ amount: 32, sourceDocumentId: 3230, documentUrl: "https://example.test/323.pdf", publishedAt: "2026-10-01T00:00:00.000Z" }],
  }],
  quarterly: { kind: "first", quarter: "2026-Q4" },
  changesSince: "2026-07-01",
  changes: [],
  financials: null,
  rules: [],
  income: [],
  proposed: { feeCategory: "overdraft", amount: 35 },
});

it("prints the packet's exhibits, footnoted sources and position check in the PDF", async () => {
  const buffer = await renderToBuffer(createElement(PdfDocument, { report: committeePacketReport(packet), reportType: "committee_packet" }) as unknown as ReactElement<DocumentProps>);
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const normalized = text.replace(/\s+/g, " ");
  for (const phrase of [
    "Pricing committee packet",
    "Capital City Bank's watched fees against its peers",
    "median of 5 peers",
    "Each peer's published fees",
    "What moved since last quarter",
    "Not found in filings",
    "Position check: $35 for overdraft",
    "Capital City Bank, published fee schedule",
    "document 3230",
  ]) expect(normalized).toContain(phrase);
}, 20000);

it("renders the screen with the same exhibits, a footnote list and the position check", () => {
  const html = renderToStaticMarkup(createElement(CommitteePacketView, {
    packet,
    hrefFor: () => "/pro/reports/committee?instId=323",
    fees: [{ category: "overdraft", name: "Overdraft" }],
    selected: { yieldFee: null, positionFee: "overdraft", positionPrice: "35", invalidPrice: false },
  }));
  for (const phrase of ["Exhibit 1", "Exhibit 6", "median of 5 peers", "id=\"fn-1\"", "Position check", "Nearest peer above", "How this packet is built", "Exhibit 7", "Back to Exhibit 1", "action=\"/pro/reports/committee#position\"", "Published fee schedules, read Oct 17, 2026 · notes"]) expect(html).toContain(phrase);
  expect(html).not.toMatch(/you should|Hamilton Pro/i);
});
