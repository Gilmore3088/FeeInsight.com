import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { RPW_DATA_PAGE_HTML, RPW_NEW_SHEET, RPW_NOTES_SHEET, RPW_OLD_SHEET, rpwWorkbook } from "./rpw-fixtures";

import {
  checkAreaStats,
  checkTractLayout,
  collectTractLines,
  dedupeAreaStats,
  incomeLevelFromRatio,
  industryStats,
  parseBeaData,
  parseCbpTable,
  parseFdicSurvey,
  parseFhfaMaster,
  parseGeographiesBatch,
  parseHudCrosswalk,
  parseNationalWideCsv,
  parsePointTract,
  parseQcew,
  locateRpwWorkbook,
  parseRemittanceFile,
  parseRemittancePrices,
  parseRemittanceWorkbook,
  readRpwBytes,
  RPW_DATA_PAGE_URL,
  RPW_DEFAULT_WORKBOOK_URL,
  RPW_MAX_BYTES,
  RPW_TOO_LARGE_PROBLEM,
  RPW_URL_ENV,
  RpwFileTooLargeError,
  rpwWorkbookLinks,
  parseRucc,
  parseSaipeTable,
  parseTractLine,
  periodFromDate,
  publishedNumber,
  qcewGeo,
  readZipLines,
  ruccClass,
  summariseShed,
  sumIndustry,
  BEA_LINES,
  type AreaStat,
} from "./economy";

describe("publishedNumber", () => {
  it("reads numbers and leaves flags and blanks null, never zero", () => {
    expect(publishedNumber("1,234.5")).toBe(1234.5);
    expect(publishedNumber("(D)")).toBeNull();
    expect(publishedNumber("")).toBeNull();
    expect(publishedNumber("N")).toBeNull();
  });
});

describe("RUCC", () => {
  it("reads the long 2023 layout and keeps the description", () => {
    const csv = [
      "FIPS,State,County_Name,Attribute,Value",
      "01001,AL,Autauga County,Population_2020,58805",
      "01001,AL,Autauga County,RUCC_2023,2",
      '01001,AL,Autauga County,Description,"Metro - Counties in metro areas of 250,000 to 1 million population"',
      "02013,AK,Aleutians East Borough,RUCC_2023,9",
    ].join("\n");
    const r = parseRucc(csv, "2023");
    expect(r.emptyReason).toBeNull();
    const autauga = r.rows.find((x) => x.geo_code === "01001")!;
    expect(autauga).toMatchObject({ value: 2, state_code: "AL", series_key: "rucc_code" });
    expect(autauga.note).toMatch(/^Metro/);
    expect(r.rows.find((x) => x.geo_code === "02013")?.value).toBe(9);
  });

  it("reads a wide file and refuses one without the code column", () => {
    expect(parseRucc("FIPS,State,County_Name,RUCC_2023,Description\n1001,AL,Autauga County,2,Metro\n", "2023").rows[0].geo_code).toBe("01001");
    expect(parseRucc("FIPS,State,County_Name\n1001,AL,Autauga\n", "2023").emptyReason).toMatch(/RUCC_2023/);
  });

  it("maps codes 1-3 to urban and 4-9 to rural", () => {
    expect([1, 3, 4, 9, 0, null].map(ruccClass)).toEqual(["urban", "urban", "rural", "rural", null, null]);
  });
});

describe("FFIEC tracts", () => {
  const line = (year: string, ratio: string) => `${year},10180,48,059,030100,N,N,N,N,U,84500,0,${ratio},70000`;

  it("uses the CRA thresholds and leaves a zero ratio unknown", () => {
    expect([49.99, 50, 79.99, 80, 119.99, 120, 0, null].map(incomeLevelFromRatio)).toEqual(["low", "moderate", "moderate", "middle", "middle", "upper", null, null]);
  });

  it("parses the geography and ratio from the documented positions", () => {
    expect(parseTractLine(line("2024", "75.5"), 2024)).toMatchObject({ tract_id: "48059030100", county_fips: "48059", msa_code: "10180", income_level: "moderate", median_family_income: 84500 });
  });

  it("blocks a file whose values do not look like the layout", () => {
    expect(checkTractLayout(100, 100, 100, Array(100).fill(1.02)).confirmed).toBe(false);
    expect(checkTractLayout(100, 100, 10, Array(100).fill(100)).problems.join()).toMatch(/file year/);
    expect(checkTractLayout(100, 100, 100, Array(100).fill(101)).confirmed).toBe(true);
  });

  it("streams lines out of a zip", async () => {
    const zip = zipSync({ "census2024.csv": strToU8(`${line("2024", "130")}\r\n${line("2024", "40")}\n`) });
    const collector = collectTractLines(2024);
    const read = await readZipLines(zip, /\.csv$/i, collector.onLine);
    expect(read).toEqual({ file: "census2024.csv", lines: 2 });
    const done = collector.finish(read.lines);
    expect(done.duplicateTracts).toBe(1);
    expect(done.rows[0].income_level).toBe("low");
  });
});

