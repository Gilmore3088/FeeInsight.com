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

function pathOf(from: string): string {
  return from.split(/[?#]/)[0];
}

function underPath(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** The name of the Pro page a reader was sent from ("Regulatory Wire"), or null. */
export function gatedPageLabel(from: string | null | undefined): string | null {
  if (!from) return null;
  const path = pathOf(from);
  return GATED_PAGES.find((page) => underPath(path, page.path))?.label ?? null;
}

/**
 * What /subscribe leads with for a visitor sent from a Pro page (James, 9 Oct 2026). A fixed
 * list of routes, so no headline is ever built from URL text. `pillar` is the benefit listed
 * first on the page (ProBenefits).
 */
const ENTRY_POINTS: { path: string; headline: string; pillar: string }[] = [
  { path: "/pro/news", headline: "Unlock Regulatory Wire", pillar: "wire" },
  { path: "/pro/analyze", headline: "Unlock Hamilton analysis", pillar: "analysis" },
  { path: "/pro/reports", headline: "Create board-ready fee reports", pillar: "analysis" },
  { path: "/pro/simulate", headline: "Model potential fee changes", pillar: "analysis" },
  { path: "/pro/monitor", headline: "Monitor competitor fee activity", pillar: "intelligence" },
];

export interface SubscribeEntry {
  /** The Pro page the visitor tried to open, or null for a direct visit. */
  page: string | null;
  headline: string;
  /** ProBenefits key to list first, or null. */
  pillar: string | null;
}

export function subscribeEntry(from: string | null | undefined, siteName: string): SubscribeEntry {
  const page = gatedPageLabel(from);
  if (!from || !page) return { page: null, headline: "Know what's changing. Understand what matters.", pillar: null };
  const path = pathOf(from);
  const entry = ENTRY_POINTS.find((point) => underPath(path, point.path));
  return entry
    ? { page, headline: entry.headline, pillar: entry.pillar }
    : { page, headline: `Unlock ${siteName} Pro`, pillar: "intelligence" };
}

export function subscribeReasonLine(reason: string | undefined, siteName: string, from?: string | null): string | null {
  if (reason === "activating") return "If you've just paid, Stripe can take a minute to confirm it. Refresh this page before paying again.";
  if (reason === "pro_required") {
    const page = gatedPageLabel(from);
    return page
      ? `You're one step away from ${page}. It's part of ${siteName} Pro, and checkout brings you straight back to it.`
      : `Hamilton is part of ${siteName} Pro. Choose a plan below to open it.`;
  }
  return null;
}
