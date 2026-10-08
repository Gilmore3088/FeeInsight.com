import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

import { summarizeSubscription } from "./billing-summary";

function sub(overrides: Partial<Stripe.Subscription> = {}, interval = "year", amount = 300000): Stripe.Subscription {
  return {
    cancel_at: null,
    cancel_at_period_end: false,
    metadata: { pro_tier: "mid", institution_id: "12" },
    items: {
      data: [
        {
          current_period_end: 1_822_000_000,
          price: { unit_amount: amount, currency: "usd", recurring: { interval } },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("summarizeSubscription", () => {
  it("reads cadence, live price, tier and renewal date", () => {
    expect(summarizeSubscription(sub())).toEqual({
      cadence: "Annual",
      priceLabel: "$3,000 per year",
      tierLabel: "$500M to $2B in assets",
      periodEnd: new Date(1_822_000_000 * 1000),
      cancelsAtPeriodEnd: false,
    });
  });

  it("names the consultant plan and a monthly price", () => {
    const summary = summarizeSubscription(sub({ metadata: { organization: "other", pro_tier: "mid" } }, "month", 30000));
    expect(summary.tierLabel).toBe("Consultant");
    expect(summary.priceLabel).toBe("$300 per month");
    expect(summary.cadence).toBe("Monthly");
  });

  it("shows the end date once the plan is set to cancel", () => {
    const summary = summarizeSubscription(sub({ cancel_at_period_end: true }));
    expect(summary.cancelsAtPeriodEnd).toBe(true);
    const scheduled = summarizeSubscription(sub({ cancel_at: 1_810_000_000 }));
    expect(scheduled.cancelsAtPeriodEnd).toBe(true);
    expect(scheduled.periodEnd).toEqual(new Date(1_810_000_000 * 1000));
  });
});
