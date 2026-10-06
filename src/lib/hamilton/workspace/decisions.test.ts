import { describe, expect, it } from "vitest";
import { buildLedger, defaultWatches, evaluateWatches, parseWatches } from "./decisions";
import { overdraftResearch } from "./test-fixtures";
import type { DecisionEvent, DecisionRecord } from "./types";

const decision = (id: string, status: DecisionRecord["status"], chosenAmount: number | null = null): DecisionRecord => ({
  id,
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status,
  chosenAmount,
  chosenBy: null,
  watchConditions: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

const chosen = (decisionId: string, evidenceLevel: string, revenueEffect: { low: number; high: number } | null): DecisionEvent => ({
  id: `c-${decisionId}`,
  decisionId,
  kind: "option_chosen",
  detail: { evidenceLevel, revenueEffect },
  actor: "user:7",
  at: "2026-10-02T00:00:00Z",
});

describe("watch conditions", () => {
  const research = overdraftResearch();

  it("sets a competitor, peer-median and regulator watch when an option is chosen", () => {
    expect(defaultWatches(research).map((w) => w.kind)).toEqual(["competitor_change", "peer_median_change", "rule_release"]);
    expect(parseWatches(defaultWatches(research))).toHaveLength(3);
    expect(parseWatches([{ kind: "nonsense" }, "x", null])).toEqual([]);
  });

  it("trips on a competitor change seen after the decision, with the fact that tripped it", () => {
    const withChange = overdraftResearch({
      recentChanges: [{ text: "Peer 3: $30 to $35, seen 2026-10-04.", source: { label: "Fee change records", asOf: "2026-10-04" } }],
    });
    const [competitor] = evaluateWatches(defaultWatches(withChange), withChange, "2026-10-02T00:00:00Z");
    expect(competitor).toMatchObject({ tripped: true, evidence: { text: "Peer 3: $30 to $35, seen 2026-10-04." } });
    expect(evaluateWatches(defaultWatches(withChange), withChange, "2026-10-05T00:00:00Z")[0].tripped).toBe(false);
  });

  it("trips when the peer median moves past the threshold", () => {
    const watches = defaultWatches(research);
    const moved = overdraftResearch({ band: { p25: 27, median: 31.5, p75: 34, n: 16 } });
    const state = evaluateWatches(watches, moved, "2026-10-02T00:00:00Z").find((w) => w.condition.kind === "peer_median_change");
    expect(state?.tripped).toBe(true);
    expect(state?.evidence?.text).toBe("The peer median is $31.50 across 16 peers, up 6.8% from $29.50.");
    expect(evaluateWatches(watches, research, "2026-10-02T00:00:00Z").some((w) => w.tripped)).toBe(false);
  });
});

describe("the ledger", () => {
  it("sums over decisions, counting dollars only from options chosen on the bank's own figures", () => {
    const decisions = [decision("a", "decided", 25), decision("b", "monitoring", 30), decision("c", "modeling")];
    const events = new Map([
      ["a", [chosen("a", "institution", { low: -75_600, high: -60_000 })]],
      ["b", [chosen("b", "working_estimate", { low: -10_000, high: -10_000 })]],
    ]);
    const ledger = buildLedger(decisions, events);
    expect(ledger).toMatchObject({ decisions: 3, chosen: 2, dollars: { low: -75_600, high: -60_000, decisions: 1 } });
    expect(ledger.byStatus).toMatchObject({ decided: 1, monitoring: 1, modeling: 1, closed: 0 });
    expect(ledger.lines.find((l) => l.decisionId === "b")?.annualEffect).toBeNull();
  });
});
