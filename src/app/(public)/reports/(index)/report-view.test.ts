import { describe, expect, it } from "vitest";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { formatReadOn, lineScale, mapStates, sampleExhibit } from "./report-view";

function line(key: string, own: number | null, comparable = true): ReportLine {
  return {
    key,
    label: key.toUpperCase(),
    own: own === null ? null : { amount: own, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key },
    peers: { n: 12, p25: 20, median: 25, p75: 30, min: 10, max: 40 },
    comparable,
    position: own === null ? null : own > 30 ? "above_market" : "in_market",
    percentile: 50,
    chargingLess: 4,
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
      findings: ["a", "b", "c", "d"],
    },
    savedAt: null,
    sinceBought: null,
  };
}

describe("reports page view", () => {
  it("keeps only the sample's comparable lines the bank publishes", () => {
    const sample = sampleExhibit(report([line("od", 35), line("nsf", null), line("atm", 3, false), line("wire", 25)]));
    expect(sample).toMatchObject({ name: "Capital City Bank", place: "Tallahassee, FL", competitorsWithData: 18 });
    expect(sample!.lines.map((l) => [l.key, l.own, l.position])).toEqual([
      ["od", 35, "above_market"],
      ["wire", 25, "in_market"],
    ]);
    expect(sample!.findings).toHaveLength(3);
    expect(sample!.readOn).toBeNull();
  });

  it("dates the sample by the latest schedule read behind it", () => {
    const r = report([line("od", 35)]);
    const fee = { institution_id: 1, line: "od", amount: 30, fee_name: "od", source_url: null, updated_at: null, source_line: "od" };
    r.data.lines = [
      { ...fee, schedule_read_on: "2026-09-28" },
      { ...fee, schedule_read_on: "2026-10-03" },
      { ...fee, schedule_read_on: null },
    ];
    expect(sampleExhibit(r)!.readOn).toBe("2026-10-03");
    expect(formatReadOn("2026-10-03")).toBe("October 3, 2026");
  });

  it("shows no sample when it is offline, not ready, or has nothing comparable", () => {
    expect(sampleExhibit(null)).toBeNull();
    expect(sampleExhibit(report([line("od", 35)], false))).toBeNull();
    expect(sampleExhibit(report([line("nsf", null)]))).toBeNull();
  });

  it("widens a line's axis so the bank's own dot fits", () => {
    const x = lineScale({ own: 50, p25: 20, p75: 30 });
    expect(x(50)).toBeLessThan(100);
    expect(x(20)).toBeGreaterThan(0);
    expect(x(20)).toBeLessThan(x(30));
    expect(x(30)).toBeLessThan(x(50));
    const below = lineScale({ own: 5, p25: 20, p75: 30 });
    expect(below(5)).toBeGreaterThanOrEqual(0);
    expect(below(5)).toBeLessThan(below(20));
  });

  it("shades states by institutions with verified fees and marks those ready for a local report", () => {
    const states = mapStates(
      [
        { state_code: "FL", institution_count: 160, fee_count: 3000 },
        { state_code: "VT", institution_count: 4, fee_count: 40 },
        { state_code: "ZZ", institution_count: 9, fee_count: 9 },
      ],
      { FL: "Florida", VT: "Vermont" },
      new Set(["FL"]),
    );
    expect(states).toEqual([
      { code: "FL", name: "Florida", institutions: 160, fees: 3000, shade: 4, reportReady: true },
      { code: "VT", name: "Vermont", institutions: 4, fees: 40, shade: 0, reportReady: false },
    ]);
  });
});
