/**
 * Knox v103: a PDF schedule that prints a row's sibling names stacked in one cell and their prices
 * stacked in the next loses the line breaks, so the stored row runs them together:
 *
 *   "Wire Transfer (Within USA) Outgoing Incoming | $20.00 $10.00"  outgoing $20, incoming $10
 *
 * (State key 9308). This reads the names cell as a stem and the trailing list of sibling variants,
 * one word each, all from one family: a direction ("Outgoing Incoming"), a region ("Domestic
 * International") or a customer type ("Member Non-Member"). Knox pairs the variants with the
 * prices in order (`pairedPriceCandidates` in knox/rules.ts) and the shared check traces each
 * variant's price (`withJoinedPrices` in source-check.ts).
 *
 * Conservative by design (#2546, #2547, #2548 reviews): the list must be exactly `count` words long,
 * every word one family's, no word repeated, and the word before it not of that family (so the
 * list's length is not a guess); the stem must name something, hold no figure, limit or balance,
 * and not end on a joiner. Null otherwise. Pure.
 */

export type StackedVariantFamily = "flow" | "region" | "customer";

export interface StackedCellVariants {
  stem: string;
  variants: string[];
  family: StackedVariantFamily;
}

const FAMILY_WORDS: Readonly<Record<StackedVariantFamily, ReadonlySet<string>>> = {
  flow: new Set(["outgoing", "incoming", "outbound", "inbound"]),
  region: new Set(["domestic", "international", "foreign"]),
  customer: new Set([
    "member", "members", "non-member", "non-members", "nonmember", "nonmembers",
    "customer", "customers", "non-customer", "non-customers", "noncustomer", "noncustomers",
  ]),
};

const MIN_VARIANTS = 2;
const MAX_VARIANTS = 4;
/** A stem that states a limit, a balance or a condition is no fee's name. */
const STEM_REFUSALS = /[$%\d]|\b(?:max(?:imum)?|min(?:imum)?|limit|cap|balances?|over|under|up to|per day|daily|waived?|free)\b/i;
const STEM_JOINER = /(?:\b(?:and|or|for|of|to|with)|[&/+,;–-])\s*$/i;
const WORD = /^[A-Za-z][A-Za-z-]*$/;

function familyOf(word: string): StackedVariantFamily | null {
  const key = word.toLowerCase();
  for (const family of Object.keys(FAMILY_WORDS) as StackedVariantFamily[]) {
    if (FAMILY_WORDS[family].has(key)) return family;
  }
  return null;
}

/** The names cell's stem and its `count` trailing sibling variants, or null when it is not that list. */
export function stackedCellVariants(nameCell: string, count: number): StackedCellVariants | null {
  if (count < MIN_VARIANTS || count > MAX_VARIANTS) return null;
  const tokens = nameCell.replace(/\s+/g, " ").trim().split(" ");
  if (tokens.length <= count) return null;
  const variants = tokens.slice(-count);
  if (!variants.every((word) => WORD.test(word))) return null;
  const family = familyOf(variants[0]);
  if (!family || !variants.every((word) => familyOf(word) === family)) return null;
  if (new Set(variants.map((word) => word.toLowerCase())).size !== count) return null;
  const before = tokens[tokens.length - count - 1];
  if (familyOf(before) === family) return null;
  const stem = tokens.slice(0, -count).join(" ");
  if (!/[a-z]{3,}/i.test(stem) || STEM_REFUSALS.test(stem) || STEM_JOINER.test(stem)) return null;
  return { stem, variants, family };
}
