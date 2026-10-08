import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getStripe, getWebhookSecret } from "@/lib/stripe";
import { withTransaction } from "@/lib/data-store/connection";
import { applyStripeEvent, recordStripeEvent, type StripeEventEffects } from "@/lib/stripe-webhook";
import { sendProWelcomeEmail } from "@/lib/email/pro-welcome";
import { trackServerEvent } from "@/lib/analytics-server";
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
      if (!(await recordStripeEvent(tx, event))) return; // Already processed

      effects = await applyStripeEvent(tx, event);
    });
  } catch (err) {
    console.error(`[stripe-webhook] Failed to process ${event.id} (${event.type}):`, err);
    return new Response("Processing failed", { status: 500 });
  }

  // After commit, so a rolled-back event never sends; never throws.
  // One welcome per account checkout just activated, so it also counts activations.
  for (const welcome of (effects as StripeEventEffects | null)?.welcome ?? []) {
    await sendProWelcomeEmail(welcome);
    await trackServerEvent("pro_activated", { source: "webhook" });
  }
  for (const paid of (effects as StripeEventEffects | null)?.reportPaid ?? []) {
    await deliverPaidReport(paid);
  }
  for (const duplicate of (effects as StripeEventEffects | null)?.reportDuplicate ?? []) {
    await alertDuplicateReportPayment(duplicate);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

export const POST = withApiRoutePolicy("api.webhooks.stripe", "POST", handlePOST);
