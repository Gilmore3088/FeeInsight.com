import { createHash, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { withCheckoutLock } from "@/lib/data-store/checkout-intents";
import { lockBillingCustomer, readSubscriptionState } from "./subscription-state";

const REQUEST = { timeout: 8_000, maxNetworkRetries: 0 } as const;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const REVIEW = "An earlier checkout needs review. Please contact support before trying another payment.";
const EXISTING = "You already have a subscription or payment in progress. Manage it from your account instead of paying again.";
export type GuardedCheckoutResult = { url: string } | { error: string };

/** Semantic identity excludes return paths; repeat visits must reuse the first request body. */
export function checkoutFingerprint(params: Stripe.Checkout.SessionCreateParams): string {
  return createHash("sha256").update(JSON.stringify({
    customer: params.customer,
    lines: params.line_items,
    metadata: Object.fromEntries(Object.entries(params.metadata ?? {}).filter(([key]) =>
      ["user_id", "pro_tier", "pro_plan", "institution_id", "organization", "tier_picked_by_buyer"].includes(key),
    ).sort(([a], [b]) => a.localeCompare(b))),
  })).digest("hex");
}

async function openSubscriptionCheckouts(stripe: Stripe, customer: string) {
  const sessions: Stripe.Checkout.Session[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 3; page++) {
    const result = await stripe.checkout.sessions.list({ customer, status: "open", limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    }, REQUEST);
    sessions.push(...result.data.filter((session) => session.mode === "subscription"));
    if (!result.has_more) return sessions;
    const next = result.data.at(-1)?.id;
    if (!next || seen.has(next)) break;
    seen.add(next); cursor = next;
  }
  throw new Error("Checkout inventory is incomplete; refusing a second purchase");
}

/** Two transactions are intentional: the reservation must survive an interrupted API call.
 * No browser-supplied idempotency key, no time-bucket key, and no fresh key on a network error.
 */
export async function createGuardedCheckout(
  userId: number, customerId: string, parameters: Stripe.Checkout.SessionCreateParams,
): Promise<GuardedCheckoutResult> {
  if (parameters.mode !== "subscription" || parameters.customer !== customerId || parameters.metadata?.user_id !== String(userId)) {
    throw new Error("Checkout parameters do not match the authenticated owner");
  }
  const fingerprint = checkoutFingerprint(parameters);
  const stripe = getStripe();
  for (let pass = 0; pass < 2; pass++) {
    await withCheckoutLock(userId, async (store) => {
      if (await store.current()) return;
      const id = randomUUID();
      await store.reserve({ id, customer_id: customerId, fingerprint,
        parameters: { ...parameters, metadata: { ...parameters.metadata, checkout_intent: id } },
      });
    });
    const result = await withCheckoutLock(userId, async (store): Promise<GuardedCheckoutResult | null> => {
      const intent = await store.current();
      if (!intent || intent.customer_id !== customerId || intent.state === "review") return { error: REVIEW };
      await lockBillingCustomer(store.tx, customerId);
      // R02 distinguishes incomplete/past-due from canceled; both must block a new purchase.
      if (await readSubscriptionState(customerId, stripe) !== "canceled") return { error: EXISTING };
      let session: Stripe.Checkout.Session;
      if (intent.session_id) {
        session = await stripe.checkout.sessions.retrieve(intent.session_id, {}, REQUEST);
      } else {
        if (Date.now() - new Date(intent.created_at).getTime() >= RETRY_WINDOW_MS) {
          await store.review(intent.id); return { error: REVIEW };
        }
        const open = await openSubscriptionCheckouts(stripe, customerId);
        // Protect checkouts made before this migration, and never silently expire unrelated sessions.
        if (open.some((item) => item.metadata?.checkout_intent !== intent.id)) return { error: EXISTING };
        session = open.find((item) => item.metadata?.checkout_intent === intent.id)
          ?? await stripe.checkout.sessions.create(intent.parameters, { ...REQUEST, idempotencyKey: `pro-checkout/${intent.id}` });
        await store.session(intent.id, session.id);
      }
      const owner = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (owner !== customerId || session.mode !== "subscription" || session.metadata?.checkout_intent !== intent.id) {
        await store.review(intent.id); return { error: REVIEW };
      }
      if (session.status === "expired") { await store.retire(intent.id); return null; }
      if (session.status === "complete") {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId, {}, REQUEST);
          if (sub.status === "canceled" || sub.status === "incomplete_expired") {
            await store.retire(intent.id); return null;
          }
        }
        return { error: EXISTING };
      }
      if (session.status !== "open" || !session.url) return { error: REVIEW };
      if (intent.fingerprint !== fingerprint) {
        // The buyer changed institution/plan. Only replace a positively expired unpaid session.
        const expired = await stripe.checkout.sessions.expire(session.id, {}, REQUEST);
        if (expired.status !== "expired") return { error: EXISTING };
        await store.retire(intent.id); return null;
      }
      return { url: session.url };
    });
    if (result) return result;
  }
  return { error: "Checkout changed while you were signing up. Please retry once from your account." };
}
