import { describe, expect, it } from "vitest";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { chosenPriceLine, FIND_PRICING_LABEL, pricingCtaLabel, SEE_PLAN_LABEL } from "./plan-cta";

describe("/subscribe pricing buttons (growth OS review N2)", () => {
  it("invites a search when no institution is chosen", () => {
    expect(pricingCtaLabel(null)).toBe(FIND_PRICING_LABEL);
  });

  it("names the chosen institution with its own tier price, read from PRO_TIERS", () => {
    for (const tier of PRO_TIERS) {
      const chosen = { name: "Example Credit Union", tier: tier.key };
      expect(chosenPriceLine(chosen)).toBe(
        `Example Credit Union: ${tierPriceLabel(tier.key, "monthly")} or ${tierPriceLabel(tier.key, "annual")}`,
      );
      expect(pricingCtaLabel(chosen)).toBe(SEE_PLAN_LABEL);
    }
  });
});
