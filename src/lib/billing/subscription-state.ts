import type Stripe from "stripe";
import type { sql as sqlClient } from "@/lib/data-store/connection";
import { getStripe } from "@/lib/stripe";
import { isProTier } from "@/lib/pro-tiers";
import { SUBSCRIBER_ORG_PREFIX, apiIncludedInTier } from "@/lib/api-subscriber-access";

export type SubscriptionState = "none" | "active" | "past_due" | "canceled";
type Tx = typeof sqlClient;

/** Keep the account's existing grace policy; this is not an event-ordering rule. */
export function mapSubscriptionStatus(status: string): SubscriptionState {
  switch (status) {
    case "active": case "trialing": return "active";
    case "past_due": case "unpaid": case "paused": return "past_due";
    case "canceled": case "incomplete_expired": return "canceled";
    default: return "none";
  }
}

/** A customer-wide lock must be taken before the remote read, not merely the SQL write.
 * Otherwise two deliveries can fetch different snapshots and commit them backwards.
 * The caller must pass its transaction tag, never a connection outside a transaction.
 */
export async function lockBillingCustomer(tx: Tx, customerId: string): Promise<void> {
  if (!customerId) throw new Error("A Stripe customer id is required");
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`feeinsight:billing:${customerId}`}, 0))`;
}

export interface SubscriptionSnapshot {
  state: SubscriptionState;
  /** A live (active or past-due) subscription is on a plan that includes the API. */
  apiIncluded: boolean;
}

/** Read all current subscriptions. A truncated/failed page is an error, never a downgrade. */
export async function readSubscriptionState(
  customerId: string,
  stripe: Pick<Stripe, "subscriptions"> = getStripe(),
): Promise<SubscriptionState> {
  return (await readSubscriptionSnapshot(customerId, stripe)).state;
}

/** readSubscriptionState plus whether a live subscription's plan includes the API. */
export async function readSubscriptionSnapshot(
  customerId: string,
  stripe: Pick<Stripe, "subscriptions"> = getStripe(),
): Promise<SubscriptionSnapshot> {
  let cursor: string | undefined;
  let active = false;
  let pastDue = false;
  let incomplete = false;
  let apiIncluded = false;
  const cursors = new Set<string>();
  const deadline = Date.now() + 20_000;
  for (let page = 0; page < 20; page += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Stripe subscription reconciliation timed out");
    const result = await stripe.subscriptions.list({
      customer: customerId, status: "all", limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    }, { timeout: Math.min(10_000, remaining), maxNetworkRetries: 0 });
    for (const subscription of result.data) {
      const status = mapSubscriptionStatus(subscription.status);
      active ||= status === "active";
      pastDue ||= status === "past_due";
      incomplete ||= status === "none";
      const tier = subscription.metadata?.pro_tier;
      if ((status === "active" || status === "past_due") && isProTier(tier) && apiIncludedInTier(tier)) {
        apiIncluded = true;
      }
    }
    if (!result.has_more) {
      const state = active ? "active" : pastDue ? "past_due" : incomplete ? "none" : "canceled";
      return { state, apiIncluded };
    }
    const next = result.data.at(-1)?.id;
    if (!next || cursors.has(next)) throw new Error("Stripe returned an incomplete subscription page");
    cursors.add(next);
    cursor = next;
  }
  throw new Error("Stripe subscription pagination exceeded its safety bound");
}

/** Events are reconciliation requests, not authoritative subscription snapshots.
 * Uses the caller's transaction so a failed Stripe read also rolls back event deduplication.
 * Staff roles and their subscription metadata are never changed here.
 */
export async function reconcileSubscription(tx: Tx, customerId: string): Promise<SubscriptionState> {
  await lockBillingCustomer(tx, customerId);
  const { state: status, apiIncluded } = await readSubscriptionSnapshot(customerId);
  if (status === "active") {
    await tx`
      UPDATE users
      SET subscription_status = 'active', past_due_since = NULL,
          role = CASE WHEN role = 'viewer' THEN 'premium' ELSE role END
      WHERE stripe_customer_id = ${customerId} AND role IN ('viewer', 'premium')
    `;
  } else if (status === "past_due") {
    await tx`
      UPDATE users
      SET subscription_status = 'past_due', past_due_since = COALESCE(past_due_since, NOW())
      WHERE stripe_customer_id = ${customerId} AND role IN ('viewer', 'premium')
    `;
  } else if (status === "canceled") {
    await tx`
      UPDATE users
      SET subscription_status = 'canceled', past_due_since = NULL, role = 'viewer'
      WHERE stripe_customer_id = ${customerId} AND role IN ('viewer', 'premium')
    `;
  } else {
    await tx`
      UPDATE users
      SET subscription_status = 'none', past_due_since = NULL, role = 'viewer'
      WHERE stripe_customer_id = ${customerId} AND role IN ('viewer', 'premium')
    `;
  }
  if (!apiIncluded) {
    // A plan without the API (the $150 plan, or none) turns off any subscriber key. Canceled
    // keys already stop at call time; this also covers a move down to the $150 plan.
    await tx`
      UPDATE api_keys SET revoked_at = NOW()
      WHERE revoked_at IS NULL
        AND organization_id IN (
          SELECT o.id FROM organizations o
          JOIN users u ON o.slug = ${SUBSCRIBER_ORG_PREFIX} || u.id::text
          WHERE u.stripe_customer_id = ${customerId}
        )
    `;
  }
  return status;
}

/** Report and unrelated one-off invoices cannot change Pro. Accept older Stripe payloads too. */
export function isSubscriptionInvoice(invoice: Stripe.Invoice): boolean {
  const legacy = invoice as Stripe.Invoice & { subscription?: string | { id: string } | null };
  return Boolean(
    invoice.parent?.subscription_details?.subscription || legacy.subscription,
  );
}
