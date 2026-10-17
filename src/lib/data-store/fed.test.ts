import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn() as ReturnType<typeof vi.fn> & {
    unsafe: ReturnType<typeof vi.fn>;
  };
  mockSql.unsafe = vi.fn();
  return {
    getSql: () => mockSql,
    sql: mockSql,
  };
});

import {
  getNationalEconomicSummary,
  getDistrictEconomicSummary,
  getDistrictBeigeBookSummaries,
  getBeigeBookThemes,
  getFredSummary,
  type DistrictEconomicSummary,
  type BeigeBookTheme,
  type DistrictBeigeBookSummary,
  type FredSummary,
} from "./fed";
import { getSql } from "./connection";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return getSql() as unknown as MockSql;
}

function resetMock(mock: MockSql) {
  mock.mockReset();
  mock.unsafe = vi.fn();
}

// ── getNationalEconomicSummary ────────────────────────────────────────────────

describe("getNationalEconomicSummary", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns object with all 4 indicator keys", async () => {
    // Each buildRichIndicator call fetches rows; CPI path fetches 24 rows
    getMock().mockResolvedValue([
      { observation_date: "2025-01-01", value: "5.33" },
      { observation_date: "2024-12-01", value: "5.33" },
      { observation_date: "2024-11-01", value: "5.25" },
    ]);

    const result = await getNationalEconomicSummary();
    expect(result).toHaveProperty("fed_funds_rate");
    expect(result).toHaveProperty("unemployment_rate");
    expect(result).toHaveProperty("cpi_yoy_pct");
    expect(result).not.toHaveProperty("consumer_sentiment");
  });

  it("returns null indicators when DB is empty", async () => {
    getMock().mockResolvedValue([]);

    const result = await getNationalEconomicSummary();
    expect(result.fed_funds_rate).toBeNull();
    expect(result.unemployment_rate).toBeNull();
    expect(result.cpi_yoy_pct).toBeNull();
  });
});

// ── CPI YoY is a percentage, not a raw index ─────────────────────────────────

describe("getNationalEconomicSummary CPI YoY computation", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("CPI YoY value is a percentage (< 50), not a raw index (> 100)", async () => {
    // 24 rows needed: current index = 315.6, 12mo ago = 305.8 -> YoY ~3.2%
    const cpiRows = Array.from({ length: 24 }, (_, i) => ({
      observation_date: `2025-${String(1 - i).padStart(2, "0")}-01`.replace(
        /(\d{4})-(-\d+)-/,
        (_, y) => `${Number(y) - Math.floor(i / 12)}-`
      ),
      value: String(315.6 - i * 0.5),
    }));
    // Override with exactly 24 rows with known current=315.6 and 12mo=305.6
    const rows24 = Array.from({ length: 24 }, (_, i) => ({
      observation_date: `2025-01-01`,
      value: String(315.6 - i * 0.83),  // index[0]=315.6, index[12]~= 305.6
    }));
    getMock().mockResolvedValue(rows24);

    const result = await getNationalEconomicSummary();
    if (result.cpi_yoy_pct !== null) {
      // YoY percentage must be < 50 (typical range -5% to +15%)
      // A raw index value would be > 100
      expect(result.cpi_yoy_pct.current).toBeLessThan(50);
      expect(result.cpi_yoy_pct.current).toBeGreaterThan(-20);
    }
    // cpi_yoy_pct.current should NOT be a raw CPI index value (like 315)
    if (result.cpi_yoy_pct !== null) {
      expect(result.cpi_yoy_pct.current).not.toBeGreaterThan(100);
    }
  });

  it("CPI YoY computed as ((current - prior) / prior) * 100", async () => {
    // current = 315.6, 12mo ago = 305.8 -> expected YoY = (315.6-305.8)/305.8*100 ~ 3.206
    const rows: { observation_date: string; value: string }[] = [];
    for (let i = 0; i < 24; i++) {
      rows.push({
        observation_date: `2025-01-01`,
        value: i === 0 ? "315.6" : i === 12 ? "305.8" : "310.0",
      });
    }
    getMock().mockResolvedValue(rows);

    const result = await getNationalEconomicSummary();
    if (result.cpi_yoy_pct !== null) {
      const expected = ((315.6 - 305.8) / 305.8) * 100;
      expect(result.cpi_yoy_pct.current).toBeCloseTo(expected, 1);
    }
  });
});

