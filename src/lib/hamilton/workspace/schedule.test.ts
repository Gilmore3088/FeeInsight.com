import { describe, expect, it } from "vitest";
import { asksWholeSchedule, scheduleOverview } from "./schedule";
import type { FeePositionRow } from "./types";

// Invented rows for tests only; no figure here is live data.
const row = (feeCategory: string, displayName: string, current: number, median: number | null, n = 14): FeePositionRow => ({
  feeCategory,
  displayName,
  current,
  band: median === null ? null : { p25: median - 2, median, p75: median + 2, n },
  peerLabel: "FL credit union peers",
});

describe("whole-schedule questions", () => {
  it("recognises questions about every fee, and not single-fee ones", () => {
    expect(asksWholeSchedule("Where do we stand on every fee?")).toBe(true);
    expect(asksWholeSchedule("How do all of our fees compare?")).toBe(true);
    expect(asksWholeSchedule("Review our fee schedule")).toBe(true);
    expect(asksWholeSchedule("How does our overdraft fee compare?")).toBe(false);
  });

  it("orders fees by distance from the peer median and says higher or lower", () => {
    const overview = scheduleOverview([
      row("overdraft", "Overdraft", 30, 29),
      row("stop_payment", "Stop Payment", 15, 29.5),
      row("atm_non_network", "Non-Network ATM", 3.62, 2.25),
      row("dormant_account", "Dormant Account", 10, 10),
      row("wire_transfer", "Wire Transfer", 25, null),
    ]);
    expect(overview.top).toBe("atm_non_network");
    expect(overview.facts.map((f) => f.text.split(":")[0])).toEqual(["Non-Network ATM", "Stop Payment", "Overdraft", "Dormant Account"]);
    expect(overview.shortAnswer).toMatch(/^Of your 4 fees with a peer comparison, 2 sit higher than the peer median, 1 lower, 1 at it\./);
    expect(overview.shortAnswer).toContain("Furthest from its median is Non-Network ATM: your $3.62 is $1.37 higher than the median of 14 peers ($2.25).");
    expect(overview.shortAnswer).toMatch(/1 more fee has too few peers publishing to compare\.$/);
    expect(overview.facts[1].text).toBe("Stop Payment: your $15 is $14.50 lower than the median of 14 peers ($29.50).");
    expect(overview.shortAnswer).not.toMatch(/cheap|should|raise|cut/i);
    expect(overview.positions.map((p) => [p.feeCategory, p.direction])).toEqual([
      ["atm_non_network", "higher"],
      ["stop_payment", "lower"],
      ["overdraft", "higher"],
      ["dormant_account", "at"],
    ]);
    expect(overview.positions[0]).toMatchObject({ current: 3.62, peerMedian: 2.25, peerCount: 14 });
  });

  it("answers without a detail fee when nothing compares", () => {
    const overview = scheduleOverview([row("wire_transfer", "Wire Transfer", 25, null)]);
    expect(overview.top).toBeNull();
    expect(overview.facts).toEqual([]);
  });
});
