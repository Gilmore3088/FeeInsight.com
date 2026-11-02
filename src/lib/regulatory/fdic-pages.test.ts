import { describe, expect, it, vi } from "vitest";

import { FDIC_PREVIOUS_RATES_PAGE, FDIC_RATE_PAGE } from "./fdic-pages-fixtures";
import {
  FDIC_NATIONAL_RATES_PREVIOUS_URL,
  FDIC_NATIONAL_RATES_URL,
  fdicNumber,
  fdicRatePageLinks,
  fdicSurveyAppendixUrl,
  fetchFdicNationalRates,
  fetchFdicSurveyAppendix,
  parseFdicRatePage,
  parseFdicSurveyStateTable,
  rateCapAsOf,
} from "./fdic-pages";

const value = (rows: { series_key: string; geo_code: string; value: number | null }[], key: string, geo = "US") =>
  rows.find((r) => r.series_key === key && r.geo_code === geo)?.value;

describe("FDIC national rates and rate caps", () => {
  it("reads numbers with a footnote dot and leaves suppressed cells null", () => {
    expect(fdicNumber("5.00.")).toBe(5);
    expect(fdicNumber("4.63")).toBe(4.63);
    expect(fdicNumber("–")).toBeNull();
    expect(fdicNumber("")).toBeNull();
  });

  it("reads the as-of date from the page heading", () => {
    expect(rateCapAsOf(FDIC_RATE_PAGE)).toBe("2026-10-19");
    expect(rateCapAsOf("<h2>Rates</h2>")).toBeNull();
  });

  it("reads every product and column of the live table, footnote marks removed", () => {
    const r = parseFdicRatePage(FDIC_RATE_PAGE, FDIC_NATIONAL_RATES_URL);
    expect(r.emptyReason).toBeNull();
    expect(r.missingFields).toEqual([]);
    // 11 products x 5 columns.
    expect(r.rows).toHaveLength(55);
    expect(new Set(r.rows.map((x) => x.period))).toEqual(new Set(["2026-10"]));
    expect(value(r.rows, "fdic_national_rate_national_rate_savings")).toBe(0.38);
    expect(value(r.rows, "fdic_national_rate_national_rate_cap_12_month_cd")).toBe(6.2);
    expect(value(r.rows, "fdic_national_rate_national_rate_cap_adjusted_interest_checking")).toBe(0.82);
    // "5.00." carries footnote 4 in the live table.
    expect(value(r.rows, "fdic_national_rate_treasury_yield_48_month_cd")).toBe(5);
    expect(r.rows.every((x) => x.value !== null)).toBe(true);
  });

  it("refuses a page without the as-of line or the table", () => {
    expect(parseFdicRatePage("<p>none</p>", "u").emptyReason).toMatch(/as of/);
    expect(parseFdicRatePage("<h2>Monthly Rate Cap Information as of May 1, 2026</h2>", "u").emptyReason).toMatch(/Deposit Products/);
  });

  it("finds the monthly pages linked from Previous Rates, once each", () => {
    expect(fdicRatePageLinks(FDIC_PREVIOUS_RATES_PAGE)).toEqual([
      "https://www.fdic.gov/national-rates-and-rate-caps/national-rates-and-rate-caps-june-2026",
      "https://www.fdic.gov/national-rates-and-rate-caps/national-rates-and-rate-caps-october-2026",
      "https://www.fdic.gov/national-rates-and-rate-caps/national-rates-and-rate-caps-september-2026",
      "https://www.fdic.gov/national-rates-and-rate-caps/national-rates-and-rate-caps-august-2026",
    ]);
  });

  it("reads the current page and each month, keeping one copy of a month read twice", async () => {
    const september = FDIC_RATE_PAGE.replace("October 19, 2026", "September 21, 2026");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === FDIC_NATIONAL_RATES_URL) return new Response(FDIC_RATE_PAGE);
      if (url === FDIC_NATIONAL_RATES_PREVIOUS_URL) return new Response(FDIC_PREVIOUS_RATES_PAGE);
      if (url.endsWith("october-2026")) return new Response(FDIC_RATE_PAGE);
      if (url.endsWith("september-2026")) return new Response(september);
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await fetchFdicNationalRates({ fetchImpl, backoffMs: 0 });
    expect(new Set(r.rows.map((x) => x.period))).toEqual(new Set(["2026-10", "2026-09"]));
    expect(r.rows).toHaveLength(110);
    expect(r.skipped.month_already_read).toBe(1);
    expect(r.unavailableParts?.map((p) => p.key.replace(/^.*caps-/, ""))).toEqual(["june-2026", "august-2026"]);
  });
});

