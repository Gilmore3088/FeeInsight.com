import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getStripe, getWebhookSecret } from "@/lib/stripe";
import { withTransaction } from "@/lib/data-store/connection";
import { applyStripeEvent, recordStripeEvent } from "@/lib/stripe-webhook";
import { stagePaymentEmails, drainPaymentEmails, paymentEmailStatus } from "@/lib/billing/payment-delivery";
import { headers } from "next/headers";
import { trackServerEvent } from "@/lib/analytics-server";
import type Stripe from "stripe";

export const maxDuration = 60;

async function handlePOST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      getWebhookSecret()
    );
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err instanceof Error ? err.message : err);
    return new Response("Invalid signature", { status: 400 });
  }

  console.log(`[stripe-webhook] Received ${event.type} (${event.id})`);

  let activated = 0;
  try {
    await withTransaction(async (tx) => {
      if (!(await recordStripeEvent(tx, event))) return; // Already processed

      const effects = await applyStripeEvent(tx, event);
      await stagePaymentEmails(tx, event.id, effects);
      activated = effects.welcome.length;
    });
  } catch (err) {
    console.error(`[stripe-webhook] Failed to process ${event.id} (${event.type}):`, err);
    return new Response("Processing failed", { status: 500 });
  }

  // Preserve activation telemetry once per freshly committed event, not per email retry.
  for (let i = 0; i < activated; i++) {
    await trackServerEvent("pro_activated", { source: "webhook" }).catch(() => {});
  }

  // A duplicate event still drains its already-committed delivery obligations.
  try {
    await drainPaymentEmails(event.id);
    const status = await paymentEmailStatus(event.id);
    if (status.pending > 0) return new Response("Delivery pending; retry safely", { status: 503, headers: { "Retry-After": "30" } });
  } catch {
    console.error("[stripe-webhook] Delivery recovery pending", { eventId: event.id });
    return new Response("Delivery recovery pending", { status: 503 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

export const POST = withApiRoutePolicy("api.webhooks.stripe", "POST", handlePOST);
