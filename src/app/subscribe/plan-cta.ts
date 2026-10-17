import { PRO_TIERS, tierPriceLabel, type ProTier } from "@/lib/pro-tiers";

/**
 * The phone hero's price line and the pricing buttons (hero, closing card, sticky bar). With no
 * institution chosen they invite a search from the lowest tier's price. Once one is chosen (inst=)
 * the page has already priced it, so they name it with its own tier and jump to its plan card
 * (growth OS review N2). Prices come from PRO_TIERS only.
 */
export const FIND_PRICING_LABEL = "Find your price";
export const SEE_PLAN_LABEL = "See your plan";
/** The closing card's heading, in the same two states as its button. */
export const FIND_PRICE_HEADING = "Find your Hamilton price";
export const CHOSEN_PLAN_HEADING = "Your Hamilton plan";

export interface ChosenInstitutionPrice {
  name: string;
  tier: ProTier;
}

/** "Space Coast Federal Credit Union: $5,000/yr or $500/mo". Annual first, the plan the page recommends. */
export function chosenPriceLine({ name, tier }: ChosenInstitutionPrice): string {
  return `${name}: ${tierPriceLabel(tier, "annual")} or ${tierPriceLabel(tier, "monthly")}`;
}

/** "From $1,500/yr or $150/mo": the lowest tier, annual first. */
export function fromPriceLine(): string {
  const lowest = PRO_TIERS[0].key;
  return `From ${tierPriceLabel(lowest, "annual")} or ${tierPriceLabel(lowest, "monthly")}`;
}

export function pricingCtaLabel(chosen: ChosenInstitutionPrice | null): string {
  return chosen ? SEE_PLAN_LABEL : FIND_PRICING_LABEL;
}

/** Once the page has priced an institution, the heading names its plan rather than asking for a search. */
export function closingHeading(chosen: ChosenInstitutionPrice | null): string {
  return chosen ? CHOSEN_PLAN_HEADING : FIND_PRICE_HEADING;
}
