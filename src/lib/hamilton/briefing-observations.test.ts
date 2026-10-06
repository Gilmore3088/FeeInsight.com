import { describe, expect, it } from "vitest";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { buildAttentionItems, proseFeeName } from "./briefing-observations";
import type { Briefing, FeeResearch, Observation } from "./workspace/types";

const provenance = { engineVersion: "1.0.0", generatedAt: "2026-10-06T00:00:00Z", dataAsOf: {}, sources: [], assumptions: [], clientFacts: [] };
const obs = (id: string, feeCategory: string | null, kind: Observation["kind"], headline: string): Observation => ({
  id,
  kind,
  feeCategory,
  headline,
  facts: [{ text: `${headline} fact (OD).`, source: { label: "x" } }],
  actions: [],
  salience: 0.5,
});
const briefing = (observations: Observation[]): Briefing => ({
  institutionId: 1,
  institutionName: "First Bank",
  observations,
  institutionFinancials: null,
  nationalIncome: null,
  nationalIncomeSeries: [],
  feesReviewed: 12,
  peerLabel: "Texas community banks",
  generatedAt: "2026-10-06T00:00:00Z",
  provenance,
});
const research = (current: number | null, amounts: number[]): FeeResearch => ({
  institutionId: 1,
  institutionName: "First Bank",
  feeCategory: "overdraft",
  displayName: "Overdraft (OD)",
  layers: [],
  institutionFinancials: null,
  regulation: [],
  localMarket: null,
  current,
  peerLabel: "Texas community banks",
  peers: amounts.map((amount, i) => ({ institutionId: i + 2, institutionName: `P${i}`, amount, stateCode: "TX", sourceDocumentIds: [], documentUrls: [], publishedAt: null })),
  band: amounts.length ? { p25: 25, median: 30, p75: 35, n: amounts.length } : null,
  bands: [],
  localCompetitors: null,
  recentChanges: [],
  revenueLine: null,
  provenance,
});

describe("proseFeeName", () => {
  it("lowercases words but keeps acronyms", () => {
    expect(proseFeeName("Non-Network ATM")).toBe("non-network ATM");
    expect(proseFeeName("Stop Payment")).toBe("stop payment");
    expect(proseFeeName("Overdraft (OD)")).toBe("overdraft");
  });
});

describe("buildAttentionItems", () => {
  it("leads with overdraft even when the engine didn't flag it, and flags a small group", () => {
    const items = buildAttentionItems(
      briefing([obs("market_position:nsf", "nsf", "market_position", `Your ${getDisplayName("nsf")} is above 18 of 20 peers.`)]),
      research(30, [25, 30, 35, 40, 20]),
    );
    expect(items.map((i) => i.feeCategory)).toEqual(["overdraft", "nsf"]);
    expect(items[0].headline).toBe("Your overdraft fee is $30; the median of 5 peers is $30.");
    expect(items[0].facts[1]).toBe("2 charge more, 1 the same and 2 less.");
    expect(items[0].note).toMatch(/small peer group/);
    expect(items[1].headline).toBe("Your NSF / returned item fee is above 18 of 20 peers.");
    const text = items.flatMap((i) => [i.headline, ...i.facts]).join(" ");
    expect(text).not.toMatch(/raise|lower|should|recommend/i);
  });

  it("moves the engine's own overdraft observation to the front", () => {
    const items = buildAttentionItems(
      briefing([
        obs("competitor_move:nsf", "nsf", "competitor_move", "3 institutions in TX changed their NSF."),
        obs("market_position:overdraft", "overdraft", "market_position", "Your overdraft is above 30 of 31 peers."),
      ]),
      research(36, [30]),
    );
    expect(items.map((i) => i.id)).toEqual(["market_position:overdraft", "competitor_move:nsf"]);
  });

  it("has no overdraft lead when the bank doesn't publish one", () => {
    expect(buildAttentionItems(briefing([]), research(null, [30]))).toEqual([]);
    expect(buildAttentionItems(null, null)).toEqual([]);
  });
});
