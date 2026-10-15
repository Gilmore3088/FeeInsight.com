import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";

/**
 * A city's median for one fee (#1178): the statistics contract's median of one value per
 * institution, and none below MIN_INSTITUTIONS_FOR_MEDIAN, the floor /methodology states for
 * every median. City pages (/fees/city) call this instead of keeping their own floor or mean.
 *
 * Pass one value per institution, each already that institution's value under the contract
 * (its median amount, or its highest tier for overdraft), as `getCityInstitutions` reads them.
 * Kept free of database imports so client components can use it; the median matches
 * `computeStats` in `src/lib/data-store/fees.ts` (linear between the middle two, to the cent),
 * and `city-median.test.ts` holds the two together.
 */
export function cityMedian(valuesPerInstitution: readonly number[]): number | null {
  const sorted = valuesPerInstitution.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (sorted.length < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
  const idx = (sorted.length - 1) / 2;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const median = sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  return Math.round(median * 100) / 100;
}

/** True when a city has enough institutions publishing a fee to show a median for it. */
export function hasCityMedian(institutionCount: number): boolean {
  return institutionCount >= MIN_INSTITUTIONS_FOR_MEDIAN;
}
