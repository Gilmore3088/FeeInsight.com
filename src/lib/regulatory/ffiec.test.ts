import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  describeFfiecPage,
  downloadButtonName,
  fetchFfiecCallBulk,
  formatFfiecPage,
  parsePorTimestamp,
  periodOptionValue,
  readFfiecOverdraft,
  readFfiecPor,
  readFormState,
  readScheduleRiOverdraft,
} from "./ffiec";

const RI = [
  '"IDRSSD"\t"RIAD4340"\t"RIADH032"\t"RIADH033"',
  '""\t"NET INCOME"\t"CONSUMER OVERDRAFT-RELATED SERVICE CHARGES"\t"OTHER"',
  '"852218"\t"9000"\t"1250"\t"40"',
  '"451965"\t"5000"\t""\t"10"',
  '"12311"\t"100"\t"0"\t""',
  "",
].join("\n");

function bulkZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

describe("readFfiecOverdraft", () => {
  it("reads H032 from Schedule RI only, keeps a filed zero, and skips blanks", async () => {
    const zip = bulkZip({
      "FFIEC CDR Call Schedule RI 06302026.txt": RI,
      "FFIEC CDR Call Schedule RIA 06302026.txt": '"IDRSSD"\t"RIADH032"\n"999"\t"77"\n',
      "FFIEC CDR Call Bulk POR 06302026.txt": "IDRSSD\n1\n",
    });
    const out = await readFfiecOverdraft(zip);
    expect(out.files).toEqual(["FFIEC CDR Call Schedule RI 06302026.txt"]);
    expect(out.hasColumn).toBe(true);
    expect(out.rows).toEqual([
      { rssd: "852218", ytdThousands: 1250 },
      { rssd: "12311", ytdThousands: 0 },
    ]);
  });

  it("reports a missing column for quarters before H032 existed", async () => {
    const zip = bulkZip({ "FFIEC CDR Call Schedule RI 12312014.txt": '"IDRSSD"\t"RIAD4340"\n"1"\t"2"\n' });
    expect(await readFfiecOverdraft(zip)).toMatchObject({ hasColumn: false, rows: [] });
  });

  it("does not size buffers from the zip directory", async () => {
    const zip = bulkZip({ "FFIEC CDR Call Schedule RI 06302026.txt": RI });
    // Mark every central directory size as unknown (0xFFFFFFFF); a whole-buffer unzip would allocate 4 GB.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 46 <= zip.length; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 20, 0xffffffff, true);
        view.setUint32(i + 24, 0xffffffff, true);
      }
    }
    expect((await readFfiecOverdraft(zip)).rows).toHaveLength(2);
  });
});

