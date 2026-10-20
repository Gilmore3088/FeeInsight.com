/**
 * One institution's comparison value for a fee category, and the percentile it rests on.
 * A leaf module with no database import, so client components (and anything they import,
 * such as the report's evidence builder) can use the same rule as the server-side medians.
 */

export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Coerce defensively: NUMERIC values that reach here as strings would otherwise
  // concatenate ("10.00" + 5 = "10.005") instead of interpolating.
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loValue = Number(sorted[lo]);
  if (lo === hi) return loValue;
  return loValue + (idx - lo) * (Number(sorted[hi]) - loValue);
}

/** Categories whose tiers are compared at the highest (standard) tier, not the median. */
export const HIGHEST_TIER_CATEGORIES: ReadonlySet<string> = new Set(["overdraft"]);

/** One institution's value for a category from its own amounts (sorted or not). */
export function institutionValue(category: string | null | undefined, amounts: number[]): number {
  const sorted = [...amounts].sort((a, b) => a - b);
  if (category && HIGHEST_TIER_CATEGORIES.has(category)) return sorted[sorted.length - 1];
  return computePercentile(sorted, 50);
}
