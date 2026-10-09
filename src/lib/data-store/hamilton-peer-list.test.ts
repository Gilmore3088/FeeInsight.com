import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerListCriteria } from "@/lib/hamilton/peer-list";
const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock("./connection", () => ({ sql: mocks.sql }));
import { getPeerListRows, getPeerListSubject, peerAssetSourceUrl, peerSubjectFromRow } from "./hamilton-peer-list";
const row = { institution_id: 202, institution_name: "Synthetic Peer CU", charter_type: "credit_union", city: "Tampa", state_code: "FL", financial_record_id: 33, total_assets_usd: "1500000000", asset_report_date: "2026-06-30", asset_source: "ncua", asset_source_url: "https://ncua.gov/analysis/credit-union-corporate-call-report-data", has_published_fees: false, total_matches: 1 };
const criteria: PeerListCriteria = { basis: "explicit_filters", charterType: "credit_union", states: ["FL"], minAssets: { value: 1_000_000_000, inclusive: false }, maxAssets: null, institutionIds: null, assetTiers: [], fedDistricts: [], peerSetId: null, peerSetLabel: null, sort: "largest_assets", referenceAssetsUsd: null, requiresAssets: true, limit: 10, requestedCount: 10, descriptions: [] };
beforeEach(() => mocks.sql.mockReset().mockResolvedValue([row]));

describe("dated asset read model", () => {
  it("does not multiply already-converted SQL output a second time", () => { expect(peerSubjectFromRow(row).totalAssetsUsd).toBe(1_500_000_000); });
  it("does not substitute deposits for absent assets", () => { expect(peerSubjectFromRow({ ...row, total_assets_usd: null, total_deposits: 9_000_000_000 }).totalAssetsUsd).toBeNull(); });
  it("keeps a zero value separate from null", () => { expect(peerSubjectFromRow({ ...row, total_assets_usd: 0 }).totalAssetsUsd).toBe(0); });
  it("normalizes Date objects without replacing the reporting period with retrieval time", () => { expect(peerSubjectFromRow({ ...row, asset_report_date: new Date("2026-03-31T00:00:00Z") }).reportDate).toBe("2026-03-31"); });
  it("refuses to present known assets with an invalid date", () => { let failed = false; try { peerSubjectFromRow({ ...row, asset_report_date: "2026-02-30" }); } catch { failed = true; } expect(failed).toBe(true); });
  it("does not manufacture a source URL", () => { expect(peerSubjectFromRow({ ...row, asset_source_url: null }).sourceUrl).toBeNull(); });
  it("allows only the recorded regulator's HTTPS source links", () => {
    expect(peerAssetSourceUrl("https://api.fdic.gov/banks/financials", "fdic")).toBe("https://api.fdic.gov/banks/financials");
    for (const url of ["javascript:alert(1)", "https://fdic.gov.attacker.test/a", "https://user:secret@fdic.gov/a", "http://fdic.gov/a", "https://ncua.gov/a"]) expect(peerAssetSourceUrl(url, "fdic")).toBeNull();
  });
  it("uses the subject's own financial record and preserves its record ID", async () => { const found = await getPeerListSubject(202, "2026-10-10"); expect(found?.recordId).toBe(33); expect(mocks.sql.mock.calls[0].slice(1)).toEqual(["2026-10-10", 202]); expect(mocks.sql.mock.calls[0][0].join("?")).toContain("(f.total_assets::numeric * 1000) AS total_assets_usd"); });
  it("does not replace a missing subject with an arbitrary first institution", async () => { mocks.sql.mockResolvedValue([]); expect(await getPeerListSubject(202, "2026-10-10")).toBeNull(); });
  it("returns peers even when their published fee data is absent", async () => { const result = await getPeerListRows(101, criteria, "2026-10-10"); expect(result.rows).toHaveLength(1); expect(result.rows[0].feeCoverage).toBe("not_found"); expect(result.totalMatches).toBe(1); });
  it("keeps the total match count distinct from the requested page length", async () => { mocks.sql.mockResolvedValue([{ ...row, total_matches: 250 }]); const result = await getPeerListRows(101, criteria, "2026-10-10"); expect(result.rows).toHaveLength(1); expect(result.totalMatches).toBe(250); });
  it("reports a successful empty result as zero", async () => { mocks.sql.mockResolvedValue([]); expect(await getPeerListRows(101, criteria, "2026-10-10")).toEqual({ rows: [], totalMatches: 0 }); });
  it("does not turn a database failure into zero matches", async () => { mocks.sql.mockRejectedValue(new Error("synthetic database failure")); let failed = false; try { await getPeerListRows(101, criteria, "2026-10-10"); } catch { failed = true; } expect(failed).toBe(true); });
  it("selects latest dated records before asset filtering and computes fee coverage after selection", async () => {
    await getPeerListRows(101, criteria, "2026-10-10");
    const text = mocks.sql.mock.calls[0][0].join("?");
    expect(text.indexOf("ORDER BY report_date DESC") < text.indexOf("eligible AS")).toBe(true);
    expect(text.indexOf("LIMIT ?") < text.indexOf("EXISTS (SELECT 1 FROM published_fee_catalog")).toBe(true);
    expect(text).toContain("(f.total_assets::numeric * 1000) AS total_assets_usd");
    expect(text).toContain("COUNT(*) OVER ()"); expect(text).toContain("'credit_union' THEN 'ncua' ELSE 'fdic'");
    expect(text).toContain("published_fee_rate_catalog");
    expect(text).not.toContain("total_deposits");
  });
});
