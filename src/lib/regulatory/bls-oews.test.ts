import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { fetchOews, readOewsBytes, oewsWorkbookFromZip, OEWS_MAX_WORKBOOK_BYTES, metroState, oewsUrl, parseOewsWorkbook, streamXlsxRows } from "./bls-oews";

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function xlsx(rows: string[][]): ReturnType<typeof zipSync> {
  const shared: string[] = [];
  const idx = (s: string) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const cell = (v: string, r: number, c: number) =>
    v === "" ? "" : /^-?\d+(\.\d+)?$/.test(v) ? `<c r="${colName(c)}${r}"><v>${v}</v></c>` : `<c r="${colName(c)}${r}" t="s"><v>${idx(v)}</v></c>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}" spans="1:20">${r.map((v, j) => cell(v, i + 1, j)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const sst = `<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`;
  return zipSync({ "xl/workbook.xml": strToU8("<workbook/>"), "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(sst) });
}

const HEADER = ["AREA", "AREA_TITLE", "AREA_TYPE", "PRIM_STATE", "NAICS", "I_GROUP", "OWN_CODE", "OCC_CODE", "OCC_TITLE", "O_GROUP", "TOT_EMP", "EMP_PRSE", "H_MEAN", "A_MEAN", "MEAN_PRSE", "H_MEDIAN", "A_MEDIAN", "ANNUAL", "HOURLY"];
const row = (area: string, title: string, type: string, st: string, occ: string, occTitle: string, emp: string, hMean: string, aMean: string, hMed: string, aMed: string) => [
  area, title, type, st, "000000", "cross-industry", "1235", occ, occTitle, "detailed", emp, "2.1", hMean, aMean, "0.8", hMed, aMed, "", "",
];

const MSA = [
  HEADER,
  row("10180", "Abilene, TX", "4", "TX", "43-3071", "Tellers", "180", "17.5", "36400", "17.1", "35570"),
  row("10180", "Abilene, TX", "4", "TX", "00-0000", "All Occupations", "70000", "25", "52000", "20", "41600"),
  row("37980", "Philadelphia-Camden-Wilmington, PA-NJ-DE-MD", "4", "PA", "13-2072", "Loan Officers", "6500", "45.2", "94016", "#", "#"),
  row("37980", "Philadelphia-Camden-Wilmington, PA-NJ-DE-MD", "4", "PA", "43-4141", "New Accounts Clerks", "**", "*", "*", "*", "*"),
  row("0100001", "Northwest Alabama nonmetropolitan area", "6", "AL", "43-3071", "Tellers", "300", "15", "31200", "15", "31200"),
];

describe("streamXlsxRows", () => {
  it("streams rows from shared and numeric cells", () => {
    const rows: string[][] = [];
    const r = streamXlsxRows(xlsx([["a", "1"], ["", "b"]]), (x) => rows.push(x));
    expect(r).toEqual({ sheet: "xl/worksheets/sheet1.xml", rows: 2 });
    expect(rows).toEqual([["a", "1"], ["", "b"]]);
  });
});

describe("parseOewsWorkbook", () => {
  it("keeps the bank occupations for metros, with BLS marks as null + note", () => {
    const r = parseOewsWorkbook(xlsx(MSA), 2024, "ma", "u", "MSA_M2024_dl.xlsx");
    expect(r.missingFields).toEqual([]);
    const teller = r.rows.find((x) => x.geo_code === "10180" && x.series_key === "oews_tellers_hourly_median")!;
    expect(teller).toMatchObject({ geo_type: "metro", state_code: "TX", period: "2024", value: 17.1, unit: "dollars_per_hour" });
    const lo = r.rows.find((x) => x.geo_code === "37980" && x.series_key === "oews_loan_officers_annual_median")!;
    expect(lo).toMatchObject({ value: null, note: "#", state_code: null });
    expect(lo.raw.prim_state).toBe("PA");
    const clerk = r.rows.find((x) => x.series_key === "oews_new_accounts_clerks_employment")!;
    expect(clerk).toMatchObject({ value: null, note: "**" });
    expect(r.rows.some((x) => x.geo_code === "0100001")).toBe(false);
    expect(r.skipped).toMatchObject({ area_type_6: 1 });
    expect(r.info.occupations_missing).toContain("13-2041");
  });

  it("reports a renamed column and a title that does not match the SOC title", () => {
    const header = HEADER.map((h) => (h === "H_MEDIAN" ? "H_MED" : h));
    const r = parseOewsWorkbook(xlsx([header, row("06", "California", "2", "CA", "43-3071", "Bank Tellers", "20000", "20", "41600", "19", "39520")]), 2024, "st", "u", null);
    expect(r.missingFields).toEqual(["st:H_MEDIAN"]);
    expect(r.info.title_mismatches[0]).toMatch(/43-3071/);
    expect(r.rows.find((x) => x.series_key === "oews_tellers_employment")).toMatchObject({ geo_type: "state", geo_code: "CA", value: 20000 });
  });

  it("names a metro's state only when it has one", () => {
    expect(metroState("Abilene, TX")).toBe("TX");
    expect(metroState("New York-Newark-Jersey City, NY-NJ")).toBeNull();
  });
});

describe("fetchOews", () => {
  it("reads all three levels and records a missing level", async () => {
    const nat = zipSync({ "oesm24nat/national_M2024_dl.xlsx": xlsx([HEADER, row("99", "U.S.", "1", "US", "43-3071", "Tellers", "330000", "19", "39520", "18.5", "38480")]) });
    const ma = zipSync({ "oesm24ma/MSA_M2024_dl.xlsx": xlsx(MSA), "oesm24ma/field_descriptions.xlsx": xlsx([["x"]]) });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === oewsUrl(2024, "nat")) return new Response(nat);
      if (url === oewsUrl(2024, "ma")) return new Response(ma);
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await fetchOews(2024, { fetchImpl, retries: 0 });
    expect(r.rows.some((x) => x.geo_type === "nation" && x.series_key === "oews_tellers_employment" && x.value === 330000)).toBe(true);
    expect(r.rows.some((x) => x.geo_type === "metro")).toBe(true);
    expect(r.missingFields).toContain("st file");
    expect(oewsUrl(2024, "ma")).toBe("https://www.bls.gov/oes/special-requests/oesm24ma.zip");
  });
});

describe("OEWS download failures", () => {
  it("names the year, level, archive stage and byte count for a truncated outer ZIP", async () => {
    const bytes=zipSync({"national_M2022_dl.xlsx":xlsx([HEADER])}).subarray(0,30);
    const fetchImpl=vi.fn(async()=>new Response(bytes,{headers:{"content-type":"application/zip"}})) as unknown as typeof fetch;
    await expect(fetchOews(2022,{fetchImpl,retries:0})).rejects.toThrow(/2022 nat outer ZIP.*bytes=30/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("distinguishes an invalid inner workbook from an invalid outer archive", async () => {
    const bytes=zipSync({"national_M2022_dl.xlsx":new Uint8Array([80,75,3,4])});
    const fetchImpl=vi.fn(async()=>new Response(bytes)) as unknown as typeof fetch;
    await expect(fetchOews(2022,{fetchImpl,retries:0})).rejects.toThrow(/2022 nat XLSX.*bytes=/);
  });
  it("does not count a 200 HTML block page as a successful empty check", async () => {
    const fetchImpl=vi.fn(async()=>new Response("<html>refused</html>",{headers:{"content-type":"text/html"}})) as unknown as typeof fetch;
    await expect(fetchOews(2022,{fetchImpl,retries:0})).rejects.toThrow(/2022 nat download.*not a ZIP.*content_type=text\/html/);
  });
});

describe("OEWS archive bounds", () => {
  it("ignores AppleDouble metadata and selects the real workbook before parsing rows", async () => {
    const state = xlsx([HEADER, row("06", "California", "2", "CA", "43-3071", "Tellers", "20000", "20", "41600", "19", "39520")]);
    const archive = zipSync({
      "__MACOSX/oesm22st/._state_M2022_dl.xlsx": strToU8("AppleDouble metadata, not an XLSX"),
      "oesm22st/state_M2022_dl.xlsx": state,
    });
    const fetchImpl = vi.fn(async (url: string) => url === oewsUrl(2022, "st")
      ? new Response(archive) : new Response("missing", { status: 404 })) as unknown as typeof fetch;
    const result = await fetchOews(2022, { fetchImpl, retries: 0 });
    expect(result.rows.find(r => r.series_key === "oews_tellers_annual_median")).toMatchObject({ period: "2022", geo_code: "CA", value: 39520 });
    expect(result.info.st).toMatchObject({ workbook: "oesm22st/state_M2022_dl.xlsx" });
  });
  it("matches an exact workbook basename and requested year, without guessing between genuine duplicates", () => {
    const workbook = xlsx([HEADER]);
    const archive = zipSync({ "state_M2021_dl.xlsx": workbook, "data/state_M2022_dl.xlsx": workbook });
    expect(oewsWorkbookFromZip(archive, "st", 2022).name).toBe("data/state_M2022_dl.xlsx");
    expect(oewsWorkbookFromZip(zipSync({ "backup_state_M2022_dl.xlsx": workbook }), "st", 2022).bytes).toBeNull();
    const ambiguous = zipSync({ "a/state_M2022_dl.xlsx": workbook, "b/state_M2022_dl.xlsx": workbook });
    expect(() => oewsWorkbookFromZip(ambiguous, "st", 2022)).toThrow(/multiple st workbooks.*a\/state_M2022_dl.xlsx.*b\/state_M2022_dl.xlsx/);
  });
  it("cancels before reading a declared oversized response", async () => {
    let cancelled=false;
    const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-length":"100"}});
    await expect(readOewsBytes(response,10)).rejects.toThrow("declared download exceeds");
    expect(cancelled).toBe(true);
  });
  it("cancels an undeclared oversized stream and checks truncated identity bodies", async () => {
    let cancelled=false;
    const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(11));},cancel(){cancelled=true;}}));
    await expect(readOewsBytes(response,10)).rejects.toThrow("received download exceeds");
    expect(cancelled).toBe(true);
    await expect(readOewsBytes(new Response(new Uint8Array(2),{headers:{"content-length":"3"}}),10)).rejects.toThrow("incomplete download");
  });
  it("compares decoded size only to the byte cap when HTTP compression is declared", async () => {
    expect(await readOewsBytes(new Response(new Uint8Array(2),{headers:{"content-length":"1","content-encoding":"gzip"}}),10)).toHaveLength(2);
  });
  it("rejects an oversized workbook from directory metadata before inflating it", () => {
    const bytes=zipSync({"MSA_M2022_dl.xlsx":new Uint8Array(2)});
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    // Change only the central-directory uncompressed size; allocate no huge fixture.
    for(let at=0;at<bytes.length-24;at++) if(view.getUint32(at,true)===0x02014b50){view.setUint32(at+24,OEWS_MAX_WORKBOOK_BYTES+1,true);break;}
    expect(()=>oewsWorkbookFromZip(bytes,"ma")).toThrow("workbook exceeds");
  });
});

it("does not record a valid ZIP with non-workbook contents as an empty XLSX check", async () => {
  const bytes=zipSync({"national_M2022_dl.xlsx":zipSync({"readme.txt":strToU8("unavailable")})});
  const fetchImpl=vi.fn(async()=>new Response(bytes)) as unknown as typeof fetch;
  await expect(fetchOews(2022,{fetchImpl,retries:0})).rejects.toThrow(/2022 nat XLSX: ZIP is missing XLSX/);
});
