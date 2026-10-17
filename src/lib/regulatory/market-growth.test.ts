import { gzipSync, strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  bpsColumnNames,
  bpsMonthlyUrl,
  checkMarketGrowthStats,
  decodeText,
  fetchLodes,
  irsMigrationStats,
  irsMigrationUrls,
  lausPeriod,
  lodesUrl,
  parseBfsCounty,
  parseBfsMonthly,
  parseBpsCounty,
  parseIrsSide,
  parseLausTable,
  parseLausText,
  parsePopest,
  popestUrl,
  readGzipLines,
  sumCounties,
} from "./market-growth";
import type { AreaStat } from "./economy";

const find = (rows: AreaStat[], geo: string, series: string, period?: string) =>
  rows.find((r) => r.geo_code === geo && r.series_key === series && (period === undefined || r.period === period));

// ---------------------------------------------------------------------------
// Building permits
// ---------------------------------------------------------------------------

const BPS_HEAD = [
  "Survey,FIPS,FIPS,Region,Division,County,,1-unit,,,2-units,,,3-4 units,,,5+ units,,,1-unit rep,,,2-units rep,,,3-4 units rep,,,5+ units rep,,",
  "Date,State,County,Code,Code,Name,,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value",
  "",
];

function bpsLine(date: string, st: string, co: string, name: string, one: number, five: number): string {
  const g = (u: number, perUnit: number) => `${u},${u},${u * perUnit}`;
  return [date, st, co, "3", "6", name, "", g(one, 250_000), "0,0,0", "0,0,0", `1,${five},${five * 150_000}`, g(one, 250_000), "0,0,0", "0,0,0", `1,${five},${five * 150_000}`].join(",");
}

describe("building permits county file", () => {
  it("names columns from the two header lines", () => {
    const names = bpsColumnNames(BPS_HEAD[0].split(","), BPS_HEAD[1].split(","));
    expect(names.slice(0, 3)).toEqual(["survey:date", "fips:state", "fips:county"]);
    expect(names[5]).toBe("county:name");
    expect(names.slice(7, 10)).toEqual(["1unit:bldgs", "1unit:units", "1unit:value"]);
    expect(names[17]).toBe("5units:units");
    expect(names[20]).toBe("1unitrep:units");
  });

  it("reads counties, sums states and the nation, and tells the value unit from the data", () => {
    const lines = [...BPS_HEAD];
    for (let i = 1; i <= 24; i += 1) lines.push(bpsLine("2024", "48", String(i * 2 - 1).padStart(3, "0"), `County ${i}`, 10 * i, i));
    lines.push(bpsLine("2024", "01", "001", "Autauga County", 201, 0));
    lines.push(bpsLine("2023", "01", "003", "Old row", 1, 0));
    const out = parseBpsCounty(lines.join("\n"), "2024");
    expect(out.missingFields).toEqual([]);
    expect(out.valueUnit).toBe("dollars");
    expect(out.skipped).toEqual({ other_period: 1 });
    expect(find(out.rows, "01001", "permits_units_1_unit")?.value).toBe(201);
    expect(find(out.rows, "48001", "permits_units_total")?.value).toBe(11);
    expect(find(out.rows, "48001", "permits_buildings_total")?.value).toBe(11);
    expect(find(out.rows, "48001", "permits_value_total")).toMatchObject({ value: 10 * 250_000 + 150_000, unit: "dollars" });
    const tx = find(out.rows, "TX", "permits_units_total")!;
    expect(tx).toMatchObject({ geo_type: "state", value: (10 + 1) * (24 * 25) / 2 });
    expect(tx.note).toMatch(/Sum of the counties/);
    expect(find(out.rows, "US", "permits_units_total")?.value).toBe(tx.value! + 201);
  });

  it("keeps a blank as null, and a state sum with a blank county stays null", () => {
    const lines = [...BPS_HEAD, bpsLine("2024", "48", "001", "A", 5, 0), bpsLine("2024", "48", "003", "B", 5, 0).replace(/^((?:[^,]*,){8})5,/, "$1(X),")];
    const out = parseBpsCounty(lines.join("\n"), "2024");
    expect(find(out.rows, "48003", "permits_units_1_unit")).toMatchObject({ value: null, note: "(X)" });
    expect(find(out.rows, "TX", "permits_units_1_unit")?.value).toBeNull();
    // Too few counties to tell dollars from thousands: the value series is held back and named.
    expect(out.valueUnit).toBeNull();
    expect(out.missingFields.join(" ")).toMatch(/Value unit/);
    expect(out.rows.some((r) => r.series_key === "permits_value_total")).toBe(false);
  });

  it("names missing columns and loads nothing when the layout is wrong", () => {
    const out = parseBpsCounty("State,County,Units\n48,001,5", "2024");
    expect(out.rows).toEqual([]);
    expect(out.emptyReason).toBeTruthy();
  });

  it("matches a monthly file's survey date", () => {
    const lines = [...BPS_HEAD, bpsLine("202508", "48", "001", "A", 5, 0)];
    const out = parseBpsCounty(lines.join("\n"), "2025-08");
    expect(find(out.rows, "48001", "permits_units_1_unit", "2025-08")?.value).toBe(5);
    expect(bpsMonthlyUrl(2025, 8)).toMatch(/co2508c\.txt$/);
  });
});

