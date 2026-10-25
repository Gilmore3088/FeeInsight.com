import { describe, expect, it } from "vitest";
import {
  FINANCIAL_PEER_MINIMUM,
  buildFinancialPerformance,
  headlineSentence,
  pctChange,
  peerQuarterDates,
  previousQuarterEnd,
  reconcile,
  type FiledQuarterRow,
  type PeerQuarterRow,
} from "./financial-quarters";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";

const ENDS = ["03-31", "06-30", "09-30", "12-31"];

function quarterEnds(fromYear: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count; i++) out.push(`${fromYear + Math.floor(i / 4)}-${ENDS[i % 4]}`);
  return out;
}

function fdicRow(reportDate: string, fee: number, id = 1): FiledQuarterRow {
  return {
    recordId: id, reportDate, source: "fdic", institutionName: "Sample Bank", certNumber: "12345",
    feeIncome: fee, totalDeposits: fee * 100, totalAssets: fee * 130,
    rawFeeIncome: fee, rawDeposits: fee * 100, rawAssets: fee * 130,
    sourceUrl: "https://api.fdic.gov/banks/financials", retrievedAt: "2026-08-20",
  };
}

/** NCUA stores thousands; the filing holds whole dollars and income year to date. */
function ncuaRow(reportDate: string, ytd: number, id = 1): FiledQuarterRow {
  return {
    recordId: id, reportDate, source: "ncua", institutionName: "Sample Credit Union", certNumber: "678",
    feeIncome: ytd, totalDeposits: 50_000, totalAssets: 60_000,
    rawFeeIncome: ytd * 1000 + 200, rawDeposits: 50_000_000, rawAssets: 60_000_000,
    sourceUrl: null, retrievedAt: "2026-08-20",
  };
}

function peers(reportDate: string, n: number, median = 500): PeerQuarterRow {
  return { reportDate, feeMedian: median, feePeers: n, depositsMedian: 40_000, depositsPeers: n, assetsMedian: 50_000, assetsPeers: n };
}

