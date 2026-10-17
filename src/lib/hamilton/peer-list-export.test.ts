import { describe, expect, it } from "vitest";
import { peerCsvCell, peerListCsv, peerListCsvFilename } from "./peer-list-export";
import type { PeerListData, PeerListRow } from "./peer-list";

const row = (id: number, name: string, assets: number | null): PeerListRow => ({
  institutionId: id, name, charterType: "bank", city: "Tampa", stateCode: "FL", totalAssetsUsd: assets,
  reportDate: assets === null ? null : "2026-06-30", source: assets === null ? null : "fdic",
  sourceUrl: assets === null ? null : "https://api.fdic.gov/financials", recordId: assets === null ? null : id * 10,
  feeCoverage: "available", inclusionReason: "Matches the stated institution, state and asset filters.",
});
const data: PeerListData = {
  version: 1, status: "ready", subject: { ...row(101, "Home Bank", 5_000_000_000) },
  criteria: { basis: "explicit_filters", charterType: "bank", states: ["FL"], minAssets: null, maxAssets: null, institutionIds: null, assetTiers: [], fedDistricts: [], peerSetId: null, peerSetLabel: null, sort: "largest_assets", referenceAssetsUsd: null, requiresAssets: false, limit: 50, requestedCount: null, descriptions: ["Banks; Florida (headquarters state)."] },
  rows: [row(202, "Alpha Bank, N.A.", 2_000_000_000), row(203, "=HYPERLINK(\"x\")", 0), row(204, "Missing Bank", null)],
  totalMatches: 53, queriedAt: "2026-10-17T12:00:00.000Z", notes: ["Showing institutions 51 to 53 of 53 matching institutions, largest by assets first."], offset: 50,
  feeComparison: {
    category: "overdraft", label: "overdraft", comparedPeerIds: [202, 203, 204],
    fees: [{ institutionId: 202, id: 9001, name: "Overdraft", amount: 0, frequency: "per_item", publishedAt: "2026-09-01T00:00:00.000Z", sourceDocumentId: 77, documentUrl: "https://alpha.example/fees.pdf", sourceUrl: null }],
    rateFees: [{ institutionId: 203, id: 9002, name: "Overdraft advance", rateLabel: "3% of the advance ($10 minimum)", frequency: null, publishedAt: null, sourceDocumentId: 78, documentUrl: null, sourceUrl: "https://hyper.example/" }],
    account: { institutionId: 101, name: "Home Bank" }, includesAccount: true, note: "Each consumer overdraft fee a peer publishes is listed on its own line, $0 fees included.",
  },
};

describe("peer list CSV export (#977, H02-T08)", () => {
  const csv = peerListCsv(data)!;
  const lines = csv.trim().split("\n");
  it("prints the rows shown, numbered by their place in the whole list, with dated sources", () => {
    expect(lines[0]).toBe("Peer list for,Home Bank");
    expect(lines).toContain("Rows in this file,51 to 53 of 53 matching institutions");
    expect(lines).toContain("Criteria,Banks; Florida (headquarters state).");
    expect(lines).toContain('51,202,"Alpha Bank, N.A.",Bank,Tampa,FL,2000000000,2026-06-30,FDIC,https://api.fdic.gov/financials,2020,Published fees available,"Matches the stated institution, state and asset filters."');
  });
  it("keeps zero distinct from missing and never runs a cell as a formula", () => {
    expect(lines.find(l => l.startsWith("52,203,"))).toContain(`"'=HYPERLINK(""x"")",Bank,Tampa,FL,0,`);
    expect(lines.find(l => l.startsWith("53,204,"))).toBe('53,204,Missing Bank,Bank,Tampa,FL,,,,,,Published fees available,"Matches the stated institution, state and asset filters."');
    expect(lines).toContain("Note,Amounts are in US dollars. A blank amount means none is on file or the fee is charged as a rate (see the rate column). A blank is never zero.");
    expect(peerCsvCell(-5)).toBe("-5");
    expect(peerCsvCell("-5")).toBe("'-5");
  });
  it("lists each published fee on its own line: a $0 fee as 0, a rate as its rate, a missing fee as missing", () => {
    expect(lines).toContain("202,\"Alpha Bank, N.A.\",Overdraft,0,,per_item,2026-09-01T00:00:00.000Z,9001,77,https://alpha.example/fees.pdf");
    expect(lines.find(l => l.includes("9002"))).toBe(`203,"'=HYPERLINK(""x"")",Overdraft advance,,3% of the advance ($10 minimum),,,9002,78,https://hyper.example/`);
    expect(lines).toContain("204,Missing Bank,No published consumer overdraft fee on file,,,,,,,");
    // A plain header a spreadsheet can reference; the fee's name is in the fee column.
    expect(lines).toContain("institution_id,institution,fee,amount_usd,rate,frequency,published_at,fee_record_id,source_document_id,source_url");
    expect(lines).toContain("101,Home Bank (your institution),No published consumer overdraft fee on file,,,,,,,");
    expect(csv).not.toMatch(/\bFree\b/);
  });
  it("names the file by subject, page and day, and makes no file for a list that is not ready", () => {
    expect(peerListCsvFilename(data)).toBe("hamilton-peer-list-home-bank-from-51-2026-10-17.csv");
    expect(peerListCsv({ ...data, status: "needs_criteria" })).toBeNull();
  });
});
