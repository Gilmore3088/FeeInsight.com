/**
 * An institution's own fees in one category, kept apart. When a category holds several
 * different fees (a $175 garnishment and a $150 levy), the bank has no single price for it:
 * their median ($162.50) is a statistic, not a fee its schedule states. Medians and
 * percentiles use `value`; every place that shows the institution's own price uses `price`,
 * or the range and the named fees when `price` is null.
 */
import { formatAmount } from "./format";

const SAME_AMOUNT = 0.005;

export interface OwnFeeLine {
  name: string;
  amount: number;
}

export interface InstitutionOwnFee {
  category: string;
  /** The statistics contract's per-institution value. For medians and percentiles, never shown as a price. */
  value: number;
  /** The price the schedule states: its one amount (the standard tier for tiered fees); null when it states several. */
  price: number | null;
  low: number;
  high: number;
  /** Each fee, lowest first; one line per name and amount. */
  fees: OwnFeeLine[];
}

/**
 * One category's own fee from its rows. `value` is the statistics contract's value for the
 * same rows; `standardTier` marks categories compared at the highest tier, whose value is a
 * stated amount (the standard tier) and so is the price.
 */
export function ownFeeFrom(
  category: string,
  rows: readonly { fee_name: string | null; amount: number }[],
  value: number,
  standardTier: boolean,
): InstitutionOwnFee | null {
  if (rows.length === 0) return null;
  const fees: OwnFeeLine[] = [];
  for (const row of [...rows].sort((a, b) => a.amount - b.amount || (a.fee_name ?? "").localeCompare(b.fee_name ?? ""))) {
    const name = (row.fee_name ?? "").trim() || "Fee";
    if (!fees.some((f) => f.name === name && Math.abs(f.amount - row.amount) < SAME_AMOUNT)) fees.push({ name, amount: row.amount });
  }
  const low = fees[0].amount;
  const high = fees[fees.length - 1].amount;
  const single = high - low < SAME_AMOUNT;
  return { category, value, price: single ? low : standardTier ? value : null, low, high, fees };
}

/** "$150.00", or "$150.00 to $175.00" when the schedule states several different fees. */
export function ownFeeLabel(fee: Pick<InstitutionOwnFee, "price" | "low" | "high">): string {
  if (fee.price !== null) return formatAmount(fee.price);
  return `${formatAmount(fee.low)} to ${formatAmount(fee.high)}`;
}

/** "Levy $150.00; Garnishment $175.00": each fee by name. */
export function ownFeeList(fee: Pick<InstitutionOwnFee, "fees">): string {
  return fee.fees.map((f) => `${f.name} ${formatAmount(f.amount)}`).join("; ");
}
