import { HAMILTON_NAV, HAMILTON_WIRE_NAV } from "@/lib/hamilton/navigation";
import { PRODUCT_NAME } from "@/lib/constants";

/** Plain data shared by the server nav shell and its client islands. */
export const PUBLIC_NAV_ITEMS = [
  { label: "Find your bank", href: "/institutions" },
  { label: PRODUCT_NAME, href: "/fees" },
  { label: "Market data", href: "/research" },
  { label: "Guides", href: "/guides" },
  { label: "Reports", href: "/reports" },
  { label: "Hamilton", href: "/for-institutions" },
] as const;

/**
 * Public items the desktop header groups under one "Explore data" menu so the bar stays
 * scannable. The mobile drawer still lists them individually.
 */
export const EXPLORE_NAV_LABEL = "Explore data";
export const EXPLORE_NAV_HREFS: readonly string[] = ["/fees", "/research", "/guides"];

export const PRICING_NAV = { label: "Pricing", href: "/subscribe" } as const;

export const PRO_NAV_ITEMS = [...HAMILTON_NAV.filter((item) => item.label !== "Admin"), HAMILTON_WIRE_NAV];

/**
 * The one navy button for signed-out visitors, repeating the homepage's primary action: look
 * up an institution and see where its fees stand (site v3, James 2026-10-14). Reports and
 * Hamilton each have their own nav item.
 */
export const REQUEST_REPORT_NAV = { label: "See where your fees stand", href: "/institutions" } as const;

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Which items the chrome shows. Signed-out and free users see the public items (plus
 * Pricing); Pro users see the Hamilton workspace items.
 */
export function navItemsFor(session: { signedIn: boolean; isPro?: boolean } | null): NavItem[] {
  if (session?.isPro) return [...PRO_NAV_ITEMS];
  return [...PUBLIC_NAV_ITEMS, PRICING_NAV];
}

/** True for the section a path belongs to (`/guides` for `/guides/overdraft-fees`). */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = href.split("#")[0];
  return pathname === path || pathname.startsWith(`${path}/`);
}