describe("readFfiecPor (#1925)", () => {
  // The bulk zip's panel-of-reporters file: one header row, one row per bank. Column order and
  // values here are illustrative; the reader finds the columns by name.
  const POR = [
    '"IDRSSD"\t"FDIC Certificate Number"\t"Financial Institution Name"\t"Financial Institution Filing Type"\t"Last Date/Time Submission Updated On"',
    '"852218"\t"628"\t"BANK A"\t"031"\t"2026-08-14T10:02:31"',
    '"451965"\t"3511"\t"BANK B"\t"041"\t"1/20/2026 3:05:00 PM"',
    '"12311"\t"100"\t"BANK C"\t"051"\t""',
    '"99"\t"7"\t"BANK D"\t"051"\t"n/a"',
    "",
  ].join("\n");

  it("reads each bank's last-updated time from the POR file, as US Eastern clock time", () => {
    const out = readFfiecPor({
      "FFIEC CDR Call Schedule RI 06302026.txt": strToU8(RI),
      "FFIEC CDR Call Bulk POR 06302026.txt": strToU8(POR),
    });
    expect(out).toMatchObject({ file: "FFIEC CDR Call Bulk POR 06302026.txt", column: "Last Date/Time Submission Updated On", unreadable: 1 });
    expect(out.rows).toEqual([
      // August: EDT, UTC-4.
      { rssd: "852218", lastUpdated: "2026-08-14T10:02:31", epochSeconds: Date.parse("2026-08-14T14:02:31Z") / 1000 },
      // January: EST, UTC-5.
      { rssd: "451965", lastUpdated: "1/20/2026 3:05:00 PM", epochSeconds: Date.parse("2026-01-20T20:05:00Z") / 1000 },
    ]);
  });

  it("reports a missing file or column instead of guessing", () => {
    expect(readFfiecPor({ "FFIEC CDR Call Schedule RI 06302026.txt": strToU8(RI) })).toEqual({
      file: null, column: null, rows: [], unreadable: 0, certColumn: null, certs: [], certUnreadable: 0,
    });
    expect(readFfiecPor({ "FFIEC CDR Call Bulk POR 06302026.txt": strToU8("IDRSSD\n1\n") })).toMatchObject({ column: null, rows: [], certColumn: null, certs: [] });
  });

  it("reads the FDIC certificate each RSSD filed under that quarter, refusing what is not a whole number (#2625)", () => {
    // Emigrant Bank, 2023-09-30: RSSD 137915 filed under the old Emigrant certificate 12054; the
    // charter that holds today's certificate 57083 filed as its own RSSD (the RSSD here is
    // illustrative). A savings bank with no FDIC certificate files 0.
    const por = [
      '"IDRSSD"\t"FDIC Certificate Number"\t"Financial Institution Name"\t"Last Date/Time Submission Updated On"',
      '"137915"\t"12054"\t"EMIGRANT BANK"\t"2023-10-30T09:00:00"',
      '"5551212"\t"057083"\t"PLUS INTERNATIONAL BANK"\t"2023-10-27T11:00:00"',
      '"777"\t"0"\t"NO CERT"\t"2023-10-27T11:00:00"',
      '"778"\t"12A54"\t"GARBLED"\t"2023-10-27T11:00:00"',
      '"779"\t""\t"BLANK"\t"2023-10-27T11:00:00"',
      "",
    ].join("\n");
    const out = readFfiecPor({ "FFIEC CDR Call Bulk POR 09302023.txt": strToU8(por) });
    expect(out).toMatchObject({ certColumn: "FDIC Certificate Number", certUnreadable: 1, unreadable: 0 });
    expect(out.certs).toEqual([{ rssd: "137915", cert: "12054" }, { rssd: "5551212", cert: "57083" }]);
    expect(out.rows).toHaveLength(5);
    // The certificate column is read even when the last-updated column is missing, and a loose
    // header ("FDIC Cert No.") matches.
    const noTime = readFfiecPor({ "FFIEC CDR Call Bulk POR 12312024.txt": strToU8('"IDRSSD"\t"FDIC Cert No."\n"366854"\t"16471"\n') });
    expect(noTime).toMatchObject({ column: null, rows: [], certColumn: "FDIC Cert No.", certs: [{ rssd: "366854", cert: "16471" }] });
  });

  it("parses stated zones and refuses impossible dates", () => {
    expect(parsePorTimestamp("2026-03-01T12:00:00Z")).toBe(Date.parse("2026-03-01T12:00:00Z") / 1000);
    expect(parsePorTimestamp("2026-03-01 12:00:00+01:00")).toBe(Date.parse("2026-03-01T11:00:00Z") / 1000);
    expect(parsePorTimestamp("12/31/2025 12:00:00 AM")).toBe(Date.parse("2025-12-31T05:00:00Z") / 1000);
    expect(parsePorTimestamp("2026-02-30T10:00:00")).toBeNull();
    expect(parsePorTimestamp("13:00 yesterday")).toBeNull();
  });
});

const PAGE = (dates: string) => `
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs&amp;1" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="gen" />
<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev" />
${dates}`;
const DATES = `<select name="ctl00$MainContentHolder$DatesDropDownList" id="x">
  <option selected="selected" value="155">06/30/2026</option>
  <option value="154">03/31/2026</option>
</select>`;

