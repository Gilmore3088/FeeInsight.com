/**
 * Asset tiers as typed dollar facts (#1077). The writer sees a peer group's or an institution's
 * asset tier as a code ("community_large") or as prose ("$1B to $10B"), so a bound it repeats
 * ("credit unions under $10 billion") had nothing to trace to and held the answer. Every tier code
 * found in the evidence becomes a fact with its minimum and maximum assets in USD, which the
 * figure check traces like any other figure. A figure that is not one of these bounds still holds.
 *
 * Pure and client-safe: no database imports.
 */

import { FDIC_TIER_BREAKPOINTS } from "@/lib/fed-districts";

/**
 * Each tier's assets in dollars, [minimum, maximum) with null for no upper bound. The stored
 * segment codes (institution_sources.asset_size_tier, regulatory/fdic.ts assetSizeTier) come first;
 * the FDIC call-report codes (fed-districts.ts) add the ones the segments do not use. "regional" is
 * listed as the stored segment ($10B to $50B), but the same code is the FDIC tier ($10B to $250B) in
 * call-report reads (by_tier views), so a fact for it states only the shared minimum
 * (AMBIGUOUS_UPPER_BOUND). The call-report peer ranking states its own FDIC bounds as dollars
 * (minimumAssetsUsd / maximumAssetsUsd).
 */
export const ASSET_TIER_DOLLAR_RANGES: Readonly<Record<string, readonly [number, number | null]>> = {
  community_small: [0, 300e6],
  community_mid: [300e6, 1e9],
  community_large: [1e9, 10e9],
  regional: [10e9, 50e9],
  large_regional: [50e9, 250e9],
  super_regional: [250e9, null],
  ...Object.fromEntries(Object.entries(FDIC_TIER_BREAKPOINTS)
    .filter(([code]) => code !== "regional")
    .map(([code, [min, max]]) => [code, [min, Number.isFinite(max) ? max : null] as const])),
};

/** The one code both vocabularies use with different upper bounds: its facts give no maximum. */
const AMBIGUOUS_UPPER_BOUND: ReadonlySet<string> = new Set(["regional"]);

/** Every nonzero bound of every tier, ascending: what a tier stated as a size can name. */
export const ASSET_TIER_BOUND_VALUES: readonly number[] = [...new Set(Object.values(ASSET_TIER_DOLLAR_RANGES)
  .flatMap(([min, max]) => [min, max]).filter((bound): bound is number => typeof bound === "number" && bound > 0))]
  .sort((a, b) => a - b);

/** One tier's bounds, as the figure check reads them: USD, never pooled into arithmetic. */
export interface AssetTierBoundFact {
  asset_tier: string;
  /** Absent for a tier that starts at zero: "$0" is no tier's bound. */
  min_assets?: number;
  max_assets?: number;
  unit: "USD";
  numeric_arithmetic_allowed: false;
  source: "asset tier definition";
}

/** Keys whose value names an asset tier (tool inputs, peer filters, registry rows). */
const TIER_KEY = /^(?:asset_?tiers?|asset_size_tiers?|assetSizeTiers?|tiers?)$/i;

function tierCodes(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((part) => part.trim()).filter((code) => Object.hasOwn(ASSET_TIER_DOLLAR_RANGES, code));
  if (Array.isArray(value)) return value.flatMap(tierCodes);
  return [];
}

/** The tier codes anywhere in the evidence (JSON strings included), each once, in the order found. */
export function assetTierCodesIn(data: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 12) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (text.length <= 1_000_000 && (text.startsWith("{") || text.startsWith("["))) {
        try { visit(JSON.parse(text), depth + 1); } catch { /* Plain text names no tier. */ }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (TIER_KEY.test(key)) for (const code of tierCodes(child)) found.add(code);
        visit(child, depth + 1);
      }
    }
  };
  visit(data, 0);
  return [...found];
}

/** The typed bounds of every tier the evidence names. */
export function assetTierBoundFacts(data: unknown): AssetTierBoundFact[] {
  return assetTierCodesIn(data).map((code) => {
    const [min, max] = ASSET_TIER_DOLLAR_RANGES[code];
    return { asset_tier: code, ...(min > 0 ? { min_assets: min } : {}), ...(max !== null && !AMBIGUOUS_UPPER_BOUND.has(code) ? { max_assets: max } : {}),
      unit: "USD", numeric_arithmetic_allowed: false, source: "asset tier definition" };
  });
}
