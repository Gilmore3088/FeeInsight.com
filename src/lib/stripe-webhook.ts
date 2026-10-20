import type Stripe from "stripe";
import type { sql as sqlClient } from "@/lib/data-store/connection";
import { REPORT_PAYMENT_KIND } from "@/lib/leads/report-payment";
import { anchorPaidInstitution, paidInstitutionId } from "@/lib/pro-checkout-institution";
import { getStripe } from "@/lib/stripe";
import { isSubscriptionInvoice, lockBillingCustomer, mapSubscriptionStatus, reconcileSubscription } from "@/lib/billing/subscription-state";

type Tx = typeof sqlClient;
export const mapStripeStatus = mapSubscriptionStatus;

function customerIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
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
  /** Keyed by checkout session and user when staged, so one checkout welcomes its buyer once. */
  welcome: Array<{ email: string; name: string | null; checkoutSessionId: string; userId: number }>;
  reportPaid: ReportPaidEffect[];
  /** A second paid session for a request already paid: James refunds it in Stripe. */
  reportDuplicate: Array<{ leadId: number; cents: number; checkoutSessionId: string }>;
  /**
   * A paid request's charge refunded in full; James is told. `revoked` is true only when the
   * charge was the recorded payment, which closes the report link; a duplicate's refund doesn't.
   */
  reportRefunded: Array<{ leadId: number; name: string; email: string; cents: number; chargeId: string; revoked: boolean }>;
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
  const effects: StripeEventEffects = { welcome: [], reportPaid: [], reportDuplicate: [], reportRefunded: [] };
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

/** A charge's report request, and how it was found: on the charge or PaymentIntent, or on its customer. */
interface ChargeReport {
  leadId: number;
  via: "intent" | "customer";
}

/**
 * The report request a charge paid for. Card checkout copies kind and lead_id onto the
 * PaymentIntent (payment_intent_data.metadata); older charges are looked up there. A report
 * paid on a Stripe invoice carries them on the invoice and on the customer made for it
 * (/pay/report "Get an invoice"), never on the charge or PaymentIntent, so the customer is
 * read last (#1973). A Stripe error throws, so the webhook returns 500 and Stripe redelivers.
 */
async function reportForCharge(charge: Stripe.Charge): Promise<ChargeReport | null> {
  let metadata: Stripe.Metadata | null | undefined = charge.metadata;
  let via: ChargeReport["via"] = "intent";
  if (metadata?.kind !== REPORT_PAYMENT_KIND && charge.payment_intent) {
    const intent =
      typeof charge.payment_intent === "string"
        ? await getStripe().paymentIntents.retrieve(charge.payment_intent)
        : charge.payment_intent;
    metadata = intent.metadata;
  }
  if (metadata?.kind !== REPORT_PAYMENT_KIND && charge.customer) {
    const customer =
      typeof charge.customer === "string" ? await getStripe().customers.retrieve(charge.customer) : charge.customer;
    // A deleted customer keeps no metadata.
    if (!("deleted" in customer && customer.deleted)) metadata = (customer as Stripe.Customer).metadata;
    via = "customer";
  }
  if (metadata?.kind !== REPORT_PAYMENT_KIND) return null;
  const leadId = Number(metadata.lead_id);
  return Number.isSafeInteger(leadId) && leadId > 0 ? { leadId, via } : null;
}

/**
 * The payment a refunded charge belongs to, in the form `leads.stripe_checkout_session_id`
 * records it: the checkout session for a card payment, the invoice for an invoice payment.
 * One Stripe call, chosen by where the report metadata was found; null when Stripe has none.
 */
async function paymentRefForCharge(charge: Stripe.Charge, via: ChargeReport["via"]): Promise<string | null> {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return null;
  if (via === "customer") {
    const payments = await getStripe().invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intentId }, limit: 1 });
    const invoice = payments.data[0]?.invoice;
    return (typeof invoice === "string" ? invoice : invoice?.id) ?? null;
  }
  const sessions = await getStripe().checkout.sessions.list({ payment_intent: intentId, limit: 1 });
  return sessions.data[0]?.id ?? null;
}

/**
 * A full refund of a paid report. Only a refund of the recorded payment closes the request:
 * it reads Refunded and its link stops opening. Refunding a second, duplicate payment for the
 * same request (flagged by markReportPaid) leaves the report open; James still gets the alert.
 */
