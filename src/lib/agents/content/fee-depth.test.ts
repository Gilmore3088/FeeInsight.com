import { describe, expect, it } from "vitest";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import type { MarketRow } from "./market-spread";
import {
  GRID_ROWS,
  USE_CASES,
  allowedDepthNumbers,
  draftDepthCaption,
  nextUseCase,
  pickDepthMetro,
  summarizeDepth,
  type MetroDepth,
} from "./fee-depth";

const CATEGORIES = Array.from({ length: 16 }, (_, i) => `fee_${String(i).padStart(2, "0")}`);

function schedule(metro: string, id: number, types: number): MarketRow[] {
  return CATEGORIES.slice(0, types).map((fee_category, i) => ({ institution_id: id, cbsa_name: metro, fee_category, amount: 5 + i }));
}

function metro(over: Partial<MetroDepth>): MetroDepth {
  return { metro: "Boston-Cambridge-Newton, MA-NH", institutions: 40, fullSchedules: 20, medianTypes: 14, maxTypes: 21, grid: new Array(GRID_ROWS).fill(null), ...over } as MetroDepth;
}

describe("summarizeDepth", () => {
  it("counts full schedules and builds a grid of the most-published fees", () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => schedule("Tulsa, OK", i + 1, 16)).flat(), ...schedule("Tulsa, OK", 99, 3)];
    const [tulsa] = summarizeDepth(rows);
    expect(tulsa.institutions).toBe(11);
    expect(tulsa.fullSchedules).toBe(10);
    expect(tulsa.medianTypes).toBe(16);
    expect(tulsa.grid).toHaveLength(GRID_ROWS);
    expect(tulsa.grid[0].institutions).toBe(11);
  });
});

describe("pickDepthMetro", () => {
  it("needs ten full schedules and skips recent metros", () => {
    const boston = metro({});
    const thin = metro({ metro: "Tulsa, OK", fullSchedules: 4 });
    const chicago = metro({ metro: "Chicago-Naperville-Elgin, IL-IN-WI", fullSchedules: 15 });
    expect(pickDepthMetro([thin, chicago, boston], new Set())?.metro).toBe(boston.metro);
    expect(pickDepthMetro([thin, chicago, boston], new Set([boston.metro]))?.metro).toBe(chicago.metro);
    expect(pickDepthMetro([thin], new Set())).toBeNull();
  });
});

describe("draftDepthCaption", () => {
  const asOf = new Date("2026-11-06T13:37:00Z");

  it("rotates use cases", () => {
    expect(nextUseCase(0).key).toBe(USE_CASES[0].key);
    expect(nextUseCase(USE_CASES.length).key).toBe(USE_CASES[0].key);
  });

  it("every use case passes the number guard and stays neutral", () => {
    const m = metro({});
    for (const useCase of USE_CASES) {
      const draft = draftDepthCaption(m, useCase, asOf);
      expect(unbackedNumbers(draft.body, allowedDepthNumbers(m, asOf))).toEqual([]);
      expect(draft.body).toContain("Boston, MA");
      expect(draft.body).not.toMatch(/can't|cannot|raise|cheap|should/i);
    }
  });
});