describe("Census geographies", () => {
  it("reads matched tracts and refuses malformed geography", () => {
    const text = [
      '"1","1 MAIN ST, X, TX, 75001","Match","Exact","1 MAIN ST","-96.8,32.9","1","L","48","113","013710","1001"',
      '"2","2 MAIN ST, X, TX, 75001","Match","Exact","2 MAIN ST","-96.8,32.9","1","L","48","113","","1001"',
      '"3","3 MAIN ST","No_Match"',
      '"4","4 MAIN ST","Tie"',
    ].join("\n");
    expect(parseGeographiesBatch(text).map((p) => [p.status, p.tract_id])).toEqual([
      ["matched", "48113013710"],
      ["no_match", null],
      ["no_match", null],
      ["tie", null],
    ]);
  });

  it("reads the tract GEOID from a coordinates reply", () => {
    expect(parsePointTract({ result: { geographies: { "Census Tracts": [{ GEOID: "48113013710" }] } } })).toBe("48113013710");
    expect(parsePointTract({ result: { geographies: {} } })).toBeNull();
  });
});

describe("QCEW", () => {
  it("maps area codes", () => {
    expect(qcewGeo("US000")).toMatchObject({ geo_type: "nation", geo_code: "US" });
    expect(qcewGeo("48000")).toMatchObject({ geo_type: "state", geo_code: "TX" });
    expect(qcewGeo("C1018")).toMatchObject({ geo_type: "metro", geo_code: "10180" });
    expect(qcewGeo("48999")).toEqual({ skip: "county_unknown" });
    expect(qcewGeo("CS100")).toEqual({ skip: "other_area_type" });
  });

  it("keeps total-covered rows and stores undisclosed values as null", () => {
    const csv = [
      '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","annual_avg_estabs","annual_avg_emplvl","total_annual_wages","taxable_annual_wages","avg_annual_pay"',
      '"48059","0","10","70","0","2025","A","","120","1500","60000000","0","40000"',
      '"48061","0","10","70","0","2025","A","N","0","0","0","0","0"',
      '"48059","5","10","71","0","2025","A","","100","1200","50000000","0","41666"',
    ].join("\n");
    const r = parseQcew(csv, 2025);
    expect(r.rows).toHaveLength(8);
    expect(r.rows.find((x) => x.geo_code === "48059" && x.series_key === "qcew_employment")?.value).toBe(1500);
    expect(r.rows.find((x) => x.geo_code === "48061" && x.series_key === "qcew_employment")).toMatchObject({ value: null, note: "N (not disclosed)" });
  });
});

describe("Census CBP and SAIPE tables", () => {
  it("reads county CBP rows", () => {
    const r = parseCbpTable([["NAME", "ESTAB", "EMP", "PAYANN", "NAICS2017", "state", "county"], ["Autauga County, Alabama", "900", "11000", "450000", "00", "01", "001"]], "county", 2023);
    expect(r.rows.map((x) => [x.geo_code, x.series_key, x.value])).toEqual([
      ["01001", "cbp_establishments", 900],
      ["01001", "cbp_employees", 11000],
      ["01001", "cbp_annual_payroll", 450000],
    ]);
  });

  it("reads SAIPE state rows and names a missing variable", () => {
    const r = parseSaipeTable([["NAME", "SAEPOVRTALL_PT", "time", "state"], ["Texas", "13.9", "2023", "48"]], "state", 2023);
    expect(r.rows).toEqual([expect.objectContaining({ geo_code: "TX", series_key: "saipe_poverty_rate", value: 13.9 })]);
    expect(r.missingFields).toEqual(["SAEPOVALL_PT"]);
  });
});