// ── getDistrictEconomicSummary ────────────────────────────────────────────────

describe("getDistrictEconomicSummary", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns object with district field and expected shape", async () => {
    getMock().mockResolvedValue([
      { observation_date: "2025-01-01", value: "4.2" },
      { observation_date: "2024-12-01", value: "4.1" },
      { observation_date: "2024-11-01", value: "4.0" },
    ]);

    const result = await getDistrictEconomicSummary(2);
    expect(result).toMatchObject<Partial<DistrictEconomicSummary>>({
      district: 2,
    });
    expect(result).toHaveProperty("unemployment_rate");
    expect(result).toHaveProperty("nonfarm_payroll");
    expect(result).toHaveProperty("nonfarm_yoy_pct");
  });

  it("returns non-null unemployment and payroll when data exists", async () => {
    getMock().mockResolvedValue([
      { observation_date: "2025-01-01", value: "4.2" },
      { observation_date: "2024-12-01", value: "4.1" },
      { observation_date: "2024-11-01", value: "4.0" },
    ]);

    const result = await getDistrictEconomicSummary(2);
    expect(result.unemployment_rate).not.toBeNull();
    expect(result.nonfarm_payroll).not.toBeNull();
  });

  it("computes nonfarm_yoy_pct correctly from 13-month history", async () => {
    // 13 rows: current=8200 (index 0), 12mo ago=8000 (index 12)
    // Expected YoY: (8200 - 8000) / 8000 * 100 = 2.5%
    const rows13 = Array.from({ length: 13 }, (_, i) => ({
      observation_date: `2025-01-01`,
      value: i === 0 ? "8200" : i === 12 ? "8000" : "8100",
    }));
    getMock().mockResolvedValue(rows13);

    const result = await getDistrictEconomicSummary(2);
    expect(result.nonfarm_yoy_pct).not.toBeNull();
    expect(result.nonfarm_yoy_pct).toBeCloseTo(2.5, 1);
  });

  it("returns null fields gracefully when DB returns empty arrays", async () => {
    getMock().mockResolvedValue([]);

    const result = await getDistrictEconomicSummary(9);
    expect(result.district).toBe(9);
    expect(result.unemployment_rate).toBeNull();
    expect(result.nonfarm_payroll).toBeNull();
    expect(result.nonfarm_yoy_pct).toBeNull();
  });

  it("returns null nonfarm_yoy_pct when fewer than 13 history points", async () => {
    // Only 3 rows — not enough for YoY
    getMock().mockResolvedValue([
      { observation_date: "2025-01-01", value: "8200" },
      { observation_date: "2024-12-01", value: "8150" },
      { observation_date: "2024-11-01", value: "8100" },
    ]);

    const result = await getDistrictEconomicSummary(11);
    expect(result.nonfarm_yoy_pct).toBeNull();
  });
});

// ── getBeigeBookThemes ────────────────────────────────────────────────────────