// ---------------------------------------------------------------------------
// Population estimates
// ---------------------------------------------------------------------------

describe("population estimates", () => {
  const header = [
    "SUMLEV,REGION,DIVISION,STATE,COUNTY,STNAME,CTYNAME,ESTIMATESBASE2020",
    "POPESTIMATE2020,POPESTIMATE2021,NPOPCHG2020,NPOPCHG2021,BIRTHS2020,BIRTHS2021,DEATHS2020,DEATHS2021",
    "NATURALCHG2020,NATURALCHG2021,INTERNATIONALMIG2020,INTERNATIONALMIG2021,DOMESTICMIG2020,DOMESTICMIG2021,NETMIG2020,NETMIG2021",
    "RNATURALCHG2021,RINTERNATIONALMIG2021,RDOMESTICMIG2021,RNETMIG2021",
  ].join(",");
  const row = (sumlev: string, st: string, co: string, stname: string, ctyname: string, pop: number, dom: number) =>
    [sumlev, "3", "6", st, co, stname, ctyname, pop, pop, pop + 100, 10, 100, 5, 50, 4, 40, 1, 10, 1, 20, dom, dom, dom + 1, dom + 21, 1.5, 0.8, dom / 10, 2.1].join(",");

  it("reads states and counties by year, keeps negatives, and sums the nation from the states", () => {
    const csv = [header, row("040", "35", "000", "New Mexico", "New Mexico", 2_100_000, -500), row("050", "35", "013", "New Mexico", "Doña Ana County", 220_000, -30), row("040", "48", "000", "Texas", "Texas", 29_000_000, 900)].join("\n");
    const out = parsePopest(csv, 2021);
    expect(out.missingFields).toEqual([]);
    expect(find(out.rows, "35013", "popest_population", "2021")).toMatchObject({ value: 220_100, geo_name: "Doña Ana County", state_code: "NM" });
    expect(find(out.rows, "35013", "popest_domestic_migration", "2021")?.value).toBe(-30);
    expect(find(out.rows, "NM", "popest_net_migration_rate", "2021")).toMatchObject({ unit: "per 1,000 residents", value: 2.1 });
    expect(find(out.rows, "US", "popest_population", "2021")).toMatchObject({ geo_type: "nation", value: 2_100_100 + 29_000_100 });
    expect(find(out.rows, "US", "popest_net_migration_rate")).toBeUndefined();
    expect(find(out.rows, "35013", "popest_population", "2021")?.raw).toMatchObject({ vintage: 2021, column: "POPESTIMATE2021" });
    // Negative domestic migration is expected, not flagged.
    expect(checkMarketGrowthStats(out.rows).flagged).toEqual([]);
  });

  it("reports the vintage column when it is missing", () => {
    const out = parsePopest(`${header}\n${row("040", "48", "000", "Texas", "Texas", 1, 1)}`, 2022);
    expect(out.missingFields).toContain("POPESTIMATE2022");
  });

  it("decodes Latin-1 names and builds the decade URL", () => {
    expect(decodeText(new Uint8Array([0x44, 0x6f, 0xf1, 0x61]))).toBe("Doña");
    expect(popestUrl(2020)).toMatch(/2010-2020\/counties\/totals\/co-est2020-alldata\.csv$/);
    expect(popestUrl(2025)).toMatch(/2020-2025\/counties\/totals\/co-est2025-alldata\.csv$/);
  });
});

