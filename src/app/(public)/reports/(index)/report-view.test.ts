import { describe, expect, it } from "vitest";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { ReportLine } from "@/lib/custom-report/analysis";
import type { MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { defaultLine, dollarAxis, formatReadOn, lineInsight, nextSteps, sampleExhibit, type SampleLine } from "./report-view";

function figure(institution_id: number, amount: number): MarketFeeLine {
  return { institution_id, line: "x", amount, fee_name: "x", source_url: `https://bank${institution_id}.test/fees.pdf`, updated_at: null, schedule_read_on: "2026-09-30", source_line: "x" };
}

function line(key: string, own: number | null, comparable = true): ReportLine {
  return {
    key,
    label: key.toUpperCase(),
    own: own === null ? null : { amount: own, fee_name: `${key} fee`, source_url: "https://ccb.test/fees.pdf", updated_at: null, schedule_read_on: "2026-10-01", source_line: key },
    peers: { n: 12, p25: 20, median: 25, p75: 30, min: 10, max: 40 },
    comparable,
    position: own === null ? null : own > 30 ? "above_market" : "in_market",
    percentile: 50,
    chargingLess: 4,
    peerFigures: [figure(1, 20), figure(2, 30), figure(99, 35)],
  };
}

function report(lines: ReportLine[], ready = true): MarketReport {
  return {
    data: {
      subject: { institution_id: 323, institution_name: "Capital City Bank", city: "TALLAHASSEE", state_code: "FL", charter_type: "bank", market_deposits: null, asset_size: null },
      market: { basis: "branch_counties", county_fips: ["12073", "12039"], places: ["TALLAHASSEE, FL"], sod_year: 2025 },
      competitors: [
        { institution_id: 1, institution_name: "First Bank", city: null, state_code: "FL", charter_type: "bank", market_deposits: 10 },
        { institution_id: 2, institution_name: "Second CU", city: null, state_code: "FL", charter_type: "credit_union", market_deposits: null },
      ],
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

const sampleLine = (over: Partial<SampleLine>): SampleLine => ({
  key: "wire_intl_outgoing", label: "Outgoing international wire", own: 75, ownFeeName: "Wire out international", ownSourceUrl: null, ownReadOn: null,
  p25: 45, median: 50, p75: 50, min: 25, max: 85, peers: 16, chargingLess: 15, position: "above_market", peerFigures: [], ...over,
});

describe("reports page view", () => {
  it("keeps only the sample's comparable lines the bank publishes, with their sources", () => {
    const sample = sampleExhibit(report([line("od", 35), line("nsf", null), line("atm", 3, false), line("wire", 25)]));
    expect(sample).toMatchObject({ name: "Capital City Bank", place: "Tallahassee, FL", market: "Tallahassee, FL area (2 counties)", competitorsWithData: 18 });
    expect(sample!.lines.map((l) => [l.key, l.own, l.position])).toEqual([
      ["od", 35, "above_market"],
      ["wire", 25, "in_market"],
    ]);
    expect(sample!.lines[0]).toMatchObject({ ownFeeName: "od fee", ownSourceUrl: "https://ccb.test/fees.pdf", ownReadOn: "2026-10-01", min: 10, max: 40 });
    expect(sample!.findings).toHaveLength(3);
    expect(sample!.readOn).toBeNull();
  });

  it("names each competitor figure from the market and drops one the market does not name", () => {
    const sample = sampleExhibit(report([line("od", 35)]))!;
    expect(sample.lines[0].peerFigures).toEqual([
      { name: "First Bank", amount: 20, sourceUrl: "https://bank1.test/fees.pdf", readOn: "2026-09-30" },
      { name: "Second CU", amount: 30, sourceUrl: "https://bank2.test/fees.pdf", readOn: "2026-09-30" },
    ]);
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

  it("opens on the outgoing international wire when the sample compares it, else the first line", () => {
    expect(defaultLine(sampleExhibit(report([line("od", 35), line("wire_intl_outgoing", 75)]))!).key).toBe("wire_intl_outgoing");
    expect(defaultLine(sampleExhibit(report([line("od", 35)]))!).key).toBe("od");
  });

  it("draws a round dollar axis from $0 that holds every figure", () => {
    expect(dollarAxis([75, 50, 50])).toEqual({ max: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(dollarAxis([3, 2.5])).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    const { max } = dollarAxis([35, 30]);
    expect(max).toBeGreaterThanOrEqual(35);
  });

  it("says where the fee sits from the chart's own figures, never that it should change", () => {
    const text = lineInsight("Capital City Bank", sampleLine({}));
    expect(text).toBe(
      "Capital City Bank's $75 outgoing international wire fee is $25 higher than the local median and sits above the middle half of published competitor prices. 15 of the 16 local competitors publishing this fee charge less.",
    );
    expect(lineInsight("Capital City Bank", sampleLine({ own: 50, position: "in_market", chargingLess: 2 }))).toMatch(/matches the local median and sits inside the middle half/);
    expect(lineInsight("Capital City Bank", sampleLine({ own: 0, position: "free" }))).toBe(
      "Capital City Bank charges nothing for outgoing international wire. The local median is $50, across 16 competitors.",
    );
    for (const position of ["above_market", "in_market", "below_market", "free"] as const) {
      const words = [lineInsight("X", sampleLine({ position })), ...nextSteps(sampleLine({ position }))].join(" ");
      expect(words).not.toMatch(/\b(should|lower it|raise it|cut)\b/i);
    }
  });

  it("gives at most three next steps, led by the fee's own kind", () => {
    expect(nextSteps(sampleLine({}))).toEqual([
      "Review wire volume and customer mix",
      "Check waivers and exceptions",
      "Weigh revenue before changing the price",
    ]);
    expect(nextSteps(sampleLine({ key: "stop_payment" }))[0]).toBe("Review how often it is charged");
  });
});
