import { HOOVIE_SOURCES } from "./sources";

/**
 * A size budget for every table a public-data source writes, in MB (pg_total_relation_size, so
 * indexes and TOAST count). Why: on Oct 17, 2026 the public-data back-fill took the database from
 * about 6.3 GB to about 10 GB in a day and Supabase grew the disk from 12 GB to 18 GB.
 * `institution_call_report_items` reached about 3.6 GB (8.7 million rows: 7.2 million NCUA 5300
 * extras, 1.5 million FFIEC call detail) and `area_statistics` about 1 GB.
 *
 * Atlas's daily storage step (`atlas-storage-retention`) measures every table here. While a
 * table's latest measurement is above its budget, the registry scheduler starts no partition for
 * any source whose contract writes that table. Nothing is deleted: the hold stops new growth until
 * the table is back under budget or a PR raises the budget. Budgets are per table, not per source,
 * because a shared table (`area_statistics` has 29 writers) has one size.
 */

/**
 * Budget for a table with no budget of its own below. No size had been measured for these tables
 * when this was set (Oct 18, 2026), so it is generous: before the back-fill all real data together
 * (financials, branches, call reports, fees) came to about 3 GB. Atlas now records each table's
 * size daily, so a later PR can tighten a budget against a real number.
 */
export const DEFAULT_TABLE_BUDGET_MB = 1_000;

/** Budgets that differ from the default, each with where its number comes from. */
export const TABLE_BUDGET_MB: Readonly<Record<string, number>> = {
  // About double the Oct 17 size (about 3.6 GB after the NCUA 5300 extras and FFIEC detail back-fill).
  institution_call_report_items: 7_000,
  // About double the Oct 17 size (about 1 GB, written by 29 sources).
  area_statistics: 2_000,
  // Not measured yet; FDIC and NCUA quarterly financials back to 2010 were the largest part of the
  // roughly 3 GB of real data before the back-fill, so this stays above that whole figure.
  institution_financial_records: 3_000,
};

/** Every table some contract writes, with its budget in MB. */
export function hoovieTableBudgets(): Record<string, number> {
  const budgets: Record<string, number> = {};
  for (const contract of HOOVIE_SOURCES) {
    for (const table of contract.tables) budgets[table] = TABLE_BUDGET_MB[table] ?? DEFAULT_TABLE_BUDGET_MB;
  }
  return budgets;
}

export interface OverBudgetTable {
  table: string;
  totalMb: number;
  budgetMb: number;
}

/** Pure: the measured tables above their budget. A table with no measurement is never over. */
export function overBudgetTables(
  sizesMb: Readonly<Record<string, number>>,
  budgets: Readonly<Record<string, number>> = hoovieTableBudgets(),
): OverBudgetTable[] {
  return Object.entries(sizesMb)
    .filter(([table, totalMb]) => budgets[table] != null && Number.isFinite(totalMb) && totalMb > budgets[table])
    .map(([table, totalMb]) => ({ table, totalMb, budgetMb: budgets[table] }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * Pure: each source held because a table it writes is over budget, with those tables. Null
 * sizes (no measurement yet) hold nothing.
 */
export function sourcesHeldForSize(
  sizesMb: Readonly<Record<string, number>> | null,
  budgets: Readonly<Record<string, number>> = hoovieTableBudgets(),
): Map<string, string[]> {
  const held = new Map<string, string[]>();
  if (!sizesMb) return held;
  const over = new Set(overBudgetTables(sizesMb, budgets).map((entry) => entry.table));
  if (over.size === 0) return held;
  for (const contract of HOOVIE_SOURCES) {
    const tables = contract.tables.filter((table) => over.has(table));
    if (tables.length > 0) held.set(contract.source, tables);
  }
  return held;
}