describe("BEA", () => {
  it("reads counties and keeps suppressed values null", () => {
    const body = { BEAAPI: { Results: { Data: [
      { GeoFips: "01001", GeoName: "Autauga, AL", TimePeriod: "2024", DataValue: "52,345", CL_UNIT: "Dollars" },
      { GeoFips: "01003", GeoName: "Baldwin, AL", TimePeriod: "2024", DataValue: "(D)", CL_UNIT: "Dollars" },
      { GeoFips: "01000", GeoName: "Alabama", TimePeriod: "2024", DataValue: "50,000", CL_UNIT: "Dollars" },
    ] } } };
    const r = parseBeaData(body, "county", BEA_LINES[2], 2024);
    expect(r.rows.map((x) => [x.geo_type, x.geo_code, x.value, x.note])).toEqual([
      ["county", "01001", 52345, null],
      ["county", "01003", null, "(D)"],
      ["state", "AL", 50000, null],
    ]);
  });
});

describe("FHFA", () => {
  it("keeps quarterly all-transactions rows for states, metros and the nation", () => {
    const csv = [
      "hpi_type,hpi_flavor,frequency,level,place_name,place_id,yr,period,index_nsa,index_sa",
      "traditional,all-transactions,quarterly,State,Texas,TX,2026,2,420.5,",
      "traditional,all-transactions,quarterly,MSA,Abilene TX,10180,2026,2,300.1,",
      "traditional,purchase-only,monthly,State,Texas,TX,2026,6,400,401",
      "traditional,all-transactions,quarterly,USA or Census Division,United States,USA,2026,2,650,",
    ].join("\n");
    expect(parseFhfaMaster(csv).rows.map((x) => [x.geo_type, x.geo_code, x.period, x.value])).toEqual([
      ["state", "TX", "2026Q2", 420.5],
      ["metro", "10180", "2026Q2", 300.1],
      ["nation", "US", "2026Q2", 650],
    ]);
  });
});

describe("FDIC household survey", () => {
  it("reads state names and percent shares, and refuses an unknown layout", () => {
    const r = parseFdicSurvey("State,Year,Unbanked,Underbanked\nTexas,2023,6.1%,15.2\nUnited States,2023,4.2,14.2\n", 2023);
    expect(r.rows.map((x) => [x.geo_code, x.series_key, x.value])).toEqual([
      ["TX", "fdic_unbanked_share", 6.1],
      ["TX", "fdic_underbanked_share", 15.2],
      ["US", "fdic_unbanked_share", 4.2],
      ["US", "fdic_underbanked_share", 14.2],
    ]);
    expect(parseFdicSurvey("Foo,Bar\n1,2\n", 2023).emptyReason).toMatch(/headers seen: FOO, BAR/);
  });
});

describe("SHED", () => {
  it("weights Yes/No text answers and does not interpret numeric codes", () => {
    const rows = [
      { WEIGHT_POP: "2", BK1: "Yes", BK2_A: "1" },
      { WEIGHT_POP: "1", BK1: "No", BK2_A: "2" },
      { WEIGHT_POP: "1", BK1: "Refused", BK2_A: "" },
    ];
    const s = summariseShed(rows);
    expect(s.weightColumn).toBe("WEIGHT_POP");
    expect(s.summaries.find((x) => x.key === "shed_has_bank_account")).toMatchObject({ share: 66.67, respondents: 2, otherAnswers: 1 });
    expect(s.summaries.find((x) => x.key === "shed_paid_overdraft_fee")).toMatchObject({ share: null, otherAnswers: 2 });
    expect(s.summaries.find((x) => x.key === "shed_used_check_cashing")?.variable).toBeNull();
  });
});

