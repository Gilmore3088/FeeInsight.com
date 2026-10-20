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

/**
 * Rounds to cents, half up, on the decimal value: a median of $4.22 and $4.23 is $4.225, which
 * binary floating point holds as 4.22499..., so plain Math.round(x * 100) / 100 gave $4.22.
 */
export function roundCents(x: number): number {
  return Math.round(Number(`${x.toFixed(6)}e2`)) / 100;
}

/**
 * The statistics contract's median of a set of amounts (sorted or not): interpolated between the
 * middle two for an even count, rounded half a cent up; null for none. `computeStats` uses it.
 */
export function medianAmount(amounts: readonly number[]): number | null {
  const sorted = amounts.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length === 0 ? null : roundCents(computePercentile(sorted, 50));
}

/** Categories whose tiers are compared at the highest (standard) tier, not the median. */
export const HIGHEST_TIER_CATEGORIES: ReadonlySet<string> = new Set(["overdraft"]);

/** One institution's value for a category from its own amounts (sorted or not). */
export function institutionValue(category: string | null | undefined, amounts: number[]): number {
  const sorted = [...amounts].sort((a, b) => a - b);
  if (category && HIGHEST_TIER_CATEGORIES.has(category)) return sorted[sorted.length - 1];
  return computePercentile(sorted, 50);
}
