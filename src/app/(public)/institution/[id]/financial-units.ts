import type { InstitutionFinancial } from "@/lib/data-store/financial";
import { FINANCIAL_SOURCES, isFinancialSource } from "@/lib/data-store/financial-sources";

/**
 * Unit normalization for the public profile.
 *
 * institution_sources.asset_size is stored in thousands of dollars for every
 * charter (FDIC/NCUA filing convention; e.g. 158,694 = $158.7M).
 *
 * institution_financial_records is read from its fdic and ncua rows only
 * (FINANCIAL_SOURCES): every dollar column in thousands, fee_income_ratio a
 * fraction. The table's ffiec rows are in other units and duplicate fdic
 * quarters; financial-sources.ts explains why they are excluded.
 * Everything here is converted to whole dollars / percent so one formatter can
 * render all of it, and one row is chosen per quarter (fdic, then ncua) so a
 * quarter never renders twice.
 */
const THOUSANDS = 1_000;
const PERCENT = 100;
export const SOURCE_PREFERENCE = FINANCIAL_SOURCES;

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Thousands of dollars (fdic/ncua convention) to whole dollars. */
export function balanceToDollars(value: number | null): number | null {
  if (!finite(value)) return null;
  return value * THOUSANDS;
}

function ratioToPercent(value: number | null): number | null {
  if (!finite(value)) return null;
  return value * PERCENT;
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
    totalAssets: balanceToDollars(record.total_assets),
    totalDeposits: balanceToDollars(record.total_deposits),
    serviceChargeIncome: balanceToDollars(record.service_charge_income),
    feeIncomeRatioPct: ratioToPercent(record.fee_income_ratio),
    roaPct: roa,
    branchCount: record.branch_count,
  };
}

export function sourceRank(source: string): number {
  const rank = SOURCE_PREFERENCE.indexOf(source.toLowerCase() as (typeof SOURCE_PREFERENCE)[number]);
  return rank === -1 ? SOURCE_PREFERENCE.length : rank;
}

/**
 * One normalized row per report_date (fdic preferred, then ncua), newest
 * quarter first. Any other source is dropped. Callers render the first row as
 * "latest" and the whole list as history, so both always come from the same
 * source and quarter.
 */
export function selectFinancialsByQuarter(records: InstitutionFinancial[]): NormalizedFinancial[] {
  const byQuarter = new Map<string, InstitutionFinancial>();
  for (const record of records) {
    if (!isFinancialSource(record.source)) continue;
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

/**
 * The words for the call-report fee figure, by filing. A bank's figure is FDIC "service charges
 * on deposit accounts"; a credit union's is NCUA 5300 Account 131, "Fee Income", which the
 * registry stores in the same service_charge_income column (src/lib/regulatory/ncua.ts). The two
 * lines measure different things, so a credit union's figure never borrows the bank's name.
 */
export interface FeeIncomeTerms {
  /** Sentence-start noun: "Service charges" or "Fee income". */
  subject: string;
  /** Its verb agrees with the subject: "were" or "was". */
  was: "were" | "was";
  /** The dollar figure's name: "Service-charge income" or "Fee income". */
  amount: string;
  /** The Pro tile and chart title: "Deposit service charges" or "Fee income". */
  title: string;
  /** What the share divides, for its definition line. */
  definition: string;
}

export function feeIncomeTerms(source: string | null | undefined): FeeIncomeTerms {
  if ((source ?? "").toLowerCase() === "ncua") {
    return {
      subject: "Fee income",
      was: "was",
      amount: "Fee income",
      title: "Fee income",
      definition: "Fee income (NCUA 5300 Account 131)",
    };
  }
  return {
    subject: "Service charges",
    was: "were",
    amount: "Service-charge income",
    title: "Deposit service charges",
    definition: "Service charges on deposit accounts",
  };
}
