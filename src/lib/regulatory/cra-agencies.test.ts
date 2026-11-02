import { describe, expect, it, vi } from "vitest";

import { normalizeCraRating } from "./cra";
import { CRAPES_ROWS, FRB_PAGE } from "./cra-agencies-fixtures";
import { crapesMonthWindow, crapesRating, fetchCrapesYear, fetchFrbCraRatings, frbCraDate, parseFrbCraPage, CRAPES_ROW_CAP, FRB_CRA_RESULT_URL } from "./cra-agencies";

describe("FDIC CRAPES ratings", () => {
  it("builds month windows the way the CRAPES page sends them", () => {
    expect(crapesMonthWindow(2026, 10)).toBe("2026-10-1:2026-10-31");
    expect(crapesMonthWindow(2024, 2)).toBe("2024-2-1:2024-2-29");
  });

  it("reads a year month by month, skips future months, counts rows missing a required field and flags capped months", async () => {
    const asked: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const release = JSON.parse(String(init?.body)).release as string;
      asked.push(release);
      const data = release === "2026-9-1:2026-9-30" ? Array.from({ length: CRAPES_ROW_CAP }, () => CRAPES_ROWS[0]) : release.startsWith("2026-10-") ? CRAPES_ROWS : [];
      return new Response(JSON.stringify({ status: "success", data }));
    }) as unknown as typeof fetch;
    const r = await fetchCrapesYear(2026, { fetchImpl, backoffMs: 0 }, new Date("2026-10-20T00:00:00Z"));
    expect(asked).toHaveLength(10);
    expect(r.cappedMonths).toEqual(["2026-9-1:2026-9-30"]);
    expect(r.missingFields).toEqual({ EXM_RTG_FULL_DESC: 1 });
    expect(r.unexpectedFields).toEqual([]);
    const alpine = r.ratings.at(-1)!;
    expect(alpine).toMatchObject({
      fdicCert: "23091", rssd: null, regulator: "FDIC", name: "Alpine Bank", state: "CO", examDate: null, ratingCode: 1,
      examMethod: "Large Bank Evaluation", assetSize: 6850257.0, evaluationUrl: "https://crapes.fdic.gov/publish/2026/23091_260427.PDF",
    });
    expect(alpine.raw.public_date).toBe("2026-10-01");
  });

  it("keys an FDIC rating on its PE file, so a new public date or date format keeps the same row", () => {
    const a = crapesRating(CRAPES_ROWS[0]);
    expect(crapesRating({ ...CRAPES_ROWS[0], EXM_CRA_PUB_DTE: "2026-11-01" }).ratingKey).toBe(a.ratingKey);
    const noFile = { ...CRAPES_ROWS[0], SYS_EXTRN_FILE_ID: null };
    expect(crapesRating({ ...noFile, EXM_CRA_PUB_DTE: "2026-10-01" }).ratingKey).toBe(crapesRating(noFile).ratingKey);
    expect(crapesRating(noFile).ratingKey).not.toBe(a.ratingKey);
  });

  it("fails loudly when CRAPES answers with an error", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "error", error: "One or more search fields are invalid." }))) as unknown as typeof fetch;
    await expect(fetchCrapesYear(2026, { fetchImpl, backoffMs: 0 }, new Date("2026-01-10T00:00:00Z"))).rejects.toThrow(/invalid/);
  });
});

describe("Federal Reserve CRAPubWeb ratings", () => {
  it("parses dates and the Board's short rating words", () => {
    expect(frbCraDate("Feb 05, 2018")).toBe("2018-02-05");
    expect(frbCraDate("Feb 30, 2018")).toBeNull();
    expect(normalizeCraRating("Sub Non Compliance")).toBe(4);
  });

  it("reads each bank row with RSSD, exam date, rating and PE link; keeps unreadable values null", () => {
    const page = parseFrbCraPage(FRB_PAGE, "u");
    expect(page.lastPage).toBe(2);
    expect(page.unreadableRows).toBe(0);
    expect(page.ratings[0]).toMatchObject({
      rssd: "746223", agencyId: "746223", regulator: "FRB", name: "1880 BANK", city: "CAMBRIDGE", state: "MD",
      examDate: "2018-02-05", ratingCode: 2, examMethod: "Int Small Bank", assetSize: 354590,
      evaluationUrl: "https://www.federalreserve.gov/apps/CRAPubWeb/CRA/DownloadPDF/746223_20180205",
    });
    expect(page.ratings[0].raw.public_date_iso).toBe("2018-09-06");
    expect(page.ratings[1]).toMatchObject({ ratingCode: 4, assetSize: null, evaluationUrl: null });
  });

  it("walks every page the pager links and stops at the last", async () => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(FRB_PAGE);
    }) as unknown as typeof fetch;
    const r = await fetchFrbCraRatings({ fetchImpl, backoffMs: 0 });
    expect(asked).toEqual([FRB_CRA_RESULT_URL, `${FRB_CRA_RESULT_URL}&page=2`]);
    expect(r.ratings).toHaveLength(4);
  });

  it("fails when the first page has no rating rows", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html><title>Community Reinvestment Act - Error</title></html>")) as unknown as typeof fetch;
    await expect(fetchFrbCraRatings({ fetchImpl, backoffMs: 0 })).rejects.toThrow(/Error/);
  });
});
