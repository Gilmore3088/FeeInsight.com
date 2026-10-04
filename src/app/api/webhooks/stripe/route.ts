import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getStripe, getWebhookSecret } from "@/lib/stripe";
import { withTransaction } from "@/lib/data-store/connection";
import { acceptPendingWorkspaceInvitationsForUser } from "@/lib/hamilton/institution-membership";
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

  try {
    await withTransaction(async (tx) => {
      // Atomic idempotency: INSERT ON CONFLICT DO NOTHING
      const result = await tx`
        INSERT INTO stripe_events (id, event_type, stripe_customer_id, payload_json)
        VALUES (${event.id}, ${event.type}, ${extractCustomerId(event)}, ${JSON.stringify(event)})
        ON CONFLICT (id) DO NOTHING
      `;

      if (result.count === 0) return; // Already processed

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const customerId =
            typeof session.customer === "string"
              ? session.customer
              : session.customer?.id;
          const email = session.customer_email || session.metadata?.email;

          console.log(`[stripe-webhook] checkout.session.completed: customer=${customerId}, email=${email}, metadata=${JSON.stringify(session.metadata)}`);

          // Pro is a subscription; a completed one-time payment must never grant it.
          if (session.mode !== "subscription") {
            console.warn(`[stripe-webhook] ignoring non-subscription checkout (mode=${session.mode})`);
            break;
          }

          if (customerId && email) {
            const activatedUsers = await tx<Array<{ id: number; email: string | null }>>`
              UPDATE users
              SET subscription_status = 'active',
                  past_due_since = NULL,
                  role = 'premium',
                  stripe_customer_id = ${customerId}
              WHERE (email = ${email} OR username = ${email}) AND role NOT IN ('admin', 'analyst')
              RETURNING id, email
            `;
            for (const activatedUser of activatedUsers) {
              await acceptPendingWorkspaceInvitationsForUser(
                { userId: activatedUser.id, email: activatedUser.email ?? email },
                tx,
              );
            }
            console.log(`[stripe-webhook] Updated ${activatedUsers.length} user(s) for ${email}`);
          }
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer.id;
          const status = mapStripeStatus(sub.status);
          const updatedUsers = await tx<Array<{ id: number; email: string | null }>>`
            UPDATE users
               SET subscription_status = ${status},
                   past_due_since = CASE
                     WHEN ${status} = 'past_due' THEN COALESCE(past_due_since, NOW())
                     ELSE NULL
                   END
            WHERE stripe_customer_id = ${customerId}
            RETURNING id, email
          `;
          if (status === "active") {
            for (const updatedUser of updatedUsers) {
              await acceptPendingWorkspaceInvitationsForUser(
                { userId: updatedUser.id, email: updatedUser.email },
                tx,
              );
            }
          }
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const customerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer.id;
          await tx`
            UPDATE users SET subscription_status = 'canceled', past_due_since = NULL
            WHERE stripe_customer_id = ${customerId} AND role IN ('viewer', 'premium')
          `;
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId =
            typeof invoice.customer === "string"
              ? invoice.customer
              : invoice.customer?.id;
          if (customerId) {
            await tx`
              UPDATE users
                 SET subscription_status = 'past_due',
                     past_due_since = COALESCE(past_due_since, NOW())
              WHERE stripe_customer_id = ${customerId}
            `;
          }
          break;
        }
      }
    });
  } catch (err) {
    console.error(`[stripe-webhook] Failed to process ${event.id} (${event.type}):`, err);
    return new Response("Processing failed", { status: 500 });
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

type SubscriptionStatus = "none" | "active" | "past_due" | "canceled";

function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

export const POST = withApiRoutePolicy("api.webhooks.stripe", "POST", handlePOST);