/** Table G.2 lines as unpdf read them from the 2023 appendix tables (pages 73-74), shortened. */
const G2_PAGES = [
  "2023 FDIC National Survey of Unbanked and Underbanked Households | APPENDIX TABLES | IV\nG.2 Fully Banked, Underbanked, and Unbanked Rates by State, 2023 ....... 73\n",
  [
    "2023 FDIC National Survey of Unbanked and Underbanked Households | APPENDIX TABLES | 73",
    "G.2 Fully Banked, Underbanked, and Unbanked Rates by State, 2023",
    "All Households, Row Percent",
    "Geography Number of Households",
    "(1000s) Percent of Households Fully Banked Underbanked Unbanked",
    "All 133,682 100.0 81.6 14.2 4.2",
    "State",
    "AL 2,249 100.0 79.6 15.2 5.2",
    "DC 338 100.0 75.8 17.0 7.2",
  ].join("\n"),
  [
    "74 | APPENDIX TABLES | 2023 FDIC National Survey of Unbanked and Underbanked Households",
    "G.2 Fully Banked, Underbanked, and Unbanked Rates by State, 2023 (continued)",
    "TX 11,226 100.0 75.0 18.5 6.5",
    "ZZ 1 100.0 1.0 1.0 1.0",
    "WY 244 100.0 83.0 15.2 –",
  ].join("\n"),
  "G.3 Fully Banked, Underbanked, and Unbanked Rates by MSA, 2023\nAll 133,682 100.0 81.6 14.2 4.2\nAK 9 100.0 1.0 1.0 1.0",
];

describe("FDIC household survey table G.2", () => {
  it("reads the national and state rows, skips the contents page, other tables and unknown codes", () => {
    const r = parseFdicSurveyStateTable(G2_PAGES, 2023, fdicSurveyAppendixUrl(2023));
    expect(r.emptyReason).toBeNull();
    expect(value(r.rows, "fdic_unbanked_share")).toBe(4.2);
    expect(value(r.rows, "fdic_underbanked_share")).toBe(14.2);
    expect(value(r.rows, "fdic_fully_banked_share", "TX")).toBe(75);
    expect(value(r.rows, "fdic_survey_households_thousands", "TX")).toBe(11226);
    expect(value(r.rows, "fdic_unbanked_share", "DC")).toBe(7.2);
    expect(value(r.rows, "fdic_unbanked_share", "AK")).toBeUndefined();
    const wy = r.rows.find((x) => x.geo_code === "WY" && x.series_key === "fdic_unbanked_share");
    expect(wy?.value).toBeNull();
    expect(wy?.note).toBe("–");
    expect(r.skipped.unknown_state_code).toBe(1);
    expect(new Set(r.rows.map((x) => x.geo_code))).toEqual(new Set(["US", "AL", "DC", "TX", "WY"]));
    expect(r.rows.every((x) => x.period === "2023")).toBe(true);
    expect(r.missingFields).toEqual(["47 of 51 state rows"]);
  });

  it("names the gap when the table is missing", () => {
    expect(parseFdicSurveyStateTable(["A.1 Distributions"], 2023, "u").emptyReason).toMatch(/G\.2/);
  });

  it("records a year with no appendix tables as empty and refuses a non-PDF answer", async () => {
    const missing = vi.fn(async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect((await fetchFdicSurveyAppendix(2021, { fetchImpl: missing, backoffMs: 0 })).emptyReason).toMatch(/No 2021 appendix tables/);
    const html = vi.fn(async () => new Response("<html></html>")) as unknown as typeof fetch;
    expect((await fetchFdicSurveyAppendix(2023, { fetchImpl: html, backoffMs: 0 })).emptyReason).toMatch(/did not return a PDF/);
  });
});
