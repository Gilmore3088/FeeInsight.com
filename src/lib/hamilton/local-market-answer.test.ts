import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { citiesOf, rankCompetitors, isLocalMarketQuestion } from "./local-market-answer";

// Test figures only.
const c = (id: number, name: string, branches: number | null, deposits: number | null, fees: Record<string, number> = {}) => ({
  institutionId: id,
  name,
  charterType: deposits == null ? "credit_union" : "bank",
  branches,
  deposits,
  fees,
});

describe("local market answer", () => {
  it("routes competitor and location questions, not fee questions", () => {
    expect(isLocalMarketQuestion("who are my local competitors and locations")).toBe(true);
    expect(isLocalMarketQuestion("Where are our branches?")).toBe(true);
    expect(isLocalMarketQuestion("Who's near us?")).toBe(true);
    expect(isLocalMarketQuestion("Where do we stand on every fee?")).toBe(false);
    expect(isLocalMarketQuestion("Why is our fee income lower than peers?")).toBe(false);
  });

  it("ranks by branches so credit unions sit beside banks, and drops rows with nothing to show", () => {
    const ranked = rankCompetitors([
      c(1, "Test Bank A", 9, 2_000_000_000),
      c(2, "Test Credit Union B", 11, null),
      c(3, "Test Bank C", 9, 3_000_000_000),
      c(4, "Test Bank D", null, null),
      c(5, "Test Bank E", null, null, { overdraft: 30 }),
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["Test Credit Union B", "Test Bank C", "Test Bank A", "Test Bank E"]);
  });

  it("groups branches by city, most first, with tidy names", () => {
    expect(
      citiesOf([
        { city: "MELBOURNE", state: "FL" },
        { city: "Palm Bay", state: "FL" },
        { city: "melbourne", state: "FL" },
        { city: null, state: "FL" },
      ]),
    ).toEqual([
      { city: "Melbourne", state: "FL", branches: 2 },
      { city: "Palm Bay", state: "FL", branches: 1 },
    ]);
  });
});
