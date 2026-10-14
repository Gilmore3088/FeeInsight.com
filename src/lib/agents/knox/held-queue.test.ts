import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { readKnoxHoldGroups, shapeInfo, toKnoxHoldGroup } from "./held-queue";

describe("Knox held lines (#1102)", () => {
  it("gives each shape its way out, and says when there is none", () => {
    expect(shapeInfo("unclassified").hasExit).toBe(true);
    expect(shapeInfo("percentage").wayOut).toContain("rate fee");
    expect(shapeInfo("range")).toMatchObject({ hasExit: false });
    expect(shapeInfo("zero")).toMatchObject({ hasExit: false, wayOut: "None yet: nothing re-reads it." });
    expect(shapeInfo("new_shape")).toMatchObject({ hasExit: false, label: "new_shape" });
  });

  it("maps a row with its set-aside and weekly counts", () => {
    expect(toKnoxHoldGroup({ shape: "unclassified", count: 26720, set_aside: 16673, new_7d: 18895, oldest: "2026-10-04T20:00:49Z", example_name: "Coin counting", example_amount: "5.00" }))
      .toMatchObject({ count: 26720, setAside: 16673, newThisWeek: 18895, oldest: "2026-10-04T20:00:49.000Z", example: { feeName: "Coin counting", amount: 5 } });
  });

  it("reads one row per shape", async () => {
    const db = vi.fn(async () => [{ shape: "zero", count: 720, set_aside: 0, new_7d: 190, oldest: null, example_name: null }]) as never;
    expect(await readKnoxHoldGroups(db)).toEqual([expect.objectContaining({ shape: "zero", count: 720, example: null, hasExit: false })]);
  });
});
