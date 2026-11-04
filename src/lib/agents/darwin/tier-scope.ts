import { namesTier, TIERLESS_CATEGORIES, tierLines, tierOfRead, type PriceTier, type TierGroup } from "@/lib/tiered-price";

/**
 * Darwin's verify (#1110, #1026; owner's audit Nov 3): a read that is one tier of a fee priced by a
 * threshold is judged on its whole source row, not its name alone. When Knox's own line (the excerpt) or
 * the line the shared check traced is one tier of a group (`tierOfRead` in `@/lib/tiered-price`: two or
 * more prices of one fee, each under its own balance, amount or count condition) and the read's name does
 * not state that tier's condition, verify holds it as `tier_unscoped`: published under that name it
 * would stand for the bank's only price. First National Bank of Moose Lake's "Overdraft fee per item per
 * presentment" $30 (raw 760359, live 116685) is the $30 tier "More than $30.00", beside a $15 tier for an
 * overdraft balance of $30.00 or less. The shared check answers `tiered_fee` for such a row, which verify
 * counts as stated, so no earlier check read the condition. Pure.
 */
export interface UnscopedTierInput {
  feeName: string;
  /** The category verify judges the read under; monthly maintenance and minimum balance have no tiers here. */
  canonicalFeeKey: string | null;
  amount: number | null;
  /** Knox's own line (its excerpt). */
  excerpt: string | null | undefined;
  /** The line the shared check traced the fee to, when it traced one. */
  tracedLine?: string | null;
  documentText: string | null | undefined;
}

export interface UnscopedTier {
  group: TierGroup;
  tier: PriceTier;
}

export function unscopedTierRead(input: UnscopedTierInput): UnscopedTier | null {
  if (!input.documentText || input.amount == null || input.amount <= 0) return null;
  if (input.canonicalFeeKey && TIERLESS_CATEGORIES.has(input.canonicalFeeKey)) return null;
  const lines = tierLines(input.documentText);
  for (const line of [input.excerpt, input.tracedLine]) {
    const found = line ? tierOfRead(lines, line, input.amount) : null;
    if (found) return namesTier(input.feeName, found.tier) ? null : found;
  }
  return null;
}
