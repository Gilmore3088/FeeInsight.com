import { describe, expect, it } from "vitest";
import { assembleResearchSnapshot, researchHash, validateResearchSnapshot } from "./assemble";
import { parseResearchRequest } from "./types";
import { countyFips } from "./metrics";
import { researchExhibits, renderResearchHtml } from "./presentation";
import { researchReadyToPublish, researchReadyToRead } from "./manifest";
import type { ResearchInputs } from "@/lib/data-store/research-database";
import { buildResearchFootprint, RESEARCH_BRANCH_SQL } from "@/lib/data-store/research-database";
import { buildResearchAudit } from "./audit";

function fixture(): ResearchInputs {
  return {
    capturedAt: "2026-10-26T00:00:00Z", audit: [], footprint: { institutionId: 1, name: "Example Bank", charter: "bank", vintage: "2026", counties: ["01001", "01003"], branches: 2, matchedBranches: 2, unmatchedBranches: 0, status: "available" },
    institutions: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, institution_name: `Institution ${i + 1}`, charter_type: i < 10 ? "bank" as const : "credit_union" as const, asset_size_tier: "small" })),
    branches: [{ branch_key: "bank:1:0", county_fips: "01001", vintage: "2026", deposits: 1000, institution_id: 1 }, { branch_key: "bank:2:0", county_fips: "01003", vintage: "2026", deposits: 2000, institution_id: 2 }],
    demographics: [{ geo_id: "county:01001", geo_name: "County A", year: 2024, total_population: 100, median_household_income: 50000 }, { geo_id: "county:01003", geo_name: "County B", year: 2024, total_population: 300, median_household_income: 90000 }],
    financials: Array.from({ length: 20 }, (_, i) => ({ institution_id: i + 1, source: i < 10 ? "fdic" as const : "ncua" as const, report_date: "2026-06-30", asset_size_tier: "small", total_assets: i < 10 ? 100 : 1000, total_deposits: 50, total_loans: 25, roa: i < 10 ? 1 : 2 })),
    fees: Array.from({ length: 20 }, (_, i) => ({ institution_id: i + 1, amount: i < 10 ? 0 : 20, fee_category: "overdraft", charter_type: i < 10 ? "bank" as const : "credit_union" as const, asset_size_tier: "small" })),
    areas: [],
  };
}
const request = parseResearchRequest({ scope: "footprint", cadence: "quarterly", institutionId: 1 });

