import { describe, expect, it } from "vitest";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { ReportLine } from "@/lib/custom-report/analysis";
import { institutionTeaser, teaserScale } from "./institution-view";

function line(key: string, own: number | null, position: ReportLine["position"] = "in_market", comparable = true): ReportLine {
  return {
    key,
    label: key,
    own: own === null ? null : { amount: own, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key },
    peers: { n: 12, p25: 20, median: 25, p75: 30, min: 10, max: 40 },
    comparable,
    position: own === null ? null : position,
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

describe("benchmark institution view", () => {
  it("withholds the name and keeps only the comparable lines the institution publishes", () => {
    const teaser = institutionTeaser(report([line("od", 35, "above_market"), line("nsf", null), line("atm", 3, "in_market", false), line("wire", 25)]));
    expect(teaser).toMatchObject({ who: "A bank in Florida", competitors: 18, above: 1 });
    expect(JSON.stringify(teaser)).not.toContain("Capital City");
    expect(teaser!.lines.map((l) => [l.key, l.own, l.chargingLess, l.peers])).toEqual([
      ["od", 35, 4, 12],
      ["wire", 25, 4, 12],
    ]);
  });

  it("shows nothing when the sample is offline, not ready, or has no comparable line", () => {
    expect(institutionTeaser(null)).toBeNull();
    expect(institutionTeaser(report([line("od", 35)], false))).toBeNull();
    expect(institutionTeaser(report([line("nsf", null)]))).toBeNull();
  });

  it("widens a line's axis so the institution's dot fits, in order", () => {
    const x = teaserScale({ own: 50, p25: 20, p75: 30 });
    expect(x(20)).toBeGreaterThan(0);
    expect(x(20)).toBeLessThan(x(30));
    expect(x(30)).toBeLessThan(x(50));
    expect(x(50)).toBeLessThan(100);
  });
});

describe("benchmark institution view wording and limits", () => {
  it("names a credit union, and drops the state when there is none", () => {
    const cu = report([line("od", 30)]);
    cu.data.subject = { ...cu.data.subject, charter_type: "credit_union" };
    expect(institutionTeaser(cu)!.who).toBe("A credit union in Florida");
    const noState = report([line("od", 30)]);
    noState.data.subject = { ...noState.data.subject, state_code: null } as typeof noState.data.subject;
    expect(institutionTeaser(noState)!.who).toBe("A bank");
  });

  it("shows at most five lines and counts above only among them", () => {
    const lines = [1, 2, 3, 4, 5].map((n) => line(`l${n}`, 25)).concat([line("l6", 99, "above_market")]);
    const teaser = institutionTeaser(report(lines))!;
    expect(teaser.lines).toHaveLength(5);
    expect(teaser.above).toBe(0);
  });
});
