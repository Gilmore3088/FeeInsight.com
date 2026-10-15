import { HAMILTON_NAV, HAMILTON_WIRE_NAV } from "@/lib/hamilton/navigation";
import { PRODUCT_NAME } from "@/lib/constants";

/** Plain data shared by the server nav shell and its client islands (site v3 brief 05, section 3). */
export interface NavItem {
  label: string;
  href: string;
  /** One line under the link in a header menu. */
  description?: string;
  /** Set on a header menu (Product, Resources): its columns. */
  groups?: readonly NavGroup[];
}

export interface NavGroup {
  /** Column heading; the Product menu uses the three public pillar labels. */
  heading?: string;
  items: readonly NavItem[];
}

export const FIND_INSTITUTION_NAV = { label: "Find your institution", href: "/institutions" } as const;
export const INDEX_NAV = {
  label: PRODUCT_NAME,
  href: "/fees",
  description: "Every fee by category, with its median and range",
} as const;
export const MARKET_DATA_NAV = {
  label: "Market data",
  href: "/research",
  description: "Your state, your Fed district and the nation",
} as const;
export const NATIONAL_INDEX_NAV = { label: "National fee index", href: "/research/national-fee-index" } as const;
export const HAMILTON_PAGE_NAV = {
  label: "Hamilton",
  href: "/for-institutions#hamilton",
  description: "The Pro workspace: your fees against every market layer",
} as const;

/** The Pro button everywhere outside the workspace: Hamilton is the workspace, Pro is the plan. */
export const PRO_PLANS_NAV = { label: "See Hamilton plans", href: "/subscribe" } as const;

/**
 * The Pro demo request: the contact form with the demo option chosen, never a booking link (brief 03 §4).
 * One verb site-wide (growth OS review N3): `label` follows another link ("See Hamilton plans · Or ask
 * for a demo"); `standaloneLabel` is the same words when the link stands alone.
 */
export const DEMO_REQUEST_NAV = {
  label: "Or ask for a demo",
  standaloneLabel: "Ask for a demo",
  href: "/contact?source=demo",
} as const;

/** The one navy header button for signed-out visitors: the institution search (brief 03, Q1 option B). */
export const PRIMARY_CTA_NAV = { label: "See where your fees stand", href: "/institutions" } as const;

/** Product menu: one column per public pillar label. */
export const PRODUCT_NAV_GROUPS: readonly NavGroup[] = [
  { heading: "Every fee", items: [FIND_INSTITUTION_NAV, INDEX_NAV] },
  { heading: "Every market", items: [MARKET_DATA_NAV, NATIONAL_INDEX_NAV] },
  { heading: "One workspace", items: [HAMILTON_PAGE_NAV, PRO_PLANS_NAV] },
];

export const GUIDES_NAV = { label: "Guides", href: "/guides" } as const;
export const METHODOLOGY_NAV = { label: "Methodology", href: "/methodology" } as const;
export const API_NAV = { label: "API", href: "/api-docs" } as const;

export const RESOURCES_NAV: readonly NavItem[] = [
  GUIDES_NAV,
  METHODOLOGY_NAV,
  { label: "Data sources", href: "/research/data-sources" },
  API_NAV,
  { label: "Submit a fee source", href: "/submit-fees" },
];

export const REPORTS_NAV = { label: "Reports", href: "/reports" } as const;
export const PRICING_NAV = { label: "Pricing", href: "/subscribe" } as const;

/** The signed-out and free top level: Product, Reports, Resources, Pricing. */
export const PUBLIC_NAV_ITEMS: readonly NavItem[] = [
  { label: "Product", href: "/for-institutions", groups: PRODUCT_NAV_GROUPS },
  REPORTS_NAV,
  { label: "Resources", href: "/guides", groups: [{ items: RESOURCES_NAV }] },
  PRICING_NAV,
];

/** The phone drawer: a flat list under small headings, shorter than the desktop menus. */
export const MOBILE_NAV_SECTIONS: readonly NavGroup[] = [
  { heading: "Product", items: [FIND_INSTITUTION_NAV, INDEX_NAV, MARKET_DATA_NAV, HAMILTON_PAGE_NAV] },
  { items: [REPORTS_NAV, PRICING_NAV] },
  { heading: "Resources", items: [GUIDES_NAV, METHODOLOGY_NAV, API_NAV] },
];

export const PRO_NAV_ITEMS = [...HAMILTON_NAV.filter((item) => item.label !== "Admin"), HAMILTON_WIRE_NAV];

/**
 * Which items the chrome shows. Signed-out and free users see the public items (Pricing
 * among them); Pro users see the Hamilton workspace items.
 */
export function navItemsFor(session: { signedIn: boolean; isPro?: boolean } | null): NavItem[] {
  if (session?.isPro) return [...PRO_NAV_ITEMS];
  return [...PUBLIC_NAV_ITEMS];
}

/** Every link inside a header menu, for active-state checks. */
export function menuLinks(item: NavItem): NavItem[] {
  return (item.groups ?? []).flatMap((group) => [...group.items]);
}

/** True for the section a path belongs to (`/guides` for `/guides/overdraft-fees`). */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = href.split("#")[0];
  return pathname === path || pathname.startsWith(`${path}/`);
}
