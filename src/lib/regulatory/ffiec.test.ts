import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { fetchFfiecCallBulk, periodOptionValue, readFfiecOverdraft, readFormState } from "./ffiec";

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
  it("reads H032 from Schedule RI only, keeps a filed zero, and skips blanks", () => {
    const zip = bulkZip({
      "FFIEC CDR Call Schedule RI 06302026.txt": RI,
      "FFIEC CDR Call Schedule RIA 06302026.txt": '"IDRSSD"\t"RIADH032"\n"999"\t"77"\n',
      "FFIEC CDR Call Bulk POR 06302026.txt": "IDRSSD\n1\n",
    });
    const out = readFfiecOverdraft(zip);
    expect(out.files).toEqual(["FFIEC CDR Call Schedule RI 06302026.txt"]);
    expect(out.hasColumn).toBe(true);
    expect(out.rows).toEqual([
      { rssd: "852218", ytdThousands: 1250 },
      { rssd: "12311", ytdThousands: 0 },
    ]);
  });

  it("reports a missing column for quarters before H032 existed", () => {
    const zip = bulkZip({ "FFIEC CDR Call Schedule RI 12312014.txt": '"IDRSSD"\t"RIAD4340"\n"1"\t"2"\n' });
    expect(readFfiecOverdraft(zip)).toMatchObject({ hasColumn: false, rows: [] });
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
    expect(readFfiecOverdraft(out.zip as Uint8Array).rows).toHaveLength(2);
    const last = new URLSearchParams(bodies[4]);
    expect(last.get("ctl00$MainContentHolder$DatesDropDownList")).toBe("154");
    expect(last.get("ctl00$MainContentHolder$FormatType")).toBe("TSVRadioButton");
    expect(last.get("ctl00$MainContentHolder$TabStrip1$Download_0")).toBe("Download");
    expect(cookies[4]).toBe("ASP.NET_SessionId=abc");
  });

  it("returns no zip when FFIEC does not list the quarter", async () => {
    const fetchImpl = vi.fn(async () => new Response(PAGE(DATES), { status: 200, headers: { "content-type": "text/html" } }));
    const out = await fetchFfiecCallBulk({ year: 2027, quarter: 1 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.zip).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
