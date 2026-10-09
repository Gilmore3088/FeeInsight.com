import { getStripe } from "@/lib/stripe";
import { sql } from "@/lib/data-store/connection";
import type { User } from "@/lib/auth";

type CustomerOwner = Pick<User, "id" | "email" | "username" | "display_name" | "stripe_customer_id">;

/** False only when Stripe says this customer is missing or deleted for the current key. */
async function customerUsable(customerId: string): Promise<boolean> {
  try {
    const customer = await getStripe().customers.retrieve(customerId);
    return !("deleted" in customer && customer.deleted);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "resource_missing") return false;
    throw error;
  }
}

/**
 * The user's Stripe customer id, created on first need.
 *
 * Registration no longer creates a customer, so a free account never depends on Stripe.
 * Checkout calls this instead: one customer per user, tagged with the user id, saved with
 * a guard so two concurrent checkouts cannot leave the user pointing at different
 * customers (the loser's customer is deleted, best effort).
 */
export async function ensureStripeCustomer(user: CustomerOwner): Promise<string> {
  const stripe = getStripe();

  // A saved id can belong to the other mode (a test-mode customer after the switch to live
  // keys) or to a customer deleted in the dashboard; checkout then fails with "No such
  // customer". Such an id is dropped and a fresh customer made for the current account.
  if (user.stripe_customer_id) {
    if (await customerUsable(user.stripe_customer_id)) return user.stripe_customer_id;
    await sql`
      UPDATE users SET stripe_customer_id = NULL
      WHERE id = ${user.id} AND stripe_customer_id = ${user.stripe_customer_id}
    `;
  }

  const created = await stripe.customers.create({
    email: user.email || user.username,
    name: user.display_name || undefined,
    metadata: { user_id: String(user.id) },
  });

  const saved = await sql<{ stripe_customer_id: string }[]>`
    UPDATE users SET stripe_customer_id = ${created.id}
    WHERE id = ${user.id} AND stripe_customer_id IS NULL
    RETURNING stripe_customer_id
  `;
  if (saved.length > 0) return created.id;

  // Another request saved a customer first: use theirs and discard ours.
  const [row] = await sql<{ stripe_customer_id: string | null }[]>`
    SELECT stripe_customer_id FROM users WHERE id = ${user.id}
  `;
  try {
    await stripe.customers.del(created.id);
  } catch {
    // best effort
  }
  if (!row?.stripe_customer_id) throw new Error("Could not attach a billing account to this user");
  return row.stripe_customer_id;
}
