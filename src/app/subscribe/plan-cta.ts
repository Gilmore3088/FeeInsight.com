import { tierPriceLabel, type ProTier } from "@/lib/pro-tiers";

/**
 * The phone hero's price line and the pricing buttons (hero, closing card, sticky bar). With no
 * institution chosen they invite a search from the lowest tier's price. Once one is chosen (inst=)
 * the page has already priced it, so they name it with its own tier and jump to its plan card
 * (growth OS review N2). Prices come from PRO_TIERS only.
 */
export const FIND_PRICING_LABEL = "Find your institution & see pricing";
export const SEE_PLAN_LABEL = "See your plan";

export interface ChosenInstitutionPrice {
  name: string;
  tier: ProTier;
}

/** "Space Coast Federal Credit Union: $500/mo or $5,000/yr" */
export function chosenPriceLine({ name, tier }: ChosenInstitutionPrice): string {
  return `${name}: ${tierPriceLabel(tier, "monthly")} or ${tierPriceLabel(tier, "annual")}`;
}

export function pricingCtaLabel(chosen: ChosenInstitutionPrice | null): string {
  return chosen ? SEE_PLAN_LABEL : FIND_PRICING_LABEL;
}