describe("FDIC industry totals", () => {
  it("sums each field over the filers that reported it and says how many", () => {
    const totals = sumIndustry([
      { CERT: 1, ASSET: 100, DEP: 80, ISERCHGQ: 2 },
      { CERT: 2, ASSET: 50, DEP: 40 },
      { CERT: 2, ASSET: 50, DEP: 40 },
    ]);
    expect(totals.filers).toBe(2);
    expect(totals.duplicateCerts).toBe(1);
    const stats = industryStats("2026Q2", totals);
    expect(stats.find((s) => s.series_key === "fdic_industry_total_assets")?.value).toBe(150);
    expect(stats.find((s) => s.series_key === "fdic_industry_deposit_service_charges_quarter")?.note).toBe("summed over 1 of 2 filers");
    expect(stats.some((s) => s.series_key === "fdic_industry_net_income_quarter")).toBe(false);
  });
});

describe("national wide CSVs", () => {
  it("reads dates in several shapes", () => {
    expect(["2026-09-15", "09/15/2026", "Sep 2026", "2024", "Q3"].map(periodFromDate)).toEqual(["2026-09", "2026-09", "2026-09", "2024", null]);
  });

  it("turns each column into a series and skips blanks", () => {
    const r = parseNationalWideCsv("Date,Savings,Interest Checking,12-Month CD\n2026-09-15,0.42,0.07,\n", { prefix: "fdic_national_rate", unit: "percent" });
    expect(r.rows.map((x) => [x.series_key, x.value])).toEqual([
      ["fdic_national_rate_savings", 0.42],
      ["fdic_national_rate_interest_checking", 0.07],
    ]);
  });
});

describe("remittance prices", () => {
  it("keeps US-send rows only", () => {
    const csv = "period,source_name,destination_name,firm,firm_type,product,cc1 fee,cc1 fx margin,cc1 total cost %\n2026_2Q,United States,Mexico,Acme Bank,Bank,,5,1.5,4.2\n2026_2Q,Spain,Morocco,X,MTO,,3,1,4\n";
    const r = parseRemittancePrices(csv);
    expect(r.nonUsRows).toBe(1);
    expect(r.rows).toEqual([expect.objectContaining({ destination_country: "Mexico", firm: "Acme Bank", fee: 5, fx_margin_pct: 1.5, total_cost_pct: 4.2, product: null })]);
  });
});

describe("remittance prices workbook", () => {
  const book = () => rpwWorkbook([RPW_NOTES_SHEET, RPW_OLD_SHEET, RPW_NEW_SHEET]);

  it("reads both data sheets, passes over the notes sheet and keeps US-send rows", () => {
    const r = parseRemittanceWorkbook(book());
    expect(r.emptyReason).toBeNull();
    expect(r.nonUsRows).toBe(1);
    expect(r.missingFields).toEqual([]);
    expect(r.sheets?.map((s) => [s.sheet, s.rows, s.us_rows])).toEqual([
      ["xl/worksheets/sheet2.xml", 1, 1],
      ["xl/worksheets/sheet3.xml", 3, 2],
    ]);
    expect(r.rows.map((x) => [x.period, x.firm, x.product, x.amount_sent, x.fee, x.fx_margin_pct, x.total_cost_pct])).toEqual([
      ["2011_1Q", "Old Bank", "Account transfer", 200, 12, 1.1, 7.1],
      ["2025_1Q", "Acme Bank", "Cash", 200, 5, 1.5, 4.2],
      ["2025_1Q", "Acme Bank", "Account", 200, 3, 0.05, 1.55],
    ]);
  });

  it("keeps only the columns the loader reads", () => {
    const raw = parseRemittanceWorkbook(book()).rows[1].raw;
    expect(Object.keys(raw).sort()).toEqual(
      ["CC1 FX MARGIN", "CC1 LCU AMOUNT", "CC1 LCU FEE", "CC1 TOTAL COST %", "DESTINATION_NAME", "FIRM", "FIRM_TYPE", "PAYMENT INSTRUMENT", "PERIOD", "SOURCE_NAME"].sort(),
    );
  });

  it("says what it saw when no sheet has the RPW header", () => {
    const r = parseRemittanceWorkbook(rpwWorkbook([RPW_NOTES_SHEET, [["country", "value"], ["Mexico", "1"]]]));
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/not in the expected layout.*headers seen: REMITTANCE PRICES WORLDWIDE, COUNTRY, VALUE/);
  });

  it("reads a workbook or a CSV by its bytes", () => {
    expect(parseRemittanceFile(book()).rows).toHaveLength(3);
    const csv = "period,source_name,destination_name,firm\n2026_2Q,United States,Mexico,Acme Bank\n";
    expect(parseRemittanceFile(strToU8(csv)).rows).toHaveLength(1);
  });
});

