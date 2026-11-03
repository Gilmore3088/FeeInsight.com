import { checkFeeCategory } from "@/lib/fee-category-guard";
import { inPlaceTierName, scopedTierName, TIERLESS_CATEGORIES, tierLines, tierOfRead, withoutTierScope, type PriceTier, type TierGroup } from "@/lib/tiered-price";
import { passesDarwinChecks } from "./layout";
import type { ExtractedFeeCandidate, HeldFeeCandidate } from "./rules";

/**
 * Knox v183 (#1092, #1110, #1026; owner's audit Nov 3, First National Bank of Moose Lake 3457, document
 * 35684, artifact 33778): a fee priced in tiers by a threshold is read as one fee per tier, each named with
 * its own condition, and a tier group Knox cannot read in full is held, never sent to Darwin one tier short.
 *
 * Knox's name builders drop every figure as a price, so "$30.00 or less – Overdraft fee per item per
 * presentment. | $15.00 per item" was named "or less – Overdraft fee per item per presentment" (raw 760358,
 * refused by Darwin's category guard as a waiver threshold) and "More than $30.00 – Overdraft fee per item
 * per presentment. | $30.00 per item" lost its condition ("Overdraft fee per item per presentment", raw
 * 760359), which went live as the bank's only overdraft price (live 116685).
 *
 * After every reader, each read that is one tier of a group (`tierOfRead` in `@/lib/tiered-price`: two or
 * more prices of one fee, each under its own balance, amount or count condition) is renamed to its fee's
 * name with its condition in brackets (`scopedTierName`): "Overdraft fee per item per presentment
 * (overdraft balance $30.00 or less)" $15 and "Overdraft fee per item per presentment (overdraft balance
 * more than $30.00)" $30. Its category is unchanged and must accept the new name (the guard reads the name
 * without its own tier bracket, v110), and its price must sit in Darwin's range. A tier the page prints
 * on the same fee's line or row that no reader read gets a read of its own under the same category. When
 * any tier of a group still has no read that passes, or the group's reads sit in two categories, every
 * read of that group is held (`tier_incomplete`) for review instead of sending fewer than all its tiers
 * to Darwin. A cap, a waiver threshold, a rate's minimum, a $0 band, one price under every condition and two fees on one line
 * (clauses that each name their own fee) are no tiers and are left
 * alone, and so are monthly maintenance and minimum balance reads, whose balance conditions are each account's
 * own (`TIERLESS_CATEGORIES`).
 */

export interface TierNameResult {
  candidates: ExtractedFeeCandidate[];
  held: HeldFeeCandidate[];
  /** Reads renamed to their tier's scoped name. */
  renamed: number;
  /** Reads added for a tier no reader read. */
  added: number;
  /** Reads held as `tier_incomplete`. */
  heldIncomplete: number;
}

/** The checks Darwin runs on the name and price, with the guard reading the scoped name as it will at verify. */
export function tierReadPasses(canonicalHint: string, feeName: string, amount: number): boolean {
  return checkFeeCategory(canonicalHint, feeName, { amount }).ok && passesDarwinChecks(canonicalHint, withoutTierScope(feeName, amount), amount);
}

const tierKey = (tier: PriceTier) => `${tier.line}:${tier.price}`;

interface GroupReads {
  group: TierGroup;
  /** Index into the candidates of each read of the group. */
  reads: number[];
  /** Tiers with a read that passes under its scoped name. */
  covered: Set<string>;
}

