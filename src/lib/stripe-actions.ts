"use server";

import { getStripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { ensureStripeCustomer } from "@/lib/stripe-customer";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function createCheckoutSession(
  priceId: string,
  mode: "subscription" | "payment" = "subscription",
  returnTo?: string,
): Promise<{ url: string | null }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  if (!priceId) throw new Error("Price ID is required");

  const stripe = getStripe();
  const origin = (await headers()).get("origin") || process.env.NEXT_PUBLIC_SITE_URL;
  const sanitizedReturnTo = returnTo
    ? sanitizeInternalRedirect(returnTo, "/account/welcome")
    : "/account/welcome";
  const hasReturnTo = sanitizedReturnTo !== "/account/welcome";
  const successParams = new URLSearchParams({ success: "true" });
  if (hasReturnTo) successParams.set("from", sanitizedReturnTo);
  const cancelParams = new URLSearchParams();
  if (hasReturnTo) cancelParams.set("from", sanitizedReturnTo);
  const cancelPath = cancelParams.toString()
    ? `/subscribe?${cancelParams.toString()}`
    : "/subscribe";

  // Created here, not at registration, so a free signup never depends on Stripe.
  const customerId = await ensureStripeCustomer(user);

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    success_url: `${origin}/account/welcome?${successParams.toString()}`,
    cancel_url: `${origin}${cancelPath}`,
    metadata: {
      user_id: String(user.id),
      email: user.email || user.username,
      ...(hasReturnTo ? { return_to: sanitizedReturnTo } : {}),
    },
  });

  return { url: session.url };
}

export async function createPortalSession(): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !user.stripe_customer_id) {
    throw new Error("No billing account found");
  }

  const stripe = getStripe();
  const origin = (await headers()).get("origin") || process.env.NEXT_PUBLIC_SITE_URL;

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${origin}/pro/settings`,
  });

  redirect(session.url);
}
