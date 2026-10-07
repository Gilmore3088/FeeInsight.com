import { describe, expect, it } from "vitest";
import { BLS_SERIES_TITLES, blsSeriesRequest, CPI_BANK_SERVICES_SERIES, parseBlsCatalogTitle, REQUIRED_FRED_SERIES } from "./fed";

describe("blsSeriesRequest", () => {
  const now = new Date("2026-10-05T00:00:00Z");

  it("asks the keyless v1 API for seven calendar years", () => {
    expect(blsSeriesRequest("CUUR0000SS68021", null, now)).toEqual({
      url: "https://api.bls.gov/publicAPI/v1/timeseries/data/",
      json: { seriesid: ["CUUR0000SS68021"], startyear: "2020", endyear: "2026" },
    });
  });

  it("uses v2 with the registration key when one is set", () => {
    expect(blsSeriesRequest("CUUR0000SA0", "k", now)).toEqual({
      url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
      json: { seriesid: ["CUUR0000SA0"], startyear: "2020", endyear: "2026", registrationkey: "k", catalog: true },
    });
  });
});

describe("CPI bank services series", () => {
  it("tracks SS68021 and labels SEMC01 as the medical series it is", () => {
    expect(CPI_BANK_SERVICES_SERIES).toBe("CUUR0000SS68021");
    expect(REQUIRED_FRED_SERIES.map((s) => s.series_id)).toContain("CUUR0000SS68021");
    expect(BLS_SERIES_TITLES.CUUR0000SEMC01).toMatch(/Physicians/);
  });

  it("reads BLS's catalog title when present", () => {
    expect(parseBlsCatalogTitle({ Results: { series: [{ catalog: { series_title: " Checking account and other bank services in U.S. city average " } }] } })).toBe(
      "Checking account and other bank services in U.S. city average",
    );
    expect(parseBlsCatalogTitle({ Results: { series: [{}] } })).toBeNull();
  });
});
