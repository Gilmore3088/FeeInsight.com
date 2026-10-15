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
 * The line above /subscribe's headline for a visitor sent from a Pro page (James, 9 Oct 2026):
 * the page they wanted, placed inside Pro. The headline itself is the same for everyone, so
 * no one feature is sold as the product. A fixed list of routes; no text comes from the URL.
 * It is the page's first mention of Hamilton, so it always gives the full name (site v3 brief
 * 03 section 4: "Hamilton, the Fee Insight Pro workspace"; Hamilton is the workspace, Pro the plan).
 */
export function hamiltonFullName(siteName: string): string {
  return `Hamilton, the ${siteName} Pro workspace`;
}

const ENTRY_POINTS: { path: string; context: (siteName: string) => string }[] = [
  { path: "/pro/news", context: (site) => `Regulatory Wire is included with ${hamiltonFullName(site)}` },
  { path: "/pro/analyze", context: (site) => `Fee analysis is included with ${hamiltonFullName(site)}` },
  { path: "/pro/reports", context: (site) => `Generate reports with ${hamiltonFullName(site)}` },
  { path: "/pro/simulate", context: (site) => `Explore pricing scenarios with ${hamiltonFullName(site)}` },
  { path: "/pro/monitor", context: (site) => `Monitor published fee changes with ${hamiltonFullName(site)}` },
];

export interface SubscribeEntry {
  /** The Pro page the visitor tried to open, or null for a direct visit. */
  page: string | null;
  /** The line above the headline. */
  context: string;
}

export function subscribeEntry(from: string | null | undefined, siteName: string): SubscribeEntry {
  const page = gatedPageLabel(from);
  if (!from || !page) return { page: null, context: `Discover everything included with ${hamiltonFullName(siteName)}` };
  const path = pathOf(from);
  const entry = ENTRY_POINTS.find((point) => underPath(path, point.path));
  if (entry) return { page, context: entry.context(siteName) };
  // The workspace home is Hamilton itself.
  if (page === "Hamilton") return { page, context: hamiltonFullName(siteName) };
  return { page, context: `${page} is included with ${hamiltonFullName(siteName)}` };
}

export function subscribeReasonLine(reason: string | undefined, siteName: string, from?: string | null): string | null {
  if (reason === "activating") return "If you've just paid, Stripe can take a minute to confirm it. Refresh this page before paying again.";
  if (reason === "pro_required") {
    const page = gatedPageLabel(from);
    return page
      ? `You're one step away from ${page}. It's part of ${hamiltonFullName(siteName)}, and checkout brings you straight back to it.`
      : `Choose a plan below to open ${hamiltonFullName(siteName)}.`;
  }
  return null;
}
