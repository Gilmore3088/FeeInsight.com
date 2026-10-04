import { getStripe } from "@/lib/stripe";
import { sql } from "@/lib/data-store/connection";
import type { User } from "@/lib/auth";

type CustomerOwner = Pick<User, "id" | "email" | "username" | "display_name" | "stripe_customer_id">;

/**
 * The user's Stripe customer id, created on first need.
 *
 * Registration no longer creates a customer, so a free account never depends on Stripe.
 * Checkout calls this instead: one customer per user, tagged with the user id, saved with
 * a guard so two concurrent checkouts cannot leave the user pointing at different
 * customers (the loser's customer is deleted, best effort).
 */
export async function ensureStripeCustomer(user: CustomerOwner): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id;

  const stripe = getStripe();
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