// ---------------------------------------------------------------------------
// IRS migration
// ---------------------------------------------------------------------------

describe("IRS county migration", () => {
  const inflow = [
    "y2_statefips,y2_countyfips,y1_statefips,y1_countyfips,y1_state,y1_countyname,n1,n2,agi",
    "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,1500,3000,90000",
    "01,001,97,000,AL,Autauga County Total Migration-US,1450,2900,87000",
    "01,001,01,001,AL,Autauga County Non-migrants,20000,45000,1500000",
    "01,001,01,101,AL,Montgomery County,600,1200,30000",
    "01,001,13,121,GA,Fulton County,40,80,4000",
    "01,001,58,000,AL,Other flows - Same State,-1,-1,-1",
    "01,003,96,000,AL,Baldwin County Total Migration-US and Foreign,-1,-1,-1",
  ].join("\n");
  const outflow = [
    "y1_statefips,y1_countyfips,y2_statefips,y2_countyfips,y2_state,y2_countyname,n1,n2,agi",
    "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,1200,2500,60000",
    "01,001,01,001,AL,Autauga County Non-migrants,20000,45000,1500000",
    "01,001,01,051,AL,Elmore County,500,1000,25000",
  ].join("\n");

  it("builds inflow, outflow, net and income per moving household, with top flows in raw", () => {
    const rows = irsMigrationStats(2022, "county", parseIrsSide(inflow, "in", "county"), parseIrsSide(outflow, "out", "county"));
    expect(find(rows, "01001", "irs_mig_inflow_returns")).toMatchObject({ value: 1500, geo_name: "Autauga County", state_code: "AL", period: "2022" });
    expect(find(rows, "01001", "irs_mig_outflow_agi")).toMatchObject({ value: 60000, unit: "thousands_dollars" });
    expect(find(rows, "01001", "irs_mig_net_returns")?.value).toBe(300);
    expect(find(rows, "01001", "irs_mig_net_agi")?.value).toBe(30000);
    expect(find(rows, "01001", "irs_mig_inflow_agi_per_return")?.value).toBe(60000);
    expect(find(rows, "01001", "irs_mig_outflow_agi_per_return")?.value).toBe(50000);
    expect(find(rows, "01001", "irs_mig_nonmigrant_returns")?.value).toBe(20000);
    const top = find(rows, "01001", "irs_mig_inflow_returns")!.raw.top_origins as Array<{ fips: string }>;
    expect(top.map((t) => t.fips)).toEqual(["01101", "13121"]);
    expect((find(rows, "01001", "irs_mig_outflow_returns")!.raw.top_destinations as unknown[]).length).toBe(1);
    // -1 is IRS suppression: null with the flag, never -1 or zero.
    expect(find(rows, "01003", "irs_mig_inflow_returns")).toMatchObject({ value: null, note: expect.stringMatching(/suppressed/) });
    expect(find(rows, "01003", "irs_mig_net_returns")).toBeUndefined();
    expect(checkMarketGrowthStats(rows).flagged).toEqual([]);
  });

  it("names a file without total rows", () => {
    const side = parseIrsSide("y2_statefips,y2_countyfips,y1_statefips,y1_countyfips,n1,n2,agi\n01,001,01,101,5,5,5", "in", "county");
    expect(side.missingFields).toEqual(expect.arrayContaining(["countyinflow Y1_STATE", "countyinflow total rows (state code 96)"]));
  });

  it("reads state files and builds the year-pair URLs", () => {
    const stateIn = "y2_statefips,y1_statefips,y1_state,y1_state_name,n1,n2,AGI\n48,96,TX,Total Migration-US and Foreign,200000,400000,15000000\n48,48,TX,Texas Non-migrants,1,1,1\n48,06,CA,California,40000,80000,5000000";
    const stateOut = "y1_statefips,y2_statefips,y2_state,y2_state_name,n1,n2,AGI\n48,96,TX,Total Migration-US and Foreign,150000,300000,10000000";
    const rows = irsMigrationStats(2022, "state", parseIrsSide(stateIn, "in", "state"), parseIrsSide(stateOut, "out", "state"));
    expect(find(rows, "TX", "irs_mig_net_returns")).toMatchObject({ geo_type: "state", value: 50000 });
    expect((find(rows, "TX", "irs_mig_inflow_returns")!.raw.top_origins as Array<{ fips: string }>)[0].fips).toBe("CA");
    expect(irsMigrationUrls(2022).countyIn).toMatch(/countyinflow2122\.csv$/);
  });
});

