"use server";

import { createGuardedCheckout } from "@/lib/billing/checkout";
import { getStripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { ensureStripeCustomer } from "@/lib/stripe-customer";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CONTACT_EMAIL } from "@/lib/constants";
import { getProPricingInstitution } from "@/lib/data-store/pro-accounts";
import { resolveProPriceId } from "@/lib/stripe-prices";
import {
  NON_INSTITUTION_TIER,
  isProPlan,
  isProTier,
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
  /**
   * The size band the buyer picked, used only when the institution has no asset size on file
   * (James, 8 Oct 2026). The subscription is marked so "Plans to check" lists it.
   */
  pickedTier?: ProTier | null;
  returnTo?: string;
}

export type ProCheckoutResult =
  | { url: string | null; error?: undefined; needsSignIn?: undefined }
  | { url: null; error: string; needsSignIn?: boolean };

/**
 * Starts Pro checkout. The tier is worked out here from the institution's assets on file,
 * never taken from the browser, so a buyer can't pick a cheaper tier than their size.
 *
 * Buyer-facing problems come back as `{ error }` rather than a throw: production builds
 * replace a thrown server-action message with a generic one, so the buyer would never
 * see "pick your bank" or the email-us line, and a signed-out click would not reach
 * the register hand-off.
 */
export async function createCheckoutSession(input: ProCheckoutInput): Promise<ProCheckoutResult> {
  const user = await getCurrentUser();
  if (!user) return { url: null, error: "Sign in to start checkout", needsSignIn: true };

  const plan = input.plan;
  if (!isProPlan(plan)) return { url: null, error: "Unknown plan" };

  let tier: ProTier | null = null;
  let institutionId: number | null = null;
  let tierPicked = false;
  if (input.institutionId) {
    const institution = await getProPricingInstitution(Number(input.institutionId));
    if (!institution) return { url: null, error: "Pick your bank or credit union from the list" };
    tier = tierForAssets(institution.assetsThousands);
    // Assets on file always win; the buyer's band only fills a gap.
    if (!tier && isProTier(input.pickedTier)) {
      tier = input.pickedTier;
      tierPicked = true;
    }
    if (!tier) {
      return {
        url: null,
        error: `We don't have ${institution.name}'s asset size yet. Pick its size above, or email ${CONTACT_EMAIL}.`,
      };
    }
    institutionId = institution.id;
  } else if (input.otherOrganization) {
    tier = NON_INSTITUTION_TIER;
  } else {
    return { url: null, error: "Pick your bank or credit union first" };
  }

  const stripe = getStripe();
  const priceId = await resolveProPriceId(tier, plan, stripe);

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
  if (tierPicked) cancelParams.set("band", tier);
  cancelParams.set("canceled", "1");
  const cancelPath = `/subscribe?${cancelParams.toString()}`;

  // Created here, not at registration, so a free signup never depends on Stripe.
  const customerId = await ensureStripeCustomer(user);

  try {
    const result = await createGuardedCheckout(user.id, customerId, {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: customerId,
    // Banks pay against an invoice that names the institution and its address.
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    allow_promotion_codes: true,
    // A card is asked for whenever money is due; a 100%-off code (our own $0 test) skips it.
    payment_method_collection: "if_required",
    success_url: `${origin}/account/welcome?${successParams.toString()}`,
    cancel_url: `${origin}${cancelPath}`,
    metadata: {
      user_id: String(user.id),
      email: user.email || user.username,
      pro_tier: tier,
      pro_plan: plan,
      ...(institutionId ? { institution_id: String(institutionId) } : { organization: "other" }),
      ...(tierPicked ? { tier_picked_by_buyer: "true" } : {}),
      ...(hasReturnTo ? { return_to: sanitizedReturnTo } : {}),
    },
    // Kept on the subscription itself so the consultant report cap can tell who it covers.
    subscription_data: {
      metadata: {
        pro_tier: tier,
        ...(institutionId ? { institution_id: String(institutionId) } : { organization: "other" }),
        ...(tierPicked ? { tier_picked_by_buyer: "true" } : {}),
      },
    },
  });

    return "error" in result ? { url: null, error: result.error } : { url: result.url };
  } catch {
    // Ambiguous provider/database failures retain the reservation; never make a new key here.
    console.error("[checkout] Could not confirm the persisted checkout attempt", { userId: user.id });
    return { url: null, error: "We could not confirm checkout. Please retry from your account; do not submit a second payment." };
  }
}

/**
 * Opens the Stripe billing portal and comes back to `returnPath` (an internal path; anything
 * else falls back to /account), so a customer returns to the page they started from.
 */
export async function createPortalSession(returnPath = "/account"): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !user.stripe_customer_id) {
    throw new Error("No billing account found");
  }

  const stripe = getStripe();
  const origin = (await headers()).get("origin") || process.env.NEXT_PUBLIC_SITE_URL;

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${origin}${sanitizeInternalRedirect(returnPath, "/account")}`,
  });

  redirect(session.url);
}
