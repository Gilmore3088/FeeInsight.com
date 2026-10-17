import { describe, expect, it, vi } from "vitest";

import {
  FHLB_BANKS,
  fetchFhlbAdvanceRates,
  fhlbBank,
  fhlbRateRows,
  fhlbUrlEnv,
  pageVerdict,
  pdfRateTable,
  postedDate,
  rateValue,
  readRateTable,
  termKey,
} from "./fhlb-advance-rates";
import { readHtmlTables } from "./industry-events";

const RATE_PAGE = `
<html><body>
<h1>Advance Rates</h1>
<p>Rates as of Thursday, October 15, 2026 at 8:00 a.m. ET. Rates are indicative and subject to change.</p>
<table>
  <thead><tr><th>Term</th><th>Classic Advance</th><th>Amortizing Advance</th><th>SOFR Spread (bps)</th></tr></thead>
  <tbody>
    <tr><td>Overnight</td><td>4.35</td><td>N/A</td><td>12</td></tr>
    <tr><td>1 Month</td><td>4.41%</td><td>--</td><td>14</td></tr>
    <tr><td>3 Mo</td><td>4.38</td><td>4.52</td><td>16</td></tr>
    <tr><td>1 Year</td><td>4.12</td><td>4.30</td><td></td></tr>
    <tr><td>1.5 Yr</td><td>4.05</td><td>4.21</td><td></td></tr>
    <tr><td>Callable options</td><td>Call</td><td></td><td></td></tr>
  </tbody>
</table>
<a href="/login">Member Login</a>
</body></html>`;

const ACROSS_PAGE = `<p>Effective: 10/16/2026</p>
<table><tr><th>Product</th><th>1 Month</th><th>6 Months</th><th>2 Years</th></tr>
<tr><td>Fixed Rate</td><td>4.40</td><td>4.25</td><td>3.98</td></tr>
<tr><td>Putable</td><td></td><td>3.90</td><td>3.70</td></tr></table>`;

const LOGIN_PAGE = `<html><body><h1>Rates</h1><p>Member login required to view current rates.</p>
<form><input type="text" name="user"><input type="password" name="pw"></form></body></html>`;

const IMAGE_PAGE = `<html><body><h1>Rates</h1><img src="/media/daily-rate-sheet.png" alt="Daily rates"></body></html>`;

