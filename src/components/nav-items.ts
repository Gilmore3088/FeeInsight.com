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
  /** Small heading over a column (Resources) or a phone-drawer section. */
  heading?: string;
  /** A Product menu card's title link, with its one line; the card's links sit under it. */
  title?: NavItem;
  /** The small drawing on a Product menu card. */
  exhibit?: "ranges" | "layers" | "ask" | "flow";
  /** The navy card: Hamilton, the paid workspace, whose first link is the plans button. */
  feature?: boolean;
  items: readonly NavItem[];
}

export const REPORTS_NAV = { label: "Reports", href: "/reports" } as const;
export const FIND_INSTITUTION_NAV = { label: "Find your institution", href: "/institutions" } as const;
export const INDEX_NAV = {
  label: PRODUCT_NAME,
  href: "/fees",
  description: "Medians and ranges by fee category",
} as const;
export const MARKET_DATA_NAV = {
  label: "Market Benchmarks",
  href: "/research",
  description: "Your state, your Fed district and the nation",
} as const;
export const NATIONAL_INDEX_NAV = { label: `${PRODUCT_NAME}: national`, href: "/research/national-fee-index" } as const;
export const STATE_DISTRICT_NAV = { label: "State and district data", href: "/research" } as const;
/**
 * The Product menu's Hamilton card names the workspace in text, without its mark; the top-level
 * header items and the footer still don't (James, 2026-10-19, docs/project/DECISIONS.md).
 * Hamilton is the paid product; "Pro" only marks who has paid, never a product name (James, 2026-10-17).
 */
export const HAMILTON_PAGE_NAV = {
  label: "Hamilton",
  href: "/for-institutions#hamilton",
  description: "Your fees against your peers, with a source for every figure.",
} as const;

/** The Pro button everywhere outside the workspace: Hamilton is the workspace, Pro is the plan. */
export const PRO_PLANS_NAV = { label: "See Hamilton plans", href: "/subscribe" } as const;

/**
 * The Pro demo request: the demo form on /for-institutions, never a booking link (brief 03 §4). One
 * destination site-wide (site audit #1952: demo links went to two places); /contact?source=demo
 * still works for old links.
 * One verb site-wide (growth OS review N3): `label` follows another link ("See Hamilton plans · Or ask
 * for a demo"); `standaloneLabel` is the same words when the link stands alone.
 */
export const DEMO_REQUEST_NAV = {
  label: "Or ask for a demo",
  standaloneLabel: "Ask for a demo",
  href: "/for-institutions#demo",
} as const;

/** The institution search, the main action inside page bodies (brief 03, Q1 option B). */
export const PRIMARY_CTA_NAV = { label: "See where your fees stand", href: "/institutions" } as const;

/** The one navy header button for signed-out visitors: the plans (James, Oct 16), since the subscription is the goal. */
export const HEADER_CTA_NAV = { label: "See plans", href: "/subscribe" } as const;

/**
 * Product menu: three cards, the free index, the market benchmarks and Hamilton (James, 2026-10-19).
 * No card claims "every fee": the index covers the schedules collected so far.
 */
export const PRODUCT_NAV_GROUPS: readonly NavGroup[] = [
  {
    title: {
      label: PRODUCT_NAME,
      href: "/fees",
      description: "Medians and ranges by fee category, from banks' and credit unions' own schedules.",
    },
    exhibit: "ranges",
    items: [FIND_INSTITUTION_NAV, { label: "National index", href: NATIONAL_INDEX_NAV.href }],
  },
  {
    title: { label: "Market Benchmarks", href: "/research", description: "Your state, your Fed district and the nation." },
    exhibit: "layers",
    items: [STATE_DISTRICT_NAV, REPORTS_NAV],
  },
  {
    title: HAMILTON_PAGE_NAV,
    exhibit: "ask",
    feature: true,
    items: [HEADER_CTA_NAV, { label: DEMO_REQUEST_NAV.standaloneLabel, href: DEMO_REQUEST_NAV.href }],
  },
];

export const GUIDES_NAV = { label: "Guides", href: "/guides" } as const;
export const METHODOLOGY_NAV = { label: "Methodology", href: "/methodology" } as const;
export const API_NAV = { label: "API", href: "/api-docs" } as const;

export const DATA_SOURCES_NAV = { label: "Data sources", href: "/research/data-sources" } as const;
export const SUBMIT_SOURCE_NAV = { label: "Submit a fee source", href: "/submit-fees" } as const;

export const RESOURCES_NAV: readonly NavItem[] = [GUIDES_NAV, METHODOLOGY_NAV, DATA_SOURCES_NAV, API_NAV, SUBMIT_SOURCE_NAV];

/** Resources menu: how the index is built first, the rest as a short list (James, 2026-10-19). */
export const RESOURCES_NAV_GROUPS: readonly NavGroup[] = [
  {
    title: {
      label: "How the index is built",
      href: METHODOLOGY_NAV.href,
      description: "Every fee starts as a bank's or credit union's own schedule.",
    },
    exhibit: "flow",
    items: [METHODOLOGY_NAV, DATA_SOURCES_NAV],
  },
  {
    heading: "More",
    items: [
      { ...GUIDES_NAV, description: "Plain-language guides to bank fees" },
      { ...API_NAV, description: "The index in your own tools" },
      { ...SUBMIT_SOURCE_NAV, description: "Send us a schedule we're missing" },
    ],
  },
];

export const PRICING_NAV = { label: "Pricing", href: "/subscribe" } as const;

/** The signed-out and free top level: Product, Reports, Resources, Pricing. */
export const PUBLIC_NAV_ITEMS: readonly NavItem[] = [
  { label: "Product", href: "/for-institutions", groups: PRODUCT_NAV_GROUPS },
  REPORTS_NAV,
  { label: "Resources", href: "/guides", groups: RESOURCES_NAV_GROUPS },
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
  return (item.groups ?? []).flatMap((group) => [...(group.title ? [group.title] : []), ...group.items]);
}

/** True for the section a path belongs to (`/guides` for `/guides/overdraft-fees`). */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = href.split("#")[0];
  return pathname === path || pathname.startsWith(`${path}/`);
}
