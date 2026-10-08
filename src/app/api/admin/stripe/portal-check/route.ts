import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin check for the Stripe customer portal behind "Manage billing". Reads the default
 * portal configuration (what a customer can do there and which Terms/Privacy links it shows),
 * sets those links when missing, then opens one portal session for an existing customer to prove
 * the button works. Nothing is charged. Stripe's customer email settings are not readable
 * through its API.
 */
async function handleGET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripe();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://feeinsight.com";

  let configuration = null;
  let linksSet = false;
  try {
    const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
    let config = configs.data[0];
    // The portal shows our Privacy and Terms links. Set them when missing; idempotent.
    if (config && (!config.business_profile.privacy_policy_url || !config.business_profile.terms_of_service_url)) {
      config = await stripe.billingPortal.configurations.update(config.id, {
        business_profile: {
          privacy_policy_url: config.business_profile.privacy_policy_url || `${origin}/privacy`,
          terms_of_service_url: config.business_profile.terms_of_service_url || `${origin}/terms`,
        },
      });
      linksSet = true;
    }
    if (config) {
      configuration = {
        id: config.id,
        livemode: config.livemode,
        active: config.active,
        cancelSubscriptions: config.features.subscription_cancel.enabled,
        cancelMode: config.features.subscription_cancel.mode,
        updatePaymentMethod: config.features.payment_method_update.enabled,
        invoiceHistory: config.features.invoice_history.enabled,
        updateCustomerDetails: config.features.customer_update.enabled,
        switchPlans: config.features.subscription_update.enabled,
        privacyPolicyUrl: config.business_profile.privacy_policy_url ?? null,
        termsOfServiceUrl: config.business_profile.terms_of_service_url ?? null,
      };
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  // Prefer the admin's own customer; otherwise the most recent one. No customer is created.
  // A session needs a customer that exists for this key; ids saved before the switch to live
  // keys are test-mode ones, so the check asks Stripe for a live customer instead.
  let portal: { customer: string; opened: boolean } | { error: string } | { skipped: string };
  try {
    const customerId = (await stripe.customers.list({ limit: 1 })).data[0]?.id ?? null;
    if (customerId) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${origin}/account`,
      });
      portal = { customer: customerId, opened: Boolean(session.url) };
    } else {
      portal = { skipped: "No customer exists in this Stripe mode yet; the first checkout creates one." };
    }
  } catch (err) {
    portal = { error: err instanceof Error ? err.message : String(err) };
  }

  const ok = Boolean(
    configuration?.active &&
      configuration.cancelSubscriptions &&
      configuration.updatePaymentMethod &&
      configuration.invoiceHistory &&
      configuration.privacyPolicyUrl &&
      configuration.termsOfServiceUrl &&
      !("error" in portal) &&
      !("opened" in portal && !portal.opened),
  );
  return NextResponse.json({
    ok,
    configuration,
    linksSet,
    portal,
    emails: "Stripe's receipt and failed-payment email settings are not readable through its API.",
    checkedAt: new Date().toISOString(),
  });
}

export const GET = withApiRoutePolicy("api.admin.stripe.portal_check", "GET", handleGET);