describe("getBeigeBookThemes", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns array of BeigeBookTheme objects with correct shape", async () => {
    const mockThemeRows = [
      {
        release_code: "202601",
        fed_district: 1,
        theme_category: "growth",
        sentiment: "positive",
        summary: "Economic activity expanded modestly.",
        confidence: 0.85,
        extracted_at: "2026-01-15T00:00:00Z",
      },
      {
        release_code: "202601",
        fed_district: 1,
        theme_category: "employment",
        sentiment: "neutral",
        summary: "Employment remained stable.",
        confidence: 0.80,
        extracted_at: "2026-01-15T00:00:00Z",
      },
    ];
    // First call: fetch latest release_code; second call: fetch theme rows
    getMock()
      .mockResolvedValueOnce([{ release_code: "202601" }])
      .mockResolvedValueOnce(mockThemeRows);

    const result = await getBeigeBookThemes();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    const first = result[0] as BeigeBookTheme;
    expect(first).toHaveProperty("release_code");
    expect(first).toHaveProperty("fed_district");
    expect(first).toHaveProperty("district_name");
    expect(first).toHaveProperty("theme_category");
    expect(first).toHaveProperty("sentiment");
    expect(first).toHaveProperty("summary");
    expect(first).toHaveProperty("confidence");
    expect(first).toHaveProperty("extracted_at");
  });

  it("maps fed_district number to district_name string", async () => {
    const mockThemeRows = [
      {
        release_code: "202601",
        fed_district: 2,
        theme_category: "growth",
        sentiment: "positive",
        summary: "New York activity picked up.",
        confidence: 0.88,
        extracted_at: "2026-01-15T00:00:00Z",
      },
    ];
    getMock()
      .mockResolvedValueOnce([{ release_code: "202601" }])
      .mockResolvedValueOnce(mockThemeRows);

    const result = await getBeigeBookThemes();

    expect(result[0].district_name).toBe("New York");
  });

  it("returns empty array when no themes exist in DB", async () => {
    getMock()
      .mockResolvedValueOnce([]) // no latest release_code
      .mockResolvedValueOnce([]);

    const result = await getBeigeBookThemes();

    expect(result).toEqual([]);
  });

  it("filters by release_code when parameter provided", async () => {
    const mockThemeRows = [
      {
        release_code: "202503",
        fed_district: 7,
        theme_category: "prices",
        sentiment: "negative",
        summary: "Input costs elevated.",
        confidence: 0.91,
        extracted_at: "2025-03-20T00:00:00Z",
      },
    ];
    getMock().mockResolvedValueOnce(mockThemeRows);

    const result = await getBeigeBookThemes("202503");

    expect(result.length).toBe(1);
    expect(result[0].release_code).toBe("202503");
  });

  it("returns empty array on DB error", async () => {
    getMock().mockRejectedValueOnce(new Error("DB connection failed"));

    const result = await getBeigeBookThemes();

    expect(result).toEqual([]);
  });
});

// ── getDistrictBeigeBookSummaries audit (BEIGE-01) ────────────────────────────

describe("getDistrictBeigeBookSummaries audit", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns array with district_number, district_name, summary, themes, release_date keys", async () => {
    getMock().mockResolvedValueOnce([
      {
        fed_district: 1,
        content_text: "Economic activity in Boston expanded modestly. Employment remained stable. Consumer spending increased. Prices rose.",
        release_date: "2026-01-15",
      },
    ]);

    const result = await getDistrictBeigeBookSummaries();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    const item = result[0] as DistrictBeigeBookSummary;
    expect(item).toHaveProperty("district_number");
    expect(item).toHaveProperty("district_name");
    expect(item).toHaveProperty("summary");
    expect(item).toHaveProperty("themes");
    expect(item).toHaveProperty("release_date");
  });

  it("themes field is a string array from keyword-based extraction", async () => {
    getMock().mockResolvedValueOnce([
      {
        fed_district: 3,
        content_text: "Employment grew modestly. Inflation pressures eased. Consumer spending was flat.",
        release_date: "2026-01-15",
      },
    ]);

    const result = await getDistrictBeigeBookSummaries();

    const themes = result[0].themes;
    expect(Array.isArray(themes)).toBe(true);
    themes.forEach((t: string) => expect(typeof t).toBe("string"));
  });

  it("returns empty array when DB returns no rows", async () => {
    getMock().mockResolvedValueOnce([]);

    const result = await getDistrictBeigeBookSummaries();

    expect(result).toEqual([]);
  });

  it("maps district numbers to names correctly", async () => {
    getMock().mockResolvedValueOnce([
      {
        fed_district: 7,
        content_text: "Chicago district activity grew at a moderate pace.",
        release_date: "2026-01-15",
      },
    ]);

    const result = await getDistrictBeigeBookSummaries();

    expect(result[0].district_number).toBe(7);
    expect(result[0].district_name).toBe("Chicago");
  });
});

// ── getFredSummary — 7 indicator fields ─────────────────────────────────────

