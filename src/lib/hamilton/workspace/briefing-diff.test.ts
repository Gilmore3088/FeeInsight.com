import { describe, expect, it } from "vitest";
import { briefingQuarter, diffBriefings, nextQuarter, quarterLabel, withConfirmedPriceChanges } from "./briefing-diff";
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
  it("reports an own figure, peer median and band moves with higher and lower", () => {
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ positions: [row("overdraft", 30, 30), row("nsf", 25)] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 36, 29), row("nsf", 25)] }) },
    );
    expect(diff.changes.map((c) => c.text)).toEqual([
      "Overdraft: the figure on file moved from $30.00 to $36.00. No price change is confirmed on its schedules, so this is shown as an update to our data, not as a price change.",
      "Overdraft: the peer median moved from $30.00 to $29.00 ($1.00 lower; 40 peers).",
      "Overdraft: its price is now above the middle half of peers; last quarter it was within the middle half of peers.",
    ]);
    expect(diff).toMatchObject({ fromQuarter: "2026-Q3", toQuarter: "2026-Q4" });
  });

  it("compares no peer figures across a changed peer group, and says the group changed", () => {
    const widened = { ...row("overdraft", 30, 25), peerLabel: "US banks" };
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ peerLabel: "US banks", positions: [widened] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 36, 40)] }) },
    );
    expect(diff.changes.map((c) => c.text)).toEqual([
      "Overdraft: the figure on file moved from $30.00 to $36.00. No price change is confirmed on its schedules, so this is shown as an update to our data, not as a price change.",
      "Overdraft: now compared with Texas banks (last quarter US banks), so its peer figures are not compared.",
    ]);
    expect(diff).toMatchObject({ fromPeerLabel: "US banks", toPeerLabel: "Texas banks" });
  });

  it("lists fees added and removed, and new and dropped observations", () => {
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ positions: [row("nsf", 25)], observations: [observation("a", "Old note")] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 30)], observations: [observation("b", "New note")] }) },
    );
    expect(diff.changes.map((c) => c.kind)).toEqual(["fee_added", "fee_removed", "observation_new", "observation_gone"]);
    expect(diff.changes.map((c) => c.text).join(" ")).not.toMatch(/cheapest|dearest|raise|recommend/i);
  });

  it("never shows a held study from a snapshot stored before #1255 (#1256)", () => {
    const study = (key: string, headline: string): Observation => ({ ...observation(`study:${key}`, headline), kind: "study" });
    const diff = diffBriefings(
      {
        quarter: "2026-Q4",
        briefing: briefing({
          observations: [
            study("local_income", "Held local income study"),
            study("market_concentration", "Held concentration study"),
            study("fee_income_share", "Held fee income study"),
            study("fee_dependence", "Fee dependence before"),
          ],
        }),
      },
      { quarter: "2027-Q1", briefing: briefing({ observations: [study("inferred_items_paid", "Inferred items paid")] }) },
    );
    expect(diff.changes.map((c) => c.text)).toEqual([
      "New this quarter: Inferred items paid",
      "No longer flagged: Fee dependence before",
    ]);
    expect(diff.changes.map((c) => c.text).join(" ")).not.toMatch(/Held/);
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

describe("filed income meaning", () => {
  it.each([["ncua", "broad credit-union fee income"], ["fdic", "deposit service charge income"]] as const)("preserves %s meaning in briefing change text", (source, label) => {
    const financials = (quarterEnd: string) => ({ source, label, quarters: [{ quarterEnd, amount: 120000 }], latestTtm: null, priorTtm: null, yoyPct: null, quarterEnd, sourceRef: { label: source }, peerMedian: null });
    const diff = diffBriefings(
      { quarter: "2026-Q1", briefing: briefing({ institutionFinancials: financials("2026-03-31") }) },
      { quarter: "2026-Q2", briefing: briefing({ institutionFinancials: financials("2026-06-30") }) },
    );
    expect(diff.changes[0].text).toContain(`New filing: ${label}`);
  });
});

describe("quarter labels (#1083)", () => {
  it("writes a stored quarter as a reader does and finds the next one", () => {
    expect(quarterLabel("2026-Q4")).toBe("Q4 2026");
    expect(nextQuarter("2026-Q4")).toBe("2027-Q1");
    expect(nextQuarter("2027-Q2")).toBe("2027-Q3");
  });
});

describe("own fee changes are data updates unless confirmed (#1891, V5 P5)", () => {
  const moved = () =>
    diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ generatedAt: "2026-07-06T15:07:00Z", positions: [row("overdraft", 30), row("nsf", 25)] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 36), row("nsf", 20)] }) },
    );

  it("never words a moved, added or dropped own figure as a price change by default", () => {
    const diff = diffBriefings(
      { quarter: "2026-Q3", briefing: briefing({ positions: [row("overdraft", 30), row("nsf", 25)] }) },
      { quarter: "2026-Q4", briefing: briefing({ positions: [row("overdraft", 36)] }) },
    );
    expect(diff.changes.map((c) => c.kind)).toEqual(["own_record", "band_side", "fee_removed"]);
    const text = diff.changes.map((c) => c.text).join(" ");
    expect(text).not.toMatch(/published price moved|price changed|raised|lowered/);
    expect(text).toContain("update to our data");
  });

  it("makes a change a price change only when a confirmed change goes from the old figure to the new one", () => {
    const diff = withConfirmedPriceChanges(moved(), [
      { feeCategory: "overdraft", oldAmount: 30, newAmount: 36, changedAt: "2026-09-02" },
      // A confirmed NSF change between other figures does not confirm this move.
      { feeCategory: "nsf", oldAmount: 30, newAmount: 20, changedAt: "2026-09-02" },
    ]);
    expect(diff.changes.filter((c) => c.kind.startsWith("own_")).map((c) => [c.feeCategory, c.kind])).toEqual([
      ["overdraft", "own_price"],
      ["nsf", "own_record"],
    ]);
    expect(diff.changes[0].text).toBe(
      "Overdraft: its price changed from $30.00 to $36.00 ($6.00 higher), confirmed against its published schedules and recorded Sep 2, 2026.",
    );
  });

  it("accepts a chain of confirmed changes, in order, and refuses one out of order", () => {
    const chain = withConfirmedPriceChanges(moved(), [
      { feeCategory: "overdraft", oldAmount: 30, newAmount: 33, changedAt: "2026-08-01" },
      { feeCategory: "overdraft", oldAmount: 33, newAmount: 36, changedAt: "2026-09-01" },
    ]);
    expect(chain.changes[0].kind).toBe("own_price");
    const backwards = withConfirmedPriceChanges(moved(), [
      { feeCategory: "overdraft", oldAmount: 33, newAmount: 36, changedAt: "2026-08-01" },
      { feeCategory: "overdraft", oldAmount: 30, newAmount: 33, changedAt: "2026-09-01" },
    ]);
    expect(backwards.changes[0].kind).toBe("own_record");
    // Two confirmed steps that do not meet ($30 to $33, then $34 to $36) are no chain.
    const gap = withConfirmedPriceChanges(moved(), [
      { feeCategory: "overdraft", oldAmount: 30, newAmount: 33, changedAt: "2026-08-01" },
      { feeCategory: "overdraft", oldAmount: 34, newAmount: 36, changedAt: "2026-09-01" },
    ]);
    expect(gap.changes[0].kind).toBe("own_record");
    // A chain through the new figure and back again is read to its newest step.
    const through = withConfirmedPriceChanges(moved(), [
      { feeCategory: "overdraft", oldAmount: 30, newAmount: 36, changedAt: "2026-08-01" },
      { feeCategory: "overdraft", oldAmount: 36, newAmount: 40, changedAt: "2026-08-15" },
      { feeCategory: "overdraft", oldAmount: 40, newAmount: 36, changedAt: "2026-09-01" },
    ]);
    expect(through.changes[0].kind).toBe("own_price");
  });

  it("confirms nothing with no confirmed changes", () => {
    expect(withConfirmedPriceChanges(moved(), []).changes.filter((c) => c.kind.startsWith("own_")).map((c) => c.kind)).toEqual(["own_record", "own_record"]);
  });
});
