/**
 * Tests for buildThesisSummary() — pure data condensation function.
 * No DB calls, no AI calls — all data passed in via mock payload.
 *
 * DB imports in national-quarterly.ts are mocked to avoid resolution errors
 * in test environment (buildThesisSummary is a pure function, never calls DB).
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB modules before importing national-quarterly.ts
// buildThesisSummary is pure — these mocks are never called.
vi.mock("@/lib/data-store/fee-index", () => ({
  getNationalIndex: vi.fn(),
  getPeerIndex: vi.fn(),
}));
vi.mock("@/lib/data-store/call-reports", () => ({
  getRevenueTrend: vi.fn(),
}));
vi.mock("@/lib/data-store/fed", () => ({
  getBeigeBookHeadlines: vi.fn(),
  getBeigeBookThemes: vi.fn(),
  getFredSummary: vi.fn(),
}));
vi.mock("@/lib/fee-taxonomy", () => ({
  getDisplayName: (cat: string) => cat.replace(/_/g, " "),
  FEE_TIERS: {},
}));
vi.mock("@/lib/report-engine/types", () => ({}));
vi.mock("@/lib/public-stats", () => ({
  getPublicStatsSummary: vi.fn(),
}));

import { buildThesisSummary } from "./national-quarterly";
import type { NationalQuarterlyPayload } from "./national-quarterly";

// ─── Mock factory ──────────────────────────────────────────────────────────────

function makeCategory(
  fee_category: string,
  institution_count: number,
  overrides: Partial<NationalQuarterlyPayload["categories"][number]> = {},
): NationalQuarterlyPayload["categories"][number] {
  return {
    fee_category,
    display_name: fee_category.replace(/_/g, " "),
    fee_family: "deposit",
    median_amount: 25,
    p25_amount: 20,
    p75_amount: 35,
    institution_count,
    observation_count: institution_count * 2,
    maturity_tier: "strong",
    bank_median: 28,
    cu_median: 20,
    bank_count: Math.floor(institution_count * 0.6),
    cu_count: Math.floor(institution_count * 0.4),
    ...overrides,
  };
}

function makeMockPayload(
  overrides: Partial<NationalQuarterlyPayload> = {},
): NationalQuarterlyPayload {
  // 15 categories with varying institution counts for sorting test
  const categories = Array.from({ length: 15 }, (_, i) =>
    makeCategory(`fee_cat_${String(i + 1).padStart(2, "0")}`, (15 - i) * 100),
  );

  return {
    report_date: "2025-01-01",
    quarter: "Q1 2025",
    total_institutions: 1500,
    total_bank_institutions: 900,
    total_cu_institutions: 600,
    categories,
    revenue: {
      latest_quarter: "Q4 2024",
      total_service_charges: 48_000_000_000,
      yoy_change_pct: -3.6,
      total_institutions: 8000,
      bank_service_charges: 36_000_000_000,
      cu_service_charges: 12_000_000_000,
    },
    fred: {
      fed_funds_rate: 5.25,
      unemployment_rate: 3.9,
      cpi_yoy_pct: 3.1,
      consumer_sentiment: 72.5,
      gdp_growth_yoy_pct: 2.8,
      personal_savings_rate: 4.6,
      bank_lending_standards: 14.5,
      as_of: "2024-12-01",
    },
    district_headlines: [
      { district: 1, headline: "Boston district activity remains moderate.", release_date: "2024-10-01" },
      { district: 2, headline: "New York financial conditions tighten.", release_date: "2024-10-01" },
    ],
    beige_themes: [
      {
        district: 3,
        district_name: "Philadelphia",
        theme_category: "lending_conditions",
        sentiment: "negative",
        summary: "Banks tightened lending standards for commercial loans.",
      },
    ],
    derived: {
      avg_iqr_spread_pct: 42.3,
      median_iqr_spread_pct: 38,
      commoditized_count: 7,
      total_priced_categories: 15,
      tightest_spreads: [],
      widest_spreads: [],
      bank_higher_count: 12,
      cu_higher_count: 3,
      comparable_count: 15,
      biggest_bank_premiums: [],
      biggest_cu_premiums: [],
      revenue_per_institution: 6_000_000,
      bank_revenue_share_pct: 75,
      cu_revenue_share_pct: 25,
      categories_with_data_count: 15,
      strong_maturity_count: 10,
      provisional_maturity_count: 5,
    },
    regional: { districts: [], sizes: [], states: [] },
    income_series: [],
    overdraft_distribution: [],
    manifest: {
      queries: [],
      data_hash: "abc123",
      pipeline_commit: "local",
    },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("buildThesisSummary", () => {
  it("returns top 10 categories sorted by institution_count descending", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    expect(result.top_categories).toHaveLength(10);

    // Should be sorted descending by institution_count
    for (let i = 0; i < result.top_categories.length - 1; i++) {
      expect(result.top_categories[i].institution_count).toBeGreaterThanOrEqual(
        result.top_categories[i + 1].institution_count,
      );
    }

    // Highest count is 15 * 100 = 1500 (fee_cat_01)
    expect(result.top_categories[0].institution_count).toBe(1500);
    // 10th highest is (15 - 9) * 100 = 600 (fee_cat_10)
    expect(result.top_categories[9].institution_count).toBe(600);
  });

  it("maps top_categories fields correctly", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    const first = result.top_categories[0];
    expect(first).toMatchObject({
      fee_category: "fee_cat_01",
      display_name: "fee cat 01",
      median_amount: 25,
      bank_median: 28,
      cu_median: 20,
      institution_count: 1500,
      maturity_tier: "strong",
    });
  });

  it("maps revenue_snapshot when revenue is non-null", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    expect(result.revenue_snapshot).not.toBeNull();
    expect(result.revenue_snapshot).toMatchObject({
      latest_quarter: "Q4 2024",
      total_service_charges: 48_000_000_000,
      yoy_change_pct: -3.6,
      bank_service_charges: 36_000_000_000,
      cu_service_charges: 12_000_000_000,
      total_institutions: 8000,
    });
  });

  it("maps fred_snapshot when fred is non-null", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    expect(result.fred_snapshot).not.toBeNull();
    expect(result.fred_snapshot).toMatchObject({
      fed_funds_rate: 5.25,
      unemployment_rate: 3.9,
      cpi_yoy_pct: 3.1,
      consumer_sentiment: 72.5,
      as_of: "2024-12-01",
    });
  });

  it("maps beige_book_themes from district_headlines", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    expect(result.beige_book_themes).toEqual([
      "Boston district activity remains moderate.",
      "New York financial conditions tighten.",
    ]);
  });

  it("generates all 3 derived_tensions when all data is present", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    expect(result.derived_tensions).toHaveLength(3);
    expect(result.derived_tensions[0]).toContain("Banks charge more than credit unions in 12 of 15");
    expect(result.derived_tensions[1]).toContain("7 of 15 fee categories have a middle half narrower than 30% of the median");
    expect(result.derived_tensions[2]).toContain("Average service-charge income per reporting institution: $6,000,000 in Q4 2024");
  });

  it("sets revenue_snapshot and fred_snapshot to null when missing", () => {
    const payload = makeMockPayload({ revenue: null, fred: null });
    const result = buildThesisSummary(payload);

    expect(result.revenue_snapshot).toBeNull();
    expect(result.fred_snapshot).toBeNull();
  });

  it("derived_tensions is empty when all data sources are absent", () => {
    const payload = makeMockPayload({
      revenue: null,
      fred: null,
      derived: {
        ...makeMockPayload().derived,
        avg_iqr_spread_pct: null,
        revenue_per_institution: null,
        bank_higher_count: 0,
        cu_higher_count: 0,
      },
    });
    const result = buildThesisSummary(payload);

    // bank_higher_count + cu_higher_count === 0 so first tension is excluded
    // avg_iqr_spread_pct === null so second tension is excluded
    // revenue_per_institution === null so third tension is excluded
    expect(result.derived_tensions).toHaveLength(0);
  });

  it("includes only bank/CU tension when revenue=null and fred=null but has bank/CU data", () => {
    const payload = makeMockPayload({
      revenue: null,
      fred: null,
      derived: {
        ...makeMockPayload().derived,
        avg_iqr_spread_pct: null,
        revenue_per_institution: null,
        bank_higher_count: 10,
        cu_higher_count: 2,
      },
    });
    const result = buildThesisSummary(payload);

    expect(result.derived_tensions).toHaveLength(1);
    expect(result.derived_tensions[0]).toContain("Banks charge more than credit unions in 10 of 12");
  });

  it("preserves scalar fields from payload", () => {
    const payload = makeMockPayload();
    const result = buildThesisSummary(payload);

    expect(result.quarter).toBe("Q1 2025");
    expect(result.total_institutions).toBe(1500);
  });

  it("does not mutate the original payload categories array", () => {
    const payload = makeMockPayload();
    const originalOrder = payload.categories.map((c) => c.fee_category);
    buildThesisSummary(payload);
    const afterOrder = payload.categories.map((c) => c.fee_category);

    expect(afterOrder).toEqual(originalOrder);
  });
});

// ─── NationalQuarterlyPayload shape tests ─────────────────────────────────────

describe("NationalQuarterlyPayload shape", () => {
  it("payload includes beige_themes array", () => {
    const payload = makeMockPayload();

    expect(payload).toHaveProperty("beige_themes");
    expect(Array.isArray(payload.beige_themes)).toBe(true);
    expect(payload.beige_themes.length).toBeGreaterThan(0);
    expect(payload.beige_themes[0]).toHaveProperty("district");
    expect(payload.beige_themes[0]).toHaveProperty("district_name");
    expect(payload.beige_themes[0]).toHaveProperty("theme_category");
    expect(payload.beige_themes[0]).toHaveProperty("sentiment");
    expect(payload.beige_themes[0]).toHaveProperty("summary");
  });

  it("fred payload includes all 7 indicators", () => {
    const payload = makeMockPayload();

    expect(payload.fred).not.toBeNull();
    expect(payload.fred).toHaveProperty("fed_funds_rate", 5.25);
    expect(payload.fred).toHaveProperty("unemployment_rate", 3.9);
    expect(payload.fred).toHaveProperty("cpi_yoy_pct", 3.1);
    expect(payload.fred).toHaveProperty("consumer_sentiment", 72.5);
    expect(payload.fred).toHaveProperty("gdp_growth_yoy_pct", 2.8);
    expect(payload.fred).toHaveProperty("personal_savings_rate", 4.6);
    expect(payload.fred).toHaveProperty("bank_lending_standards", 14.5);
    expect(payload.fred).toHaveProperty("as_of");
  });

  it("beige_themes contains only lending_conditions and prices categories", () => {
    const payload = makeMockPayload();

    for (const theme of payload.beige_themes) {
      expect(["lending_conditions", "prices"]).toContain(theme.theme_category);
    }
  });

  it("beige_themes can be empty when no fee-relevant themes exist", () => {
    const payload = makeMockPayload({ beige_themes: [] });

    expect(payload.beige_themes).toEqual([]);
    // district_headlines still present as fallback
    expect(payload.district_headlines.length).toBeGreaterThan(0);
  });
});
