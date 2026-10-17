import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { checkAreaStats } from "./economy";
import {
  FED_PAYMENTS_PAGES,
  NACHA_PAGES,
  dataFileLinks,
  excelSerialDate,
  fetchKcfedSbls,
  fetchPaymentStats,
  fetchSbcs,
  lenderTypeOf,
  pageTables,
  parseKcfedSbls,
  parseSbcsWorkbook,
  parseStatsTables,
  periodOf,
  readSeriesTable,
  readXlsxSheets,
  unitFromLabel,
  valueOfCell,
} from "./smallbiz-payments";

/** A minimal xlsx with named sheets; numbers as numeric cells, text as inline strings. */
function workbook(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>): Uint8Array {
  const col = (i: number) => String.fromCharCode(65 + i);
  const files: Record<string, Uint8Array> = {};
  const sheetXml = (rows: Array<Array<string | number>>) =>
    `<?xml version="1.0"?><worksheet><sheetData>${rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) =>
              v === ""
                ? ""
                : typeof v === "number"
                  ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`
                  : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${String(v).replace(/&/g, "&amp;")}</t></is></c>`,
            )
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`;
  files["xl/workbook.xml"] = strToU8(
    `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${s.name.replace(/&/g, "&amp;")}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows))));
  return zipSync(files);
}

describe("periods", () => {
  it("reads the quarter, month and year spellings publishers use", () => {
    expect(periodOf("2024Q3")).toBe("2024Q3");
    expect(periodOf("2024:Q3")).toBe("2024Q3");
    expect(periodOf("Q3 2024")).toBe("2024Q3");
    expect(periodOf("3Q24")).toBe("2024Q3");
    expect(periodOf("Third quarter 2024")).toBe("2024Q3");
    expect(periodOf("Q2", { contextYear: 2025 })).toBe("2025Q2");
    expect(periodOf("Q2")).toBeNull();
    expect(periodOf("2025")).toBe("2025");
    expect(periodOf("Sep 2025")).toBe("2025-09");
    expect(periodOf("2025-09-30", { quarterly: true })).toBe("2025Q3");
    expect(periodOf("45565", { quarterly: true, allowSerial: true })).toBe("2024Q3");
    expect(periodOf("45565")).toBeNull();
    expect(periodOf("Total")).toBeNull();
    expect(periodOf("1,234")).toBeNull();
    expect(excelSerialDate(45565)).toBe("2024-09-30");
  });

  it("keeps blanks and flags out of numbers", () => {
    expect(valueOfCell("$1,234.5")).toMatchObject({ value: 1234.5, note: null });
    expect(valueOfCell("45%")).toMatchObject({ value: 45, percentSign: true });
    expect(valueOfCell("n/a")).toMatchObject({ value: null, note: "n/a" });
  });

  it("names units from labels, never from values", () => {
    expect(unitFromLabel("Average interest rate, C&I loans")).toBe("percent");
    expect(unitFromLabel("Loan volume index")).toBe("index");
    expect(unitFromLabel("Volume", "FedACH (in millions)")).toBe("count (millions)");
    expect(unitFromLabel("Value ($ billions)")).toBe("dollars (billions)");
    expect(unitFromLabel("Participants")).toBe("as published");
  });
});

describe("generic time-series tables", () => {
  it("reads periods across with a year band above quarter headers", () => {
    const read = readSeriesTable(
      [
        ["", "2024", "", "2025", ""],
        ["", "Q3", "Q4", "Q1", "Q2"],
        ["Volume", "4,612", "4,700", "", "4,810"],
      ],
      { quarterly: true },
    );
    expect(read.orientation).toBe("periods_across");
    expect(read.cells.map((c) => c.period)).toEqual(["2024Q3", "2024Q4", "2025Q2"]);
    expect(read.blankCells).toBe(1);
  });

  it("reads periods down with a year column carried over merged cells", () => {
    const read = readSeriesTable(
      [
        ["Year", "Quarter", "Volume", "Value"],
        ["2025", "Q1", "100", "2.5"],
        ["", "Q2", "110", "(NA)"],
      ],
      { quarterly: true },
    );
    expect(read.orientation).toBe("periods_down");
    expect(read.cells).toEqual([
      expect.objectContaining({ period: "2025Q1", label: "Volume", value: "100" }),
      expect.objectContaining({ period: "2025Q1", label: "Value", value: "2.5" }),
      expect.objectContaining({ period: "2025Q2", label: "Volume", value: "110" }),
      expect.objectContaining({ period: "2025Q2", label: "Value", value: "(NA)" }),
    ]);
  });

  it("does not take a data row of year-like numbers mixed with values as a header", () => {
    const read = readSeriesTable([["Loans", "2010", "350", "Total"], ["Other", "1", "2", "3"]]);
    expect(read.cells).toEqual([]);
  });
});

describe("Kansas City Fed small business lending survey", () => {
  const sheets = readXlsxSheets(
    workbook([
      { name: "Notes", rows: [["Small Business Lending Survey"], ["Source: Federal Reserve Bank of Kansas City"]] },
      {
        name: "Interest rates",
        rows: [
          ["Average interest rate on new small business loans (percent)"],
          ["Date", "C&I line of credit, variable rate", "Commercial real estate", "Equipment"],
          [45382, 8.42, 7.91, 8.1],
          [45473, 8.55, "", 8.2],
        ],
      },
      {
        name: "Indexes",
        rows: [
          ["Quarter", "Loan volume index", "Credit standards index", "Loan demand index"],
          ["2024:Q1", 92.1, 104, 88],
          ["2024:Q2", 95.3, 103, "n.a."],
        ],
      },
    ]),
  );

  it("reads every sheet's series by name, with periods and units", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Notes", "Interest rates", "Indexes"]);
    const out = parseKcfedSbls(sheets, "https://example.test/sbls.xlsx");
    expect(out.emptyReason).toBeNull();
    expect(out.missingFields).toEqual([]);
    expect(out.skipped).toMatchObject({ sheet_without_dated_table: 1, blank_cells: 1 });
    const rate = out.rows.find((r) => r.series_key === "kcfed_sbl_interest_rates_c_i_line_of_credit_variable_rate" && r.period === "2024Q2");
    expect(rate).toMatchObject({ geo_type: "nation", geo_code: "US", value: 8.55, unit: "percent" });
    const demand = out.rows.find((r) => r.series_key === "kcfed_sbl_indexes_loan_demand_index" && r.period === "2024Q2");
    expect(demand).toMatchObject({ value: null, note: "n.a.", unit: "index" });
    expect(out.rows.every((r) => r.value !== 0)).toBe(true);
    expect(checkAreaStats(out.rows).duplicateKeys).toBe(0);
  });

  it("reports the labels it expected and did not find", () => {
    const out = parseKcfedSbls([{ name: "Sheet1", rows: [["Quarter", "Loan volume index"], ["2025Q1", "90"], ["2025Q2", "91"]] }], null);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].series_key).toBe("kcfed_sbl_loan_volume_index");
    expect(out.missingFields).toEqual(expect.arrayContaining(["credit_standards", "loan_demand", "ci_loans"]));
  });

  it("finds the data file on the survey page and records PDF-only pages empty", async () => {
    const bytes = workbook([{ name: "Data", rows: [["Quarter", "Loan volume index"], ["2025Q1", 90], ["2025Q2", 91]] }]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.includes("small-business-lending-survey")) {
        return new Response(`<a href="/documents/1/sbls-report.pdf">Report</a><a href="/documents/2/sbls-2025q2-data.xlsx">Download data</a>`);
      }
      if (url.endsWith(".xlsx")) return new Response(bytes as Uint8Array<ArrayBuffer>);
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const out = await fetchKcfedSbls({}, { fetchImpl, backoffMs: 0 });
    expect(out.url).toBe("https://www.kansascityfed.org/documents/2/sbls-2025q2-data.xlsx");
    expect(out.rows).toHaveLength(2);

    const pdfOnly = vi.fn(async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response(`<a href="/documents/1/sbls.pdf">Report</a>`),
    ) as unknown as typeof fetch;
    const empty = await fetchKcfedSbls({}, { fetchImpl: pdfOnly, backoffMs: 0 });
    expect(empty.emptyReason).toMatch(/links no xlsx or csv data file; set KCFED_SBLS_DATA_URL/);
  });
});

describe("Fed Small Business Credit Survey", () => {
  it("names lender types without confusing small banks with small businesses", () => {
    expect(lenderTypeOf("Small bank")).toBe("small_bank");
    expect(lenderTypeOf("Large banks")).toBe("large_bank");
    expect(lenderTypeOf("Credit union")).toBe("credit_union");
    expect(lenderTypeOf("Small business")).toBeNull();
  });

  const sheets = [
    {
      name: "Figure 24",
      rows: [
        ["Financing approval by source, share of applicants"],
        ["", "Approved for all", "Approved for some", "Denied"],
        ["Large bank", "44%", "26%", "30%"],
        ["Small bank", "56%", "24%", "20%"],
        ["Credit union", "50%", "", "22%"],
        ["Online lender", "41%", "34%", "25%"],
      ],
    },
    {
      name: "Figure 31",
      rows: [
        ["Lender satisfaction, net satisfaction"],
        ["", "Large bank", "Small bank", "Credit union", "Finance company"],
        ["Net satisfaction", "45", "71", "62", "30"],
      ],
    },
    { name: "Figure 2", rows: [["Firm age"], ["", "0-2 years", "3-5 years"], ["Share", "20%", "30%"]] },
    { name: "Figure 10", rows: [["Applied for financing, by lender type"], ["State", "Large bank applied", "Credit union applied"], ["Missouri", "40%", "12%"], ["TX", "38%", "(S)"]] },
  ];

  it("reads lender comparisons as rows the aggregates can pivot", () => {
    const out = parseSbcsWorkbook(sheets, 2025, "https://example.test/sbcs.xlsx");
    expect(out.emptyReason).toBeNull();
    expect(out.missingFields).toEqual([]);
    expect(out.skipped).toMatchObject({ sheet_without_lender_table: 1, blank_cells: 1 });
    const cu = out.rows.find((r) => r.series_key === "fed_sbcs_approval_approved_for_all_credit_union");
    expect(cu).toMatchObject({ geo_type: "nation", period: "2025", value: 50, unit: "percent" });
    expect(cu?.raw).toMatchObject({ lender_type: "credit_union", metric_key: "approved_for_all", topic: "approval" });
    const sat = out.rows.find((r) => r.series_key === "fed_sbcs_satisfaction_net_satisfaction_small_bank");
    expect(sat).toMatchObject({ value: 71, unit: "percent" });
    const state = out.rows.filter((r) => r.geo_type === "state");
    expect(state.map((r) => `${r.geo_code}:${r.series_key}:${r.value}`)).toEqual([
      "MO:fed_sbcs_application_applied_large_bank:40",
      "MO:fed_sbcs_application_applied_credit_union:12",
      "TX:fed_sbcs_application_applied_large_bank:38",
      "TX:fed_sbcs_application_applied_credit_union:null",
    ]);
    expect(state[3].note).toBe("(S)");
  });

  it("records a year with no chart data empty with the reason", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response(`<a href="/x/2025-report.pdf">PDF</a>`),
    ) as unknown as typeof fetch;
    const out = await fetchSbcs(2025, {}, { fetchImpl, backoffMs: 0 });
    expect(out.rows).toEqual([]);
    expect(out.emptyReason).toMatch(/links no xlsx or csv chart data.*FED_SBCS_DATA_URL/);
  });

  it("reads a configured file address with the year filled in", async () => {
    const bytes = workbook([{ name: "Approval", rows: sheets[0].rows }]);
    const fetchImpl = vi.fn(async (url: string) => (url === "https://files.test/sbcs-2024.xlsx" ? new Response(bytes as Uint8Array<ArrayBuffer>) : new Response("", { status: 404 }))) as unknown as typeof fetch;
    const out = await fetchSbcs(2024, { FED_SBCS_DATA_URL: "https://files.test/sbcs-{year}.xlsx" }, { fetchImpl, backoffMs: 0 });
    expect(out.rows.length).toBe(11);
    expect(out.rows.every((r) => r.period === "2024")).toBe(true);
  });
});

describe("payment volume pages", () => {
  const fedachHtml = `
    <h2>FedACH quarterly statistics</h2>
    <h3>2025</h3>
    <table><tr><th>Quarter</th><th>Total volume (millions)</th><th>Total value ($ billions)</th></tr>
      <tr><td>Q1</td><td>4,612.4</td><td>$11,230</td></tr>
      <tr><td>Q2</td><td>4,705.0</td><td>$11,602</td></tr></table>
    <h3>2024</h3>
    <table><tr><th>Quarter</th><th>Total volume (millions)</th><th>Total value ($ billions)</th></tr>
      <tr><td>Q1</td><td>4,401.9</td><td>$10,870</td></tr>
      <tr><td>Q2</td><td>4,488.2</td><td>*</td></tr></table>`;

  it("reads tables with the year from the heading above them", () => {
    const tables = pageTables(fedachHtml);
    expect(tables.map((t) => t.context)).toEqual(["2025", "2024"]);
    const page = FED_PAYMENTS_PAGES.find((p) => p.key === "fedach")!;
    const out = parseStatsTables(tables, page, "https://example.test/fedach");
    expect(out.missingFields).toEqual([]);
    const vol = out.rows.filter((r) => r.series_key === "fedach_total_volume_millions").map((r) => [r.period, r.value, r.unit]);
    expect(vol).toEqual([
      ["2025Q1", 4612.4, "count (millions)"],
      ["2025Q2", 4705, "count (millions)"],
      ["2024Q1", 4401.9, "count (millions)"],
      ["2024Q2", 4488.2, "count (millions)"],
    ]);
    const blank = out.rows.find((r) => r.series_key === "fedach_total_value_billions" && r.period === "2024Q2");
    expect(blank).toMatchObject({ value: null, note: "*", unit: "dollars (billions)" });
  });

  it("reads Payments Study tables with payment types down and years across", () => {
    const html = `<h2>Table 1. Number of core noncash payments (billions)</h2>
      <table><tr><th>Payment type</th><th>2018</th><th>2021</th><th>CAGR 2018-2021</th></tr>
      <tr><td>Card</td><td>131.2</td><td>153.3</td><td>5.3%</td></tr>
      <tr><td>ACH</td><td>23.7</td><td>29.1</td><td>7.1%</td></tr>
      <tr><td>Check</td><td>14.5</td><td>11.2</td><td>-8.2%</td></tr></table>
      <h2>Table 2. Value of core noncash payments ($ trillions)</h2>
      <table><tr><th>Payment type</th><th>2018</th><th>2021</th></tr>
      <tr><td>Card</td><td>7.9</td><td>9.8</td></tr></table>`;
    const page = FED_PAYMENTS_PAGES.find((p) => p.key === "frps")!;
    const out = parseStatsTables(pageTables(html), page, null);
    expect(out.missingFields).toEqual([]);
    const keys = [...new Set(out.rows.map((r) => r.series_key))];
    expect(keys).toEqual(expect.arrayContaining(["frps_number_core_noncash_payments_billions_card", "frps_value_core_noncash_payments_trillions_card"]));
    const ach = out.rows.find((r) => r.series_key.endsWith("_ach") && r.period === "2021");
    expect(ach).toMatchObject({ value: 29.1 });
    expect(out.rows.some((r) => /cagr/i.test(String(r.raw.period_cell)))).toBe(false);
  });

  it("records a Nacha page with no table empty, and honours robots.txt", async () => {
    const page = NACHA_PAGES[0];
    const noTable = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("<p>ACH volume rose 5%.</p>"))) as unknown as typeof fetch;
    const out = await fetchPaymentStats(page, {}, { fetchImpl: noTable, backoffMs: 0 });
    expect(out.emptyReason).toMatch(/No dated volume or value table/);
    expect(out.missingFields).toEqual(["volume", "value"]);

    const blocked = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /") : new Response(""))) as unknown as typeof fetch;
    const out2 = await fetchPaymentStats(page, {}, { fetchImpl: blocked, backoffMs: 0 });
    expect(out2.emptyReason).toMatch(/robots.txt disallows/);
  });

  it("lists data links with the ones that say data first", () => {
    const html = `<a href="a.xlsx">Chart</a><a href="b.pdf">PDF</a><a href="c.csv">Download data</a>`;
    expect(dataFileLinks(html, "https://x.test/p/")).toEqual(["https://x.test/p/c.csv", "https://x.test/p/a.xlsx"]);
  });
});
