import { describe, expect, it } from "vitest";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { buildCompetitorBoard } from "./pro-view";
import { chargingLess, lineAxisMax, rankWindow, shortInstitutionName, stackDots } from "./board-math";
import { proPlanFacts } from "./plan-facts";

const competitors = [
  { institution_id: 1, institution_name: "Wells Fargo Bank, National Association" },
  { institution_id: 2, institution_name: "Truist Bank" },
  { institution_id: 3, institution_name: "Ameris Bank" },
  { institution_id: 4, institution_name: "Regions Bank" },
  { institution_id: 5, institution_name: "T M H Federal Credit Union" },
  { institution_id: 6, institution_name: "Hancock Whitney Bank" },
].map((c) => ({ ...c, city: null, state_code: "FL", charter_type: "bank", market_deposits: null }));

function figure(id: number, amount: number) {
  return { institution_id: id, line: "x", amount, fee_name: "x", source_url: null, updated_at: null, schedule_read_on: null, source_line: "" };
}

function line(key: string, own: number | null, amounts: number[], comparable = true): ReportLine {
  const sorted = [...amounts].sort((a, b) => a - b);
  return {
    key,
    label: key,
    own: own === null ? null : { amount: own, fee_name: key, source_url: null, updated_at: null, schedule_read_on: "2026-10-03", source_line: "" },
    peers: sorted.length ? { n: sorted.length, p25: sorted[1], median: sorted[2], p75: sorted[3], min: sorted[0], max: sorted[sorted.length - 1] } : null,
    comparable,
    position: comparable ? "in_market" : null,
    percentile: null,
    chargingLess: null,
    peerFigures: sorted.map((amount, i) => figure(i + 1, amount)),
  };
}

function report(lines: ReportLine[]): MarketReport {
  return {
    data: {
      subject: { institution_id: 323, institution_name: "Capital City Bank", city: "Tallahassee", state_code: "FL", charter_type: "bank", market_deposits: null, asset_size: null },
      market: { basis: "branch_counties", county_fips: ["a", "b", "c"], places: ["TALLAHASSEE, FL"], sod_year: 2026 },
      competitors,
      lines: [],
      dropped: {},
    },
    analysis: { readiness: { ready: true, comparableLines: 6, ownLines: 9, competitorsWithData: 29, competitorsInMarket: 36, reason: null }, lines, named: [], findings: [] },
    savedAt: null,
    sinceBought: null,
  } as unknown as MarketReport;
}

describe("buildCompetitorBoard", () => {
  it("names each local competitor on each comparable line, overdraft first", () => {
    const board = buildCompetitorBoard(
      report([line("stop_payment", 35, [20, 30, 33, 35, 36]), line("overdraft", 35, [10, 31.5, 35, 36, 40, 34])]),
    )!;
    expect(board.institutionName).toBe("Capital City Bank");
    expect(board.marketLabel).toBe("Tallahassee, FL area (3 counties)");
    expect(board.competitorsWithData).toBe(29);
    expect(board.lines.map((l) => l.key)).toEqual(["overdraft", "stop_payment"]);
    expect(board.lines[0].peers[0]).toEqual({ id: 1, name: "Wells Fargo Bank, N.A.", amount: 10 });
  });

  it("leaves out lines that are not comparable or name fewer than five competitors (thin rule)", () => {
    expect(buildCompetitorBoard(report([line("nsf", 35, [10, 20, 30, 40]), line("overdraft", 35, [1, 2, 3, 4, 5], false)]))).toBeNull();
    expect(buildCompetitorBoard(null)).toBeNull();
  });
});

describe("board math", () => {
  const peers = [10, 30, 35, 35, 40].map((amount, i) => ({ id: i, name: `P${i}`, amount }));

  it("counts competitors charging strictly less", () => {
    expect(chargingLess(peers, 35)).toBe(2);
    expect(chargingLess(peers, 0)).toBe(0);
  });

  it("windows the ranked list around the subject", () => {
    const rows = rankWindow({ peers, own: 35 }, "Capital City Bank", 3);
    expect(rows.map((r) => r.name)).toEqual(["P3", "Capital City Bank", "P4"]);
    expect(rows.find((r) => r.self)?.amount).toBe(35);
  });

  it("stacks equal amounts and finds a clean axis top", () => {
    expect(stackDots([35, 10, 35, 35])).toEqual([0, 0, 1, 2]);
    expect(lineAxisMax({ peers, own: 35 })).toBe(40);
    expect(lineAxisMax({ peers, own: 75 })).toBe(75);
    expect(lineAxisMax({ peers: [], own: 2 })).toBe(10);
  });

  it("shortens National Association only", () => {
    expect(shortInstitutionName("Bank of America, National Association")).toBe("Bank of America, N.A.");
    expect(shortInstitutionName("Truist Bank")).toBe("Truist Bank");
  });
});

describe("proPlanFacts", () => {
  it("reads the lowest monthly price and the annual months free from the tiers", () => {
    expect(proPlanFacts()).toEqual({ fromMonthly: "$150/mo", freeMonths: 2 });
  });
});