describe("FFIEC bulk form", () => {
  it("reads view state and the period option for a quarter", () => {
    expect(readFormState(PAGE(""), new Map())).toMatchObject({ viewState: "vs&1", viewStateGenerator: "gen", eventValidation: "ev" });
    expect(periodOptionValue(DATES, { year: 2026, quarter: 1 })).toBe("154");
    expect(periodOptionValue(DATES, { year: 2025, quarter: 4 })).toBeNull();
  });

  it("posts product, period, format and download with the session cookie", async () => {
    const zip = bulkZip({ "FFIEC CDR Call Schedule RI 03312026.txt": RI });
    const bodies: string[] = [];
    const cookies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      cookies.push(String((init?.headers as Record<string, string>)?.Cookie ?? ""));
      if (bodies.length === 1) {
        return new Response(PAGE(""), { status: 200, headers: { "content-type": "text/html", "set-cookie": "ASP.NET_SessionId=abc; path=/" } });
      }
      if (bodies.length < 5) return new Response(PAGE(DATES), { status: 200, headers: { "content-type": "text/html" } });
      return new Response(zip as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="FFIEC CDR Call Bulk All Schedules 03312026.zip"' },
      });
    });
    const out = await fetchFfiecCallBulk({ year: 2026, quarter: 1 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.fileName).toBe("FFIEC CDR Call Bulk All Schedules 03312026.zip");
    expect(readScheduleRiOverdraft(out.files ?? {}).rows).toHaveLength(2);
    const last = new URLSearchParams(bodies[4]);
    expect(last.get("ctl00$MainContentHolder$DatesDropDownList")).toBe("154");
    expect(last.get("ctl00$MainContentHolder$FormatType")).toBe("TSVRadioButton");
    expect(last.get("ctl00$MainContentHolder$TabStrip1$Download_0")).toBe("Download");
    expect(cookies[4]).toBe("ASP.NET_SessionId=abc");
  });

  it("returns no zip when FFIEC does not list the quarter", async () => {
    const fetchImpl = vi.fn(async () => new Response(PAGE(DATES), { status: 200, headers: { "content-type": "text/html" } }));
    const out = await fetchFfiecCallBulk({ year: 2027, quarter: 1 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.files).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("describeFfiecPage", () => {
  const html = `<html><head><title> Download Bulk Data </title></head><body>
    <input type="hidden" name="__VIEWSTATE" value="huge" />
    <input type="email" name="contact" value="someone@example.com" />
    <span id="ctl00_MainContentHolder_ErrorMessage" class="err">Please select a   file format.</span>
    <div class="validation-summary">Please select a file format.</div>
    <script>alert('Session expired');</script>
    <input type="radio" name="ctl00$MainContentHolder$FormatType" value="TSVRadioButton" />
    <input type="radio" name="ctl00$MainContentHolder$FormatType" value="XBRLRadioButton" checked="checked" />
    <select name="ctl00$MainContentHolder$DatesDropDownList"><option value="1">09/30/2026</option><option value="2" selected="selected">06/30/2026</option></select>
    <input type="submit" name="ctl00$MainContentHolder$TabStrip1$Download_0" value="Download" />
  </body></html>`;

  it("names the title, the visible messages and the form fields without hidden values", () => {
    const page = describeFfiecPage(html);
    expect(page.title).toBe("Download Bulk Data");
    expect(page.messages).toEqual(["Please select a file format.", "Session expired"]);
    expect(page.fields).toEqual([
      "__VIEWSTATE",
      "contact",
      "ctl00$MainContentHolder$FormatType[radio=TSVRadioButton]",
      "ctl00$MainContentHolder$FormatType[radio=XBRLRadioButton*]",
      "ctl00$MainContentHolder$TabStrip1$Download_0[submit=Download]",
      "ctl00$MainContentHolder$DatesDropDownList[select 2 options, 06/30/2026*]",
    ]);
    const line = formatFfiecPage(page);
    expect(line).toMatch(/^title "Download Bulk Data"; messages: "Please select a file format\." \| "Session expired"; fields: __VIEWSTATE, /);
    expect(line).not.toContain("huge");
    expect(line).not.toContain("someone@example.com");
  });

  it("finds the Download control by its label", () => {
    expect(downloadButtonName(html)).toBe("ctl00$MainContentHolder$TabStrip1$Download_0");
    expect(downloadButtonName('<input type="submit" name="other" value="Search" />')).toBeNull();
  });

  it("says none when the page has nothing", () => {
    expect(formatFfiecPage(describeFfiecPage(""))).toBe("title none; messages: none; fields: none");
  });
});
