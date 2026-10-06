/**
 * The bank's own reported fee income, as Hamilton's revenue evidence. Pure.
 *
 * Units follow institution_financial_records: FDIC and NCUA dollars are stored in
 * thousands; FDIC income is per quarter; NCUA income is year to date, so each quarter is
 * its YTD minus the prior quarter's YTD in the same year.
 */

import type { ServiceChargeTrend } from "./observations";

export interface ServiceChargeRow {
  report_date: string;
  source: string;
  /** In thousands, as stored. */
  service_charge_income: number | null;
}

const THOUSANDS = 1000;

function quarterOf(date: string): number {
  return Math.floor(Number(date.slice(5, 7)) / 3);
}

function previousQuarterEnd(date: string): string {
  const year = Number(date.slice(0, 4));
  const q = quarterOf(date);
  if (q === 1) return `${year - 1}-12-31`;
  return `${year}-${["03-31", "06-30", "09-30"][q - 2]}`;
}

/** Quarterly service charges in dollars, keyed by quarter end, for one source. */
export function quarterlyServiceCharges(rows: ServiceChargeRow[], source: "fdic" | "ncua"): Map<string, number> {
  const ytd = new Map<string, number>();
  for (const row of rows) {
    if (row.source !== source || row.service_charge_income === null) continue;
    const v = Number(row.service_charge_income);
    if (Number.isFinite(v)) ytd.set(row.report_date.slice(0, 10), v);
  }
  const quarterly = new Map<string, number>();
  for (const [date, value] of ytd) {
    if (source === "fdic" || quarterOf(date) === 1) {
      quarterly.set(date, value * THOUSANDS);
      continue;
    }
    const prior = ytd.get(previousQuarterEnd(date));
    if (prior !== undefined) quarterly.set(date, (value - prior) * THOUSANDS);
  }
  return quarterly;
}

/** The latest four quarters against the four before, only when all eight are on file. */
export function serviceChargeTrend(rows: ServiceChargeRow[]): ServiceChargeTrend | null {
  const latestBySource = (["fdic", "ncua"] as const)
    .map((source) => ({
      source,
      latest: rows.filter((r) => r.source === source && r.service_charge_income !== null)
        .map((r) => r.report_date.slice(0, 10)).sort().pop(),
    }))
    .filter((s): s is { source: "fdic" | "ncua"; latest: string } => !!s.latest)
    .sort((a, b) => b.latest.localeCompare(a.latest))[0];
  if (!latestBySource) return null;
  const quarterly = quarterlyServiceCharges(rows, latestBySource.source);
  const dates: string[] = [latestBySource.latest];
  while (dates.length < 8) dates.push(previousQuarterEnd(dates[dates.length - 1]));
  const values = dates.map((d) => quarterly.get(d));
  if (values.some((v) => v === undefined)) return null;
  const sum = (vs: (number | undefined)[]) => vs.reduce<number>((acc, v) => acc + (v as number), 0);
  return {
    latestTtm: sum(values.slice(0, 4)),
    priorTtm: sum(values.slice(4, 8)),
    quarterEnd: latestBySource.latest,
    source: latestBySource.source,
  };
}
