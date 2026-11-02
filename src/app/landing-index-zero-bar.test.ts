import { describe, expect, it } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import { histogram, institutionsFor } from "./(public)/fees/(index)/index-view";
import { buildIndexCard } from "./landing-index";
import { cellBars, hasMedian, US } from "./landing-index-view";

let nextId = 1;
function row(institution_id: number, amount: number): IndexRow {
  return { id: nextId++, institution_name: `Institution ${institution_id}`, institution_id, amount, charter_type: "bank", state_code: "FL" };
}

/** The homepage card's bars must have the same bounds and counts as the /fees histogram. */
function expectSameBars(rows: IndexRow[]) {
  const card = buildIndexCard(new Map([["monthly_maintenance", rows]]));
  const pick = card.cells.monthly_maintenance[US][0];
  expect(hasMedian(pick)).toBe(true);
  if (!hasMedian(pick)) return;
  const fees = histogram(institutionsFor(rows, "monthly_maintenance", null, "all"));
  const bars = cellBars(pick);
  expect(bars.map((b) => b.total)).toEqual(fees.map((b) => b.total));
  expect(bars.map((b) => [b.min, b.max])).toEqual(
    fees.map((b) => [b.min === null ? null : Math.round(b.min * 100) / 100, b.max === null ? null : Math.round(b.max * 100) / 100]),
  );
}

describe("homepage card bars (site check 2026-11-01)", () => {
  it("keeps dollar-wide bars when some institutions publish the fee free", () => {
    // Free accounts plus $3-$12 monthly fees: the median is several dollars, so no bar is a cent wide.
    const rows = [0, 0, 0, 3, 4, 5, 5, 6, 7, 7, 7, 8, 9, 10, 12].map((a, i) => row(i + 1, a));
    expectSameBars(rows);
    const pick = buildIndexCard(new Map([["monthly_maintenance", rows]])).cells.monthly_maintenance[US][0];
    if (!hasMedian(pick)) throw new Error("expected a median");
    const bars = cellBars(pick);
    expect(bars[0]).toMatchObject({ min: 0, max: 0, total: 3 });
    for (const bar of bars.slice(1)) {
      if (bar.min !== null && bar.max !== null) expect(bar.max - bar.min).toBeGreaterThan(0.5);
    }
  });

  it("matches /fees with no free institutions", () => {
    expectSameBars([3, 4, 5, 5, 6, 7, 7, 7, 8, 9, 10, 12].map((a, i) => row(i + 1, a)));
  });

  it("matches /fees with free institutions and an under bar", () => {
    expectSameBars([0, 0, 0.5, 20, 21, 22, 22, 23, 24, 24, 25, 25, 26, 27, 28, 30, 60].map((a, i) => row(i + 1, a)));
  });
});
