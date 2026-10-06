/**
 * Webhook-lag fallback: a user who has paid can reach Fee Insight before Stripe's webhook marks
 * them active. Ask Stripe directly and activate them, so they're never shown checkout again
 * (funnel audit finding 9: a paid user bounced from /pro to /subscribe could pay twice).
 * Returns true when this call activated the user.
 */
import { sql } from "@/lib/data-store/connection";
import type { User } from "@/lib/auth";
import { acceptPendingWorkspaceInvitationsForUser } from "@/lib/hamilton/institution-membership";

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
      console.error("[billing] Failed to verify subscription:", e);
    }
  }

  return false;
}

