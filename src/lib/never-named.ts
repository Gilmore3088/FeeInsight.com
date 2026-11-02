/**
 * Institutions the site never names in a list a visitor or a demo sees (product rule): Frost Bank
 * and Space Coast Credit Union. They are still counted wherever a count includes them; only their
 * names are left out. Used by the institution page's cohort list (fee-share-cohort.ts
 * listablePeers) and Hamilton's fee-share screens (#2028).
 */
const NEVER_NAMED = /\bfrost bank\b|\bspace coast\b/i;

export function neverNamed(name: string): boolean {
  return NEVER_NAMED.test(name);
}