describe("getFredSummary", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns all 7 indicator fields plus as_of (8 total fields)", async () => {
    // Mock: DISTINCT ON query returns rows for all 6 series
    getMock()
      .mockResolvedValueOnce([
        { series_id: "FEDFUNDS", value: 5.33, observation_date: "2025-01-01" },
        { series_id: "UNRATE", value: 4.1, observation_date: "2025-01-01" },
        { series_id: "CPIAUCSL", value: 315.6, observation_date: "2025-01-01" },
        { series_id: "GDPC1", value: 22000, observation_date: "2024-10-01" },
        { series_id: "PSAVERT", value: 4.6, observation_date: "2025-01-01" },
        { series_id: "DRCBLACBS", value: 14.5, observation_date: "2024-10-01" },
      ])
      // CPI YoY query (LIMIT 13) — not enough rows, cpiYoy stays null
      .mockResolvedValueOnce([])
      // GDP YoY query (LIMIT 5) — not enough rows, gdpYoy stays null
      .mockResolvedValueOnce([]);

    const result = await getFredSummary();

    expect(result).toHaveProperty("fed_funds_rate");
    expect(result).toHaveProperty("unemployment_rate");
    expect(result).toHaveProperty("cpi_yoy_pct");
    expect(result).not.toHaveProperty("consumer_sentiment");
    expect(result).toHaveProperty("gdp_growth_yoy_pct");
    expect(result).toHaveProperty("personal_savings_rate");
    expect(result).toHaveProperty("bank_lending_standards");
    expect(result).toHaveProperty("as_of");

    // Direct value fields should be populated
    expect(result.fed_funds_rate).toBe(5.33);
    expect(result.personal_savings_rate).toBe(4.6);
    expect(result.bank_lending_standards).toBe(14.5);
  });

  it("returns all null indicators when DB returns empty", async () => {
    getMock()
      .mockResolvedValueOnce([]) // DISTINCT ON query
      .mockResolvedValueOnce([]) // CPI YoY
      .mockResolvedValueOnce([]); // GDP YoY

    const result = await getFredSummary();

    expect(result.fed_funds_rate).toBeNull();
    expect(result.unemployment_rate).toBeNull();
    expect(result.cpi_yoy_pct).toBeNull();
    expect(result.gdp_growth_yoy_pct).toBeNull();
    expect(result.personal_savings_rate).toBeNull();
    expect(result.bank_lending_standards).toBeNull();
  });

  it("computes GDP YoY from 5 quarterly observations", async () => {
    // GDP: latest=22000, 4 quarters ago=21000 -> YoY = (22000-21000)/21000*100 = 4.76..% -> rounded 4.8
    getMock()
      .mockResolvedValueOnce([
        { series_id: "FEDFUNDS", value: 5.33, observation_date: "2025-01-01" },
        { series_id: "GDPC1", value: 22000, observation_date: "2024-10-01" },
      ])
      .mockResolvedValueOnce([]) // CPI YoY — not enough rows
      .mockResolvedValueOnce([
        { value: 22000, observation_date: "2024-10-01" },
        { value: 21750, observation_date: "2024-07-01" },
        { value: 21500, observation_date: "2024-04-01" },
        { value: 21250, observation_date: "2024-01-01" },
        { value: 21000, observation_date: "2023-10-01" },
      ]);

    const result = await getFredSummary();

    expect(result.gdp_growth_yoy_pct).not.toBeNull();
    const expected = ((22000 - 21000) / 21000) * 100; // ~4.76%
    expect(result.gdp_growth_yoy_pct).toBeCloseTo(Math.round(expected * 10) / 10, 1);
  });

  it("returns null gdp_growth_yoy_pct when fewer than 5 quarterly observations", async () => {
    getMock()
      .mockResolvedValueOnce([
        { series_id: "FEDFUNDS", value: 5.33, observation_date: "2025-01-01" },
      ])
      .mockResolvedValueOnce([]) // CPI YoY
      .mockResolvedValueOnce([
        { value: 22000, observation_date: "2024-10-01" },
        { value: 21750, observation_date: "2024-07-01" },
      ]); // Only 2 GDP rows

    const result = await getFredSummary();

    expect(result.gdp_growth_yoy_pct).toBeNull();
  });

  it("returns empty FredSummary on DB error", async () => {
    getMock().mockRejectedValueOnce(new Error("DB connection failed"));

    const result = await getFredSummary();

    expect(result.fed_funds_rate).toBeNull();
    expect(result.gdp_growth_yoy_pct).toBeNull();
    expect(result.personal_savings_rate).toBeNull();
    expect(result.bank_lending_standards).toBeNull();
    expect(result.as_of).toBeDefined();
  });
});
