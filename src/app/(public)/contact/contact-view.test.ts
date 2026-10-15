import { describe, expect, it } from "vitest";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { SCREEN_LINES, hamiltonScreen, screenScale } from "./contact-view";

function line(key: string, own: number | null, comparable = true): ReportLine {
  return {
    key,
    label: key,
    own: own === null ? null : { amount: own, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key },
    peers: { n: 12, p25: 20, median: 25, p75: 30, min: 10, max: 40 },
    comparable,
    position: own === null ? null : "in_market",
    percentile: 50,
    chargingLess: own === null ? null : 4,
    peerFigures: [],
  };
}

function report(lines: ReportLine[], ready = true): MarketReport {
  return {
    data: {
      subject: { institution_id: 323, institution_name: "Capital City Bank", city: "TALLAHASSEE", state_code: "FL", charter_type: "bank", market_deposits: null, asset_size: null },
      market: null,
      competitors: [],
      lines: [],
      dropped: {},
    },
    analysis: {
      readiness: { ready, comparableLines: 6, ownLines: 12, competitorsWithData: 18, competitorsInMarket: 30, reason: null },
      lines,
      named: [],
      findings: [],
    },
    savedAt: null,
    sinceBought: null,
  } as MarketReport;
}

describe("contact Hamilton screen", () => {
  it("keeps the first comparable lines the institution publishes, up to four", () => {
    const lines = [line("a", 30), line("b", null), line("c", 3, false), line("d", 25), line("e", 20), line("f", 22), line("g", 21)];
    const screen = hamiltonScreen(report(lines))!;
    expect(screen.institution).toBe("Capital City Bank");
    expect(screen.competitors).toBe(18);
    expect(screen.lines.map((l) => l.key)).toEqual(["a", "d", "e", "f"]);
    expect(screen.lines).toHaveLength(SCREEN_LINES);
  });

  it("shows nothing when the sample is offline, not ready, or has nothing to compare", () => {
    expect(hamiltonScreen(null)).toBeNull();
    expect(hamiltonScreen(report([line("a", 30)], false))).toBeNull();
    expect(hamiltonScreen(report([line("a", null)]))).toBeNull();
  });

  it("widens the axis so the dot fits", () => {
    const x = screenScale({ own: 50, p25: 20, p75: 30 });
    expect(x(20)).toBeGreaterThan(0);
    expect(x(50)).toBeLessThan(100);
  });
});
