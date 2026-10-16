import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { readKnoxHoldGroups, shapeInfo, toKnoxHoldGroup } from "./held-queue";

describe("Knox held lines (#1102)", () => {
  it("gives each shape its way out, and says when there is none", () => {
    expect(shapeInfo("unclassified").hasExit).toBe(true);
    expect(shapeInfo("percentage").wayOut).toContain("rate fee");
    expect(shapeInfo("range")).toMatchObject({ hasExit: false });
    expect(shapeInfo("range").owner).toContain("#1060");
    expect(shapeInfo("zero")).toMatchObject({ hasExit: false });
    expect(shapeInfo("new_shape")).toMatchObject({ hasExit: false, label: "new_shape", owner: "Nobody recorded" });
  });

  it("names an owner for every group Knox holds (#1102: who's reviewing it?)", () => {
    for (const shape of ["unclassified", "range", "range_no_category", "range_band", "percentage", "untraced", "zero", "superseded", "taken_down"]) {
      expect(shapeInfo(shape).owner, shape).not.toBe("Nobody recorded");
    }
    // The range-band pass is switched off: its way out waits on James.
    expect(shapeInfo("range_no_category")).toMatchObject({ hasExit: false });
    expect(shapeInfo("range_no_category").owner).toContain("switched off");
    expect(shapeInfo("superseded")).toMatchObject({ hasExit: true });
    expect(shapeInfo("untraced").owner).toContain("Rosetta");
  });

  it("maps a row with its set-aside and weekly counts", () => {
    expect(toKnoxHoldGroup({ shape: "unclassified", count: 26720, set_aside: 16673, new_7d: 18895, oldest: "2026-10-04T20:00:49Z", example_name: "Coin counting", example_amount: "5.00" }))
      .toMatchObject({ count: 26720, setAside: 16673, rereadThrice: 0, newThisWeek: 18895, oldest: "2026-10-04T20:00:49.000Z", example: { feeName: "Coin counting", amount: 5 } });
  });

  it("splits retired lines, and ranges with and without a category, into their own groups", async () => {
    const db = vi.fn(async () => [{ shape: "untraced", count: 2852, set_aside: 0, reread_thrice: 2409, new_7d: 1626, oldest: null, example_name: null }]);
    const groups = await readKnoxHoldGroups(db as never);
    expect(groups[0]).toMatchObject({ shape: "untraced", rereadThrice: 2409 });
    const calls = db.mock.calls as unknown as Array<[TemplateStringsArray]>;
    const query = calls[0][0].join(" ");
    expect(query).toContain("'superseded'");
    expect(query).toContain("'range_no_category'");
    expect(query).toContain("reread_thrice");
  });

  it("reads one row per shape", async () => {
    const db = vi.fn(async () => [{ shape: "zero", count: 720, set_aside: 0, new_7d: 190, oldest: null, example_name: null }]) as never;
    expect(await readKnoxHoldGroups(db)).toEqual([expect.objectContaining({ shape: "zero", count: 720, example: null, hasExit: false })]);
  });
});
