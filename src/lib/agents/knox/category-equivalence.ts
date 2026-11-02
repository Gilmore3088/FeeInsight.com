/**
 * Categories that name one fee: a reader may file it under either. "$10 fee if the balance falls
 * below $1,000" is a minimum balance fee to one reader and a monthly maintenance fee to another;
 * James folded the keys' unmapped minimum balance lines into monthly maintenance (v26). One map,
 * used by Knox's answer-key gate (`answer-key-gate.ts`) and its two-read agreement
 * (`two-read-agreement.ts`), so the two never differ on what counts as the same category.
 */
export const EQUIVALENT_CATEGORIES: Readonly<Record<string, string>> = Object.freeze({ minimum_balance: "monthly_maintenance" });

/** A category under the name it is compared by. Pure. */
export function equivalentCategory(category: string): string {
  return EQUIVALENT_CATEGORIES[category] ?? category;
}

/** The two categories name one fee: equal, or equal under `EQUIVALENT_CATEGORIES`. Pure. */
export function sameEquivalentCategory(a: string, b: string): boolean {
  return equivalentCategory(a) === equivalentCategory(b);
}
