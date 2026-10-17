/**
 * The shared rule for an institution that publishes several amounts for one fee (James's
 * review, 2026-10-17): show the range and the named account prices, and compare at the one
 * value the index itself counts for that institution (`institutionValue` in
 * src/lib/data-store/fee-stats.ts: the middle of its prices, the highest for overdraft). The
 * words below label that value on screen, so /check, the institution profile and the reports
 * say it the same way.
 *
 * Pure and import-free so client components can use it; the caller passes the value
 * `institutionValue` returned and whether the category counts its highest tier
 * (`HIGHEST_TIER_CATEGORIES`).
 */

export interface AccountPrice {
  account: string;
  amount: number;
}

function money(n: number): string {
  return Number.isInteger(n)
    ? `$${n.toLocaleString("en-US")}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$7.95 to $8.95, depending on account"; one price as itself; null for none. */
export function priceRangeText(amounts: number[]): string | null {
  if (amounts.length === 0) return null;
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  return low === high ? money(low) : `${money(low)} to ${money(high)}, depending on account`;
}

/**
 * "Compared at $8.45, the middle of its prices", or for a highest-tier fee (overdraft)
 * "Compared at $35, its standard fee, the highest of its prices". Null when it publishes one
 * distinct price: the price shown is then the price compared and needs no label.
 */
export function comparedAtText(input: { value: number; amounts: number[]; highestTier: boolean }): string | null {
  if (new Set(input.amounts).size < 2) return null;
  return input.highestTier
    ? `Compared at ${money(input.value)}, its standard fee, the highest of its prices`
    : `Compared at ${money(input.value)}, the middle of its prices`;
}

/**
 * "Carefree Checking $7.95 · Everyday Checking $8.95": the named account prices, lowest first,
 * one entry per account with its own full range ("Premier Checking $10 to $25") when it lists
 * several. Pass every amount the range is built from: when any distinct amount has no named
 * account the list would contradict the range, so it returns null and the range stands alone.
 */
export function accountPricesText(prices: AccountPrice[], amounts?: number[]): string | null {
  if (prices.length === 0) return null;
  if (amounts && amounts.some((amount) => !prices.some((p) => p.amount === amount))) return null;
  const byAccount = new Map<string, number[]>();
  for (const p of prices) byAccount.set(p.account, [...(byAccount.get(p.account) ?? []), p.amount]);
  return [...byAccount.entries()]
    .map(([account, list]) => ({ account, low: Math.min(...list), high: Math.max(...list) }))
    .sort((a, b) => a.low - b.low || a.high - b.high || a.account.localeCompare(b.account))
    .map(({ account, low, high }) => `${account} ${low === high ? money(low) : `${money(low)} to ${money(high)}`}`)
    .join(" \u00b7 ");
}