// ---------------------------------------------------------------------------
// Business Formation Statistics
// ---------------------------------------------------------------------------

describe("business formation statistics", () => {
  it("reads state and national monthly totals, adjusted and not, and leaves future months out", () => {
    const csv = [
      "sa,naics_sector,series,geo,year,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec",
      "U,TOTAL,BA_BA,US,2026,500000,450000,480000,470000,460000,455000,440000,430000,,,,",
      "A,TOTAL,BA_BA,US,2026,460000,455000,450000,452000,451000,449000,447000,445000,,,,",
      "U,TOTAL,BA_HBA,TX,2026,15000,14000,NA,13000,12000,12500,12000,11000,,,,",
      "A,TOTAL,BA_HBA,TX,2026,14000,14000,14000,14000,14000,14000,14000,14000,,,,",
      "U,NAICS44,BA_BA,TX,2026,1,1,1,1,1,1,1,1,,,,",
      "U,TOTAL,BF_DUR4Q,US,2026,1,1,1,1,1,1,1,1,,,,",
      "U,TOTAL,BA_BA,TX,2010,1,1,1,1,1,1,1,1,1,1,1,1",
    ].join("\n");
    const out = parseBfsMonthly(csv);
    expect(find(out.rows, "US", "bfs_applications", "2026-01")).toMatchObject({ geo_type: "nation", value: 500000 });
    expect(find(out.rows, "US", "bfs_applications_sa", "2026-08")?.value).toBe(445000);
    expect(find(out.rows, "TX", "bfs_high_propensity_applications", "2026-03")).toMatchObject({ value: null, note: "NA" });
    expect(find(out.rows, "US", "bfs_applications", "2026-09")).toBeUndefined();
    expect(out.rows.some((r) => r.period.startsWith("2010"))).toBe(false);
    expect(out.missingFields).toEqual([]);
  });

  it("reads a wide county annual file and sums states", () => {
    const rows = [
      ["Business Applications by County"],
      ["State", "County", "FIPS", "BA2023", "BA2024", "HBA2023", "HBA2024"],
      ["TX", "Travis County", "48453", "20000", "22000", "5000", "5600"],
      ["TX", "Hays County", "48209", "3000", "(S)", "800", "900"],
      ["TX", "Texas", "48000", "1", "1", "1", "1"],
    ];
    const out = parseBfsCounty(rows);
    expect(find(out.rows, "48453", "bfs_applications", "2024")).toMatchObject({ value: 22000, geo_name: "Travis County", state_code: "TX" });
    expect(find(out.rows, "48209", "bfs_applications", "2024")).toMatchObject({ value: null, note: "(S)" });
    expect(find(out.rows, "TX", "bfs_applications", "2023")?.value).toBe(23000);
    expect(find(out.rows, "TX", "bfs_applications", "2024")?.value).toBeNull();
    expect(out.skipped).toEqual({ state_row: 1 });
  });

  it("reads a long county file and refuses one with no FIPS", () => {
    const long = parseBfsCounty([["fips", "county", "year", "ba", "hba"], ["1001", "Autauga", "2024", "300", "90"]]);
    expect(find(long.rows, "01001", "bfs_high_propensity_applications", "2024")?.value).toBe(90);
    const bad = parseBfsCounty([["county", "year", "applications"]]);
    expect(bad.rows).toEqual([]);
    expect(bad.missingFields).toContain("county FIPS column");
  });
});

