import { describe, expect, it, vi } from "vitest";
import type { CustomReportAnalysis, ReportLine } from "@/lib/custom-report/analysis";

vi.mock("@/lib/custom-report/sample-report", () => ({ loadSampleReport: vi.fn() }));

import { sampleExcerptLines } from "./report-offer";

function line(key: string, position: ReportLine["position"], comparable = true): ReportLine {
  return {
    key,
    label: key,
    own: { amount: 10, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key },
    peers: { n: 20, p25: 8, median: 10, p75: 12, min: 5, max: 15 },
    comparable,
    position,
    percentile: 50,
    chargingLess: 10,
    peerFigures: [],
  };
}

describe("sampleExcerptLines", () => {
  it("leads with lines outside the local range, then fills with lines inside it, three at most", () => {
    const analysis = {
      lines: [line("a", "in_market"), line("b", "above_market"), line("c", "in_market"), line("d", "below_market"), line("e", "in_market")],
    } as CustomReportAnalysis;
    expect(sampleExcerptLines(analysis).map((l) => l.key)).toEqual(["b", "d", "a"]);
  });

  it("skips lines without enough local data", () => {
    const analysis = { lines: [line("a", null, false), line("b", "in_market")] } as CustomReportAnalysis;
    expect(sampleExcerptLines(analysis).map((l) => l.key)).toEqual(["b"]);
  });
});
