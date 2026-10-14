import { describe, expect, it } from "vitest";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { buildAttentionItems, buildBriefingOverview, proseFeeName } from "./briefing-observations";
import type { Briefing, Observation } from "./workspace/types";

const provenance = { engineVersion: "1.0.0", generatedAt: "2026-10-06T00:00:00Z", peerGroup: { label: "Texas community banks", n: 14 }, dataAsOf: {}, sources: [], assumptions: [], clientFacts: [] };
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
  positions: [],
  feesReviewed: 12,
  peerLabel: "Texas community banks",
  generatedAt: "2026-10-06T00:00:00Z",
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
  it("leaves out an overdraft fee that is not unusual and keeps the engine's order", () => {
    const items = buildAttentionItems(
      briefing([obs("market_position:nsf", "nsf", "market_position", `Your ${getDisplayName("nsf")} is above 18 of 20 peers.`)]),
    );
    expect(items.map((i) => i.feeCategory)).toEqual(["nsf"]);
    expect(items[0].headline).toBe("Your NSF / returned item fee is above 18 of 20 peers.");
    const text = items.flatMap((i) => [i.headline, ...i.facts]).join(" ");
    expect(text).not.toMatch(/raise|lower|should|recommend/i);
  });

  it("moves the engine's own overdraft observation to the front", () => {
    const items = buildAttentionItems(
      briefing([
        obs("competitor_move:nsf", "nsf", "competitor_move", "3 institutions in TX changed their NSF."),
        obs("market_position:overdraft", "overdraft", "market_position", "Your overdraft is above 30 of 31 peers."),
      ]),
    );
    expect(items.map((i) => i.id)).toEqual(["market_position:overdraft", "competitor_move:nsf"]);
  });

  it("leaves out a fee whose peers charge it on mixed bases, and the items-paid study", () => {
    // Space Coast FCU, Oct 9: a $5 loan late fee against peers' mixed late charges.
    const items = buildAttentionItems(
      briefing([
        obs("market_position:late_payment", "late_payment", "market_position", "Your late payment is below 6 of 6 peers."),
        obs("market_position:minimum_balance", "minimum_balance", "market_position", "Your minimum balance is above 8 of 8 peers."),
        obs("study:inferred_items_paid", null, "study", "Your overdraft income implies about 648,800 overdraft items paid."),
      ]),
      { mixedBasis: new Set(["late_payment"]) },
    );
    expect(items.map((i) => i.id)).toEqual(["market_position:minimum_balance"]);
  });

  it("returns nothing without a briefing", () => {
    expect(buildAttentionItems(briefing([]))).toEqual([]);
    expect(buildAttentionItems(null)).toEqual([]);
  });

  it("keeps the last of three places for a study the cap would drop", () => {
    const list = [
      obs("a", "nsf", "market_position", "A"),
      obs("b", "wire_domestic_outgoing", "market_position", "B"),
      obs("c", "stop_payment", "market_position", "C"),
      obs("study:fee_dependence", null, "study", "Deposit service charges were 3.83% of your revenue in 2025."),
    ];
    const items = buildAttentionItems(briefing(list));
    expect(items.map((i) => i.id)).toEqual(["a", "b", "study:fee_dependence"]);
  });
});

describe("buildBriefingOverview", () => {
  it("counts fees above, inside and below their peers' middle half, fee changes nearby and income", () => {
    const row = (feeCategory: string, current: number, band: [number, number] | null) => ({
      feeCategory,
      displayName: feeCategory,
      current,
      band: band ? { p25: band[0], median: (band[0] + band[1]) / 2, p75: band[1], n: 10 } : null,
      peerLabel: "FL credit unions",
    });
    const b: Briefing = {
      ...briefing([obs("competitor_move:nsf", "nsf", "competitor_move", "2 institutions in FL changed their NSF.")]),
      positions: [
        row("stop_payment", 15, [26.63, 35]),
        row("overdraft", 30, [28.75, 31.25]),
        row("atm_non_network", 2.5, [1, 2]),
        row("account_verification", 20, null),
      ],
      institutionFinancials: {
        source: "ncua",
        label: "x",
        quarters: [],
        latestTtm: 35_872_000,
        priorTtm: 32_094_000,
        yoyPct: 11.8,
        quarterEnd: "2026-06-30",
        sourceRef: { label: "x" },
        peerMedian: null,
      },
    };
    expect(buildBriefingOverview(b, "FL")).toEqual({
      feesCompared: 3,
      higher: 1,
      inLine: 1,
      lower: 1,
      peerCount: 14,
      stateLabel: "FL",
      feesChangedNearby: 1,
      income: { latestTtm: 35_872_000, yoyPct: 11.8, quarterEnd: "2026-06-30", source: "ncua" },
    });
  });
});
