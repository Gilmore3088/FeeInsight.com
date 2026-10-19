import { sql } from "./connection";
import { groupExpression, MIN_GROUP, type CallItemGroup } from "./call-report-items";

/**
 * Helpers over the industry-events tables (institution_structure_events, by source) and the
 * holding-company fee-income lines from XBRL (sec_fee_income_facts). Groupings reuse
 * call-report-items' groupExpression over institution_sources aliased `s`, and a group below
 * MIN_GROUP institutions gets a count and no median. Server only.
 */

export type IndustryEventKind = "failure" | "assistance" | "merger" | "other";

/**
 * Which kind of event a structure row is. FDIC's failure list also carries open-bank assistance
 * transactions (RESTYPE "ASSISTANCE"); those are not failures.
 */
export function structureEventKind(source: string, changeDescription: string | null): IndustryEventKind {
  if (source === "fdic-failures") {
    const d = (changeDescription ?? "").trim().toUpperCase();
    return d === "FAILURE" ? "failure" : d === "ASSISTANCE" ? "assistance" : "other";
  }
  if (source === "ncua-liquidations") return "failure";
  if (source === "ncua-mergers") return "merger";
  return "other";
}

export type EventGroup = CallItemGroup;

/** For events, "state" means where the institution was (the list's own state), else its record's. */
export function eventGroupExpression(group: EventGroup): string {
  return group === "state" ? "COALESCE(e.office_state, s.state_code)" : groupExpression(group);
}

/** Median helper: null below MIN_GROUP so a thin group never shows a figure. */
export function medianOrNull(values: number[], minGroup: number = MIN_GROUP): number | null {
  if (values.length < minGroup) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Holding-company fee-income lines (XBRL) per concept and year: median with filer count. */
export async function getFeeIncomeFactMedians(sinceYear: number) {
  return sql<Array<{ concept: string; label: string | null; frame: string; filers: number; median: number | null }>>`
    SELECT concept, MAX(label) AS label, frame, COUNT(DISTINCT cik)::int AS filers,
           CASE WHEN COUNT(DISTINCT cik) >= ${MIN_GROUP} THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::float8 END AS median
      FROM sec_fee_income_facts
     WHERE frame >= ${`CY${sinceYear}`}
     GROUP BY concept, frame
     ORDER BY frame DESC, filers DESC
  `;
}
