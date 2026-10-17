import { describe, expect, it } from "vitest";
import {
  cleanCraLending,
  cleanCraRatings,
  craDate,
  craLendingUrls,
  CRA_DISCLOSURE_LAYOUT,
  CRA_TRANSMITTAL_LAYOUT,
  isCraDisclosureEntry,
  layoutFailed,
  normalizeCraRating,
  normalizeCraRegulator,
  parseCraDisclosureLine,
  parseCraRatingsText,
  readCraDisclosure,
  readCraTransmittal,
} from "./cra";

/** Build a fixed-width line from a layout; numbers are right-aligned like the FFIEC files. */
function fixedLine(layout: ReadonlyArray<{ key: string; start: number; length: number }>, values: Record<string, string | number>): string {
  const end = Math.max(...layout.map((f) => f.start - 1 + f.length));
  const chars = Array<string>(end).fill(" ");
  for (const f of layout) {
    const v = values[f.key];
    if (v === undefined) continue;
    const s = typeof v === "number" ? String(v).padStart(f.length, " ") : String(v).padEnd(f.length, " ");
    for (let i = 0; i < f.length; i += 1) chars[f.start - 1 + i] = s[i];
  }
  return chars.join("");
}

const disclosureLine = (over: Record<string, string | number> = {}) =>
  fixedLine(CRA_DISCLOSURE_LAYOUT, {
    tableId: "D1-1", respondentId: "0000012345", agencyCode: "3", activityYear: "2024", loanType: "4", actionTaken: "1",
    state: "48", county: "201", msaMd: "26420", assessmentArea: "0001", incomeGroup: "", reportLevel: "040",
    countSize1: 50, amountSize1: 1500, countSize2: 10, amountSize2: 1700, countSize3: 4, amountSize3: 2600,
    countRevUnder1m: 30, amountRevUnder1m: 1200, ...over,
  });

const transmittalLine = (over: Record<string, string | number> = {}) =>
  fixedLine(CRA_TRANSMITTAL_LAYOUT, {
    respondentId: "0000012345", agencyCode: "3", activityYear: "2024", name: "FIRST TEST BANK", city: "HOUSTON", state: "TX",
    rssd: "852218", assets: 1200000, ...over,
  });

describe("CRA ratings file", () => {
  const file = [
    'ID_RSSD,Bank Name,City,State,Exam Date,Rating,Regulator,Exam Method,Asset Size,PE URL,Extra Col',
    '852218,"First Test Bank, N.A.",Houston,tx,03/15/2024,2,OCC,Large Bank,"1,200,000",https://example.gov/pe.pdf,x',
    '999,Other Bank,Austin,TX,2023-01-09,Needs to Improve,3,Small Bank,,not a url,',
    ',No Id Bank,Dallas,TX,13/45/2022,Excellent,9,Small Bank,,,',
  ].join("\n");

  it("maps fields by header name and reports missing and unexpected headers", () => {
    const parsed = parseCraRatingsText(file);
    expect(parsed.delimiter).toBe(",");
    expect(parsed.layoutProblem).toBeNull();
    expect(parsed.fieldColumns.rssd).toBe("ID_RSSD");
    expect(parsed.fieldColumns.evaluationUrl).toBe("PE URL");
    expect(parsed.missingFields).toEqual(expect.arrayContaining(["fdicCert", "agencyId"]));
    expect(parsed.unexpectedHeaders).toEqual(["Extra Col"]);
    const [a, b, c] = parsed.ratings;
    expect(a).toMatchObject({ rssd: "852218", name: "First Test Bank, N.A.", state: "TX", examDate: "2024-03-15", ratingCode: 2, regulator: "OCC", assetSize: 1_200_000, evaluationUrl: "https://example.gov/pe.pdf" });
    expect(b).toMatchObject({ ratingCode: 3, regulator: "FDIC", assetSize: null, evaluationUrl: null, examDate: "2023-01-09" });
    expect(c).toMatchObject({ rssd: null, examDate: null, ratingCode: null, regulator: null });
  });

  it("refuses a file without the required columns", () => {
    expect(parseCraRatingsText("NAME,CITY,STATE\nA,B,C").layoutProblem).toMatch(/examDate, rating/);
    expect(parseCraRatingsText("one value per line\nx").layoutProblem).toMatch(/No header row/);
  });

  it("cleaning reports gaps without changing values", () => {
    const parsed = parseCraRatingsText(file);
    const report = cleanCraRatings(parsed, new Date("2026-10-17T00:00:00Z"));
    expect(report.unreadableExamDates).toBe(1);
    expect(report.unrecognizedRatings).toEqual([{ value: "Excellent", rows: 1 }]);
    expect(report.unrecognizedRegulators).toEqual([{ value: "9", rows: 1 }]);
    expect(report.missingByField.rssd).toBe(1);
    expect(report.ratingCounts).toMatchObject({ Satisfactory: 1, "Needs to Improve": 1, unrecognized: 1 });
    expect(parsed.ratings[2].ratingRaw).toBe("Excellent");
  });

  it("normalizes ratings, regulators and dates", () => {
    expect(normalizeCraRating("Substantial Noncompliance")).toBe(4);
    expect(normalizeCraRating("1")).toBe(1);
    expect(normalizeCraRating("")).toBeNull();
    expect(normalizeCraRegulator("Federal Reserve")).toBe("FRB");
    expect(craDate("20240229")).toBe("2024-02-29");
    expect(craDate("02/30/2024")).toBeNull();
  });
});

