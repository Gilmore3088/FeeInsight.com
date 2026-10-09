import type { User } from "@/lib/auth";
import { HAMILTON_ACCOUNT_NAV, HAMILTON_REFERENCE_NAV } from "@/lib/hamilton/navigation";
import { PRO_EXTRA_FEATURES, PRO_WORKSPACE_FEATURES } from "@/lib/hamilton/pro-features";

/**
 * Why /pro sent someone to /subscribe, so the page can say so in one line. "activating" when
 * they have a Stripe customer and no ended subscription: they may have just paid and the
 * webhook hasn't landed yet.
 */
export type SubscribeReason = "pro_required" | "activating";

export function subscribeReason(user: Pick<User, "stripe_customer_id" | "subscription_status">): SubscribeReason {
  return user.stripe_customer_id && user.subscription_status !== "canceled" ? "activating" : "pro_required";
}

/** Pro pages by path, longest first, so /pro/news/digest is named before /pro/news. */
const GATED_PAGES: { path: string; label: string }[] = [
  ...PRO_WORKSPACE_FEATURES,
  ...PRO_EXTRA_FEATURES.filter((feature) => feature.key !== "csv"),
  ...HAMILTON_ACCOUNT_NAV,
  ...HAMILTON_REFERENCE_NAV,
]
  // The workspace home is Hamilton itself; "This month" is only its tab name.
  .map((page) => ({ path: page.href, label: page.href === "/pro/hamilton" ? "Hamilton" : page.label }))
  .sort((a, b) => b.path.length - a.path.length);

/** The name of the Pro page a reader was sent from ("Regulatory Wire"), or null. */
export function gatedPageLabel(from: string | null | undefined): string | null {
  if (!from) return null;
  const path = from.split(/[?#]/)[0];
  const match = GATED_PAGES.find((page) => path === page.path || path.startsWith(`${page.path}/`));
  return match?.label ?? null;
}

export function subscribeReasonLine(reason: string | undefined, siteName: string, from?: string | null): string | null {
  if (reason === "activating") return "If you've just paid, Stripe can take a minute to confirm it. Refresh this page before paying again.";
  if (reason === "pro_required") {
    const page = gatedPageLabel(from);
    return page
      ? `${page} is part of ${siteName} Pro. Pick a plan below to open it.`
      : `Hamilton is part of ${siteName} Pro. Choose a plan below to open it.`;
  }
  return null;
}
