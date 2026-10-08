import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { resolveProPriceId } from "@/lib/stripe-prices";
import { PRO_TIERS, tierPriceLabel, type ProPlan } from "@/lib/pro-tiers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin check for Pro checkout. Sets up any missing tier price (src/lib/stripe-prices.ts,
 * idempotent), then opens one Stripe checkout per price and expires it at once, so each tier
 * is proven to reach Stripe's payment page without anyone paying.
 */
async function handleGET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripe();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://feeinsight.com";
  const results = [];
  for (const tier of PRO_TIERS) {
    for (const plan of ["monthly", "annual"] as ProPlan[]) {
      try {
        const priceId = await resolveProPriceId(tier.key, plan, stripe);
        const price = await stripe.prices.retrieve(priceId);
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${origin}/account/welcome`,
          cancel_url: `${origin}/subscribe`,
          metadata: { kind: "admin_checkout_check" },
        });
        await stripe.checkout.sessions.expire(session.id);
        results.push({
          tier: tier.key,
          plan,
          expected: tierPriceLabel(tier.key, plan),
          priceId,
          lookupKey: price.lookup_key,
          stripeAmount: (price.unit_amount ?? 0) / 100,
          interval: price.recurring?.interval ?? null,
          livemode: price.livemode,
          checkoutOpened: Boolean(session.url),
          checkoutExpired: true,
        });
      } catch (err) {
        results.push({ tier: tier.key, plan, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  const ok = results.every((result) => "checkoutOpened" in result && result.checkoutOpened);
  return NextResponse.json({ ok, results, checkedAt: new Date().toISOString() });
}

export const GET = withApiRoutePolicy("api.admin.stripe.pro_prices", "GET", handleGET);
