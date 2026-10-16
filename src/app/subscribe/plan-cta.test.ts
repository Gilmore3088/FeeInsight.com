import { describe, expect, it } from "vitest";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { chosenPriceLine, closingHeading, FIND_PRICING_LABEL, fromPriceLine, pricingCtaLabel, SEE_PLAN_LABEL } from "./plan-cta";

describe("/subscribe pricing buttons (growth OS review N2)", () => {
  it("invites a search when no institution is chosen", () => {
    expect(pricingCtaLabel(null)).toBe(FIND_PRICING_LABEL);
    expect(FIND_PRICING_LABEL).toBe("Find your price");
    expect(closingHeading(null)).toBe("Find your Hamilton Pro price");
  });

  it("leads with the annual price, the plan the page recommends", () => {
    const lowest = PRO_TIERS[0].key;
    expect(fromPriceLine()).toBe(`From ${tierPriceLabel(lowest, "annual")} or ${tierPriceLabel(lowest, "monthly")}`);
  });

  it("names the chosen institution with its own tier price, read from PRO_TIERS", () => {
    for (const tier of PRO_TIERS) {
      const chosen = { name: "Example Credit Union", tier: tier.key };
      expect(chosenPriceLine(chosen)).toBe(
        `Example Credit Union: ${tierPriceLabel(tier.key, "annual")} or ${tierPriceLabel(tier.key, "monthly")}`,
      );
      expect(pricingCtaLabel(chosen)).toBe(SEE_PLAN_LABEL);
      // The price is already found, so the closing heading names the plan instead.
      expect(closingHeading(chosen)).toBe("Your Hamilton Pro plan");
    }
  });
});
