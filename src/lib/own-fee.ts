/**
 * An institution's own fees in one category, kept apart. When a category holds several
 * different fees (a $175 garnishment and a $150 levy), the bank has no single price for it:
 * their median ($162.50) is a statistic, not a fee its schedule states. Medians and
 * percentiles use `value`; every place that shows the institution's own price uses `price`,
 * or the range and the named fees when `price` is null. The same holds for a named competitor
 * or peer: its row shows its stated price, or `SeveralFees` when it states several (#1931).
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

/**
 * `ownFeeFrom` over raw catalog rows: keeps the rows the statistics contract counts (a
 * non-negative amount, read from a number or numeric text) and drops the rest.
 */
export function ownFeeFromRows(
  category: string,
  rows: readonly { fee_name?: string | null; amount: unknown }[],
  value: number,
  standardTier: boolean,
): InstitutionOwnFee | null {
  const counted: { fee_name: string | null; amount: number }[] = [];
  for (const row of rows) {
    const raw = row.amount;
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) continue;
    const amount = Number(raw);
    if (Number.isFinite(amount) && amount >= 0) counted.push({ fee_name: typeof row.fee_name === "string" ? row.fee_name : null, amount });
  }
  return ownFeeFrom(category, counted, value, standardTier);
}

/** A named institution's fees in one category when its schedule states several different ones. */
export type SeveralFees = Pick<InstitutionOwnFee, "low" | "high" | "fees">;

/** The range and named fees when the schedule states several different fees; undefined when it states one price. */
export function severalFeesOf(fee: InstitutionOwnFee | null | undefined): SeveralFees | undefined {
  if (!fee || fee.price !== null) return undefined;
  return { low: fee.low, high: fee.high, fees: fee.fees };
}

type Money = (amount: number) => string;

/** "$150.00", or "$150.00 to $175.00" when the schedule states several different fees. */
export function ownFeeLabel(fee: Pick<InstitutionOwnFee, "price" | "low" | "high">, money: Money = formatAmount): string {
  if (fee.price !== null) return money(fee.price);
  return `${money(fee.low)} to ${money(fee.high)}`;
}

/** "Levy $150.00; Garnishment $175.00": each fee by name. */
export function ownFeeList(fee: Pick<InstitutionOwnFee, "fees">, money: Money = formatAmount): string {
  return fee.fees.map((f) => `${f.name} ${money(f.amount)}`).join("; ");
}

/**
 * A named institution's figure: its stated price (`amount` when `several` is absent), or the
 * range of the fees it states.
 */
export function statedFeeLabel(amount: number, several?: SeveralFees | null, money: Money = formatAmount): string {
  return several ? ownFeeLabel({ price: null, low: several.low, high: several.high }, money) : money(amount);
}

/** The same in one line of text: "$150.00 to $175.00 (Levy $150.00; Garnishment $175.00)". */
export function statedFeeText(amount: number, several?: SeveralFees | null, money: Money = formatAmount): string {
  return several ? `${statedFeeLabel(amount, several, money)} (${ownFeeList(several, money)})` : money(amount);
}

/** All stored schedule links behind a named price/range; a legacy single link stays usable. */
export function feeScheduleUrls(urls?: readonly string[] | null, legacy?: string | null): string[] {
  return [...new Set([...(urls ?? []), ...(legacy ? [legacy] : [])])].filter((value) => {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  });
}
