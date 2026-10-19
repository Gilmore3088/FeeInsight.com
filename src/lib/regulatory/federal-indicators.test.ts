import { describe, expect, it } from "vitest";

import { readSdmxPackage } from "./fed-board-data";
import { sdmxPackage } from "./fed-board-fixtures";
import {
  beaNipaUrl,
  beaPeriodDate,
  blsBatchRequest,
  blsBatchSize,
  frbObservations,
  parseBeaNipaLine,
  parseBlsBatch,
  publisherSeriesUrl,
  PUBLISHER_INDICATORS,
} from "./federal-indicators";

/**
 * Reply shapes: BLS as the BLS loader already reads in production (status, Results.series[].data
 * with year/period/value); BEA NIPA records with the fields the BEA API user guide lists for GetData
 * (TableName, SeriesCode, LineNumber, LineDescription, TimePeriod, METRIC_NAME, CL_UNIT, UNIT_MULT,
 * DataValue). Values are illustrative: the hosts could not be reached from the container.
 */
describe("BLS batches", () => {
  it("asks for up to 25 series keyless and 50 with a key, over seven calendar years", () => {
    expect(blsBatchSize(null)).toBe(25);
    expect(blsBatchSize("k")).toBe(50);
    expect(blsBatchRequest(["LNS14000000", "CUSR0000SA0"], null, new Date("2026-10-18T00:00:00Z"))).toEqual({
      url: "https://api.bls.gov/publicAPI/v1/timeseries/data/",
      json: { seriesid: ["LNS14000000", "CUSR0000SA0"], startyear: "2020", endyear: "2026" },
    });
    expect(blsBatchRequest(["LNS14000000"], "k", new Date("2026-10-18T00:00:00Z")).json).toMatchObject({ registrationkey: "k", catalog: true });
  });

  it("splits a reply by series, skipping annual averages and blank months", () => {
    const r = parseBlsBatch({
      status: "REQUEST_SUCCEEDED",
      message: ["No Data Available for Series LASST990000000000003 Year: 2026"],
      Results: {
        series: [
          {
            seriesID: "LNS14000000",
            catalog: { series_title: "(Seas) Unemployment Rate" },
            data: [
              { year: "2026", period: "M09", value: "4.3" },
              { year: "2026", period: "M08", value: "4.2" },
              { year: "2025", period: "M10", value: "-" },
              { year: "2025", period: "M13", value: "4.1" },
            ],
          },
          { seriesID: "LASST990000000000003", data: [] },
        ],
      },
    });
    expect([...r.bySeries.keys()]).toEqual(["LNS14000000"]);
    expect(r.bySeries.get("LNS14000000")).toEqual([
      { observation_date: "2026-08-01", value: 4.2 },
      { observation_date: "2026-09-01", value: 4.3 },
    ]);
    expect(r.catalogTitles).toEqual({ LNS14000000: "(Seas) Unemployment Rate" });
    expect(r.messages[0]).toMatch(/No Data Available/);
    expect(parseBlsBatch({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold"] }).bySeries.size).toBe(0);
  });
});

describe("BEA NIPA tables", () => {
  const body = {
    BEAAPI: {
      Results: {
        Data: [
          { TableName: "T10106", SeriesCode: "A191RX", LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2026Q1", METRIC_NAME: "Chained Dollars", CL_UNIT: "Level", UNIT_MULT: "6", DataValue: "24,012,345", NoteRef: "T10106" },
          { TableName: "T10106", SeriesCode: "A191RX", LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2026Q2", METRIC_NAME: "Chained Dollars", CL_UNIT: "Level", UNIT_MULT: "6", DataValue: "24,150,000", NoteRef: "T10106" },
          { TableName: "T10106", SeriesCode: "DPCERX", LineNumber: "2", LineDescription: "Personal consumption expenditures", TimePeriod: "2026Q2", METRIC_NAME: "Chained Dollars", CL_UNIT: "Level", UNIT_MULT: "6", DataValue: "16,500,000", NoteRef: "T10106" },
        ],
      },
    },
  };

  it("reads one line by its description and scales millions to billions", () => {
    const r = parseBeaNipaLine(body, /^Gross domestic product$/i, 1e9);
    expect(r.problem).toBeNull();
    expect(r.line).toBe("Gross domestic product");
    expect(r.observations).toEqual([
      { observation_date: "2026-01-01", value: 24012.345 },
      { observation_date: "2026-04-01", value: 24150 },
    ]);
  });

  it("names a missing line or a BEA error instead of guessing", () => {
    expect(parseBeaNipaLine(body, /saving rate/i, 1).problem).toMatch(/no line matching/);
    expect(parseBeaNipaLine({ BEAAPI: { Results: { Error: { APIErrorDescription: "Invalid UserID" } } } }, /x/, 1).problem).toBe("Invalid UserID");
  });

  it("dates BEA periods and builds the request", () => {
    expect(beaPeriodDate("2026Q3")).toBe("2026-07-01");
    expect(beaPeriodDate("2026M08")).toBe("2026-08-01");
    expect(beaPeriodDate("2026M8")).toBe("2026-08-01");
    expect(beaPeriodDate("2026")).toBeNull();
    const url = new URL(beaNipaUrl("key", "T10104", "Q", new Date("2026-10-18T00:00:00Z"), 2024));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      UserID: "key",
      method: "GetData",
      datasetname: "NIPA",
      TableName: "T10104",
      Frequency: "Q",
      Year: "2024,2025,2026",
      ResultFormat: "json",
    });
  });
});

describe("Fed Board H.15", () => {
  it("dates monthly fed funds observations from the first of the month and drops no-data months", () => {
    const { found } = readSdmxPackage(
      sdmxPackage("H15_H15", [{ name: "RIFSPFF_N.M", unitMult: "1", obs: [["2026-07", "-9999", "ND"], ["2026-08", "4.33"], ["2026-09", "4.08"]] }]),
      ["RIFSPFF_N.M"],
    );
    expect(frbObservations(found.get("RIFSPFF_N.M"), "monthly")).toEqual([
      { observation_date: "2026-08-01", value: 4.33 },
      { observation_date: "2026-09-01", value: 4.08 },
    ]);
    expect(frbObservations(undefined, "monthly")).toEqual([]);
  });
});

describe("indicator catalogue", () => {
  it("cites the original publisher for every series, never FRED", () => {
    for (const s of PUBLISHER_INDICATORS) expect(publisherSeriesUrl(s)).not.toMatch(/stlouisfed/);
    expect(publisherSeriesUrl(PUBLISHER_INDICATORS.find((s) => s.series_id === "UNRATE")!)).toBe("https://data.bls.gov/timeseries/LNS14000000");
  });
});
