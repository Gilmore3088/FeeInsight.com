import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The Stripe events `src/lib/stripe-webhook.ts` acts on. An endpoint that misses one fails
 * silently: a paid report invoice would never open the report.
 */
const HANDLED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
];

const WEBHOOK_PATH = "/api/webhooks/stripe";

/**
 * Read-only admin check of the Stripe webhook endpoint that points at this site: its status
 * and which handled events it does not send. Changes nothing in Stripe.
 */
async function handleGET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const endpoints = await getStripe().webhookEndpoints.list({ limit: 100 });
    const checked = endpoints.data
      .filter((endpoint) => endpoint.url.includes(WEBHOOK_PATH))
      .map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        status: endpoint.status,
        livemode: endpoint.livemode,
        missing: endpoint.enabled_events.includes("*")
          ? []
          : HANDLED_STRIPE_EVENTS.filter((name) => !endpoint.enabled_events.includes(name as never)),
        enabledEvents: endpoint.enabled_events,
      }));
    // A disabled endpoint receives nothing, so only the enabled ones decide ok (the retired
    // fly.dev endpoint stays listed, disabled, and must not turn a correct setup red).
    const enabled = checked.filter((endpoint) => endpoint.status === "enabled");
    const ok = enabled.length > 0 && enabled.every((endpoint) => endpoint.missing.length === 0);
    return NextResponse.json({ ok, endpoints: checked, checkedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export const GET = withApiRoutePolicy("api.admin.stripe.webhook_check", "GET", handleGET);
