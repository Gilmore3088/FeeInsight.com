import { describe, expect, it } from "vitest";
import { blsSeriesRequest } from "./fed";

describe("blsSeriesRequest", () => {
  const now = new Date("2026-10-05T00:00:00Z");

  it("asks the keyless v1 API for seven calendar years", () => {
    expect(blsSeriesRequest("CUUR0000SEMC01", null, now)).toEqual({
      url: "https://api.bls.gov/publicAPI/v1/timeseries/data/",
      json: { seriesid: ["CUUR0000SEMC01"], startyear: "2020", endyear: "2026" },
    });
  });

  it("uses v2 with the registration key when one is set", () => {
    expect(blsSeriesRequest("CUUR0000SA0", "k", now)).toEqual({
      url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
      json: { seriesid: ["CUUR0000SA0"], startyear: "2020", endyear: "2026", registrationkey: "k" },
    });
  });
});
