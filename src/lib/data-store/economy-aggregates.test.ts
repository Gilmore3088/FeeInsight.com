import { describe, expect, it } from "vitest";

import { latestPerSeries, normalizeGeoCode, withLmiShare, withRemittanceAttribution } from "./economy-aggregates";

describe("economy aggregates helpers", () => {
  it("normalises area codes and refuses malformed ones", () => {
    expect(normalizeGeoCode("state", "tx")).toBe("TX");
    expect(normalizeGeoCode("state", "48")).toBe("TX");
    expect(normalizeGeoCode("state", "72")).toBe("PR");
    expect(normalizeGeoCode("county", "1001")).toBe("01001");
    expect(normalizeGeoCode("metro", "1018")).toBeNull();
    expect(normalizeGeoCode("nation", "anything")).toBe("US");
  });

  it("keeps the newest period per series with the one before it", () => {
    const base = { source: "bls-qcew", unit: "jobs", note: null, geo_name: null };
    const out = latestPerSeries([
      { ...base, series_key: "qcew_employment", period: "2024", value: 10 },
      { ...base, series_key: "qcew_employment", period: "2025", value: 12 },
      { ...base, source: "fhfa-hpi", series_key: "fhfa_hpi_all_transactions", period: "2026Q2", value: null },
    ]);
    expect(out).toEqual([
      expect.objectContaining({ series_key: "qcew_employment", period: "2025", value: 12, previous_period: "2024", previous_value: 10 }),
      expect.objectContaining({ series_key: "fhfa_hpi_all_transactions", value: null, previous_period: null }),
    ]);
  });

  it("carries the Urban Institute attribution on Debt in America rows, and none on others", () => {
    const base = { unit: "percent", note: null, geo_name: null, period: "2023", value: 30 };
    const out = latestPerSeries([
      { ...base, source: "urban-debt-in-america", series_key: "urban_debt_any" },
      { ...base, source: "bls-qcew", series_key: "qcew_employment" },
    ]);
    expect(out.find((r) => r.source === "bls-qcew")).not.toHaveProperty("attribution");
    expect(out.find((r) => r.source === "urban-debt-in-america")?.attribution).toBe("Braga et al., Debt in America, Urban Institute");
  });

  it("carries the World Bank CC BY 4.0 attribution on every remittance corridor row", () => {
    const [row] = withRemittanceAttribution([{ destination_country: "Mexico", period: "2026Q2", quotes: 12, firms: 5, median_fee: 4.99, median_total_cost_pct: 3.2 }]);
    expect(row).toMatchObject({ licence: "CC BY 4.0", attribution: "The World Bank: Remittance Prices Worldwide" });
  });

  it("gives an LMI share only to groups large enough", () => {
    const row = { group_value: "TX", branches: 10, low: 1, moderate: 2, middle: 4, upper: 3, unknown_level: 0, not_placed: 0 };
    expect(withLmiShare({ ...row, institutions: 5 }).lmi_share).toBe(30);
    expect(withLmiShare({ ...row, institutions: 4 }).lmi_share).toBeNull();
  });
});
