import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  cleanUbpr,
  describesUbpr,
  normalizeDate,
  pickUbprColumns,
  productOption,
  projectZipColumns,
  readUbprBanks,
  readUbprPeerAverages,
  UBPR_PEER_GROUP,
  UBPR_RATIO_PRODUCT,
  UBPR_RATIOS,
  UBPR_STATS_PRODUCT,
} from "./ubpr-peer-groups";

const tsv = (rows: string[][]) => strToU8(rows.map((r) => r.map((c) => `"${c}"`).join("\t")).join("\r\n"));
const ratio = (key: string) => UBPR_RATIOS.find((r) => r.key === key)!;

describe("description checks", () => {
  it("tells ROA from pretax ROA and NIM from interest expense", () => {
    expect(describesUbpr(ratio("roa"), "NET INCOME TO AVERAGE ASSETS")).toBe(true);
    expect(describesUbpr(ratio("roa"), "PRETAX NET OPERATING INCOME TO AVERAGE ASSETS")).toBe(false);
    expect(describesUbpr(ratio("nim"), "NET INTEREST INCOME (TE) TO AVERAGE EARNING ASSETS")).toBe(true);
    expect(describesUbpr(ratio("nim"), "INTEREST EXPENSE TO AVERAGE EARNING ASSETS")).toBe(false);
  });

  it("keeps net losses apart from loss coverage and the peer group number apart from peer ratios", () => {
    expect(describesUbpr(ratio("net_charge_offs_to_avg_loans"), "NET LOSS TO AVERAGE TOTAL LN&LS")).toBe(true);
    expect(describesUbpr(ratio("net_charge_offs_to_avg_loans"), "EARNINGS COVERAGE OF NET LOSSES (X)")).toBe(false);
    expect(describesUbpr(UBPR_PEER_GROUP, "PEER GROUP NUMBER")).toBe(true);
    expect(describesUbpr(UBPR_PEER_GROUP, "PEER GROUP AVERAGE NET INCOME TO AVERAGE ASSETS")).toBe(false);
  });
});

describe("productOption", () => {
  const html = `<select name="ctl00$MainContentHolder$ListBox1"><option value="A">Call Reports -- Single Period</option>
    <option value="B">UBPR Ratio -- Single Period</option><option value="C">UBPR Stats -- Four Periods</option></select>`;
  it("picks products by label and lists every label", () => {
    expect(productOption(html, UBPR_RATIO_PRODUCT)).toEqual({
      value: "B",
      labels: ["Call Reports -- Single Period", "UBPR Ratio -- Single Period", "UBPR Stats -- Four Periods"],
    });
    expect(productOption(html, UBPR_STATS_PRODUCT).value).toBe("C");
  });
});

describe("normalizeDate", () => {
  it("reads the date forms FFIEC files use", () => {
    expect(normalizeDate("6/30/2026 12:00:00 AM")).toBe("2026-06-30");
    expect(normalizeDate("20260630")).toBe("2026-06-30");
    expect(normalizeDate("2026-06-30")).toBe("2026-06-30");
    expect(normalizeDate("Q2")).toBeNull();
  });
});

