import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeeRevenueCorrelation } from "./fee-revenue";

vi.mock("./fee-revenue", () => ({ getFeeRevenueData: vi.fn() }));
import { getFeeRevenueData } from "./fee-revenue";
import { buildFeeRevenueResearch, getFeeRevenueResearch, getFeeRevenueResearchPreview, previewFeeRevenueResearch } from "./fee-revenue-research";

function row(id: number, source: "fdic" | "ncua" = "fdic", overrides: Partial<FeeRevenueCorrelation> = {}): FeeRevenueCorrelation {
  return {
    institution_id: id, institution_name: `Synthetic ${id}`, charter_type: source === "fdic" ? "bank" : "credit_union",
    regulatory_status: null, state_code: "VA", asset_size_tier: "micro", financial_source: source,
    report_date: "2026-06-30", total_assets: 20_000_000, service_charge_income: 100,
    avg_fee: 10, fee_count: 3, median_overdraft: null, fee_income_ratio: .05,
    ...overrides,
  };
}
const rows = (count: number, source: "fdic" | "ncua" = "fdic", offset = 0) => Array.from({ length: count }, (_, index) => row(offset + index + 1, source));

beforeEach(() => vi.mocked(getFeeRevenueData).mockReset());

describe("source-separated financial research read model (#2330)", () => {
  it("derives every mean, size summary and rank from one exact source and matched date", () => {
    const banks = rows(5).map((value, index) => ({ ...value, service_charge_income: (index + 1) * 100 }));
    const cus = rows(5, "ncua", 100).map((value, index) => ({ ...value, service_charge_income: (index + 1) * 1000 }));
    const input = [...banks, ...cus, row(200, "ncua", { report_date: "2026-03-31", service_charge_income: 90000 }), row(201, "ncua", { report_date: "2025-12-31" })];
    const original = structuredClone(input);
    const result = buildFeeRevenueResearch(input);
    expect(input).toEqual(original);
    expect(result.groups.map((group) => [group.source, group.report_date, group.institution_count])).toEqual([["fdic", "2026-06-30", 5], ["ncua", "2026-06-30", 5]]);
    const [bank, cu] = result.groups;
    expect(bank.summary.mean_income_usd).toBeCloseTo(300000);
    expect(cu.summary.mean_income_usd).toBeCloseTo(3000000);
    expect(bank.by_tier).toEqual([{ asset_size_tier: "regional", ...bank.summary }]);
    expect(cu.by_tier).toEqual([{ asset_size_tier: "regional", ...cu.summary }]);
    expect(bank.rankings.map((value) => value.institution_id)).toEqual([5, 4, 3, 2, 1]);
    expect(cu.rankings.map((value) => value.institution_id)).toEqual([105, 104, 103, 102, 101]);
    expect(cu).toMatchObject({ stale_institution_count: 2, stale_report_dates: ["2026-03-31", "2025-12-31"], date_selection_basis: "newest_usable_matched_quarter" });
    expect(cu.date_selection_definition).toContain("not the latest filing date across the regulator's full population");
    expect(bank).toMatchObject({ measure: "deposit_service_charge_income", unit: "USD", period_basis: "standalone_quarter", source_period_basis: "standalone_quarter" });
    expect(cu).toMatchObject({ measure: "broad_credit_union_fee_income", unit: "USD", period_basis: "standalone_quarter", source_period_basis: "year_to_date" });
    expect(cu).toMatchObject({ population_basis: "fee_price_income_correlation", stored_income_unit: "thousands of dollars", fee_price_unit: "USD", intensity_unit: "USD income per 10,000 USD assets" });
    expect(cu.fee_price_basis).toBe("current_published_categories_not_historical_prices");
    expect(cu.limitations.join(" ")).toContain("not historical fee-price snapshots");
    expect(cu.limitations.join(" ")).toContain("reporting date identifies only the financial quarter");
    expect(cu.eligibility.definition).toContain("consumer, shared consumer/business, or unknown audience; business-only rows excluded");
  });

  it("selects each source's newest usable matched sample without borrowing another regulator's date", () => {
    const banks = rows(5).map((value) => ({ ...value, report_date: "2026-09-30" }));
    const cus = rows(5, "ncua", 100);
    const result = buildFeeRevenueResearch([...banks, ...cus, row(500, "ncua", { report_date: "2026-09-30", service_charge_income: null })]);
    expect(result.groups.map((group) => [group.source, group.report_date])).toEqual([["fdic", "2026-09-30"], ["ncua", "2026-06-30"]]);
    expect(result.excluded_invalid_rows).toBe(1);
  });

  it("never silently falls back to an older larger sample when the newest matched quarter is thin", () => {
    const result = buildFeeRevenueResearch([...rows(5), row(100, "fdic", { report_date: "2026-09-30" })]);
    expect(result.groups[0]).toMatchObject({ report_date: "2026-09-30", institution_count: 1, stale_institution_count: 5,
      summary: { institution_count: 1, mean_income_usd: null, mean_listed_fee_usd: null, mean_income_per_10k_assets: null }, rankings: [] });
  });

  it("converts stored income/assets once, keeps fee prices in USD and derives intensity from the same filing", () => {
    const group = buildFeeRevenueResearch(rows(5, "ncua").map((value) => ({ ...value,
      service_charge_income: 30032, total_assets: 25000000, avg_fee: 23.33, fee_income_ratio: 99999 }))).groups[0];
    expect(group.institutions[0]).toMatchObject({ income_usd: 30032000, assets_usd: 25000000000, listed_fee_usd: 23.33, asset_size_tier: "regional" });
    expect(group.institutions[0].income_per_10k_assets).toBeCloseTo(12.0128);
    expect(group.summary.mean_income_usd).toBeCloseTo(30032000);
    expect(group.summary.mean_listed_fee_usd).toBeCloseTo(23.33);
    expect(group.summary.mean_income_per_10k_assets).toBeCloseTo(12.0128);
  });

  it("retains real zero prices and signed income, and never treats null/zero assets as a denominator", () => {
    const input = rows(5).map((value, index) => ({ ...value, service_charge_income: [0, -10, 20, 30, 60][index], avg_fee: index ? 10 : 0 }));
    const group = buildFeeRevenueResearch(input).groups[0];
    expect(group.summary).toMatchObject({ institution_count: 5, ratio_reported_count: 5, mean_income_usd: 20000, mean_listed_fee_usd: 8 });
    expect(group.institutions[0]).toMatchObject({ income_usd: 0, listed_fee_usd: 0, income_per_10k_assets: 0 });
    expect(group.institutions[1].income_usd).toBe(-10000);
    input[0].total_assets = null;
    input[1].total_assets = 0;
    const missing = buildFeeRevenueResearch(input).groups[0];
    expect(missing.summary).toMatchObject({ institution_count: 5, ratio_reported_count: 3, mean_income_usd: 20000, mean_listed_fee_usd: 8, mean_income_per_10k_assets: null });
    expect(missing.rankings).toEqual([]);
    expect(missing.institutions[0]).toMatchObject({ assets_usd: null, income_per_10k_assets: null, asset_size_tier: "unknown" });
    expect(missing.institutions[1]).toMatchObject({ assets_usd: 0, income_per_10k_assets: null });
  });

  it("applies the five-institution floor separately to each actual tier and ratio population", () => {
    const group = buildFeeRevenueResearch([...rows(5), ...rows(4, "fdic", 10).map((value) => ({ ...value, total_assets: 500000 }))]).groups[0];
    expect(group.summary.institution_count).toBe(9);
    expect(group.summary.mean_income_usd).not.toBeNull();
    expect(group.by_tier.find((tier) => tier.asset_size_tier === "community")).toMatchObject({ institution_count: 4, ratio_reported_count: 4, mean_income_usd: null, mean_listed_fee_usd: null, mean_income_per_10k_assets: null });
    expect(group.by_tier.find((tier) => tier.asset_size_tier === "regional")).toMatchObject({ institution_count: 5, mean_income_usd: 100000 });
  });

  it("deduplicates identical institution rows and excludes conflicting IDs instead of fabricating the count floor", () => {
    const one = row(1);
    const duplicates = buildFeeRevenueResearch(Array.from({ length: 5 }, () => ({ ...one })));
    expect(duplicates).toMatchObject({ excluded_duplicate_rows: 4, conflicting_institution_count: 0 });
    expect(duplicates.groups[0]).toMatchObject({ institution_count: 1, summary: { mean_income_usd: null }, rankings: [] });
    const conflicting = buildFeeRevenueResearch([...rows(5), row(5, "fdic", { service_charge_income: 200 })]);
    expect(conflicting).toMatchObject({ excluded_duplicate_rows: 1, conflicting_institution_count: 1 });
    expect(conflicting.groups[0]).toMatchObject({ institution_count: 4, summary: { mean_income_usd: null }, rankings: [] });
  });

  it("does not turn duplicate identities with different dates or sources into separate cohorts", () => {
    for (const other of [row(1, "fdic", { report_date: "2026-09-30" }), row(1, "ncua")]) {
      const result = buildFeeRevenueResearch([row(1), other]);
      expect(result.groups).toEqual([]);
      expect(result.conflicting_institution_count).toBe(1);
    }
  });

  it.each([
    { financial_source: "ffiec" }, { financial_source: "other" }, { charter_type: "credit_union" }, { charter_type: "unknown" },
    { report_date: null }, { report_date: "2026-06-29" }, { report_date: "2026-Q2" },
    { institution_id: 0 }, { institution_id: 1.5 }, { institution_name: "" }, { regulatory_status: "inactive" },
    { avg_fee: Number.NaN }, { avg_fee: -1 }, { fee_count: 2 }, { fee_count: 3.5 },
    { service_charge_income: null }, { service_charge_income: Infinity }, { service_charge_income: Number.MAX_SAFE_INTEGER },
    { total_assets: Number.NaN }, { total_assets: -1 },
  ])("excludes unusable or ineligible rows: %j", (overrides) => {
    const result = buildFeeRevenueResearch([row(1, "fdic", overrides)]);
    expect(result.groups).toEqual([]);
    expect(result.excluded_invalid_rows).toBe(1);
  });

  it("does not invent an empty regulator family or present a price basket as a causal benchmark", () => {
    expect(buildFeeRevenueResearch([])).toEqual({ groups: [], excluded_invalid_rows: 0, excluded_duplicate_rows: 0, conflicting_institution_count: 0 });
    const group = buildFeeRevenueResearch(rows(5, "ncua")).groups[0];
    expect(group.eligibility.minimum_published_fee_categories).toBe(3);
    expect(group.limitations.join(" ")).toContain("Price baskets differ");
    expect(group.limitations.join(" ")).toContain("not a same-fee benchmark");
    expect(group.limitations.join(" ")).toContain("merger adjustment, causal correlation");
  });

  it("makes one uncached population read for the complete model and propagates failures", async () => {
    vi.mocked(getFeeRevenueData).mockResolvedValue(rows(5));
    expect((await getFeeRevenueResearch()).groups[0].institution_count).toBe(5);
    expect(getFeeRevenueData).toHaveBeenCalledExactlyOnceWith();
    vi.mocked(getFeeRevenueData).mockRejectedValueOnce(new Error("read unavailable"));
    await expect(getFeeRevenueResearch()).rejects.toThrow("read unavailable");
  });

  it("bounds the cached preview after computing full-population statistics and source-specific ranks (#2419)", () => {
    const input = [
      ...rows(2500).map((value, index) => ({ ...value, institution_name: `Synthetic bank ${index} — member service`, service_charge_income: index + 1 })),
      ...rows(2500, "ncua", 10000).map((value, index) => ({ ...value, institution_name: `Synthetic credit union ${index} — member service`, service_charge_income: (index + 1) * 100 })),
      row(30000, "ncua", { report_date: "2026-03-31", service_charge_income: 1e6 }),
    ];
    const full = buildFeeRevenueResearch(input);
    const preview = previewFeeRevenueResearch(full);
    expect(full.groups.map((group) => group.institutions.length)).toEqual([2500, 2500]);
    expect(full.groups.map((group) => group.rankings.length)).toEqual([2500, 2500]);
    for (const [index, group] of preview.groups.entries()) {
      expect(group).not.toHaveProperty("institutions");
      expect(group.institution_count).toBe(2500);
      expect(group.summary).toEqual(full.groups[index].summary);
      expect(group.by_tier).toEqual(full.groups[index].by_tier);
      expect(group.stale_institution_count).toBe(full.groups[index].stale_institution_count);
      expect(group.rankings).toEqual(full.groups[index].rankings.slice(0, 50));
      expect(group.ranking_preview).toEqual({ limit: 50, total: 2500, complete: false });
      expect(group.rankings[0].institution_name).toBe(full.groups[index].rankings[0].institution_name);
    }
    expect(preview.groups[0].summary.mean_income_usd).toBeCloseTo(1250500);
    expect(preview.groups[1].summary.mean_income_usd).toBeCloseTo(125050000);
    expect(preview.groups[1]).toMatchObject({ source: "ncua", report_date: "2026-06-30", stale_institution_count: 1 });
    expect(Buffer.byteLength(JSON.stringify(full), "utf8")).toBeGreaterThan(2097152);
    expect(Buffer.byteLength(JSON.stringify(preview), "utf8")).toBeLessThan(2097152);
  });

  it("marks truthful complete and suppressed ranking previews without inventing available rows", async () => {
    const complete = previewFeeRevenueResearch(buildFeeRevenueResearch(rows(5))).groups[0];
    expect(complete.ranking_preview).toEqual({ limit: 50, total: 5, complete: true });
    expect(complete.rankings).toHaveLength(5);
    vi.mocked(getFeeRevenueData).mockResolvedValue(rows(4));
    const thin = await getFeeRevenueResearchPreview();
    expect(getFeeRevenueData).toHaveBeenCalledExactlyOnceWith();
    expect(thin.groups[0]).toMatchObject({ institution_count: 4, summary: { ratio_reported_count: 4 }, rankings: [], ranking_preview: { limit: 50, total: 0, complete: true } });
    expect(thin.groups[0]).not.toHaveProperty("institutions");
  });
});