// ---------------------------------------------------------------------------
// LAUS
// ---------------------------------------------------------------------------

describe("BLS county labor force", () => {
  const current = [
    "                   Labor Force Data by County, Not Seasonally Adjusted",
    "      LAUS Code     |  State |  County |     County Name/State Abbreviation     |   Period  |    Labor  |  Employed  |  Unemployed  | Unemployment",
    "                    |  FIPS  |  FIPS   |                                        |           |    Force  |            |    Level     |  Rate",
    "--------------------|--------|---------|----------------------------------------|-----------|-----------|------------|--------------|-------------",
    "  CN0100100000000   |   01   |   001   | Autauga County, AL                     |   Aug-25  |   26,123  |    25,456  |       667    |     2.6",
    "  CN0100100000000   |   01   |   001   | Autauga County, AL                     | Sep-25(p) |   26,200  |    25,500  |       700    |     2.7",
    "  CN0100300000000   |   01   |   003   | Baldwin County, AL                     | Sep-25(p) |  110,000  |   107,000  |     3,000    |     2.7",
    "  CN7200100000000   |   72   |   001   | Adjuntas Municipio, PR                 | Sep-25(p) |     5,000 |       -    |        -     |      -",
    "  footnote: (p) = preliminary.",
  ].join("\n");

  it("reads the 14-month file with preliminary months, sums states and derives their rate", () => {
    const out = parseLausText(current);
    expect(out.missingFields).toEqual([]);
    expect(find(out.rows, "01001", "laus_labor_force", "2025-08")).toMatchObject({ value: 26123, note: null, geo_name: "Autauga County, AL" });
    expect(find(out.rows, "01001", "laus_unemployment_rate", "2025-09")).toMatchObject({ value: 2.7, unit: "percent", note: "preliminary" });
    expect(find(out.rows, "72001", "laus_employed", "2025-09")).toMatchObject({ value: null, note: "-" });
    expect(find(out.rows, "AL", "laus_labor_force", "2025-09")?.value).toBe(136200);
    expect(find(out.rows, "AL", "laus_unemployment_rate", "2025-09")?.value).toBe(2.7);
    expect(find(out.rows, "US", "laus_unemployed", "2025-09")?.value).toBeNull();
  });

  it("parses periods", () => {
    expect(lausPeriod("Sep-25(p)")).toEqual({ period: "2025-09", preliminary: true });
    expect(lausPeriod("2024")).toEqual({ period: "2024", preliminary: false });
    expect(lausPeriod("Q3")).toBeNull();
  });

  it("reads the annual table with a two-row header", () => {
    const rows = [
      ["Labor force data by county, 2024 annual averages"],
      ["LAUS", "State FIPS", "County FIPS", "County Name/State", "", "", "Labor", "", "", "Unemployment"],
      ["Code", "Code", "Code", "Abbreviation", "Year", "", "Force", "Employed", "Unemployed", "Rate (%)"],
      ["CN0100100000000", "01", "001", "Autauga County, AL", "2024", "", "26000", "25300", "700", "2.7"],
    ];
    const out = parseLausTable(rows, 2024);
    expect(out.missingFields).toEqual([]);
    expect(find(out.rows, "01001", "laus_employed", "2024")?.value).toBe(25300);
    expect(find(out.rows, "01001", "laus_unemployment_rate", "2024")?.value).toBe(2.7);
  });
});