describe("finding the RPW workbook", () => {
  const page = (body: string, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;

  it("orders the data page's workbook links newest first", () => {
    expect(rpwWorkbookLinks(RPW_DATA_PAGE_HTML, RPW_DATA_PAGE_URL)).toEqual([
      "https://remittanceprices.worldbank.org/sites/default/files/rpw_dataset_2011_2025_q1.xlsx",
      "https://remittanceprices.worldbank.org/sites/default/files/rpw_dataset_2011_2024_q4.xlsx",
    ]);
  });

  it("uses the env override, then the data page, then the default", async () => {
    expect(await locateRpwWorkbook({ [RPW_URL_ENV]: " https://example.org/rpw.csv " })).toEqual({ url: "https://example.org/rpw.csv", via: "env", pageProblem: null });
    expect(await locateRpwWorkbook({}, { fetchImpl: page(RPW_DATA_PAGE_HTML), backoffMs: 0 })).toMatchObject({ url: expect.stringMatching(/2025_q1\.xlsx$/), via: "data-page" });
    expect(await locateRpwWorkbook({}, { fetchImpl: page("<html></html>"), backoffMs: 0 })).toMatchObject({ url: RPW_DEFAULT_WORKBOOK_URL, via: "default", pageProblem: expect.stringMatching(/linked no/) });
    expect(await locateRpwWorkbook({}, { fetchImpl: page("no", 403), backoffMs: 0 })).toMatchObject({ url: RPW_DEFAULT_WORKBOOK_URL, via: "default", pageProblem: expect.stringMatching(/could not be read/) });
  });
});

describe("RPW size guard", () => {
  it("refuses a declared length over the cap without reading the body", async () => {
    const response = new Response("x", { headers: { "content-length": String(RPW_MAX_BYTES + 1) } });
    await expect(readRpwBytes(response, "u")).rejects.toMatchObject({ problem: RPW_TOO_LARGE_PROBLEM });
  });

  it("refuses a body that passes the cap while streaming, and reads one under it", async () => {
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < 4; i += 1) c.enqueue(new Uint8Array(10));
          c.close();
        },
      });
    await expect(readRpwBytes(new Response(stream()), "u", 25)).rejects.toBeInstanceOf(RpwFileTooLargeError);
    expect((await readRpwBytes(new Response(stream()), "u", 40)).length).toBe(40);
  });
});

describe("HUD crosswalk", () => {
  it("reads ZIP-county pairs and the period", () => {
    const r = parseHudCrosswalk({ data: { year: 2026, quarter: 2, results: [
      { zip: "75001", geoid: "48113", res_ratio: 0.9, bus_ratio: 0.8, oth_ratio: 1, tot_ratio: 0.88, city: "ADDISON", state: "TX" },
      { zip: "bad", geoid: "48113" },
    ] } });
    expect(r.period).toBe("2026Q2");
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
});

describe("cleaning pass", () => {
  const row = (geo: string, value: number | null, series = "qcew_employment"): AreaStat => ({
    geo_type: "county", geo_code: geo, geo_name: null, state_code: "TX", period: "2025", series_key: series, value, unit: "jobs", note: null, raw: {},
  });

  it("counts blanks, duplicates and impossible negatives without changing values", () => {
    const rows = [row("48001", 10), row("48001", 11), row("48003", null), row("48005", -4)];
    const checks = checkAreaStats(rows);
    expect(checks).toMatchObject({ rows: 4, duplicateKeys: 1, blankBySeries: { qcew_employment: 1 } });
    expect(checks.flagged[0]).toMatchObject({ key: "qcew_employment/county", negatives: 1 });
    expect(rows[3].value).toBe(-4);
    expect(dedupeAreaStats(rows).find((r) => r.geo_code === "48001")?.value).toBe(11);
  });

  it("allows negatives in net income", () => {
    expect(checkAreaStats([row("US", -5, "fdic_industry_net_income_quarter")]).flagged).toEqual([]);
  });
});
