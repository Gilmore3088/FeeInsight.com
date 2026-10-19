import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  boardQuarter,
  findHtmlColumn,
  parseHtmlGridTables,
  periodStartDate,
  readSdmxPackage,
  readZipEntryText,
  scaleSdmxValue,
  SdmxSeriesScanner,
  sloosChartDataUrl,
  unitMultiplier,
  zipEntries,
} from "./fed-board-data";
import { CHGDEL_DELINQUENCY_SA_HTML, SLOOS_CHART_DATA_HTML, sdmxPackage, sdmxXml } from "./fed-board-fixtures";

describe("zip entries", () => {
  it("lists entries from the central directory and inflates one in pieces", () => {
    const big = "x".repeat(3_000_000);
    const zip = zipSync({ "a.xml": strToU8(`<a>${big}</a>`), "b.txt": strToU8("hello") });
    const entries = zipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.xml", "b.txt"]);
    const pieces: string[] = [];
    readZipEntryText(zip, entries[0], (t) => pieces.push(t));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(`<a>${big}</a>`);
    expect(zipEntries(strToU8("not a zip"))).toEqual([]);
  });
});

describe("SDMX scanner", () => {
  const xml = sdmxXml("H8_H8", [
    { name: "B1058NCBA", unitMult: "1000000000", obs: [["2026-09-24", "18001.5"], ["2026-10-01", "-9999", "ND"], ["2026-10-08", "18050.25"]] },
    { name: "B1058NCBD", unitMult: "1000000000", obs: [["2026-10-08", "17990"]] },
    { name: "RIFSPFF_N.M", obs: [["2026-08", "4.33"], ["2026-09", "4.08"]] },
  ]);

  it("keeps only the series asked for, whatever the element prefix, with no-data points as null", () => {
    const scanner = new SdmxSeriesScanner(new Set(["B1058NCBA", "RIFSPFF_N.M"]));
    scanner.push(xml);
    expect([...scanner.found.keys()]).toEqual(["B1058NCBA", "RIFSPFF_N.M"]);
    expect(scanner.seen.has("B1058NCBD")).toBe(true);
    const deposits = scanner.found.get("B1058NCBA")!;
    expect(deposits.multiplier).toBe(1e9);
    expect(deposits.observations).toEqual([
      { period: "2026-09-24", value: 18001.5, status: "A" },
      { period: "2026-10-01", value: null, status: "ND" },
      { period: "2026-10-08", value: 18050.25, status: "A" },
    ]);
    expect(scanner.found.get("RIFSPFF_N.M")!.multiplier).toBeNull();
  });

  it("reads the same when the text arrives in small pieces split mid-tag", () => {
    const whole = new SdmxSeriesScanner(new Set(["B1058NCBA"]));
    whole.push(xml);
    const split = new SdmxSeriesScanner(new Set(["B1058NCBA"]));
    for (let i = 0; i < xml.length; i += 7) split.push(xml.slice(i, i + 7));
    expect(split.found.get("B1058NCBA")).toEqual(whole.found.get("B1058NCBA"));
  });

  it("matches a fully qualified series name and skips structure files in a package", () => {
    const zip = sdmxPackage("H15_H15", [{ name: "H15/H15/RIFSPFF_N.M", obs: [["2026-09-30", "4.08"]] }]);
    const r = readSdmxPackage(zip, ["RIFSPFF_N.M"]);
    expect(r.entries).toEqual(["H15_H15_data.xml"]);
    expect(r.found.get("RIFSPFF_N.M")?.observations).toEqual([{ period: "2026-09-30", value: 4.08, status: "A" }]);
  });

  it("reads UNIT_MULT as an exponent or a factor and scales to the unit asked for", () => {
    expect(unitMultiplier("9")).toBe(1e9);
    expect(unitMultiplier("1000000")).toBe(1e6);
    expect(unitMultiplier("1")).toBe(1);
    expect(unitMultiplier(undefined)).toBeNull();
    expect(scaleSdmxValue(18050.25, 1e9, 1e9)).toBe(18050.25);
    expect(scaleSdmxValue(18050.25, 1e6, 1e9)).toBe(18.05025);
    expect(scaleSdmxValue(4.08, null, 1)).toBe(4.08);
  });

  it("dates a period from its first day", () => {
    expect(periodStartDate("2026-09", "monthly")).toBe("2026-09-01");
    expect(periodStartDate("2026-09-30", "monthly")).toBe("2026-09-01");
    expect(periodStartDate("2026-06-30", "quarterly")).toBe("2026-04-01");
    expect(periodStartDate("2026Q3", "quarterly")).toBe("2026-07-01");
    expect(periodStartDate("2026-10-08", "weekly")).toBe("2026-10-08");
    expect(periodStartDate("2026-10", "weekly")).toBeNull();
  });
});

describe("Board HTML tables", () => {
  it("stacks every header level into one label per column (charge-off and delinquency rates)", () => {
    const [table] = parseHtmlGridTables(CHGDEL_DELINQUENCY_SA_HTML);
    expect(table.columns).toEqual([
      "",
      "Real estate loans | All",
      "Real estate loans | Booked in domestic offices | Residential 1",
      "Real estate loans | Booked in domestic offices | Commercial 2",
      "Real estate loans | Booked in domestic offices | Farmland",
      "Consumer loans | All",
      "Consumer loans | Credit cards",
      "Consumer loans | Other",
      "Leases",
      "C&I loans",
      "Agricultural loans",
      "Total loans and leases",
    ]);
    expect(table.rows[0]).toEqual(["2026:2", "1.68", "1.86", "1.53", "1.33", "2.62", "2.85", "2.33", "1.19", "1.27", "1.10", "1.42"]);
    const cards = findHtmlColumn([table], { column: [/consumer/i, /credit cards?/i] });
    expect(cards?.index).toBe(6);
  });

  it("finds a SLOOS column by figure, panel and sub-heading", () => {
    const tables = parseHtmlGridTables(SLOOS_CHART_DATA_HTML);
    expect(tables).toHaveLength(2);
    expect(tables[0].title).toMatch(/^Figure 1: Measures of Supply and Demand for C&I Loans/);
    const demandSmall = findHtmlColumn(tables, { table: /C&I loans/i, column: [/stronger demand/i, /\|\s*small\b/i] });
    expect(demandSmall?.index).toBe(6);
    expect(demandSmall?.table.rows.map((r) => r[demandSmall.index])).toEqual(["n.a.", "0.0", "3.6"]);
    const subprime = findHtmlColumn(tables, { table: /mortgage/i, column: [/tightening standards/i, /\|\s*subprime$/i] });
    expect(subprime?.index).toBe(4);
    expect(findHtmlColumn(tables, { table: /consumer loans/i, column: [/tightening/i] })).toBeNull();
  });

  it("reads Board quarter labels and builds the SLOOS page address", () => {
    expect(boardQuarter("2026:2")).toBe("2026Q2");
    expect(boardQuarter("2026Q3")).toBe("2026Q3");
    expect(boardQuarter("Period")).toBeNull();
    expect(sloosChartDataUrl("202607")).toBe("https://www.federalreserve.gov/data/sloos/sloos-202607-chart-data.htm");
  });
});
