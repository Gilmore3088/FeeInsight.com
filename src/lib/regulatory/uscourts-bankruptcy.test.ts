import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { f2WorkbookUrls, fetchF2, parseF2RowLabel, parseF2Rows, quarterEndText, readF2Layout } from "./uscourts-bankruptcy";

const Q = { year: 2025, quarter: 1 as const };

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function xlsx(rows: string[][]): ReturnType<typeof zipSync> {
  const shared: string[] = [];
  const idx = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const cell = (v: string, r: number, c: number) =>
    v === "" ? "" : /^\d+$/.test(v) ? `<c r="${colName(c)}${r}"><v>${v}</v></c>` : `<c r="${colName(c)}${r}" t="s"><v>${idx(v)}</v></c>`;
  const sheet = `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, i + 1, j)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const sst = `<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`;
  return zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(sst) });
}

// Layout as remembered from the published table: title, a group row, a chapter row, then
// circuits, districts and the TOTAL row.
const F2: string[][] = [
  ["Table F-2.", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["U.S. Bankruptcy Courts--Business and Nonbusiness Cases Commenced, by Chapter of the Bankruptcy Code, During the 3-Month Period Ending March 31, 2025"],
  ["Circuit and District", "Total Filings", "", "", "", "", "Business Filings", "", "", "", "Nonbusiness Filings", "", ""],
  ["", "Total", "Chapter 7", "Chapter 11", "Chapter 13", "Other", "Total", "Chapter 7", "Chapter 11", "Chapter 13", "Total", "Chapter 7", "Chapter 13"],
  ["TOTAL", "135000", "80000", "2500", "52000", "500", "6000", "3500", "2400", "100", "129000", "76500", "51900"],
  ["DC", "60", "40", "5", "15", "-", "6", "4", "2", "-", "54", "36", "15"],
  ["DC", "60", "40", "5", "15", "-", "6", "4", "2", "-", "54", "36", "15"],
  ["1ST", "2000", "1500", "50", "450", "0", "100", "70", "30", "0", "1900", "1430", "450"],
  ["ME", "300", "250", "5", "45", "0", "10", "8", "2", "0", "290", "242", "45"],
  ["AL,N", "1000", "400", "10", "590", "0", "20", "10", "10", "0", "980", "390", "580"],
  ["AL, M", "500", "200", "5", "295", "0", "10", "5", "5", "0", "490", "195", "290"],
  ["AL,S", "700", "300", "", "395", "0", "15", "10", "", "0", "685", "290", "395"],
  ["Footnote: data are provisional", "", "", "", "", "", "", "", "", "", "", "", ""],
];

describe("F-2 row labels", () => {
  it("reads totals, circuits and districts in the forms US Courts uses", () => {
    expect(parseF2RowLabel("TOTAL")).toEqual({ kind: "nation" });
    expect(parseF2RowLabel("2ND")).toMatchObject({ kind: "circuit" });
    expect(parseF2RowLabel("NY,E")).toEqual({ kind: "district", state: "NY", district: "NY,E" });
    expect(parseF2RowLabel("NY, E")).toEqual({ kind: "district", state: "NY", district: "NY,E" });
    expect(parseF2RowLabel("ME")).toEqual({ kind: "district", state: "ME", district: "ME" });
    expect(parseF2RowLabel("NMI")).toEqual({ kind: "district", state: "MP", district: "NMI" });
    expect(parseF2RowLabel("Alabama - Northern")).toEqual({ kind: "district", state: "AL", district: "AL,N" });
    expect(parseF2RowLabel("Notes")).toMatchObject({ kind: "unknown" });
  });
});

describe("F-2 layout", () => {
  it("finds the header, the period and every group/chapter column", () => {
    const layout = readF2Layout(F2)!;
    expect(layout.periodMonths).toBe(3);
    expect(layout.columns.map((c) => `${c.group}/${c.chapter}`)).toEqual([
      "total/all_chapters",
      "total/ch7",
      "total/ch11",
      "total/ch13",
      "total/other",
      "business/all_chapters",
      "business/ch7",
      "business/ch11",
      "business/ch13",
      "nonbusiness/all_chapters",
      "nonbusiness/ch7",
      "nonbusiness/ch13",
    ]);
  });
});

describe("parseF2Rows", () => {
  it("sums districts to states, keeps districts in raw and takes the nation from TOTAL", () => {
    const r = parseF2Rows(F2, Q, "https://example.test/f2.xlsx");
    expect(r.emptyReason).toBeNull();
    expect(r.missingFields).toEqual([]);
    const al = r.rows.find((x) => x.geo_code === "AL" && x.series_key === "bankruptcy_3mo_nonbusiness_all_chapters")!;
    expect(al).toMatchObject({ geo_type: "state", period: "2025Q1", value: 2155, unit: "count" });
    expect((al.raw.districts as unknown[]).length).toBe(3);
    const alCh11 = r.rows.find((x) => x.geo_code === "AL" && x.series_key === "bankruptcy_3mo_total_ch11")!;
    expect(alCh11.value).toBeNull();
    expect(alCh11.note).toMatch(/AL,S/);
    const nation = r.rows.find((x) => x.geo_type === "nation" && x.series_key === "bankruptcy_3mo_total_all_chapters")!;
    expect(nation.value).toBe(135000);
    // "-" is kept as a flag, never turned into zero.
    const dcOther = r.rows.find((x) => x.geo_code === "DC" && x.series_key === "bankruptcy_3mo_total_other")!;
    expect(dcOther).toMatchObject({ value: null, note: expect.stringContaining("-") });
    expect(r.skipped).toMatchObject({ circuit_subtotal: 1, repeated_district_row: 1 });
  });

  it("refuses a table for another period", () => {
    const other = F2.map((r) => [...r]);
    other[1] = ["... During the 3-Month Period Ending June 30, 2025"];
    const r = parseF2Rows(other, Q, null);
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/March 31, 2025/);
  });

  it("reports a missing required column", () => {
    const noNonbusiness = F2.map((r) => r.slice(0, 10));
    const r = parseF2Rows(noNonbusiness, Q, null);
    expect(r.missingFields).toContain("nonbusiness all_chapters");
  });
});

describe("fetchF2", () => {
  it("follows the table page to the workbook when the direct address is missing", async () => {
    const book = xlsx(F2);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("statistics/table/f-2-three-months")) return new Response('<a href="/file/bf_f2_0331.2025.xlsx">Download XLSX</a>');
      if (url.endsWith("/file/bf_f2_0331.2025.xlsx")) return new Response(book);
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await fetchF2(Q, { fetchImpl, retries: 0 });
    expect(r.url).toBe("https://www.uscourts.gov/file/bf_f2_0331.2025.xlsx");
    expect(r.rows.length).toBeGreaterThan(10);
  });

  it("returns empty with a reason when nothing is published", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const r = await fetchF2(Q, { fetchImpl, retries: 0 });
    expect(r.rows).toEqual([]);
    expect(r.emptyReason).toMatch(/No F-2 table found/);
  });

  it("puts a configured template first", () => {
    expect(f2WorkbookUrls(Q, "https://x.test/{YYYY}/{MM}{DD}.xlsx")[0]).toBe("https://x.test/2025/0331.xlsx");
    expect(quarterEndText({ year: 2024, quarter: 4 })).toBe("December 31, 2024");
  });
});
