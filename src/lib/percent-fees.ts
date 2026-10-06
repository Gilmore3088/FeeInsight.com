/**
 * Percentage fees: a fee stated as a share of something ("1.1% of the transaction") rather
 * than a dollar amount. Such a fee has amount_kind 'percent', amount NULL and rate_percent
 * set on every fee tier (migration 20270110000006). A rate is never compared with, or
 * pooled into, dollar amounts: medians, ranges and positions for a category are computed
 * over its rates on their own.
 */

export type AmountKind = "flat" | "percent";

export type RateBasis = "transaction" | "settlement" | "advance" | "balance_transferred" | "balance" | "loan_balance";

/**
 * Categories whose fee may publish as a rate, with the plausible range of that rate in
 * percent. Any other category keeps a rate held: most "percent" lines on a schedule are
 * interest or dividend rates, not fees.
 */
export const PERCENT_FEE_RANGES: Readonly<Record<string, { min: number; max: number }>> = {
  card_foreign_txn: { min: 0.1, max: 5 },
  cash_advance: { min: 0.5, max: 10 },
  // "10% of the coins counted" (often waived for members); non-customer machines reach 20%.
  coin_counting: { min: 0.5, max: 20 },
  // "5% of the payment amount" on a late loan payment; held rows run 1% to 10%.
  late_payment: { min: 1, max: 10 },
};

export interface RateFields {
  amount_kind?: string | null;
  rate_percent?: number | string | null;
  rate_min_amount?: number | string | null;
  rate_max_amount?: number | string | null;
  rate_basis?: string | null;
}

export function isPercentFee(row: RateFields | null | undefined): boolean {
  return row?.amount_kind === "percent";
}

export function ratePercentOf(row: RateFields | null | undefined): number | null {
  if (!isPercentFee(row) || row?.rate_percent == null) return null;
  const rate = Number(row.rate_percent);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function percentFeeAllowed(canonicalFeeKey: string | null | undefined): boolean {
  return !!canonicalFeeKey && Object.prototype.hasOwnProperty.call(PERCENT_FEE_RANGES, canonicalFeeKey);
}

const BASIS_TEXT: Record<RateBasis, string> = {
  transaction: "of the transaction",
  settlement: "of the settlement amount",
  advance: "of the advance",
  balance_transferred: "of the balance transferred",
  balance: "of the balance",
  loan_balance: "of the loan balance",
};

function rateText(rate: number): string {
  return `${Number(rate.toFixed(4)).toString()}%`;
}

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** "1.1% of the transaction", "3% of the advance ($10 minimum)". */
export function formatRateFee(row: RateFields): string | null {
  const rate = ratePercentOf(row);
  if (rate == null) return null;
  const basis = row.rate_basis && row.rate_basis in BASIS_TEXT ? ` ${BASIS_TEXT[row.rate_basis as RateBasis]}` : "";
  const min = row.rate_min_amount == null ? null : Number(row.rate_min_amount);
  const max = row.rate_max_amount == null ? null : Number(row.rate_max_amount);
  const bounds = [
    min != null && Number.isFinite(min) && min > 0 ? `${dollars(min)} minimum` : null,
    max != null && Number.isFinite(max) && max > 0 ? `${dollars(max)} maximum` : null,
  ].filter(Boolean);
  return `${rateText(rate)}${basis}${bounds.length > 0 ? ` (${bounds.join(", ")})` : ""}`;
}

/** A rate statistic for display ("1.1%"). */
export function formatRatePercent(rate: number | null | undefined): string {
  return rate == null || !Number.isFinite(rate) ? "n/a" : rateText(rate);
}
