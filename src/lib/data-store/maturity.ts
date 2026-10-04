/**
 * Maturity rules of the statistics contract, with no database or server imports, so
 * client components (Simulate) can use them. fee-stats.ts re-exports these.
 */

export const MIN_INSTITUTIONS_FOR_MEDIAN = 5;
export const STRONG_INSTITUTION_COUNT = 20;

export type MaturityTier = "strong" | "provisional" | "insufficient";

export function maturityTier(institutionCount: number): MaturityTier {
  if (institutionCount >= STRONG_INSTITUTION_COUNT) return "strong";
  if (institutionCount >= MIN_INSTITUTIONS_FOR_MEDIAN) return "provisional";
  return "insufficient";
}
