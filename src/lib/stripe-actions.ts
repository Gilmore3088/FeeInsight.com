"use server";

import { getStripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { ensureStripeCustomer } from "@/lib/stripe-customer";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CONTACT_EMAIL } from "@/lib/constants";
import { getProPricingInstitution } from "@/lib/data-store/pro-accounts";
import {
  NON_INSTITUTION_TIER,
  isProPlan,
  proPriceId,
  tierForAssets,
  type ProPlan,
  type ProTier,
} from "@/lib/pro-tiers";

export interface ProCheckoutInput {
  plan: ProPlan;
  /** The bank or credit union the plan covers; its assets set the tier. */
  institutionId?: number | null;
  /** A consultant or other organization with no assets of its own. */
  otherOrganization?: boolean;
  returnTo?: string;
}

/**
 * Starts Pro checkout. The tier is worked out here from the institution's assets on file,
 * never taken from the browser, so a buyer can't pick a cheaper tier than their size.
 */
export async function createCheckoutSession(input: ProCheckoutInput): Promise<{ url: string | null }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const plan = input.plan;
  if (!isProPlan(plan)) throw new Error("Unknown plan");

  let tier: ProTier | null = null;
  let institutionId: number | null = null;
  if (input.institutionId) {
    const institution = await getProPricingInstitution(Number(input.institutionId));
    if (!institution) throw new Error("Pick your bank or credit union from the list");
    tier = tierForAssets(institution.assetsThousands);
    if (!tier) {
      throw new Error(`We don't have ${institution.name}'s asset size yet. Email ${CONTACT_EMAIL} and we'll set up your plan.`);
    }
    institutionId = institution.id;
  } else if (input.otherOrganization) {
    tier = NON_INSTITUTION_TIER;
  } else {
    throw new Error("Pick your bank or credit union first");
  }

  const priceId = proPriceId(tier, plan);
  if (!priceId) throw new Error(`Checkout for this plan isn't open yet. Email ${CONTACT_EMAIL} to sign up.`);

  const stripe = getStripe();
  const origin = (await headers()).get("origin") || process.env.NEXT_PUBLIC_SITE_URL;
  const sanitizedReturnTo = input.returnTo
    ? sanitizeInternalRedirect(input.returnTo, "/account/welcome")
    : "/account/welcome";
  const hasReturnTo = sanitizedReturnTo !== "/account/welcome";
  const successParams = new URLSearchParams({ success: "true" });
  if (hasReturnTo) successParams.set("from", sanitizedReturnTo);
  const cancelParams = new URLSearchParams();
  if (hasReturnTo) cancelParams.set("from", sanitizedReturnTo);
  if (institutionId) cancelParams.set("inst", String(institutionId));
  else cancelParams.set("org", "other");
  const cancelPath = `/subscribe?${cancelParams.toString()}`;

  // Created here, not at registration, so a free signup never depends on Stripe.
  const customerId = await ensureStripeCustomer(user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    success_url: `${origin}/account/welcome?${successParams.toString()}`,
    cancel_url: `${origin}${cancelPath}`,
    metadata: {
      user_id: String(user.id),
      email: user.email || user.username,
      pro_tier: tier,
      pro_plan: plan,
      ...(institutionId ? { institution_id: String(institutionId) } : { organization: "other" }),
      ...(hasReturnTo ? { return_to: sanitizedReturnTo } : {}),
    },
    // Kept on the subscription itself so the consultant report cap can tell who it covers.
    subscription_data: {
      metadata: {
        pro_tier: tier,
        ...(institutionId ? { institution_id: String(institutionId) } : { organization: "other" }),
      },
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