describe("financial performance view (#1892)", () => {
  it("uses the 10-peer rule for financial peers", () => {
    expect(FINANCIAL_PEER_MINIMUM).toBe(MIN_PEERS_FOR_POSITION);
  });

  it("shows the newest 12 bank quarters, newest first, with quarter and year changes", () => {
    const dates = quarterEnds(2022, 16);
    const rows = dates.map((d, i) => fdicRow(d, 1000 + i * 10, i + 1));
    const view = buildFinancialPerformance(rows, [])!;
    expect(view.source).toBe("fdic");
    expect(view.quarters).toHaveLength(12);
    expect(view.short).toBe(false);
    const latest = view.quarters[0];
    expect(latest.reportDate).toBe("2025-12-31");
    expect(latest.label).toBe("Q4 2025");
    expect(latest.key).toBe("2025-Q4");
    expect(latest.fee.value).toBe(1150);
    expect(latest.fee.qoqPct).toBe(pctChange(1150, 1140));
    expect(latest.fee.yoyPct).toBe(pctChange(1150, 1110));
    expect(latest.fee.yearToDate).toBeNull();
    // The oldest shown quarter still has its year-ago quarter, read from the extra filings.
    expect(view.quarters[11].fee.yoyPct).toBe(pctChange(1040, 1000));
    expect(latest.evidence.entity).toBe("Sample Bank, FDIC certificate 12345");
    expect(latest.evidence.variables.map((v) => v.code)).toEqual(["ISERCHGQ", "DEP", "ASSET"]);
    expect(latest.evidence.variables.every((v) => v.check === "matches")).toBe(true);
    expect(latest.evidence.calculation).toContain("No conversion");
  });

  it("splits credit union year to date into quarters and keeps the filed year to date apart", () => {
    const rows = [
      ncuaRow("2025-03-31", 100, 1),
      ncuaRow("2025-06-30", 230, 2),
      ncuaRow("2025-09-30", 360, 3),
      ncuaRow("2025-12-31", 500, 4),
      ncuaRow("2026-03-31", 120, 5),
      ncuaRow("2026-06-30", 250, 6),
    ];
    const view = buildFinancialPerformance(rows, [])!;
    const byDate = new Map(view.quarters.map((q) => [q.reportDate, q]));
    expect(byDate.get("2026-06-30")!.fee.value).toBe(130);
    expect(byDate.get("2026-06-30")!.fee.yearToDate).toBe(250);
    expect(byDate.get("2026-03-31")!.fee.value).toBe(120);
    expect(byDate.get("2025-12-31")!.fee.value).toBe(140);
    // Quarter on quarter compares standalone quarters, never year-to-date totals.
    expect(byDate.get("2026-06-30")!.fee.qoqPct).toBe(pctChange(130, 120));
    expect(byDate.get("2026-06-30")!.fee.yoyPct).toBe(pctChange(130, 130));
    expect(byDate.get("2026-06-30")!.evidence.calculation).toContain("ACCT_131 year to date at Jun 30, 2026");
    expect(byDate.get("2026-06-30")!.evidence.calculation).toContain("less ACCT_131 year to date at Mar 31, 2026");
    expect(byDate.get("2026-06-30")!.evidence.entity).toBe("Sample Credit Union, NCUA charter 678");
    // Raw dollars round to the stored thousands.
    expect(byDate.get("2026-06-30")!.evidence.variables[0].check).toBe("matches");
    expect(view.short).toBe(true);
  });

  it("splits a credit union quarter on the filed dollars, not on two rounded totals", () => {
    // Filed $120,400 then $260,600 year to date: the quarter is $140,200, shown as 140 thousand, not 261 - 120 = 141.
    const q1 = { ...ncuaRow("2026-03-31", 120, 1), rawFeeIncome: 120_400 };
    const q2 = { ...ncuaRow("2026-06-30", 261, 2), rawFeeIncome: 260_600 };
    const view = buildFinancialPerformance([q1, q2], [])!;
    const q = view.quarters.find((x) => x.reportDate === "2026-06-30")!;
    expect(q.fee.value).toBe(140);
    expect(q.evidence.calculation).toContain("($260,600) less ACCT_131 year to date at");
    expect(q.evidence.calculation).toContain("= $140,200 for the quarter.");
    // A quarter that comes out negative reads as -$X.
    const back = buildFinancialPerformance([q1, { ...ncuaRow("2026-06-30", 115, 2), rawFeeIncome: 115_000 }], [])!;
    expect(back.quarters.find((x) => x.reportDate === "2026-06-30")!.evidence.calculation).toContain("= -$5,400 for the quarter.");
  });

  it("never shows a year-to-date total as one quarter when the previous filing is missing", () => {
    const view = buildFinancialPerformance([ncuaRow("2026-03-31", 120, 1), ncuaRow("2026-09-30", 400, 2)], [])!;
    const q3 = view.quarters.find((q) => q.reportDate === "2026-09-30")!;
    expect(q3.fee.value).toBeNull();
    expect(q3.fee.yearToDate).toBe(400);
    expect(q3.evidence.heldReason).toMatch(/cannot be split/);
  });

  it("never splits a quarter out from a previous filing that does not match its own filing", () => {
    const badPrior = { ...ncuaRow("2026-03-31", 120, 1), rawFeeIncome: 250_000 };
    const view = buildFinancialPerformance([badPrior, ncuaRow("2026-06-30", 260, 2)], [])!;
    const q2 = view.quarters.find((q) => q.reportDate === "2026-06-30")!;
    expect(q2.fee.value).toBeNull();
    expect(q2.evidence.heldReason).toMatch(/previous quarter's stored figure does not match/);
  });

  it("holds back a stored fee figure that does not match the filing", () => {
    const bad = { ...fdicRow("2026-06-30", 900, 2), rawFeeIncome: 950 };
    const view = buildFinancialPerformance([fdicRow("2026-03-31", 800, 1), bad], [])!;
    const q2 = view.quarters[0];
    expect(q2.fee.value).toBeNull();
    expect(q2.evidence.variables[0].check).toBe("differs");
    expect(q2.evidence.heldReason).toMatch(/does not match/);
  });

  it("shows a figure whose filed variable is not in the stored record, and says it was not checked", () => {
    const row = { ...fdicRow("2026-06-30", 900), rawFeeIncome: null };
    const view = buildFinancialPerformance([row], [])!;
    expect(view.quarters[0].fee.value).toBe(900);
    expect(view.quarters[0].evidence.variables[0].check).toBe("not_in_record");
  });

  it("gives a peer median only when at least 10 peers report", () => {
    const rows = [fdicRow("2026-03-31", 800, 1), fdicRow("2026-06-30", 900, 2)];
    const view = buildFinancialPerformance(rows, [peers("2026-06-30", 10, 700), peers("2026-03-31", 9, 650)])!;
    expect(view.quarters[0].fee.peerMedian).toBe(700);
    expect(view.quarters[0].fee.peers).toBe(10);
    expect(view.quarters[1].fee.peerMedian).toBeNull();
    expect(view.quarters[1].fee.peers).toBe(9);
    expect(view.quarters[1].deposits.peerMedian).toBeNull();
  });

  it("keeps one record per quarter end and ignores dates that are not quarter ends", () => {
    const rows = [fdicRow("2026-06-30", 900, 2), fdicRow("2026-06-30", 950, 7), fdicRow("2026-05-15", 10, 9)];
    const view = buildFinancialPerformance(rows, [])!;
    expect(view.quarters).toHaveLength(1);
    expect(view.quarters[0].fee.value).toBe(950);
    expect(peerQuarterDates(rows)).toEqual(["2026-06-30"]);
  });

  it("writes the headline from the view's own numbers", () => {
    const rows = quarterEnds(2025, 6).map((d, i) => fdicRow(d, 1000 + i * 100, i + 1));
    const view = buildFinancialPerformance(rows, [peers("2026-06-30", 12, 1200)])!;
    expect(headlineSentence(view)).toBe(
      "Deposit service charges in Q2 2026 were $1.5 million, up 36.4% on Q2 2025. The peer group median was $1.2 million across 12 institutions.",
    );
    expect(headlineSentence(view)).not.toMatch(/\u2014/);
  });

  it("returns nothing without filings", () => {
    expect(buildFinancialPerformance([], [])).toBeNull();
  });

  it("dates and checks", () => {
    expect(previousQuarterEnd("2026-03-31")).toBe("2025-12-31");
    expect(previousQuarterEnd("2026-09-30")).toBe("2026-06-30");
    expect(reconcile(250, 250_400, "dollars")).toBe("matches");
    expect(reconcile(250, 251_000, "dollars")).toBe("differs");
    expect(pctChange(10, 0)).toBeNull();
  });
});