/** See the module note. Pure: returns new arrays and leaves the inputs unchanged. */
export function withTierNames(
  candidates: readonly ExtractedFeeCandidate[],
  held: readonly HeldFeeCandidate[],
  sourceText: string,
): TierNameResult {
  const out = [...candidates];
  const outHeld = [...held];
  const result: TierNameResult = { candidates: out, held: outHeld, renamed: 0, added: 0, heldIncomplete: 0 };
  if (!/\$\s?\d[\s\S]*\$\s?\d|\d\s*\+|\bor\s+more\b|\d\s*(?:-|–|to)\s*\d/i.test(sourceText)) return result;
  const lines = tierLines(sourceText);
  const groups = new Map<number, GroupReads>();
  const groupOf = (group: TierGroup) => {
    const key = group.tiers[0].line;
    const found = groups.get(key) ?? { group, reads: [], covered: new Set<string>() };
    groups.set(key, found);
    return found;
  };
  for (let at = 0; at < out.length; at++) {
    const read = out[at];
    if (TIERLESS_CATEGORIES.has(read.canonicalHint)) continue;
    const found = tierOfRead(lines, read.excerpt, read.amount);
    if (!found) continue;
    const entry = groupOf(found.group);
    entry.reads.push(at);
    // The figure back in the name's own slot ("Cashier's checks over $1,000.00 per item"), else the condition in brackets.
    const inPlace = found.group.sameLine ? null : inPlaceTierName(read.feeName, found.tier);
    const bracketed = scopedTierName(read.feeName, found.tier, found.group);
    const scoped = [inPlace, bracketed].find((name): name is string => name != null && tierReadPasses(read.canonicalHint, name, read.amount));
    if (!scoped) continue;
    if (scoped !== read.feeName) {
      out[at] = { ...read, feeName: scoped };
      result.renamed++;
    }
    entry.covered.add(tierKey(found.tier));
  }
  const incomplete = new Set<number>();
  const coveredTier = (excerpt: string, amount: number | null) => {
    const found = amount != null ? tierOfRead(lines, excerpt, amount) : null;
    return found != null && (groups.get(found.group.tiers[0].line)?.covered.has(tierKey(found.tier)) ?? false);
  };
  for (const [key, entry] of groups) {
    const categories = new Set(entry.reads.map((at) => out[at].canonicalHint));
    if (categories.size !== 1) {
      incomplete.add(key);
      continue;
    }
    // The template for a missing tier is a read whose own tier passed under its scoped name.
    const template = entry.reads.map((at) => out[at]).find((read) => {
      const found = tierOfRead(lines, read.excerpt, read.amount);
      return found != null && entry.covered.has(tierKey(found.tier));
    });
    for (const tier of template ? entry.group.tiers : []) {
      if (!template) break;
      if (entry.covered.has(tierKey(tier))) continue;
      // Another read of this tier's line at this price, in any category, is that tier's own decision.
      const onLine = out.some((read) => {
        const found = tierOfRead(lines, read.excerpt, read.amount);
        return found != null && tierKey(found.tier) === tierKey(tier);
      });
      if (onLine) continue;
      const base = withoutTierScope(template.feeName, template.amount);
      const name = scopedTierName(base, tier, entry.group);
      if (!name || !tierReadPasses(template.canonicalHint, name, tier.price)) continue;
      out.push({ ...template, feeName: name, amount: tier.price, excerpt: lines[tier.line].trim(), confidence: Math.min(template.confidence, 0.85) });
      entry.reads.push(out.length - 1);
      entry.covered.add(tierKey(tier));
      result.added++;
    }
    if (entry.covered.size < entry.group.tiers.length) incomplete.add(key);
  }
  // An untraced hold of a tier a passing read now covers is that read again, under a cut name.
  for (let at = outHeld.length - 1; at >= 0; at--) {
    const row = outHeld[at];
    if (row.shape === "untraced" && row.canonicalHint && !TIERLESS_CATEGORIES.has(row.canonicalHint) && coveredTier(row.excerpt, row.amount)) outHeld.splice(at, 1);
  }
  if (incomplete.size === 0) return result;
  const holding = new Set<number>();
  for (const key of incomplete) for (const at of groups.get(key)!.reads) holding.add(at);
  for (const at of [...holding].sort((a, b) => b - a)) {
    const read = out[at];
    outHeld.push({
      shape: "tier_incomplete",
      feeName: read.feeName,
      amount: read.amount,
      amountMax: null,
      percent: null,
      frequency: read.frequency,
      canonicalHint: read.canonicalHint,
      excerpt: read.excerpt,
    });
    out.splice(at, 1);
    result.heldIncomplete++;
  }
  return result;
}