// ---------------------------------------------------------------------------
// LODES
// ---------------------------------------------------------------------------

describe("LEHD LODES", () => {
  const wac = [
    "w_geocode,C000,CA01,CA02,CA03,CE01,CE02,CE03,CNS01,CNS02,CNS03,CNS04,CNS05,CNS06,CNS07,CNS08,CNS09,CNS10,CNS11,createdate",
    "100010401001000,100,1,1,1,10,20,70,0,0,0,0,0,0,0,0,0,15,0,20240101",
    "100010401001001,50,1,1,1,10,20,20,0,0,0,0,0,0,0,0,0,5,0,20240101",
    "100030101001000,400,1,1,1,10,90,300,0,0,0,0,0,0,0,0,0,80,0,20240101",
  ].join("\n");
  const rac = [
    "h_geocode,C000,CA01,CA02,CA03,CE01,CE02,CE03,createdate",
    "100010401001000,300,1,1,1,10,90,200,20240101",
    "100030101001000,200,1,1,1,10,90,100,20240101",
    "100050101001000,50,1,1,1,10,20,20,20240101",
  ].join("\n");

  it("streams gzip lines", async () => {
    const lines: string[] = [];
    const count = await readGzipLines(gzipSync(strToU8("a,b\n1,2\n3,4")), (l) => lines.push(l));
    expect(count).toBe(3);
    expect(lines).toEqual(["a,b", "1,2", "3,4"]);
  });

  it("aggregates blocks to counties with the jobs-per-resident-worker ratio", async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(gzipSync(strToU8(url.includes("_wac_") ? wac : rac)), { status: 200 })) as unknown as typeof fetch;
    const out = await fetchLodes("de", 2022, { fetchImpl, backoffMs: 0 });
    expect(out.missingFields).toEqual([]);
    expect(find(out.rows, "10001", "lodes_jobs_workplace")).toMatchObject({ value: 150, period: "2022", state_code: "DE" });
    expect(find(out.rows, "10001", "lodes_jobs_finance_insurance")?.value).toBe(20);
    expect(find(out.rows, "10001", "lodes_workers_residence")?.value).toBe(300);
    expect(find(out.rows, "10001", "lodes_daytime_ratio")).toMatchObject({ value: 0.5, unit: "ratio" });
    expect(find(out.rows, "10003", "lodes_daytime_ratio")?.value).toBe(2);
    // A county with resident workers but no workplace blocks: jobs blank, never zero.
    expect(find(out.rows, "10005", "lodes_jobs_workplace")).toMatchObject({ value: null });
    expect(find(out.rows, "10005", "lodes_daytime_ratio")?.value).toBeNull();
    expect(find(out.rows, "DE", "lodes_jobs_workplace")).toMatchObject({ geo_type: "state", value: 550 });
    expect(find(out.rows, "DE", "lodes_daytime_ratio")?.value).toBe(1);
    expect(lodesUrl("DE", "wac", 2022)).toBe("https://lehd.ces.census.gov/data/lodes/LODES8/de/wac/de_wac_S000_JT00_2022.csv.gz");
  });

  it("records nothing when neither file is published", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const out = await fetchLodes("DE", 2030, { fetchImpl, backoffMs: 0 });
    expect(out.rows).toEqual([]);
    expect(out.emptyReason).toMatch(/has not published/);
  });
});

describe("sumCounties", () => {
  it("adds counties into states and the nation", () => {
    const base = { geo_type: "county" as const, geo_name: null, period: "2024", series_key: "x", unit: "count", note: null, raw: {} };
    const sums = sumCounties(
      [
        { ...base, geo_code: "48001", state_code: "TX", value: 1 },
        { ...base, geo_code: "48003", state_code: "TX", value: 2 },
        { ...base, geo_code: "01001", state_code: "AL", value: 4 },
      ],
      ["x"],
      { nation: true, note: "n" },
    );
    expect(sums.find((s) => s.geo_code === "TX")?.value).toBe(3);
    expect(sums.find((s) => s.geo_code === "US")?.value).toBe(7);
  });
});
