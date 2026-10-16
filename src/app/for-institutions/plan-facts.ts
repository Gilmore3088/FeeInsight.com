import { PRO_TIERS, annualMonthsFree, tierPriceLabel, type ProTierDef } from "@/lib/pro-tiers";

/**
 * The plan facts the page states, read from PRO_TIERS so no price is typed twice: the lowest
 * monthly price ("$150/mo") and the months annual billing leaves free, or 0 when the tiers
 * disagree (the page then says nothing about it).
 */
export function proPlanFacts(tiers: readonly ProTierDef[] = PRO_TIERS): { fromMonthly: string; freeMonths: number } {
  const lowest = [...tiers].sort((a, b) => a.monthlyUsd - b.monthlyUsd)[0];
  const free = tiers.map((tier) => annualMonthsFree(tier.key));
  const same = free.length > 0 && free.every((months) => months === free[0] && months > 0);
  return { fromMonthly: tierPriceLabel(lowest.key, "monthly"), freeMonths: same ? free[0] : 0 };
}
