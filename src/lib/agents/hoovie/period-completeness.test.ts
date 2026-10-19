import { describe, expect, it } from "vitest";
import type { RegistryPeriodPartition } from "@/lib/data-store/feed-freshness";
import { MISSING_PARTITIONS_LISTED, periodCompleteness, periodOfPartition } from "./period-completeness";

const NOW = new Date("2026-10-19T12:00:00Z");

function part(partitionKey: string, status: string, extra: Partial<RegistryPeriodPartition> = {}): RegistryPeriodPartition {
  return { source: "s", partitionKey, status, partial: false, rowCount: status === "succeeded" ? 10 : 0, blocked: false, fetchedAt: "2026-10-18T00:00:00.000Z", ...extra };
}

describe("periodOfPartition", () => {
  it("reads years, quarters, months and a period's sub-partitions, and nothing else", () => {
    expect(periodOfPartition("2025")?.key).toBe("2025");
    expect(periodOfPartition("2026Q2")).toEqual({ key: "2026Q2", end: new Date("2026-06-30T00:00:00Z") });
    expect(periodOfPartition("2026-08")).toEqual({ key: "2026-08", end: new Date("2026-08-31T00:00:00Z") });
    expect(periodOfPartition("202608")?.key).toBe("2026-08");
    expect(periodOfPartition("2025-OH")?.key).toBe("2025");
    expect(periodOfPartition("ncua-mergers")).toBeNull();
    expect(periodOfPartition("card-2026Q2")).toBeNull();
    expect(periodOfPartition("current")).toBeNull();
  });
});

describe("periodCompleteness (#2228)", () => {
  const quarters = ["2026Q2", "2026Q1", "2025Q4"];

  it("is complete only when the newest expected period loaded in full", () => {
    const c = periodCompleteness(quarters, quarters.map((q) => part(q, "succeeded")), NOW);
    expect(c).toMatchObject({ state: "complete", expectedPeriod: "2026Q2", completedPeriod: "2026Q2", periodsBehind: 0, coverage: { loaded: 3, planned: 3 }, missingCount: 0 });
    expect(c.completedPeriodAgeDays).toBe(111);
  });

  it("does not let a backfill success certify the newest period", () => {
    // The newest successful fetch was an old quarter; the newest expected quarter never loaded.
    const c = periodCompleteness(quarters, [part("2025Q4", "succeeded", { fetchedAt: "2026-10-19T00:00:00.000Z" }), part("2026Q1", "succeeded")], NOW);
    expect(c).toMatchObject({ state: "unchecked", expectedPeriod: "2026Q2", completedPeriod: "2026Q1", periodsBehind: 1, missingPartitions: ["2026Q2"] });
  });

  it("is awaiting release, not missing, when the publisher has nothing yet for the newest period (no release yet)", () => {
    const c = periodCompleteness(quarters, [part("2026Q2", "empty"), part("2026Q1", "succeeded"), part("2025Q4", "succeeded")], NOW);
    expect(c).toMatchObject({ state: "awaiting_release", completedPeriod: "2026Q1", awaitingPartitions: 1, missingCount: 0 });
    expect(c.reason).toBe("no release yet for 2026Q2; newest complete 2026Q1");
  });

  it("is late when the newest period and the one before it are both unloaded (late release)", () => {
    const c = periodCompleteness(quarters, [part("2026Q2", "empty"), part("2026Q1", "empty"), part("2025Q4", "succeeded")], NOW);
    expect(c).toMatchObject({ state: "late", completedPeriod: "2025Q4", periodsBehind: 2 });
    expect(c.reason).toContain("2 periods behind");
  });

  it("is awaiting release, not late, for a publisher that skips months (Beige Book in early July)", () => {
    // Eight books a year: June 2026 and February 2026 had none and stay empty for good.
    const months = ["202607", "202606", "202605", "202604", "202603", "202602", "202601"];
    const rows = [part("202607", "empty"), part("202606", "empty"), part("202605", "succeeded"), part("202604", "succeeded"), part("202603", "succeeded"), part("202602", "empty"), part("202601", "succeeded")];
    const c = periodCompleteness(months, rows, new Date("2026-07-03T12:00:00Z"));
    expect(c).toMatchObject({ state: "awaiting_release", completedPeriod: "2026-05" });
  });

  it("is still late for a skipping publisher when the last non-empty period before the newest failed", () => {
    const months = ["202607", "202606", "202605", "202604", "202603"];
    const rows = [part("202607", "empty"), part("202606", "empty"), part("202605", "failed"), part("202604", "succeeded"), part("202603", "empty")];
    const c = periodCompleteness(months, rows, new Date("2026-07-03T12:00:00Z"));
    expect(c.state).toBe("late");
    expect(c.reason).toContain("2026-05 not loaded in full");
  });

  it("is partial when only some of the newest period's partitions loaded (partial coverage)", () => {
    const planned = ["2025-OH", "2025-TX", "2025-CA", "2024-OH", "2024-TX", "2024-CA"];
    const rows = [part("2025-OH", "succeeded"), part("2025-TX", "succeeded", { partial: true }), ...["2024-OH", "2024-TX", "2024-CA"].map((k) => part(k, "succeeded"))];
    const c = periodCompleteness(planned, rows, NOW);
    expect(c).toMatchObject({ state: "partial", expectedPeriod: "2025", completedPeriod: "2024", coverage: { loaded: 4, planned: 6 }, missingPartitions: ["2025-TX", "2025-CA"] });
    expect(c.reason).toBe("2025 partly loaded: 1 of 3 partitions in full, 1 partial; newest complete 2024");
  });

  it("treats an allowed-empty check and a zero-row success as nothing loaded, and a failure or refusal as missing", () => {
    expect(periodCompleteness(["2026"], [part("2026", "succeeded", { rowCount: 0 })], NOW).state).toBe("awaiting_release");
    expect(periodCompleteness(["2026", "2025"], [part("2026", "failed"), part("2025", "succeeded")], NOW)).toMatchObject({ state: "missing", missingPartitions: ["2026"] });
    expect(periodCompleteness(["2026"], [part("2026", "empty", { blocked: true })], NOW).state).toBe("missing");
  });

  it("says so explicitly when a source has no periods or plans nothing", () => {
    expect(periodCompleteness(["ncua-mergers", "fdic-failures"], [], NOW)).toMatchObject({ state: "not_periodic", expectedPeriod: null });
    expect(periodCompleteness([], [], NOW)).toMatchObject({ state: "not_planned", expectedPeriod: null });
  });

  it("lists at most a bounded number of missing partitions but counts them all", () => {
    const planned = Array.from({ length: 20 }, (_, i) => String(2026 - i));
    const c = periodCompleteness(planned, [], NOW);
    expect(c.missingPartitions).toHaveLength(MISSING_PARTITIONS_LISTED);
    expect(c.missingCount).toBe(20);
    expect(c.missingPartitions[0]).toBe("2026");
  });
});
