import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getStripe, getWebhookSecret } from "@/lib/stripe";
import { withTransaction } from "@/lib/data-store/connection";
import { applyStripeEvent, type StripeEventEffects } from "@/lib/stripe-webhook";
import { sendProWelcomeEmail } from "@/lib/email/pro-welcome";
import { alertDuplicateReportPayment, deliverPaidReport } from "@/lib/leads/report-paid";
import { headers } from "next/headers";
import type Stripe from "stripe";

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

  let effects: StripeEventEffects | null = null;
  try {
    await withTransaction(async (tx) => {
      // Atomic idempotency: INSERT ON CONFLICT DO NOTHING
      const result = await tx`
        INSERT INTO stripe_events (id, event_type, stripe_customer_id, payload_json)
        VALUES (${event.id}, ${event.type}, ${extractCustomerId(event)}, ${JSON.stringify(event)})
        ON CONFLICT (id) DO NOTHING
      `;

      if (result.count === 0) return; // Already processed

      effects = await applyStripeEvent(tx, event);
    });
  } catch (err) {
    console.error(`[stripe-webhook] Failed to process ${event.id} (${event.type}):`, err);
    return new Response("Processing failed", { status: 500 });
  }

  // After commit, so a rolled-back event never sends; never throws.
  for (const welcome of (effects as StripeEventEffects | null)?.welcome ?? []) {
    await sendProWelcomeEmail(welcome);
  }
  for (const paid of (effects as StripeEventEffects | null)?.reportPaid ?? []) {
    await deliverPaidReport(paid);
  }
  for (const duplicate of (effects as StripeEventEffects | null)?.reportDuplicate ?? []) {
    await alertDuplicateReportPayment(duplicate);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const customer = obj.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in (customer as object)) {
    return (customer as { id: string }).id;
  }
  return null;
}

export const POST = withApiRoutePolicy("api.webhooks.stripe", "POST", handlePOST);