async function markReportRefunded(tx: Tx, charge: Stripe.Charge, report: ChargeReport, effects: StripeEventEffects): Promise<void> {
  const { leadId } = report;
  const ref = await paymentRefForCharge(charge, report.via);
  const refunded = ref
    ? await tx<Array<{ id: string | number; name: string; email: string }>>`
        UPDATE leads
        SET refunded_at = NOW(), status = 'refunded'
        WHERE id = ${leadId} AND paid_at IS NOT NULL AND refunded_at IS NULL
          AND stripe_checkout_session_id = ${ref}
        RETURNING id, name, email
      `
    : [];
  for (const lead of refunded) {
    effects.reportRefunded.push({ leadId: Number(lead.id), name: lead.name, email: lead.email, cents: charge.amount_refunded, chargeId: charge.id, revoked: true });
  }
  if (refunded.length > 0) return;
  const [lead] = await tx<Array<{ id: string | number; name: string; email: string; stripe_checkout_session_id: string | null }>>`
    SELECT id, name, email, stripe_checkout_session_id FROM leads WHERE id = ${leadId} AND paid_at IS NOT NULL
  `;
  // Nothing new when the request was never paid, or this payment was already refunded.
  if (!lead || (ref !== null && lead.stripe_checkout_session_id === ref)) return;
  effects.reportRefunded.push({ leadId: Number(lead.id), name: lead.name, email: lead.email, cents: charge.amount_refunded, chargeId: charge.id, revoked: false });
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

      // Link only the account checkout belongs to. An old checkout cannot replace a
      // different customer id saved for the account since then.
      await lockBillingCustomer(tx, customerId);
      const linked = Number.isInteger(userId) && userId > 0
        ? await tx<Array<{ id: number | string; email: string | null; display_name: string | null }>>`
            UPDATE users SET stripe_customer_id = ${customerId}
            WHERE id = ${userId} AND role IN ('viewer', 'premium')
              AND (stripe_customer_id IS NULL OR stripe_customer_id = ${customerId})
            RETURNING id, email, display_name
          `
        : email
          ? await tx<Array<{ id: number | string; email: string | null; display_name: string | null }>>`
              UPDATE users SET stripe_customer_id = ${customerId}
              WHERE (email = ${email} OR username = ${email}) AND role IN ('viewer', 'premium')
                AND (stripe_customer_id IS NULL OR stripe_customer_id = ${customerId})
              RETURNING id, email, display_name
            `
          : [];
      const status = await reconcileSubscription(tx, customerId);
      if (status !== "active") return;
      const institutionId = paidInstitutionId(session.metadata);
      for (const user of linked) {
        const to = user.email ?? email;
        // Not gated on the stored status: /account/welcome, invoice.paid and
        // customer.subscription.created usually mark the account active first (#1972). The
        // outbox keys this by session and user, so a replay or a second event for the same
        // checkout (completed, then async_payment_succeeded) never welcomes twice.
        if (to) {
          effects.welcome.push({ email: to, name: user.display_name ?? null, checkoutSessionId: session.id ?? event.id, userId: Number(user.id) });
        }
        if (institutionId) {
          await anchorPaidInstitution(tx, { userId: Number(user.id), institutionId, note: `Filed at Pro checkout (${session.id}).` });
        }
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (customerId) await reconcileSubscription(tx, customerId);
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.metadata?.kind === REPORT_PAYMENT_KIND) {
        await applyReportInvoicePayment(tx, invoice, effects);
      } else if (isSubscriptionInvoice(invoice)) {
        const customerId = customerIdOf(invoice.customer);
        if (customerId) await reconcileSubscription(tx, customerId);
      }
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      // A partial refund leaves the report paid; only a full refund closes it.
      if (!charge.refunded) return;
      const report = await reportForCharge(charge);
      if (report) await markReportRefunded(tx, charge, report, effects);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // A report invoice is not a subscription; a failed bank transfer never touches Pro.
      if (invoice.metadata?.kind === REPORT_PAYMENT_KIND) return;
      if (!isSubscriptionInvoice(invoice)) return;
      const customerId = customerIdOf(invoice.customer);
      if (customerId) await reconcileSubscription(tx, customerId);
      return;
    }
  }
}
