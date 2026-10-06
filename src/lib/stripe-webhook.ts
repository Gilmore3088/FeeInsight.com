import type Stripe from "stripe";
import type { sql as sqlClient } from "@/lib/data-store/connection";
import { acceptPendingWorkspaceInvitationsForUser } from "@/lib/hamilton/institution-membership";
import type { User } from "@/lib/auth";
import { REPORT_PAYMENT_KIND } from "@/lib/leads/report-payment";

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
  const leadId = Number(session.metadata?.lead_id);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) return;
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
    case "checkout.session.completed": {
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
      for (const user of activated) {
        await acceptPendingWorkspaceInvitationsForUser({ userId: user.id, email: user.email ?? email ?? "" }, tx);
        const to = user.email ?? email;
        if (to) effects.welcome.push({ email: to, name: user.display_name ?? null });
      }
      return;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (!customerId) return;
      const status = mapStripeStatus(sub.status);
      if (status === "canceled") {
        await endSubscription(tx, customerId);
        return;
      }
      const updated = status === "active"
        ? await tx<Array<{ id: number; email: string | null }>>`
            UPDATE users
            SET subscription_status = 'active',
                past_due_since = NULL,
                role = CASE WHEN role = 'viewer' THEN 'premium' ELSE role END
            WHERE stripe_customer_id = ${customerId}
            RETURNING id, email
          `
        : await tx<Array<{ id: number; email: string | null }>>`
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
        for (const user of updated) {
          await acceptPendingWorkspaceInvitationsForUser({ userId: user.id, email: user.email }, tx);
        }
      }
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = customerIdOf(sub.customer);
      if (customerId) await endSubscription(tx, customerId);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
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
