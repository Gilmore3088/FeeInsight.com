import type {
  InstitutionFinancialHistoryRow,
  PeerFinancialMedians,
  PeerPercentiles,
  PeerRankMetric,
} from "@/lib/data-store/financial";
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
  loansCreditCard: number | null;
  loansAuto: number | null;
  securities: number | null;
  depositsCore: number | null;
  depositsBrokered: number | null;
  depositsUninsured: number | null;
  provision: number | null;
  roePct: number | null;
  leveragePct: number | null;
  totalCapitalPct: number | null;
  employees: number | null;
  members: number | null;
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
  roePct: number | null;
  leveragePct: number | null;
  totalCapitalPct: number | null;
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
    loansCreditCard: dollars(row.loans_credit_card),
    loansAuto: dollars(row.loans_auto),
    securities: dollars(row.total_securities),
    depositsCore: dollars(row.core_deposits),
    depositsBrokered: dollars(row.brokered_deposits),
    depositsUninsured: dollars(row.uninsured_deposits),
    provision: quarterly ? dollars(row.provision_for_losses) : null,
    roePct: finiteOrNull(row.roe),
    leveragePct: finiteOrNull(row.leverage_ratio),
    totalCapitalPct: row.total_capital_ratio !== null && row.total_capital_ratio !== 0 ? finiteOrNull(row.total_capital_ratio) : null,
    employees: finiteOrNull(row.employee_count),
    members: finiteOrNull(row.member_count),
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
    roePct: peers.roe,
    leveragePct: peers.leverage_ratio,
    totalCapitalPct: peers.total_capital_ratio,
  };
}

// --- Growth ---------------------------------------------------------------

type StockKey = "assets" | "deposits" | "loans" | "equity" | "securities" | "depositsUninsured" | "members" | "employees";
type FlowKey = "serviceCharges" | "netIncome" | "provision";

export interface GrowthRow {
  key: StockKey | FlowKey;
  label: string;
  kind: "balance" | "count" | "flow";
  /** Latest balance, or the trailing four quarters' total for income lines. */
  latest: number;
  latestQuarter: string;
  /** Percent changes; null when the earlier figure is missing, zero, or of the other sign. */
  qoq: number | null;
  yoy: number | null;
  cagr5: number | null;
  cagr10: number | null;
}

const STOCKS: Array<{ key: StockKey; label: string; kind: "balance" | "count" }> = [
  { key: "assets", label: "Total assets", kind: "balance" },
  { key: "deposits", label: "Deposits", kind: "balance" },
  { key: "loans", label: "Loans", kind: "balance" },
  { key: "securities", label: "Securities", kind: "balance" },
  { key: "equity", label: "Equity", kind: "balance" },
  { key: "depositsUninsured", label: "Uninsured deposits", kind: "balance" },
  { key: "members", label: "Members", kind: "count" },
  { key: "employees", label: "Employees", kind: "count" },
];

const FLOWS: Array<{ key: FlowKey; label: string }> = [
  { key: "serviceCharges", label: "Deposit service charges (4 quarters)" },
  { key: "netIncome", label: "Net income (4 quarters)" },
  { key: "provision", label: "Loan-loss provisions (4 quarters)" },
];

