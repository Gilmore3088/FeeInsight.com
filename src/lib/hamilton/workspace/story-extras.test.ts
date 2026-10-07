import { describe, expect, it } from "vitest";
import { buildAskResponse, parseAsk } from "./ask";
import { evaluateFourRoles } from "./four-roles";
import { scheduleOverview } from "./schedule";
import { incomeSplitData, withDepth } from "./story-extras";
import { overdraftResearch } from "./test-fixtures";
import { explainIncome, incomeSplit } from "./why";
import type { FeePositionRow } from "./types";

// Invented figures for tests only; no figure here is live data.
const rows: FeePositionRow[] = [
  { feeCategory: "overdraft", displayName: "Overdraft (OD)", current: 32, band: { p25: 25.75, median: 29.5, p75: 32, n: 16 }, peerLabel: "peers" },
  { feeCategory: "stop_payment", displayName: "Stop Payment", current: 15, band: { p25: 25, median: 30, p75: 32, n: 12 }, peerLabel: "peers" },
];
const split = incomeSplit({ quarterEnd: "2026-06-30", own: 1.9, peerMedian: 1.5, peers: 180, peersBelow: 140 }, rows, "credit unions with $300M to $1B in assets")!;
const why = { split, explained: explainIncome(split), top: scheduleOverview(rows).top };

function answer(question: string, withSchedule: boolean) {
  const intent = { ...parseAsk(question), feeCategory: "overdraft" };
  const built = buildAskResponse({ question, intent, research: overdraftResearch(), memory: [] });
  return withDepth(built, withSchedule ? scheduleOverview(rows) : null, why, "2026-09-30");
}

describe("withDepth", () => {
  it("leads the storyline with the income split, so the memo carries it", () => {
    const response = answer("Why is our fee income higher than peers?", false);
    const story = response.answer!.storyline!;
    expect(story.exhibits[0].id).toBe("income-split");
    expect(story.exhibits[0].actionTitle).toMatch(/\d/);
    expect(story.exhibits.map((e) => e.number)).toEqual(story.exhibits.map((_, i) => i + 1));
    expect(story.exhibits.length).toBeLessThanOrEqual(5);
    expect(response.shortAnswer).toMatch(/^Your deposit service charges came to \$1\.90 per \$1,000/);
    expect(evaluateFourRoles(response.answer!).roles.flatMap((r) => r.failures)).toEqual([]);
  });

  it("adds every compared fee as a table when the question covers the whole schedule", () => {
    const story = answer("Why is our fee income where it is, across every fee?", true).answer!.storyline!;
    const table = story.exhibits.find((e) => e.id === "schedule-overview");
    expect(table?.exhibit.kind).toBe("structure_matrix");
    expect(table?.actionTitle).toBe("Of your 2 compared fees, 1 sits higher than the peer median and 1 lower.");
  });
});

describe("incomeSplitData", () => {
  it("gives the page the split as numbers that add up to the gap", () => {
    const data = incomeSplitData(split);
    expect(data).toMatchObject({ unit: "per_1000_deposits", own: 1.9, peerMedian: 1.5, n: 180, priceIndex: 74, quarterEnd: "2026-06-30" });
    // Prices sit below the peer medians, so price pulls income down; everything else pulls it up.
    expect(data.priceExplained).toBeLessThan(0);
    expect(data.otherExplained).toBeGreaterThan(0);
    expect(data.priceExplained + data.otherExplained).toBeCloseTo(0.4, 2);
  });

  it("rides on the income-split exhibit, and every compared fee carries its peer band", () => {
    const story = answer("Why is our fee income higher than peers?", true).answer!.storyline!;
    const income = story.exhibits.find((e) => e.id === "income-split")!.exhibit;
    expect(income.kind === "structure_matrix" && income.incomeSplit?.priceIndex).toBe(74);
    expect(scheduleOverview(rows).positions.map((p) => p.band)).toEqual([{ p25: 25, p75: 32 }, { p25: 25.75, p75: 32 }]);
  });
});