describe("research calculations and frozen evidence", () => {
  it("keeps county leading zeroes and rejects malformed identifiers", () => {
    expect(countyFips(1001)).toBe("01001");
    for (const bad of [0, "1.1", "010010", "01001x", null]) expect(countyFips(bad)).toBeNull();
  });
  it("requires a numeric canonical institution identity and verified evidence", () => {
    expect(() => parseResearchRequest({ scope: "footprint", cadence: "quarterly", institutionId: "1" })).toThrow();
    expect(() => parseResearchRequest({ scope: "national", cadence: "quarterly", evidencePolicy: "provisional-first" })).toThrow();
  });
  it("sums distinct counties, keeps county medians separate and converts financial units", () => {
    const s = assembleResearchSnapshot(request, fixture());
    expect(s.cells.find(c => c.key === "population")?.value).toBe(400);
    expect(s.cells.filter(c => c.key === "household_income").map(c => c.value)).toEqual([50000, 90000]);
    expect(s.cells.find(c => c.key === "assets" && c.cohort === "bank:small")?.value).toBe(100000);
    expect(s.cells.find(c => c.key === "assets" && c.cohort === "credit_union:small")?.value).toBe(1000000);
    expect(s.cells.filter(c => c.key === "loan_deposit_ratio").map(c => c.value)).toEqual([0.5, 0.5]);
  });
  it("withholds a complete population total when a footprint county is missing", () => {
    const input = fixture(); input.demographics.pop();
    expect(assembleResearchSnapshot(request, input).cells.find(c => c.key === "population")?.value).toBeNull();
  });
  it("uses a compact, measured national branch fact with its original coverage counts", () => {
    const input = fixture(); input.footprint = null; input.branches = [];
    input.branchSummary = { vintage: "2026", branches: 75859, priced_branches: 75859, deposits: 19050196416000, unmapped_branches: 0 };
    const s = assembleResearchSnapshot({ ...request, scope: "national", institutionId: null }, input);
    expect(s.cells.find(c => c.key === "bank_deposits")).toMatchObject({ value: 19050196416000, eligible: 75859, observed: 75859 });
  });
  it("retains zero dollar fees and suppresses nine-institution cohorts", () => {
    const input = fixture();
    let s = assembleResearchSnapshot(request, input);
    expect(s.cells.find(c => c.key === "fee:overdraft" && c.cohort === "bank")?.value).toBe(0);
    input.fees = input.fees.filter(f => f.institution_id !== 1);
    s = assembleResearchSnapshot(request, input);
    expect(s.cells.find(c => c.key === "fee:overdraft" && c.cohort === "bank")).toMatchObject({ value: null, observed: 9 });
  });
  it("compares paired annual assets and keeps balance-sheet equity separate from regulatory capital", () => {
    const input = fixture();
    input.financials = input.financials.map(row => ({ ...row, prior_assets: row.source === "fdic" ? 50 : 500, total_equity: row.source === "fdic" ? 10 : 100 }));
    const s = assembleResearchSnapshot(request, input);
    expect(s.cells.filter(c => c.key === "asset_growth").map(c => c.value)).toEqual([100, 100]);
    expect(s.cells.filter(c => c.key === "equity_assets").map(c => c.value)).toEqual([10, 10]);
  });
  it("does not benchmark institutions whose asset-size cohort is unknown", () => {
    const input = fixture();
    input.institutions = input.institutions.map(i => ({ ...i, asset_size_tier: null }));
    input.financials = input.financials.map(f => ({ ...f, asset_size_tier: null }));
    const s = assembleResearchSnapshot(request, input);
    expect(s.cells.filter(c => c.cohort.endsWith(":unclassified")).every(c => c.value === null)).toBe(true);
  });
  it("distinguishes new reporting periods from same-period values and fee catalog refreshes", () => {
    const input = fixture();
    const before = assembleResearchSnapshot(request, input);
    input.previous = { capturedAt: "2026-09-01T00:00:00Z", cells: before.cells.map(c => c.key === "population" ? { ...c, period: "2023" } : c) };
    const s = assembleResearchSnapshot({ ...request, cadence: "monthly" }, input);
    expect(s.cells.find(c => c.key === "population")?.releaseStatus).toBe("new_period");
    expect(s.cells.find(c => c.key === "household_income")?.releaseStatus).toBe("same_period");
    expect(s.cells.find(c => c.key === "fee:overdraft")?.releaseStatus).toBe("snapshot_refresh");
  });
  it("does not turn a suppressed Census income into a negative dollar finding", () => {
    const input = fixture(); input.demographics[0].median_household_income = -666666666;
    expect(assembleResearchSnapshot(request, input).cells.find(c => c.key === "household_income")?.value).toBeNull();
  });
  it("rejects duplicate counties, duplicate offices, mixed quarters and mixed ACS vintages", () => {
    const a = fixture(); a.demographics.push(a.demographics[0]);
    expect(() => assembleResearchSnapshot(request, a)).toThrow(/Duplicate county/);
    const b = fixture(); b.branches.push(b.branches[0]);
    expect(() => assembleResearchSnapshot(request, b)).toThrow(/Duplicate branch/);
    const c = fixture(); c.financials[0].report_date = "2026-03-31";
    expect(() => assembleResearchSnapshot(request, c)).toThrow(/Mixed financial/);
    const d = fixture(); d.demographics[0].year = 2023;
    expect(() => assembleResearchSnapshot(request, d)).toThrow(/Mixed ACS/);
  });
  it("replays saved inputs and detects changed figures or changed evidence", () => {
    const input = fixture(); const s = assembleResearchSnapshot(request, input);
    expect(validateResearchSnapshot(s, input)).toBe(true);
    const manifest = { research_snapshot: s, research_inputs: input, research_verification: { verified: true, kind: "frozen_input_replay", snapshotHash: s.snapshotHash } };
    expect(researchReadyToPublish(manifest)).toBe(true);
    expect(researchReadyToRead(JSON.stringify(manifest))).toBe(true);
    s.cells[0].value = 999;
    expect(researchReadyToPublish(manifest)).toBe(false);
    expect(researchReadyToRead(manifest)).toBe(false);
  });
  it("does not change an archived snapshot when newer inputs arrive", () => {
    const original = fixture(); const s = assembleResearchSnapshot(request, original);
    const newer = structuredClone(original); newer.demographics[0].total_population = 999;
    expect(assembleResearchSnapshot(request, newer).snapshotHash).not.toBe(s.snapshotHash);
    expect(s.cells.find(c => c.key === "population")?.value).toBe(400);
    expect(validateResearchSnapshot(s, original)).toBe(true);
  });
  it("shares formatted figures with printable HTML and escapes untrusted text", () => {
    const input = fixture(); input.demographics[0].geo_name = '<img src=x onerror="alert(1)">';
    const s = assembleResearchSnapshot(request, input);
    const html = renderResearchHtml(s, "Example <report>");
    expect(html).not.toContain("<img src=x"); expect(html).toContain("&lt;img");
    for (const cell of researchExhibits(s)) expect(html).toContain(cell.formatted);
    expect(researchHash({ b: 1, a: 2 })).toBe(researchHash({ a: 2, b: 1 }));
  });
});

describe("source readiness and physical footprints", () => {
  it("uses all branch counties and exposes unmatched offices", () => {
    const input = fixture();
    const branches = Array.from({ length: 5 }, (_, i) => ({ branch_key: String(i), institution_id: 1, county_fips: i === 4 ? null : `0100${i + 1}`, vintage: "2026", deposits: null }));
    expect(buildResearchFootprint(input.institutions[0], branches)).toMatchObject({ counties: ["01001", "01002", "01003", "01004"], branches: 5, matchedBranches: 4, status: "partial" });
    expect(RESEARCH_BRANCH_SQL).toContain("MAX(report_date)");
    expect(RESEARCH_BRANCH_SQL).toContain("t.address_hash = md5");
    expect(RESEARCH_BRANCH_SQL).not.toContain("LIMIT 3");
  });
  it("never treats a source contract as a populated dataset and blocks held licences", () => {
    const audit = buildResearchAudit([]);
    expect(audit.find(a => a.source === "census-acs")?.status).toBe("unmeasured");
    expect(audit.find(a => a.source === "state-bill-news")?.status).toBe("blocked");
  });
});