describe("bank peer groups", () => {
  const zip = zipSync({
    "FFIEC CDR UBPR Ratio Summary 06302026.txt": tsv([
      ["IDRSSD", "UBPRXXXX", "UBPRE013", "UBPRE088", "UBPRZZZ1", "UBPRE018"],
      ["", "PEER GROUP NUMBER", "NET INCOME TO AVERAGE ASSETS", "SOMETHING ELSE", "SERVICE CHARGES ON DEPOSIT ACCOUNTS TO AVERAGE ASSETS", "INTEREST EXPENSE TO AVG EARNING ASSETS"],
      ["100", "4", "1.10", "61", "-0.20", "3.1"],
      ["200", "4", "", "70", "0.31", "3.2"],
      ["300", "A9", "0.95", "55", "0.12", ""],
    ]),
    "FFIEC CDR UBPR Ratio Unrelated 06302026.txt": tsv([["IDRSSD", "UBPRQ001"], ["", "TOTAL DEPOSITS GROWTH"], ["100", "5"]]),
  });

  it("drops files nothing needs while reading the zip", async () => {
    const projected = await projectZipColumns(zip, pickUbprColumns);
    expect(projected.names).toHaveLength(2);
    expect(projected.files.map((f) => f.name)).toEqual(["FFIEC CDR UBPR Ratio Summary 06302026.txt"]);
  });

  it("loads described columns, reports the rest, and keeps blanks absent", async () => {
    const read = readUbprBanks(await projectZipColumns(zip, pickUbprColumns));
    expect(read.peerGroupColumn).toMatchObject({ status: "loaded_by_description", code: "UBPRXXXX" });
    const status = (key: string) => read.columns.find((c) => c.key === key)?.status;
    expect(status("roa")).toBe("loaded");
    expect(status("service_charges_to_avg_assets")).toBe("loaded_by_description");
    expect(status("nim")).toBe("description_mismatch");
    expect(status("efficiency_ratio")).toBe("description_mismatch");
    expect(status("noninterest_income_to_avg_assets")).toBe("not_in_file");
    const b200 = read.banks.find((b) => b.rssd === "200")!;
    expect(b200.ratios).toEqual({ service_charges_to_avg_assets: 0.31 });
    expect(b200.peerGroup).toBe("4");

    const report = cleanUbpr(read, [], 1);
    expect(report.peerGroupSizes).toEqual({ "4": 2, A9: 1 });
    expect(report.oddPeerGroups).toEqual([{ rssd: "300", peerGroup: "A9" }]);
    expect(report.impossibleValues).toEqual([{ key: "service_charges_to_avg_assets", rssd: "100", value: -0.2 }]);
    expect(report.missingRatioCells.roa).toBe(1);
    expect(report.unmatchedRssds).toBe(1);
  });

  it("refuses a description that matches two columns", async () => {
    const two = zipSync({
      "a.txt": tsv([
        ["IDRSSD", "UBPRA001", "UBPRA002"],
        ["", "EFFICIENCY RATIO", "EFFICIENCY RATIO (ADJ)"],
        ["1", "50", "51"],
      ]),
    });
    const read = readUbprBanks(await projectZipColumns(two, pickUbprColumns));
    expect(read.columns.find((c) => c.key === "efficiency_ratio")).toMatchObject({ status: "ambiguous_description" });
    expect(read.banks).toEqual([]);
  });
});

describe("published peer averages", () => {
  it("keeps the quarter's average rows and refuses duplicated groups", async () => {
    const zip = zipSync({
      "UBPR Stats 06302026.txt": tsv([
        ["PEER GROUP", "REPORTING PERIOD", "STATISTIC", "UBPRE013"],
        ["1", "6/30/2026", "AVERAGE", "1.02"],
        ["1", "3/31/2026", "AVERAGE", "0.99"],
        ["1", "6/30/2026", "PERCENTILE 75", "1.40"],
        ["2", "6/30/2026", "AVERAGE", ""],
        ["3", "6/30/2026", "AVERAGE", "0.8"],
        ["3", "6/30/2026", "AVERAGE", "0.9"],
      ]),
    });
    // No description row: header names stand in for descriptions, and a bare code has none.
    const read = readUbprPeerAverages(await projectZipColumns(zip, pickUbprColumns), { year: 2026, quarter: 2 });
    expect(read.peerGroupColumn.status).toBe("loaded_by_description");
    expect(read.columns.find((c) => c.key === "roa")?.status).toBe("no_description");
    expect(read.averages).toEqual([]);
    expect(read.rowsOtherPeriod).toBe(1);
    expect(read.rowsOtherStatistic).toBe(1);
    expect(read.duplicatePeerGroups).toEqual(["3"]);
  });

  it("reads averages when the columns are described", async () => {
    const zip = zipSync({
      "UBPR Stats 06302026.txt": tsv([
        ["PEER GROUP", "UBPRE013"],
        ["", "NET INCOME TO AVERAGE ASSETS"],
        ["1", "1.02"],
        ["2", "0.88"],
      ]),
    });
    const read = readUbprPeerAverages(await projectZipColumns(zip, pickUbprColumns), { year: 2026, quarter: 2 });
    expect(read.averages.map((a) => [a.peerGroup, a.key, a.value])).toEqual([
      ["1", "roa", 1.02],
      ["2", "roa", 0.88],
    ]);
  });
});
