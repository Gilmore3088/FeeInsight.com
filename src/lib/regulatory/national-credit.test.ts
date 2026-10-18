import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { STRUCK_AREA_SERIES_KEYS, STRUCK_NATIONAL_SERIES_IDS } from "@/lib/data-store/struck-sources";
import {
  checkNationalCreditStats,
  excelSerialDate,
  fetchCct,
  fetchHhdcState,
  fetchNationalSeries,
  fredPeriod,
  hhdcSheetKind,
  NATIONAL_SERIES,
  NYFED_HHDC_STATE_URL_ENV,
  parseCctCsv,
  parseFredSeriesCsv,
  parseHhdcWorkbook,
  parseSceCreditWorkbook,
  quarterFromLabel,
  readWorkbookSheets,
  CFPB_CCT_FILES,
  CFPB_CCT_MARKETS,
  type NationalSeriesConfig,
} from "./national-credit";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** A minimal xlsx: one worksheet per entry, strings inline, numbers as values. */
function makeXlsx(sheets: Record<string, Array<Array<string | number>>>): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
    ),
  };
  names.forEach((name, i) => {
    const rows = sheets[name]
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((cell, c) =>
              typeof cell === "number"
                ? `<c r="${col(c)}${r + 1}"><v>${cell}</v></c>`
                : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${esc(cell)}</t></is></c>`,
            )
            .join("")}</row>`,
      )
      .join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`);
  });
  return zipSync(files);
}

const DEPOSITS = NATIONAL_SERIES.find((s) => s.id === "DPSACBW027SBOG")!;
const SLOOS = NATIONAL_SERIES.find((s) => s.id === "DRTSCILM")!;

describe("FRED national series", () => {
  it("maps dates to periods by frequency and rejects dates that do not fit", () => {
    expect(fredPeriod("2026-10-07", "weekly")).toBe("2026-10-07");
    expect(fredPeriod("2026-09-01", "monthly")).toBe("2026-09");
    expect(fredPeriod("2026-07-01", "quarterly")).toBe("2026Q3");
    expect(fredPeriod("2026-08-01", "quarterly")).toBeNull();
    expect(fredPeriod("2026-09-15", "monthly")).toBeNull();
  });

  it("reads a graph CSV whose header names the series, keeping blanks as null with the flag", () => {
    const csv = "observation_date,DPSACBW027SBOG\n1999-12-29,4500.1\n2026-09-24,18001.5\n2026-10-01,.\n2026-10-08,18050.25\n";
    const r = parseFredSeriesCsv(csv, DEPOSITS);
    expect(r.problem).toBeNull();
    expect(r.skipped).toEqual({ before_first_date: 1 });
    expect(r.rows.map((x) => [x.period, x.value, x.note])).toEqual([
      ["2026-09-24", 18001.5, null],
      ["2026-10-01", null, "."],
      ["2026-10-08", 18050.25, null],
    ]);
    expect(r.rows[0]).toMatchObject({ geo_type: "nation", geo_code: "US", series_key: "natl_h8_deposits_all", unit: "billions_dollars" });
  });

  it("refuses a file whose header names another series (never substituted)", () => {
    const r = parseFredSeriesCsv("observation_date,DPSALLW027SBOG\n2026-10-08,1\n", DEPOSITS);
    expect(r.rows).toEqual([]);
    expect(r.problem).toMatch(/not DPSACBW027SBOG/);
    expect(parseFredSeriesCsv("<html>Error</html>", DEPOSITS).problem).toMatch(/HTML/);
  });

  it("reads quarterly SLOOS dates as quarters and counts off-quarter dates", () => {
    const r = parseFredSeriesCsv("DATE,DRTSCILM\n2026-04-01,-5.2\n2026-07-01,7.9\n2026-08-01,1\n", SLOOS);
    expect(r.rows.map((x) => [x.period, x.value])).toEqual([
      ["2026Q2", -5.2],
      ["2026Q3", 7.9],
    ]);
    expect(r.skipped).toEqual({ date_not_quarterly: 1 });
  });

  it("names every series FRED does not return and loads the rest", async () => {
    const series: NationalSeriesConfig[] = [DEPOSITS, SLOOS];
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("DPSACBW027SBOG")
        ? new Response("observation_date,DPSACBW027SBOG\n2026-10-08,18050\n")
        : new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;
    const r = await fetchNationalSeries(series, { fetchImpl, backoffMs: 0 });
    expect(r.rows).toHaveLength(1);
    expect(r.missingFields).toEqual(["DRTSCILM (HTTP 404)"]);
    expect(r.perSeries.DPSACBW027SBOG).toEqual({ rows: 1, latest: "2026-10-08", problem: null });
    expect(r.emptyReason).toBeNull();
  });

  it("gives every configured series a unique id and key", () => {
    expect(new Set(NATIONAL_SERIES.map((s) => s.id)).size).toBe(NATIONAL_SERIES.length);
    expect(new Set(NATIONAL_SERIES.map((s) => s.key)).size).toBe(NATIONAL_SERIES.length);
    for (const s of NATIONAL_SERIES) expect(s.key).toMatch(/^natl_[a-z0-9_]+$/);
  });

  it("configures no struck series (Freddie Mac PMMS, Philadelphia Fed cards; DECISIONS.md 2026-10-18)", () => {
    expect(NATIONAL_SERIES.filter((s) => STRUCK_NATIONAL_SERIES_IDS.includes(s.id)).map((s) => s.id)).toEqual([]);
    expect(NATIONAL_SERIES.filter((s) => STRUCK_AREA_SERIES_KEYS.includes(s.key)).map((s) => s.key)).toEqual([]);
  });
});

describe("cleaning pass", () => {
  it("lets SLOOS net percentages go negative but flags other negatives", () => {
    const row = (series_key: string, value: number) => ({ geo_type: "nation" as const, geo_code: "US", geo_name: null, state_code: null, period: "2026Q3", series_key, value, unit: "percent", note: null, raw: {} });
    const checks = checkNationalCreditStats([row("natl_sloos_ci_large_mid_tightening", -5), row("natl_fdic_rate_savings", -1)], new Set(["natl_sloos_ci_large_mid_tightening"]));
    expect(checks.flagged.map((f) => f.key)).toEqual(["natl_fdic_rate_savings/nation"]);
  });
});

describe("workbook reader", () => {
  it("reads every sheet by tab name", () => {
    const sheets = readWorkbookSheets(makeXlsx({ auto: [["state", "Q4_2024"], ["AK", 5000]], creditcard_delinq: [["state"], ["AK"]] }));
    expect(sheets.map((s) => s.name)).toEqual(["auto", "creditcard_delinq"]);
    expect(sheets[0].rows).toEqual([["state", "Q4_2024"], ["AK", "5000"]]);
    expect(readWorkbookSheets(strToU8("state,2024\n"))).toEqual([]);
  });
});

describe("NY Fed household debt by state", () => {
  it("recognises sheet kinds and period labels", () => {
    expect(hhdcSheetKind("creditcard_delinq")).toEqual({ loan: "credit_card", measure: "delinquent_90_pct" });
    expect(hhdcSheetKind("studentloan")).toEqual({ loan: "student_loan", measure: "balance_per_capita" });
    expect(hhdcSheetKind("population")).toBeNull();
    expect(quarterFromLabel("Q4_2023")).toBe("2023Q4");
    expect(quarterFromLabel("2024:Q1")).toBe("2024Q1");
    expect(quarterFromLabel("03:Q1")).toBe("2003Q1");
    expect(quarterFromLabel("2023")).toBe("2023");
    expect(quarterFromLabel("state")).toBeNull();
  });

  const workbook = () =>
    readWorkbookSheets(
      makeXlsx({
        auto: [["Auto loan debt balance per capita (in $)"], ["state", "Q4_2023", "Q4_2024"], ["AK", 5210, 5400], ["Texas", 6000, 6110], ["allUS", 5800, 5900], ["Middle Atlantic", 1, 2]],
        auto_delinq: [["Percent of auto loan balance 90+ days delinquent"], ["state", "Q4_2023", "Q4_2024"], ["AK", 4.1, "n/a"]],
        population: [["state", "2024"], ["AK", 733000]],
      }),
    );

  it("loads states and the nation, keeps a blank as null with its flag, and names gaps", () => {
    const r = parseHhdcWorkbook(workbook());
    const ak = r.rows.filter((x) => x.geo_code === "AK" && x.series_key === "hhd_auto_balance_per_capita");
    expect(ak.map((x) => [x.period, x.value])).toEqual([
      ["2023Q4", 5210],
      ["2024Q4", 5400],
    ]);
    expect(r.rows.find((x) => x.geo_code === "TX")).toMatchObject({ geo_type: "state", state_code: "TX", unit: "dollars" });
    expect(r.rows.filter((x) => x.geo_type === "nation").map((x) => x.value)).toEqual([5800, 5900]);
    const blank = r.rows.find((x) => x.series_key === "hhd_auto_delinquent_90_pct" && x.period === "2024Q4")!;
    expect(blank).toMatchObject({ value: null, note: "n/a", unit: "percent" });
    expect(r.skipped).toEqual({ unknown_area: 1 });
    expect(r.unexpectedFields).toContain("sheet population");
    expect(r.missingFields).toContain("sheet for mortgage balance_per_capita");
    expect(r.missingFields.some((m) => m.startsWith("label"))).toBe(false);
  });

  it("names a missing unit label but still loads", () => {
    const r = parseHhdcWorkbook(readWorkbookSheets(makeXlsx({ mortgage: [["state", "Q4_2024"], ["AK", 70000]] })));
    expect(r.rows).toHaveLength(1);
    expect(r.missingFields).toContain('label "per capita" on sheet mortgage');
  });

  it("uses the configured URL and reports a missing file as empty", async () => {
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    const r = await fetchHhdcState({ [NYFED_HHDC_STATE_URL_ENV]: "https://example.test/hhdc.xlsx" }, { fetchImpl, backoffMs: 0 });
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/example\.test\/hhdc\.xlsx/);
  });
});

describe("NY Fed SCE credit access", () => {
  it("converts Excel serial dates and reads each sheet as national series", () => {
    expect(excelSerialDate("45689")).toBe("2025-02-01");
    expect(excelSerialDate("12")).toBeNull();
    const sheets = readWorkbookSheets(
      makeXlsx({
        "Rejection rates": [["Share of applications rejected"], ["Date", "Any credit", "Credit card"], [45689, 21.4, 19.8], ["Jun 2025", "", "."], ["notes", 1, 2]],
        "Application rates": [["Survey wave", "Any credit"], ["2025-10", 43.5]],
      }),
    );
    const r = parseSceCreditWorkbook(sheets);
    expect(r.rows.map((x) => [x.series_key, x.period, x.value, x.note])).toEqual([
      ["sce_credit_rejection_rates_any_credit", "2025-02", 21.4, null],
      ["sce_credit_rejection_rates_credit_card", "2025-02", 19.8, null],
      ["sce_credit_rejection_rates_credit_card", "2025-06", null, "."],
      ["sce_credit_application_rates_any_credit", "2025-10", 43.5, null],
    ]);
    expect(r.skipped).toEqual({ unreadable_date: 1 });
    expect(r.missingFields).toEqual(['label "discouraged borrowers"']);
  });
});

describe("CFPB Consumer Credit Trends", () => {
  const auto = CFPB_CCT_MARKETS.find((m) => m.code === "AUT")!;
  const num = CFPB_CCT_FILES.find((f) => f.prefix === "num")!;

  it("reads the value and unadjusted columns by month", () => {
    const r = parseCctCsv("month,date,num,num_unadj,extra\n0,2000-01,1520311,1400000,x\n1,2000-02,,1410000,x\n", auto, num);
    expect(r.rows.map((x) => [x.series_key, x.period, x.value, x.note])).toEqual([
      ["cct_auto_originations_count", "2000-01", 1520311, null],
      ["cct_auto_originations_count_unadj", "2000-01", 1400000, null],
      ["cct_auto_originations_count", "2000-02", null, "blank"],
      ["cct_auto_originations_count_unadj", "2000-02", 1410000, null],
    ]);
    expect(r.unexpectedFields).toEqual(["num_data_AUT: extra"]);
  });

  it("names a file with the wrong header", () => {
    const r = parseCctCsv("period,count\n2000-01,5\n", auto, num);
    expect(r.rows).toEqual([]);
    expect(r.missingFields).toEqual(["num_data_AUT: date", "num_data_AUT: num"]);
  });

  it("tries each directory spelling and names files not found", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith("auto-loans/num_data_AUT.csv") ? new Response("month,date,num\n0,2000-01,5\n") : new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    const r = await fetchCct({ fetchImpl, backoffMs: 0 });
    expect(r.rows).toHaveLength(1);
    expect(r.files.num_data_AUT).toMatch(/auto-loans/);
    expect(r.missingFields).toContain("vol_data_CRC (not found)");
    expect(r.missingFields).toHaveLength(7);
  });
});
