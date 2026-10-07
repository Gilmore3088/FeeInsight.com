import { describe, expect, it } from "vitest";
import { briefingQuarter, diffBriefings } from "./briefing-diff";
import type { Briefing, FeePositionRow, Observation } from "./types";

function row(feeCategory: string, current: number, median: number | null = 30): FeePositionRow {
  return {
    feeCategory,
    displayName: feeCategory === "overdraft" ? "Overdraft" : "NSF",
    current,
    band: median === null ? null : { p25: median - 5, median, p75: median + 5, n: 40 },
    peerLabel: "Texas banks",
  };
}

function observation(id: string, headline: string): Observation {
  return { id, kind: "market_position", feeCategory: null, headline, facts: [], actions: [], salience: 1 };
}

function briefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    institutionId: 1,
    institutionName: "Home Bank",
    observations: [],
    institutionFinancials: null,
    nationalIncome: null,
    nationalIncomeSeries: [],
    feesReviewed: 0,
    positions: [],
    peerLabel: "Texas banks",
    generatedAt: "2026-07-06T15:07:00Z",
    provenance: { engineVersion: "1.12.1", generatedAt: "2026-07-06T15:07:00Z", dataAsOf: {}, sources: [], assumptions: [], clientFacts: [] },
    ...overrides,
  };
}

describe("briefingQuarter", () => {
  it("names the calendar quarter in UTC", () => {
    expect(briefingQuarter(new Date("2026-10-07T00:00:00Z"))).toBe("2026-Q4");
    expect(briefingQuarter(new Date("2026-03-31T23:59:00Z"))).toBe("2026-Q1");
  });
});

describe("diffBriefings", () => {
  it("reports own price, peer median and band moves with higher and lower", () => {
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ positions: [row("overdraft", 30, 30), row("nsf", 25)] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 36, 29), row("nsf", 25)] }) },
    );
    expect(diff.changes.map((c) => c.text)).toEqual([
      "Overdraft: your published price moved from $30.00 to $36.00 ($6.00 higher).",
      "Overdraft: the peer median moved from $30.00 to $29.00 ($1.00 lower; 40 peers).",
      "Overdraft: your price is now above the middle half of peers; last quarter it was within the middle half of peers.",
    ]);
    expect(diff).toMatchObject({ fromQuarter: "2026-Q3", toQuarter: "2026-Q4" });
  });

  it("lists fees added and removed, and new and dropped observations", () => {
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ positions: [row("nsf", 25)], observations: [observation("a", "Old note")] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 30)], observations: [observation("b", "New note")] }) },
    );
    expect(diff.changes.map((c) => c.kind)).toEqual(["fee_added", "fee_removed", "observation_new", "observation_gone"]);
    expect(diff.changes.map((c) => c.text).join(" ")).not.toMatch(/cheapest|dearest|raise|recommend/i);
  });

  it("reports nothing when nothing moved", () => {
    const same = briefing({ positions: [row("overdraft", 30)], observations: [observation("a", "Note")] });
    expect(diffBriefings({ quarter: "2026-Q3", briefing: same }, { quarter: "2026-Q4", briefing: same }).changes).toEqual([]);
  });

  it("reports a new income filing", () => {
    const financials = (quarterEnd: string, amount: number, yoyPct: number | null) => ({
      source: "fdic" as const,
      label: "Service charges",
      quarters: [{ quarterEnd, amount }],
      latestTtm: null,
      priorTtm: null,
      yoyPct,
      quarterEnd,
      sourceRef: { label: "FDIC" },
      peerMedian: null,
    });
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ institutionFinancials: financials("2026-03-31", 100000, null) }) },
      { quarter: "2026-Q4", briefing: briefing({ institutionFinancials: financials("2026-06-30", 120000, -4.2) }) },
    );
    expect(diff.changes).toEqual([
      expect.objectContaining({ kind: "income", text: expect.stringContaining("4.2% lower") }),
    ]);
  });
});
