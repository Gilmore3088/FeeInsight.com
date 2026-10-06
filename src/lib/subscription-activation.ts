import type { User } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { acceptPendingWorkspaceInvitationsForUser } from "@/lib/hamilton/institution-membership";

/**
 * Activation fallback for when the Stripe webhook has not landed yet: if the user's
 * Stripe customer has an active subscription, mark the account active now. Used by the
 * welcome page and by /subscribe, so a payer is never offered checkout a second time.
 */
export async function activateIfPaid(
  user: Pick<User, "id" | "username" | "email" | "role" | "subscription_status" | "stripe_customer_id">,
): Promise<boolean> {
  if (user.subscription_status === "active") return false;

  if (user.stripe_customer_id) {
    try {
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      const subs = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) {
        await sql`
          UPDATE users SET subscription_status = 'active', past_due_since = NULL, role = 'premium'
          WHERE id = ${user.id} AND role NOT IN ('admin', 'analyst')`;
        await acceptPendingWorkspaceInvitationsForUser({
          userId: user.id,
          email: user.email ?? user.username,
        }).catch(() => []);
        return true;
      }
    } catch (e) {
      console.error("[welcome] Failed to verify subscription:", e);
    }
  }

  return false;
}
