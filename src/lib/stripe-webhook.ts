import type Stripe from "stripe";
import type { sql as sqlClient } from "@/lib/data-store/connection";
import type { User } from "@/lib/auth";
import { REPORT_PAYMENT_KIND } from "@/lib/leads/report-payment";
import { anchorPaidInstitution, paidInstitutionId } from "@/lib/pro-checkout-institution";
import { getStripe } from "@/lib/stripe";

type Tx = typeof sqlClient;
export type SubscriptionStatus = User["subscription_status"];

/**
 * Stripe subscription status to ours. A paused or unpaid subscription is past due (the
 * account still exists and can recover); canceled and expired are ended.
 */
export function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

function customerIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Ends a subscription: status canceled and, for paying roles, back to a free viewer, so
 * the role never claims Pro after Pro has ended. Staff roles are never touched.
 */
async function endSubscription(tx: Tx, customerId: string): Promise<void> {
  await tx`
    UPDATE users
    SET subscription_status = 'canceled', past_due_since = NULL, role = 'viewer'
    WHERE stripe_customer_id = ${customerId} AND role IN ('viewer', 'premium')
  `;
}

/**
 * True when the customer still has another active or trialing subscription, so ending one
 * subscription (James moving a plan by starting a new one and cancelling the old) never
 * takes Pro away from someone who is still paying. A Stripe error throws, so the webhook
 * returns 500 and Stripe redelivers rather than ending Pro on a guess.
 */
async function hasOtherLiveSubscription(customerId: string, endedId: string | undefined): Promise<boolean> {
  const listed = await getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  return listed.data.some((s) => s.id !== endedId && (s.status === "active" || s.status === "trialing"));
}

async function endSubscriptionUnlessAnother(tx: Tx, customerId: string, endedId: string | undefined): Promise<void> {
  if (await hasOtherLiveSubscription(customerId, endedId)) return;
  await endSubscription(tx, customerId);
}

/** A paid institution report request, for the emails sent after commit. */
export interface ReportPaidEffect {
  leadId: number;
  name: string;
  email: string;
  institutionId: number | null;
  cents: number;
  checkoutSessionId: string;
}

/**
 * What the caller does after the transaction commits: a welcome email per new Pro, and
 * James's alert plus the requester's report link per paid institution report.
 */
export interface StripeEventEffects {
  welcome: Array<{ email: string; name: string | null }>;
  reportPaid: ReportPaidEffect[];
  /** A second paid session for a request already paid: James refunds it in Stripe. */
  reportDuplicate: Array<{ leadId: number; cents: number; checkoutSessionId: string }>;
}

/**
 * Records the event id, returning false when it was already processed. Matches prod's
 * stripe_events (bigint id, unique stripe_event_id, event_type, processed_at); the old
 * insert named columns prod never had, so every delivery failed with a 500.
 */
export async function recordStripeEvent(tx: Tx, event: Stripe.Event): Promise<boolean> {
  const inserted = await tx`
    INSERT INTO stripe_events (stripe_event_id, event_type)
    VALUES (${event.id}, ${event.type})
    ON CONFLICT (stripe_event_id) DO NOTHING
    RETURNING id
  `;
  return inserted.length > 0;
}

/**
 * Applies one verified, not-yet-seen Stripe event inside the caller's transaction.
 * `past_due_since` starts the 7-day payment grace window on the first failure (never
 * reset by later failures) and clears whenever the subscription is active or ends.
 */
export async function applyStripeEvent(tx: Tx, event: Stripe.Event): Promise<StripeEventEffects> {
  const effects: StripeEventEffects = { welcome: [], reportPaid: [], reportDuplicate: [] };
  await applyEvent(tx, event, effects);
  return effects;
}

/**
 * An institution report paid by card (/pay/report). Marks the request Paid once; a
 * redelivered or second session for an already-paid request changes nothing. The amount
 * recorded is what Stripe charged, which is what James is told.
 */
async function applyReportPayment(tx: Tx, session: Stripe.Checkout.Session, effects: StripeEventEffects): Promise<void> {
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  await markReportPaid(tx, { leadId: Number(session.metadata?.lead_id), ref: session.id, cents: session.amount_total ?? 0 }, effects);
}

/**
 * An institution report paid on a Stripe invoice (/pay/report "Get an invoice"): bank
 * transfer or card on Stripe's invoice page. The invoice id stands where a checkout id would.
 */
async function applyReportInvoicePayment(tx: Tx, invoice: Stripe.Invoice, effects: StripeEventEffects): Promise<void> {
  if (invoice.status !== "paid" || !invoice.id) return;
  await markReportPaid(tx, { leadId: Number(invoice.metadata?.lead_id), ref: invoice.id, cents: invoice.amount_paid ?? 0 }, effects);
}

