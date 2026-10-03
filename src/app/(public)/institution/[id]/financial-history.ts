import type { InstitutionFinancialHistoryRow, PeerFinancialMedians } from "@/lib/data-store/financial";
import { balanceToDollars, formatReportQuarter, sourceRank } from "./financial-units";

/**
 * Chart-ready call-report history for the gated Financial profile.
 *
 * Every value is whole dollars or percent (8.2 = 8.2%), one point per quarter,
 * oldest first. Quarterly income lines come only from registry-written FDIC rows
 * (they carry net_income); NCUA income is year-to-date and legacy rows predate
 * the corrected service-charge mapping, so those quarters leave income null
 * rather than drawing a misleading series.
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
  return [...byQuarter.values()]
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
    .map(toFinancialPoint);
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