describe("CRA lending flat files", () => {
  it("builds two-digit-year URLs", () => {
    expect(craLendingUrls(2024).disclosure).toBe("https://www.ffiec.gov/cra/xls/24exp_discl.zip");
  });

  it("reads a disclosure line and keeps blanks as null", () => {
    const { row, problem } = parseCraDisclosureLine(disclosureLine({ countSize3: "", amountSize3: "" }), 2024);
    expect(problem).toBeNull();
    expect(row).toMatchObject({ tableId: "D1-1", respondentId: "0000012345", stateFips: "48", countyFips: "201", reportLevel: "040", countSize1: 50, countSize3: null, amountSize3: null, loanType: "small_business", actionTaken: "originated" });
  });

  it("flags lines that fail the layout check and skips other tables", () => {
    const content = [
      disclosureLine(),
      disclosureLine({ activityYear: "2023" }),
      disclosureLine({ amountSize1: "12A" }),
      disclosureLine({ tableId: "D3-0" }),
    ].join("\n");
    const read = readCraDisclosure(content, 2024);
    expect(read.rows).toHaveLength(1);
    expect(read.problems).toEqual({ activity_year_mismatch: 1, non_numeric_amount: 1 });
    expect(read.skippedTables).toEqual({ "D3-0": 1 });
    expect(layoutFailed(read)).toBe(true);
  });

  it("reads the transmittal sheet", () => {
    const read = readCraTransmittal(transmittalLine(), 2024);
    expect(read.rows[0]).toMatchObject({ respondentId: "0000012345", rssd: "852218", assets: 1_200_000, name: "FIRST TEST BANK" });
  });

  it("cleaning checks county totals, bucket bounds and transmittal coverage", () => {
    const lines = [
      disclosureLine(),
      disclosureLine({ reportLevel: "", incomeGroup: "001", countSize1: 40, countSize2: 10, countSize3: 4 }),
      disclosureLine({ reportLevel: "", incomeGroup: "002", countSize1: 5, amountSize1: 400, countSize2: 0, countSize3: 0, amountSize2: 0, amountSize3: 0 }),
      disclosureLine({ respondentId: "77", countSize1: 1, amountSize1: 900 }),
    ].join("\n");
    const rows = readCraDisclosure(lines, 2024).rows;
    const transmittal = readCraTransmittal(transmittalLine(), 2024).rows;
    const report = cleanCraLending(rows, transmittal);
    expect(report.countyTotalsChecked).toBe(1);
    expect(report.countyTotalsMismatched).toBe(1); // 64 in the total row vs 59 across income groups
    expect(report.averageAboveBucket).toBe(1); // 900 thousand on one loan in the $100K bucket
    expect(report.respondentsWithoutTransmittal).toBe(1);
    expect(report.reportLevels).toEqual({ "040": 2, "(blank)": 2 });
  });

  it("recognizes disclosure entries for D1 and D2 tables only", () => {
    expect(isCraDisclosureEntry("cra2024_Discl_D11.dat")).toBe(true);
    expect(isCraDisclosureEntry("cra2024_Discl_D22.dat")).toBe(true);
    expect(isCraDisclosureEntry("cra2024_Discl_D3.dat")).toBe(true); // combined-name fallback; lines are filtered by table id
    expect(isCraDisclosureEntry("cra2024_Discl_D61.dat")).toBe(false);
    expect(isCraDisclosureEntry("readme.pdf")).toBe(false);
  });
});
