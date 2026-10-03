import type { InstitutionFinancialHistoryRow, PeerFinancialMedians } from "@/lib/data-store/financial";
import { balanceToDollars, formatReportQuarter, sourceRank } from "./financial-units";

/**
 * Chart-ready call-report history for the gated Financial profile.
 *
 * Every value is whole dollars or percent (8.2 = 8.2%), one point per quarter,
 * oldest first. Quarterly income comes from registry-written rows only: FDIC
 * rows are already quarterly; NCUA rows are year to date and are differenced
 * against the prior quarter of the same year. Legacy rows predate the corrected
 * service-charge mapping, so they leave income null rather than drawing a
 * misleading series.
 */
export interface FinancialPoint {
  reportDate: string;
  quarter: string;
  source: string;
  assets: number | null;
  deposits: number | null;
  loans: number | null;
  equity: number | null;
  netIncome: number | null;
  serviceCharges: number | null;
  roaPct: number | null;
  nimPct: number | null;
  efficiencyPct: number | null;
  ncoRatePct: number | null;
  noncurrentRatePct: number | null;
  tier1Pct: number | null;
  loansRealEstate: number | null;
  loansCommercial: number | null;
  loansConsumer: number | null;
  loansOther: number | null;
}

export interface PeerMedianPoints {
  quarter: string;
  peerCount: number;
  roaPct: number | null;
  nimPct: number | null;
  efficiencyPct: number | null;
  ncoRatePct: number | null;
  noncurrentRatePct: number | null;
  tier1Pct: number | null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

function hasQuarterlyIncome(row: InstitutionFinancialHistoryRow): boolean {
  return row.source === "fdic" && row.net_income !== null;
}

/** Registry-written NCUA rows carry year-to-date income (legacy NCUA rows have no net_income). */
function hasYearToDateIncome(row: InstitutionFinancialHistoryRow): boolean {
  return row.source === "ncua" && row.net_income !== null;
}

function quarterNumber(reportDate: string): number {
  return Math.floor(Number(reportDate.slice(5, 7)) / 3);
}

/** YTD minus the prior quarter's YTD in the same year; Q1 is already one quarter. */
function deYearToDate(points: FinancialPoint[], rows: Map<string, InstitutionFinancialHistoryRow>): FinancialPoint[] {
  return points.map((point, index) => {
    const row = rows.get(point.reportDate);
    if (!row || !hasYearToDateIncome(row)) return point;
    const dollars = (value: number | null) => balanceToDollars(finiteOrNull(value), "ncua");
    const q = quarterNumber(point.reportDate);
    if (q === 1) {
      return { ...point, netIncome: dollars(row.net_income), serviceCharges: dollars(row.service_charge_income) };
    }
    const prev = points[index - 1];
    const prevRow = prev ? rows.get(prev.reportDate) : undefined;
    const contiguous =
      prev && prevRow && hasYearToDateIncome(prevRow) &&
      prev.reportDate.slice(0, 4) === point.reportDate.slice(0, 4) && quarterNumber(prev.reportDate) === q - 1;
    if (!contiguous) return point;
    const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : dollars(a - b));
    return {
      ...point,
      netIncome: diff(row.net_income, prevRow.net_income),
      serviceCharges: diff(row.service_charge_income, prevRow.service_charge_income),
    };
  });
}

export function toFinancialPoint(row: InstitutionFinancialHistoryRow): FinancialPoint {
  const source = row.source.toLowerCase();
  const dollars = (value: number | null) => balanceToDollars(finiteOrNull(value), source);
  const quarterly = hasQuarterlyIncome(row);
  const loans = dollars(row.total_loans);
  const realEstate = dollars(row.loans_real_estate);
  const commercial = dollars(row.loans_commercial);
  const consumer = dollars(row.loans_consumer);
  const mixKnown = realEstate !== null || commercial !== null || consumer !== null;
  const other =
    loans !== null && mixKnown
      ? Math.max(0, loans - (realEstate ?? 0) - (commercial ?? 0) - (consumer ?? 0))
      : null;

  return {
    reportDate: row.report_date,
    quarter: formatReportQuarter(row.report_date) ?? row.report_date,
    source,
    assets: dollars(row.total_assets),
    deposits: dollars(row.total_deposits),
    loans,
    equity: dollars(row.total_equity),
    netIncome: quarterly ? dollars(row.net_income) : null,
    serviceCharges: quarterly ? dollars(row.service_charge_income) : null,
    roaPct: row.roa !== null && row.roa !== 0 ? row.roa : null,
    nimPct: finiteOrNull(row.net_interest_margin),
    efficiencyPct: finiteOrNull(row.efficiency_ratio),
    ncoRatePct: finiteOrNull(row.net_charge_off_rate),
    noncurrentRatePct: finiteOrNull(row.noncurrent_loan_rate),
    tier1Pct: finiteOrNull(row.tier1_capital_ratio),
    loansRealEstate: realEstate,
    loansCommercial: commercial,
    loansConsumer: consumer,
    loansOther: other,
  };
}

/** One point per quarter (fdic, then ffiec, then ncua), oldest first. */
export function buildFinancialSeries(rows: InstitutionFinancialHistoryRow[]): FinancialPoint[] {
  const byQuarter = new Map<string, InstitutionFinancialHistoryRow>();
  for (const row of rows) {
    const current = byQuarter.get(row.report_date);
    if (!current || sourceRank(row.source) < sourceRank(current.source)) byQuarter.set(row.report_date, row);
  }
  const points = [...byQuarter.values()]
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
    .map(toFinancialPoint);
  return deYearToDate(points, byQuarter);
}

export function toPeerMedianPoints(peers: PeerFinancialMedians | null): PeerMedianPoints | null {
  if (!peers || peers.peer_count < 3) return null;
  return {
    quarter: formatReportQuarter(peers.report_date) ?? peers.report_date,
    peerCount: peers.peer_count,
    roaPct: peers.roa,
    nimPct: peers.net_interest_margin,
    efficiencyPct: peers.efficiency_ratio,
    ncoRatePct: peers.net_charge_off_rate,
    noncurrentRatePct: peers.noncurrent_loan_rate,
    tier1Pct: peers.tier1_capital_ratio,
  };
}