function page(body: string, contentType = "text/html") {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("FHLB advance rate parsing", () => {
  it("lists all eleven FHLBanks with an override variable each", () => {
    expect(FHLB_BANKS).toHaveLength(11);
    expect(new Set(FHLB_BANKS.map((b) => b.district)).size).toBe(11);
    expect(fhlbUrlEnv(fhlbBank("des-moines")!)).toBe("FHLB_DES_MOINES_RATES_URL");
  });

  it("reads term labels and refuses anything else", () => {
    expect(termKey("Overnight")).toBe("overnight");
    expect(termKey("30 Day")).toBe("30d");
    expect(termKey("3 Mo")).toBe("3m");
    expect(termKey("1 Year")).toBe("1y");
    expect(termKey("1.5 Yr")).toBe("1_5y");
    expect(termKey("2 Weeks")).toBe("2w");
    expect(termKey("Callable options")).toBeNull();
    expect(termKey("")).toBeNull();
  });

  it("reads rate cells and leaves non-numbers null", () => {
    expect(rateValue("4.41%")).toBe(4.41);
    expect(rateValue(" 4.520 ")).toBe(4.52);
    expect(rateValue("N/A")).toBeNull();
    expect(rateValue("--")).toBeNull();
    expect(rateValue("")).toBeNull();
    expect(rateValue("2026")).toBeNull();
  });

  it("reads the stated posting date only", () => {
    expect(postedDate("Rates as of Thursday, October 15, 2026 at 8:00")).toBe("2026-10-15");
    expect(postedDate("Effective: 10/16/2026")).toBe("2026-10-16");
    expect(postedDate("Effective 10/16/26")).toBe("2026-10-16");
    expect(postedDate("Daily rates for members")).toBeNull();
  });

  it("reads a terms-down table and keeps blanks as null with the cell text", () => {
    const read = readRateTable(readHtmlTables(RATE_PAGE)[0], 0)!;
    expect(read.orientation).toBe("terms_down");
    expect(read.unreadTerms).toEqual(["Callable options"]);
    const rows = fhlbRateRows(fhlbBank("boston")!, { url: "https://x/rates", postedDate: "2026-10-15", tables: [read] });
    const byKey = Object.fromEntries(rows.map((r) => [r.series_key, r]));
    expect(byKey.fhlb_boston_classic_advance_overnight).toMatchObject({ value: 4.35, unit: "percent", period: "2026-10-15", geo_type: "nation", geo_code: "US" });
    expect(byKey.fhlb_boston_amortizing_advance_overnight).toMatchObject({ value: null, note: "N/A" });
    expect(byKey.fhlb_boston_amortizing_advance_1m).toMatchObject({ value: null, note: "--" });
    expect(byKey.fhlb_boston_classic_advance_1_5y.value).toBe(4.05);
    expect(byKey.fhlb_boston_sofr_spread_bps_3m).toMatchObject({ value: 16, unit: "basis_points" });
    expect(byKey.fhlb_boston_sofr_spread_bps_1y).toMatchObject({ value: null, note: "blank" });
    expect(byKey.fhlb_boston_classic_advance_overnight.raw).toMatchObject({ fhlbank: "boston", term_label: "Overnight", product_label: "Classic Advance" });
  });

  it("reads a terms-across table", () => {
    const read = readRateTable(readHtmlTables(ACROSS_PAGE)[0], 0)!;
    expect(read.orientation).toBe("terms_across");
    const rows = fhlbRateRows(fhlbBank("dallas")!, { url: "u", postedDate: "2026-10-16", tables: [read] });
    expect(rows.find((r) => r.series_key === "fhlb_dallas_fixed_rate_2y")?.value).toBe(3.98);
    expect(rows.find((r) => r.series_key === "fhlb_dallas_putable_1m")).toMatchObject({ value: null, note: "blank" });
  });

  it("keeps a product name shared by two tables apart", () => {
    const t = [["Term", "Fixed"], ["1 Month", "4.1"]];
    const rows = fhlbRateRows(fhlbBank("topeka")!, { url: "u", postedDate: "2026-10-16", tables: [readRateTable(t, 0)!, readRateTable(t, 1)!] });
    expect(rows.map((r) => r.series_key)).toEqual(["fhlb_topeka_fixed_1m", "fhlb_topeka_fixed_t1_1m"]);
  });

  it("reads PDF lines only when the header gives one label per column", () => {
    const text = "Daily Rates\nRates as of October 15, 2026\nTerm  Fixed Rate  Amortizing\n1 Month 4.40 4.55\n3 Months 4.35 N/A\nDisclaimer text";
    expect(pdfRateTable(text)).toEqual([["Term", "Fixed Rate", "Amortizing"], ["1 Month", "4.40", "4.55"], ["3 Months", "4.35", "N/A"]]);
    expect(pdfRateTable("Term Fixed Rate Amortizing\n1 Month 4.40 4.55")).toEqual([]);
    expect(pdfRateTable("1 Month 4.40 4.55")).toEqual([]);
  });

  it("tells a login page from an image page from an empty one", () => {
    expect(pageVerdict(LOGIN_PAGE, 0)).toBe("member_login");
    expect(pageVerdict('<p>Please enter your work email address below</p><img src="WithoutRates.png">', 0)).toBe("member_login");
    expect(pageVerdict(IMAGE_PAGE, 0)).toBe("images_only");
    expect(pageVerdict("<html><p>About us</p></html>", 0)).toBe("no_rate_table");
  });
});

describe("fetchFhlbAdvanceRates", () => {
  const options = { backoffMs: 0, retries: 0 };

  it("loads a public table with its posted date", async () => {
    const fetchImpl = vi.fn(async () => page(RATE_PAGE)) as unknown as typeof fetch;
    const out = await fetchFhlbAdvanceRates(fhlbBank("boston")!, { ...options, fetchImpl }, {});
    expect(out.verdict).toBe("rates");
    expect(out.emptyReason).toBeNull();
    expect(out.rows.length).toBe(15);
    expect(out.rows.every((r) => r.period === "2026-10-15")).toBe(true);
  });

  it("stores nothing when the page states no posted date", async () => {
    const undated = RATE_PAGE.replace(/Rates as of[^<]*/, "Indicative rates.");
    const fetchImpl = vi.fn(async () => page(undated)) as unknown as typeof fetch;
    const out = await fetchFhlbAdvanceRates(fhlbBank("boston")!, { ...options, fetchImpl }, {});
    expect(out.rows).toEqual([]);
    expect(out.missingFields).toEqual(["posted_date"]);
    expect(out.emptyReason).toMatch(/no posted date/);
  });

  it("records a members-only bank as skipped with the reason, after trying every address", async () => {
    const fetchImpl = vi.fn(async (url: string) => (String(url) === "https://www.fhlbc.com/rates" ? page(LOGIN_PAGE) : new Response("nf", { status: 404 }))) as unknown as typeof fetch;
    const out = await fetchFhlbAdvanceRates(fhlbBank("chicago")!, { ...options, fetchImpl }, {});
    expect(out.verdict).toBe("member_login");
    expect(out.emptyReason).toMatch(/member login/);
    expect(out.tried.map((t) => t.status)).toEqual(["member_login", "http_404"]);
  });

  it("tries the configured address first", async () => {
    const fetchImpl = vi.fn(async () => page(ACROSS_PAGE)) as unknown as typeof fetch;
    const out = await fetchFhlbAdvanceRates(fhlbBank("dallas")!, { ...options, fetchImpl }, { FHLB_DALLAS_RATES_URL: "https://example.test/dallas.html" });
    expect(out.url).toBe("https://example.test/dallas.html");
    expect(out.rows.length).toBe(6);
  });

  it("follows a linked CSV rate sheet when the page has no table", async () => {
    const html = `<p>Rates posted October 14, 2026</p><a href="/files/daily-rates.csv">Daily rates (CSV)</a>`;
    const csv = "Term,Fixed Rate\n1 Month,4.50\n1 Year,4.10\n";
    const fetchImpl = vi.fn(async (url: string) => (String(url).endsWith(".csv") ? page(csv, "text/csv") : page(html))) as unknown as typeof fetch;
    const out = await fetchFhlbAdvanceRates(fhlbBank("pittsburgh")!, { ...options, fetchImpl }, {});
    expect(out.url).toMatch(/daily-rates\.csv$/);
    expect(out.rows.map((r) => [r.series_key, r.value, r.period])).toEqual([
      ["fhlb_pittsburgh_fixed_rate_1m", 4.5, "2026-10-14"],
      ["fhlb_pittsburgh_fixed_rate_1y", 4.1, "2026-10-14"],
    ]);
  });
});
