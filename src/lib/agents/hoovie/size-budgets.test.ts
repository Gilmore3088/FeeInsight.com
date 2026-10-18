import { describe, expect, it } from "vitest";

import { HOOVIE_SOURCES } from "./sources";
import {
  DEFAULT_TABLE_BUDGET_MB,
  TABLE_BUDGET_MB,
  hoovieTableBudgets,
  overBudgetTables,
  sourcesHeldForSize,
} from "./size-budgets";

describe("Hoovie table size budgets", () => {
  it("gives every table a source writes a budget", () => {
    const budgets = hoovieTableBudgets();
    for (const contract of HOOVIE_SOURCES) {
      for (const table of contract.tables) expect(budgets[table], `${contract.source}: ${table}`).toBeGreaterThan(0);
    }
  });

  it("sets about double the Oct 17 size for the two tables the back-fill grew", () => {
    const budgets = hoovieTableBudgets();
    expect(budgets.institution_call_report_items).toBe(7_000);
    expect(budgets.area_statistics).toBe(2_000);
    expect(budgets.irs_zip_income).toBe(DEFAULT_TABLE_BUDGET_MB);
  });

  it("budgets only tables some source writes", () => {
    const written = new Set(HOOVIE_SOURCES.flatMap((contract) => contract.tables));
    expect(Object.keys(TABLE_BUDGET_MB).filter((table) => !written.has(table))).toEqual([]);
  });

  it("finds a measured table above its budget, and never one at or under it", () => {
    const budgets = { area_statistics: 2_000, demographics: 1_000 };
    expect(overBudgetTables({ area_statistics: 2_000.1, demographics: 1_000 }, budgets)).toEqual([
      { table: "area_statistics", totalMb: 2_000.1, budgetMb: 2_000 },
    ]);
    expect(overBudgetTables({ area_statistics: 1_999 }, budgets)).toEqual([]);
    // A table with no budget is not a Hoovie table and is never over.
    expect(overBudgetTables({ pipeline_attempts: 99_999 }, budgets)).toEqual([]);
  });

  it("holds every source that writes an over-budget table, and nothing without a measurement", () => {
    const held = sourcesHeldForSize({ institution_call_report_items: 7_500, area_statistics: 900 });
    expect([...held.keys()].sort()).toEqual(["ffiec-call-detail", "ncua-extras"]);
    expect(held.get("ncua-extras")).toEqual(["institution_call_report_items"]);
    expect(sourcesHeldForSize(null).size).toBe(0);
    expect(sourcesHeldForSize({}).size).toBe(0);
  });

  it("holds every writer of a shared table", () => {
    const writers = HOOVIE_SOURCES.filter((contract) => contract.tables.includes("area_statistics")).map((c) => c.source);
    const held = sourcesHeldForSize({ area_statistics: 2_500 });
    expect([...held.keys()].sort()).toEqual([...writers].sort());
  });
});