async function markReportPaid(
  tx: Tx,
  payment: { leadId: number; ref: string; cents: number },
  effects: StripeEventEffects,
): Promise<void> {
  const { leadId, ref } = payment;
  if (!Number.isSafeInteger(leadId) || leadId <= 0) return;
  const session = { id: ref, amount_total: payment.cents };
  const paid = await tx<Array<{ id: string | number; name: string; email: string; quote_institution_id: string | number | null }>>`
    UPDATE leads
    SET paid_at = NOW(), status = 'paid', stripe_checkout_session_id = ${session.id}
    WHERE id = ${leadId} AND paid_at IS NULL
    RETURNING id, name, email, quote_institution_id
  `;
  if (paid.length === 0) {
    const [earlier] = await tx<Array<{ stripe_checkout_session_id: string | null }>>`
      SELECT stripe_checkout_session_id FROM leads WHERE id = ${leadId} AND paid_at IS NOT NULL
    `;
    if (earlier && earlier.stripe_checkout_session_id !== session.id) {
      effects.reportDuplicate.push({ leadId, cents: session.amount_total ?? 0, checkoutSessionId: session.id });
    }
    return;
  }
  for (const lead of paid) {
    const institutionId = lead.quote_institution_id === null ? null : Number(lead.quote_institution_id);
    effects.reportPaid.push({
      leadId: Number(lead.id),
      name: lead.name,
      email: lead.email,
      institutionId: Number.isSafeInteger(institutionId) && (institutionId ?? 0) > 0 ? institutionId : null,
      cents: session.amount_total ?? 0,
      checkoutSessionId: session.id,
    });
  }
}

async function applyEvent(tx: Tx, event: Stripe.Event, effects: StripeEventEffects): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    // A delayed payment method (bank debit) completes checkout unpaid, then sends this once the money clears.
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind === REPORT_PAYMENT_KIND) {
        await applyReportPayment(tx, session, effects);
        return;
      }
      const customerId = customerIdOf(session.customer);
      const email = session.customer_email || session.customer_details?.email || session.metadata?.email;
      const userId = Number(session.metadata?.user_id);
      if (!customerId) return;
      // Pro is a subscription; a completed one-time payment must never grant it.
      if (session.mode !== "subscription") return;
      // Pro starts when the money does: an unpaid session waits for async_payment_succeeded.
      if (session.payment_status === "unpaid") return;

      // Prefer the user id checkout was started for; fall back to the email for sessions
      // created before user ids were attached.
      const activated = Number.isInteger(userId) && userId > 0
        ? await tx<Array<{ id: number; email: string | null; display_name: string | null }>>`
            UPDATE users
            SET subscription_status = 'active', past_due_since = NULL, role = 'premium', stripe_customer_id = ${customerId}
            WHERE id = ${userId} AND role NOT IN ('admin', 'analyst')
            RETURNING id, email, display_name
          `
        : email
          ? await tx<Array<{ id: number; email: string | null; display_name: string | null }>>`
              UPDATE users
              SET subscription_status = 'active', past_due_since = NULL, role = 'premium', stripe_customer_id = ${customerId}
              WHERE (email = ${email} OR username = ${email}) AND role NOT IN ('admin', 'analyst')
              RETURNING id, email, display_name
            `
          : [];
      const institutionId = paidInstitutionId(session.metadata);
      for (const user of activated) {
        const to = user.email ?? email;
        if (to) effects.welcome.push({ email: to, name: user.display_name ?? null });
        if (institutionId) {
          await anchorPaidInstitution(tx, { userId: user.id, institutionId, note: `Filed at Pro checkout (${session.id}).` });
        }
      }
      return;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      const status = mapStripeStatus(sub.status);
      if (status === "canceled") {
        await endSubscriptionUnlessAnother(tx, customerId, sub.id);
        return;
      }
      // A paid subscription never accepts workspace invitations by email: a seat becomes
      // active only through the signed invite link (/workspace-invite).
      if (status === "active") {
        await tx`
          UPDATE users
          SET subscription_status = 'active',
              past_due_since = NULL,
              role = CASE WHEN role = 'viewer' THEN 'premium' ELSE role END
          WHERE stripe_customer_id = ${customerId}
        `;
      } else {
        await tx`
          UPDATE users
          SET subscription_status = ${status},
              past_due_since = CASE
                WHEN ${status} = 'past_due' THEN COALESCE(past_due_since, NOW())
                ELSE NULL
              END
          WHERE stripe_customer_id = ${customerId}
        `;
      }
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (customerId) await endSubscriptionUnlessAnother(tx, customerId, sub.id);
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.metadata?.kind === REPORT_PAYMENT_KIND) await applyReportInvoicePayment(tx, invoice, effects);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // A report invoice is not a subscription; a failed bank transfer never touches Pro.
      if (invoice.metadata?.kind === REPORT_PAYMENT_KIND) return;
      const customerId = customerIdOf(invoice.customer as string | { id: string } | null);
      if (customerId) {
        await tx`
          UPDATE users
          SET subscription_status = 'past_due',
              past_due_since = COALESCE(past_due_since, NOW())
          WHERE stripe_customer_id = ${customerId}
        `;
      }
      return;
    }
  }
}
