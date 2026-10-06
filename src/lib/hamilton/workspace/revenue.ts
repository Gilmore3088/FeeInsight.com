/**
 * The bank's own reported fee income, as Hamilton's revenue evidence. Pure.
 *
 * Units follow institution_financial_records: FDIC and NCUA dollars are stored in
 * thousands; FDIC income is per quarter; NCUA income is year to date, so each quarter is
 * its YTD minus the prior quarter's YTD in the same year.
 */

import type { ServiceChargeTrend } from "./observations";
import type { IncomeQuarter, InstitutionFinancials, RevenueLine, SourceRef } from "./types";

export interface ServiceChargeRow {
  report_date: string;
  source: string;
  /** In thousands, as stored. */
  service_charge_income: number | null;
  /** In thousands. Banks: consumer overdraft and NSF together (RIAD H032). Credit unions: overdraft only (IS0048). */
  overdraft_revenue?: number | null;
  /** In thousands. Credit unions only (IS0049). */
  nsf_revenue?: number | null;
}

type IncomeField = "service_charge_income" | "overdraft_revenue" | "nsf_revenue";

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

/** Quarterly income in dollars for one line, keyed by quarter end, for one source. */
export function quarterlyIncome(rows: ServiceChargeRow[], source: "fdic" | "ncua", field: IncomeField): Map<string, number> {
  const ytd = new Map<string, number>();
  for (const row of rows) {
    const raw = row[field];
    if (row.source !== source || raw === null || raw === undefined) continue;
    const v = Number(raw);
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

/** Quarterly service charges in dollars, keyed by quarter end, for one source. */
export function quarterlyServiceCharges(rows: ServiceChargeRow[], source: "fdic" | "ncua"): Map<string, number> {
  return quarterlyIncome(rows, source, "service_charge_income");
}

function quarterEnds(latest: string, count: number): string[] {
  const dates: string[] = [latest];
  while (dates.length < count) dates.push(previousQuarterEnd(dates[dates.length - 1]));
  return dates;
}

/** Sum of the quarters, or null when any is missing. */
function sumAll(quarterly: Map<string, number>, dates: string[]): number | null {
  let total = 0;
  for (const d of dates) {
    const v = quarterly.get(d);
    if (v === undefined) return null;
    total += v;
  }
  return total;
}

function latestSource(rows: ServiceChargeRow[], field: IncomeField): { source: "fdic" | "ncua"; latest: string } | null {
  return (["fdic", "ncua"] as const)
    .map((source) => ({
      source,
      latest: rows.filter((r) => r.source === source && r[field] !== null && r[field] !== undefined)
        .map((r) => r.report_date.slice(0, 10)).sort().pop(),
    }))
    .filter((s): s is { source: "fdic" | "ncua"; latest: string } => !!s.latest)
    .sort((a, b) => b.latest.localeCompare(a.latest))[0] ?? null;
}

/**
 * The bank's deposit service charge income by quarter (newest first, up to eight),
 * with trailing-four-quarter totals only when every quarter is on file.
 */
export function institutionFinancials(rows: ServiceChargeRow[]): InstitutionFinancials | null {
  const found = latestSource(rows, "service_charge_income");
  if (!found) return null;
  const quarterly = quarterlyServiceCharges(rows, found.source);
  const dates = quarterEnds(found.latest, 8);
  const quarters: IncomeQuarter[] = dates
    .filter((d) => quarterly.has(d))
    .map((d) => ({ quarterEnd: d, amount: quarterly.get(d) as number }));
  if (quarters.length === 0) return null;
  const latestTtm = sumAll(quarterly, dates.slice(0, 4));
  const priorTtm = sumAll(quarterly, dates.slice(4, 8));
  const label = found.source === "ncua"
    ? "Fee income (NCUA 5300 call report)"
    : "Service charges on deposit accounts (FDIC call report)";
  const sourceRef: SourceRef = { label, table: "institution_financial_records", asOf: found.latest };
  return {
    source: found.source,
    label,
    quarters,
    latestTtm,
    priorTtm,
    yoyPct: latestTtm !== null && priorTtm !== null && priorTtm > 0
      ? Math.round(((latestTtm - priorTtm) / priorTtm) * 1000) / 10
      : null,
    quarterEnd: found.latest,
    sourceRef,
  };
}

const OVERDRAFT_LINE_CATEGORIES = new Set(["overdraft", "od_daily_cap", "continuous_od"]);

/**
 * The filed income line for one fee, trailing four quarters, when the filing has one.
 * Credit unions file overdraft (IS0048) and NSF (IS0049) income separately. Banks over $1B
 * file one line for consumer overdraft and NSF together (RIAD H032), so that line is
 * returned for either fee with `combinedWith` naming the other.
 */
export function feeRevenueLine(rows: ServiceChargeRow[], feeCategory: string, charterType: string): RevenueLine | null {
  const isOverdraft = OVERDRAFT_LINE_CATEGORIES.has(feeCategory);
  const isNsf = feeCategory === "nsf";
  if (!isOverdraft && !isNsf) return null;
  const creditUnion = charterType === "credit_union";
  const field: IncomeField = creditUnion && isNsf ? "nsf_revenue" : "overdraft_revenue";
  const source = creditUnion ? "ncua" : "fdic";
  const filed = rows.filter((r) => r.source === source && r[field] !== null && r[field] !== undefined);
  const latest = filed.map((r) => r.report_date.slice(0, 10)).sort().pop();
  if (!latest) return null;
  const annualIncome = sumAll(quarterlyIncome(rows, source, field), quarterEnds(latest, 4));
  if (annualIncome === null) return null;
  const label = creditUnion
    ? isNsf ? "NSF fee income (NCUA 5300, IS0049)" : "Overdraft fee income (NCUA 5300, IS0048)"
    : "Consumer overdraft and NSF fee income (call report Schedule RI-E, RIAD H032)";
  return {
    annualIncome,
    label,
    quarterEnd: latest,
    source: { label, table: "institution_financial_records", asOf: latest },
    ...(creditUnion ? {} : { combinedWith: isNsf ? "overdraft" : "NSF" }),
  };
}

/** The latest four quarters against the four before, only when all eight are on file. */
export function serviceChargeTrend(rows: ServiceChargeRow[]): ServiceChargeTrend | null {
  const f = institutionFinancials(rows);
  if (!f || f.latestTtm === null || f.priorTtm === null) return null;
  return { latestTtm: f.latestTtm, priorTtm: f.priorTtm, quarterEnd: f.quarterEnd, source: f.source };
}