function shiftDate(reportDate: string, months: number): string {
  const year = Number(reportDate.slice(0, 4));
  const month = Number(reportDate.slice(5, 7));
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function change(now: number | null, then: number | null): number | null {
  if (now === null || then === null || then <= 0 || now < 0) return null;
  return (now / then - 1) * 100;
}

function cagr(now: number | null, then: number | null, years: number): number | null {
  if (now === null || then === null || then <= 0 || now <= 0) return null;
  return (Math.pow(now / then, 1 / years) - 1) * 100;
}

/** Sum of the four quarters ending at reportDate; null unless all four are on file. */
function trailingFour(byDate: Map<string, FinancialPoint>, reportDate: string, key: FlowKey): number | null {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const value = byDate.get(shiftDate(reportDate, -3 * i))?.[key];
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

/**
 * Growth over a quarter, a year, five and ten years for each line with data.
 * Balances compare quarter-end figures; income lines compare trailing
 * four-quarter totals so seasonality and year-to-date reporting cancel out.
 */
export function computeGrowth(points: FinancialPoint[]): GrowthRow[] {
  if (points.length === 0) return [];
  const byDate = new Map(points.map((p) => [p.reportDate, p]));
  const rows: GrowthRow[] = [];

  for (const stock of STOCKS) {
    const latest = [...points].reverse().find((p) => p[stock.key] !== null);
    const now = latest?.[stock.key] ?? null;
    if (!latest || now === null) continue;
    const at = (months: number) => byDate.get(shiftDate(latest.reportDate, months))?.[stock.key] ?? null;
    rows.push({
      key: stock.key,
      label: stock.label,
      kind: stock.kind,
      latest: now,
      latestQuarter: latest.quarter,
      qoq: change(now, at(-3)),
      yoy: change(now, at(-12)),
      cagr5: cagr(now, at(-60), 5),
      cagr10: cagr(now, at(-120), 10),
    });
  }

  for (const flow of FLOWS) {
    const latest = [...points].reverse().find((p) => trailingFour(byDate, p.reportDate, flow.key) !== null);
    if (!latest) continue;
    const ttm = (months: number) => trailingFour(byDate, shiftDate(latest.reportDate, months), flow.key);
    const now = ttm(0);
    if (now === null) continue;
    rows.push({
      key: flow.key,
      label: flow.label,
      kind: "flow",
      latest: now,
      latestQuarter: latest.quarter,
      qoq: null,
      yoy: change(now, ttm(-12)),
      cagr5: cagr(now, ttm(-60), 5),
      cagr10: cagr(now, ttm(-120), 10),
    });
  }
  return rows;
}

// --- Peer rank and outliers -------------------------------------------------

export const PEER_RANK_LABELS: Record<PeerRankMetric, string> = {
  total_assets: "Total assets",
  asset_growth: "Asset growth, past year",
  deposit_growth: "Deposit growth, past year",
  loan_growth: "Loan growth, past year",
  roa: "Return on assets",
  roe: "Return on equity",
  net_interest_margin: "Net interest margin",
  efficiency_ratio: "Efficiency ratio",
  fee_income_ratio: "Fee income share of revenue",
  net_charge_off_rate: "Net charge-off rate",
  noncurrent_loan_rate: "Noncurrent loans",
  tier1_capital_ratio: "Capital ratio",
  brokered_share: "Brokered deposit share",
  uninsured_share: "Uninsured deposit share",
};

export interface PeerRankRow {
  metric: PeerRankMetric;
  label: string;
  /** 0-100, share of reporting peers below this institution. */
  percentile: number;
}

export function toPeerRankRows(peers: PeerPercentiles | null): PeerRankRow[] {
  if (!peers) return [];
  return (Object.keys(PEER_RANK_LABELS) as PeerRankMetric[])
    .map((metric) => ({ metric, label: PEER_RANK_LABELS[metric], percentile: peers.percentiles[metric] }))
    .filter((row): row is PeerRankRow => row.percentile !== null && row.percentile !== undefined);
}

export interface OutlierFlag {
  /** Stable id for keys and tests. */
  id: string;
  text: string;
}

const EXTREME_HIGH = 95;
const EXTREME_LOW = 5;
const FEE_GAP_POINTS = 20;
const ASSET_JUMP_PCT = 25;
const ASSET_DROP_PCT = -10;
const MIN_YEARS_FOR_RECORD = 5;

function signedPct(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/**
 * Plain statements of where an institution stands out, from its own history
 * and its peer rank. Each one states the figure; none judges it.
 */
export function findOutliers(points: FinancialPoint[], growth: GrowthRow[], peers: PeerPercentiles | null): OutlierFlag[] {
  const flags: OutlierFlag[] = [];
  const g = (key: GrowthRow["key"]) => growth.find((row) => row.key === key) ?? null;
  const assets = g("assets");
  const charges = g("serviceCharges");
  const income = g("netIncome");

  if (charges?.yoy != null && assets?.yoy != null && Math.abs(charges.yoy - assets.yoy) >= FEE_GAP_POINTS) {
    flags.push({
      id: "fees-vs-assets",
      text: `Deposit service charges ${signedPct(charges.yoy)} over the past year while total assets moved ${signedPct(assets.yoy)}.`,
    });
  }
  if (assets?.yoy != null && assets.yoy >= ASSET_JUMP_PCT) {
    flags.push({
      id: "asset-jump",
      text: `Total assets ${signedPct(assets.yoy)} in a year. A jump this size often comes from a merger; check the filings.`,
    });
  } else if (assets?.yoy != null && assets.yoy <= ASSET_DROP_PCT) {
    flags.push({ id: "asset-drop", text: `Total assets ${signedPct(assets.yoy)} in a year.` });
  }
  if (income && income.latest < 0) {
    flags.push({ id: "net-loss", text: `Net loss over the four quarters to ${income.latestQuarter}.` });
  }

  // Service charges at a high or low for the whole history on file.
  if (charges) {
    const byDate = new Map(points.map((p) => [p.reportDate, p]));
    const totals = points
      .map((p) => trailingFour(byDate, p.reportDate, "serviceCharges"))
      .filter((v): v is number => v !== null);
    const years = Math.floor(totals.length / 4);
    if (years >= MIN_YEARS_FOR_RECORD) {
      const latest = totals[totals.length - 1];
      if (latest >= Math.max(...totals)) {
        flags.push({ id: "fees-record-high", text: `Deposit service charges are at their highest in the ${years} years on file.` });
      } else if (latest <= Math.min(...totals)) {
        flags.push({ id: "fees-record-low", text: `Deposit service charges are at their lowest in the ${years} years on file.` });
      }
    }
  }

  if (peers) {
    for (const row of toPeerRankRows(peers)) {
      if (row.metric === "total_assets") continue;
      if (row.percentile >= EXTREME_HIGH) {
        flags.push({ id: `peer-high-${row.metric}`, text: `${row.label} is in the highest 5% of peers.` });
      } else if (row.percentile <= EXTREME_LOW) {
        flags.push({ id: `peer-low-${row.metric}`, text: `${row.label} is in the lowest 5% of peers.` });
      }
    }
  }
  return flags;
}
