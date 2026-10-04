import type { InstitutionFinancial } from "@/lib/data-store/financial";

/**
 * Unit normalization for the public profile.
 *
 * institution_sources.asset_size is stored in thousands of dollars for every
 * charter (FDIC/NCUA filing convention; e.g. 158,694 = $158.7M).
 *
 * institution_financial_records carries up to three sources for the same
 * quarter, and their scales differ. Verified 2026-08-17 by comparing 12,934
 * paired fdic/ffiec rows for the same institution and report_date (median
 * ffiec / fdic ratios: total_assets 1,000x; service_charge_income ~1,000,000x;
 * fee_income_ratio ~1,000x):
 *   - fdic / ncua: every dollar column in thousands; fee_income_ratio a fraction.
 *   - ffiec: balance-sheet columns (total_assets, total_deposits, total_loans,
 *     total_revenue) in whole dollars; service_charge_income over-scaled by a
 *     further 1,000 (JPMorgan Q1 2026: 821,921,000,000 against fdic 821,921
 *     thousands, i.e. $822M), and fee_income_ratio inflated by the same 1,000
 *     because it is derived from that income figure.
 * Everything here is converted to whole dollars / percent so one formatter can
 * render all of it, and one row is chosen per quarter (fdic, then ffiec, then
 * ncua) so a quarter never renders twice.
 */
const THOUSANDS = 1_000;
const PERCENT = 100;
const FFIEC_INCOME_OVERSCALE = 1_000;
const FFIEC_RATIO_OVERSCALE = 1_000;
export const SOURCE_PREFERENCE = ["fdic", "ffiec", "ncua"] as const;

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function balanceToDollars(value: number | null, source: string): number | null {
  if (!finite(value)) return null;
  return source === "ffiec" ? value : value * THOUSANDS;
}

function incomeToDollars(value: number | null, source: string): number | null {
  if (!finite(value)) return null;
  return source === "ffiec" ? value / FFIEC_INCOME_OVERSCALE : value * THOUSANDS;
}

function ratioToPercent(value: number | null, source: string): number | null {
  if (!finite(value)) return null;
  const fraction = source === "ffiec" ? value / FFIEC_RATIO_OVERSCALE : value;
  return fraction * PERCENT;
}

export function assetSizeToDollars(assetSize: number | null | undefined): number | null {
  if (assetSize === null || assetSize === undefined || !Number.isFinite(assetSize)) return null;
  return assetSize > 0 ? assetSize * THOUSANDS : null;
}

export interface NormalizedFinancial {
  reportDate: string;
  source: string;
  totalAssets: number | null;
  totalDeposits: number | null;
  serviceChargeIncome: number | null;
  /** Percent value (8.2 means 8.2%). */
  feeIncomeRatioPct: number | null;
  /** Percent value; null when missing or zero (zero is a placeholder in NCUA rows). */
  roaPct: number | null;
  branchCount: number | null;
}

export function normalizeFinancial(record: InstitutionFinancial): NormalizedFinancial {
  const source = record.source.toLowerCase();
  const roa = finite(record.roa) && record.roa !== 0 ? record.roa : null;
  return {
    reportDate: record.report_date,
    source,
    totalAssets: balanceToDollars(record.total_assets, source),
    totalDeposits: balanceToDollars(record.total_deposits, source),
    serviceChargeIncome: incomeToDollars(record.service_charge_income, source),
    feeIncomeRatioPct: ratioToPercent(record.fee_income_ratio, source),
    roaPct: roa,
    branchCount: record.branch_count,
  };
}

export function sourceRank(source: string): number {
  const rank = SOURCE_PREFERENCE.indexOf(source.toLowerCase() as (typeof SOURCE_PREFERENCE)[number]);
  return rank === -1 ? SOURCE_PREFERENCE.length : rank;
}

/**
 * One normalized row per report_date (fdic preferred, then ffiec, then ncua),
 * newest quarter first. Callers render the first row as "latest" and the whole
 * list as history, so both always come from the same source and quarter.
 */
export function selectFinancialsByQuarter(records: InstitutionFinancial[]): NormalizedFinancial[] {
  const byQuarter = new Map<string, InstitutionFinancial>();
  for (const record of records) {
    const current = byQuarter.get(record.report_date);
    if (!current || sourceRank(record.source) < sourceRank(current.source)) {
      byQuarter.set(record.report_date, record);
    }
  }
  return [...byQuarter.values()]
    .sort((a, b) => b.report_date.localeCompare(a.report_date))
    .map(normalizeFinancial);
}

/** "Q1 2026" for a report date, or the raw string when it cannot be parsed. */
export function formatReportQuarter(reportDate: string | null | undefined): string | null {
  if (!reportDate) return null;
  const date = new Date(reportDate);
  if (Number.isNaN(date.getTime())) return reportDate;
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}
