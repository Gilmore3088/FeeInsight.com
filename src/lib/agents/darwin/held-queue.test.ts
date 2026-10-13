import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { labelFor, readHoldGroups, toHoldGroup, wayOutFor } from "./held-queue";

describe("Darwin held queue (#1115 step 1)", () => {
  it("names each reason and says plainly when it has no way out", () => {
    expect(labelFor("not_judged")).toBe("Not judged yet");
    expect(labelFor("outside_envelope")).toBe("Amount outside the category's plausible range");
    expect(wayOutFor("peer_outlier").hasExit).toBe(true);
    expect(wayOutFor("conditional_zero")).toMatchObject({ hasExit: false });
    expect(wayOutFor("something_new")).toMatchObject({ hasExit: false, text: "None recorded for this reason." });
  });

  it("turns a query row into a group with its example", () => {
    const group = toHoldGroup({
      cause: "outside_envelope",
      count: 3243,
      oldest: "2026-10-04T20:25:03Z",
      example_name: "Wire transfer",
      example_amount: "125.00",
      example_institution: "First Example Bank",
    });
    expect(group).toMatchObject({
      cause: "outside_envelope",
      count: 3243,
      oldest: "2026-10-04T20:25:03.000Z",
      example: { feeName: "Wire transfer", amount: 125, institution: "First Example Bank" },
      hasExit: true,
    });
  });

  it("reads one row per cause from the run ledger", async () => {
    const db = vi.fn(async () => [
      { cause: "peer_outlier", count: 2, oldest: null, example_name: null },
    ]) as never;
    const groups = await readHoldGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ cause: "peer_outlier", count: 2, example: null });
  });
});
