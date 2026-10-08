import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { isProTier, proTier } from "@/lib/pro-tiers";

export interface BillingSummary {
  /** "Annual" or "Monthly" (or Stripe's interval when it is something else). */
  cadence: string;
  /** "$3,000 per year" from the live price; null when Stripe has no unit amount. */
  priceLabel: string | null;
  /** "Over $2B in assets" or "Consultant"; null when checkout left no tier. */
  tierLabel: string | null;
  /** The date the plan renews, or ends when it is set to cancel. */
  periodEnd: Date | null;
  cancelsAtPeriodEnd: boolean;
}

const CADENCE: Record<string, string> = { year: "Annual", month: "Monthly" };
const PER: Record<string, string> = { year: "per year", month: "per month" };

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** What the account page says about a subscription; pure so it can be tested without Stripe. */
export function summarizeSubscription(subscription: Stripe.Subscription): BillingSummary {
  const item = subscription.items.data[0];
  const price = item?.price;
  const interval = price?.recurring?.interval ?? "";
  const tier = subscription.metadata?.pro_tier;
  const endSeconds = subscription.cancel_at ?? item?.current_period_end ?? null;
  return {
    cadence: CADENCE[interval] ?? interval,
    priceLabel:
      price?.unit_amount != null ? `${money(price.unit_amount, price.currency)} ${PER[interval] ?? `per ${interval}`}` : null,
    tierLabel:
      subscription.metadata?.organization === "other"
        ? "Consultant"
        : isProTier(tier)
          ? proTier(tier).assetsLabel
          : null,
    periodEnd: endSeconds ? new Date(endSeconds * 1000) : null,
    cancelsAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at != null,
  };
}

/**
 * The customer's current subscription, read live from Stripe. Returns null when there is
 * none or Stripe can't be reached; the account page then shows the plan without details.
 */
export async function getBillingSummary(customerId: string | null | undefined): Promise<BillingSummary | null> {
  if (!customerId) return null;
  try {
    const subscriptions = await getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 5 });
    const current = subscriptions.data.find((s) => ["active", "trialing", "past_due"].includes(s.status));
    return current ? summarizeSubscription(current) : null;
  } catch (error) {
    console.error("[billing-summary] Stripe read failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}
