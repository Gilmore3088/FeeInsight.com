import type { User } from "@/lib/auth";

/**
 * Why /pro sent someone to /subscribe, so the page can say so in one line. "activating" when
 * they have a Stripe customer and no ended subscription: they may have just paid and the
 * webhook hasn't landed yet.
 */
export type SubscribeReason = "pro_required" | "activating";

export function subscribeReason(user: Pick<User, "stripe_customer_id" | "subscription_status">): SubscribeReason {
  return user.stripe_customer_id && user.subscription_status !== "canceled" ? "activating" : "pro_required";
}

export function subscribeReasonLine(reason: string | undefined, siteName: string): string | null {
  if (reason === "activating") return "If you've just paid, Stripe can take a minute to confirm it. Refresh this page before paying again.";
  if (reason === "pro_required") return `Hamilton is part of ${siteName} Pro. Choose a plan below to open it.`;
  return null;
}
