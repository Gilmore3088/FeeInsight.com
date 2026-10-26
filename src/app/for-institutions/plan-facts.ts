import { PRO_TIERS, tierAmountLabel, type ProTierDef } from "@/lib/pro-tiers";

/**
 * The plan fact the page states, read from PRO_TIERS so no price is typed twice: the lowest
 * annual price ("$1,500"). Pro is sold annually only (James, Oct 26).
 */
export function proPlanFacts(tiers: readonly ProTierDef[] = PRO_TIERS): { fromAnnual: string } {
  const lowest = [...tiers].sort((a, b) => a.annualUsd - b.annualUsd)[0];
  return { fromAnnual: tierAmountLabel(lowest.key) };
}
