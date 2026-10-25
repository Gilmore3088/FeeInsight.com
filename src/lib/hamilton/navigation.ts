/**
 * Hamilton Navigation — Single source of truth.
 * Top nav labels, left rail structure, CTA hierarchy, and label constants.
 *
 * Label set: This month | My fees | Try a price | Reports, in a banker's words (HAMILTON_MODES in
 * constants.ts carries them for public copy). Changes to watch live in This month; the bank and its
 * data, Reference pages and Admin live in the account menu. Hamilton is a neutral research and
 * modeling workspace (docs/project/DECISIONS.md, 2026-10-05): research, compare, model any
 * price, then plan and report. Ask Hamilton is a bar on every screen rather than a nav item;
 * its answers open in /pro/analyze. Each label's screen uses the same word in its metadata title.
 * URLs are unchanged to preserve bookmarks.
 *
 * History:
 *   - D-16 (Phase 38) locked labels to Home | Analyze | Simulate | Reports | Monitor.
 *   - 2026-04-17 UX audit H-4 superseded D-16 with job-oriented labels (Option A).
 *   - 2026-08-17 executive-panel audit F8: one list of mode names across public copy and the workspace.
 *   - 2026-10-05 James: Briefing | Research | Model | Reports | Watch | Data, with a docked Ask bar.
 *   - 2026-10-06 James: too many tabs, and "a banker doesn't wake up wanting to model or watch".
 *     Four tabs in plain words; Watch folds into This month, Data and Admin into the account menu.
 *   - 2026-10-08 James: Regulatory Wire becomes a top nav item (HAMILTON_WIRE_NAV).
 *   - 2026-10-15 James: build on #1011's unified workspace. Its left navigation
 *     (HAMILTON_WORKSPACE_NAV) replaces the header tabs inside /pro; HAMILTON_NAV still drives the
 *     site header for Pro users on public pages.
 *   - 2026-10-15 James ("Nav only" card): a "Your institution" entry opens My fees; Overview stays national.
 *   - 2026-10-19 James's redesign review (#2044): eight areas become five. Your institution joins
 *     Research and Saved analyses joins Try a price, each as a sub-tab (HAMILTON_WORKSPACE_SUBNAV);
 *     Monitor becomes "Alerts and watches", a secondary link beside Settings.
 *   - 2026-10-25 #1891 (James's Oct 18 audit, V5 plan P5): the landing is the institution's
 *     command center, so "Overview" is named "Command center"; the national market stays under Research.
 */

/** Base path for Hamilton screens. Change here if route group structure changes in Phase 40. */
export const HAMILTON_BASE = "/pro" as const;

export const HAMILTON_NAV = [
  { label: "This month",  href: `${HAMILTON_BASE}/hamilton` },
  { label: "My fees",     href: `${HAMILTON_BASE}/research` },
  { label: "Try a price", href: `${HAMILTON_BASE}/simulate` },
  { label: "Reports",     href: `${HAMILTON_BASE}/reports`  },
  { label: "Admin",       href: "/admin"                    },
] as const;

/**
 * The workspace's left navigation, from #1011 (James's Oct 11 unified-workspace design; README in
 * docs/design/hamilton-rebuild/). Research is one destination whose lenses include the Regulatory
 * Wire and the reference pages, so those paths light it up.
 */
export const HAMILTON_WORKSPACE_NAV = [
  { label: "Command center", href: `${HAMILTON_BASE}/hamilton`,     icon: "ChartNoAxesColumnIncreasing" },
  { label: "Research",       href: `${HAMILTON_BASE}/intelligence`, icon: "Search" },
  { label: "Ask Hamilton",   href: `${HAMILTON_BASE}/analyze`,      icon: "MessageCircle" },
  { label: "Try a price",    href: `${HAMILTON_BASE}/simulate`,     icon: "Calculator" },
  { label: "Reports",        href: `${HAMILTON_BASE}/reports`,      icon: "FileText" },
  { label: "Admin",          href: "/admin",                        icon: "Settings" },
] as const;

/** The secondary link beside Settings: managing watches, whose alerts show across the workspace. */
export const HAMILTON_ALERTS_NAV = { label: "Alerts and watches", href: `${HAMILTON_BASE}/monitor` } as const;

const RESEARCH_PATHS = ["/pro/intelligence", "/pro/research", "/pro/financials", "/pro/data", "/pro/market", "/pro/categories", "/pro/districts", "/pro/news"];
const TRY_A_PRICE_PATHS = ["/pro/simulate", "/pro/saved"];

const under = (pathname: string, paths: readonly string[]) => paths.some(path => pathname === path || pathname.startsWith(`${path}/`));

export function isWorkspaceNavActive(pathname: string | null, item: { label: string; href: string }): boolean {
  if (!pathname) return false;
  if (item.label === "Research") return under(pathname, RESEARCH_PATHS);
  if (item.label === "Try a price") return under(pathname, TRY_A_PRICE_PATHS);
  return under(pathname, [item.href]);
}

/**
 * The sub-tabs of the two areas that hold two pages (#2044). The institution tab is named for the
 * institution being researched, so the reader sees whose fees it shows. `current` marks the tab the
 * reader is on: the monthly briefing (`/pro/intelligence?view=institution`) is the institution's page.
 */
export function workspaceSubnav(pathname: string | null, institutionName: string | null, view: string | null = null): { ariaLabel: string; tabs: { label: string; href: string; current: boolean }[] } | null {
  if (!pathname) return null;
  if (under(pathname, ["/pro/intelligence", "/pro/research"])) {
    const onInstitution = under(pathname, ["/pro/research"]) || view === "institution";
    return { ariaLabel: "Research pages", tabs: [
      { label: "Market", href: `${HAMILTON_BASE}/intelligence`, current: !onInstitution },
      { label: institutionName ? `${institutionName} fees` : "Institution fees", href: `${HAMILTON_BASE}/research`, current: onInstitution },
    ] };
  }
  if (under(pathname, TRY_A_PRICE_PATHS)) {
    const onSaved = under(pathname, ["/pro/saved"]);
    return { ariaLabel: "Try a price pages", tabs: [
      { label: "Try a price", href: `${HAMILTON_BASE}/simulate`, current: !onSaved },
      { label: "Saved analyses", href: `${HAMILTON_BASE}/saved`, current: onSaved },
    ] };
  }
  return null;
}

/** Account menu: the bank and its data, and what changed, outside the workspace areas. */
export const HAMILTON_ACCOUNT_NAV = [
  { label: "My bank and data", href: `${HAMILTON_BASE}/settings` },
  { label: "Alerts and watches", href: `${HAMILTON_BASE}/monitor`  },
] as const;

export type HamiltonScreen = (typeof HAMILTON_NAV)[number]["label"];

/**
 * Regulatory Wire sits in the top nav after the four tabs (James, 2026-10-08: "i wish the
 * regulatory wire was a nav item"), so it left the Reference menu.
 */
export const HAMILTON_WIRE_NAV = { label: "Regulatory Wire", href: `${HAMILTON_BASE}/news` } as const;

/** Reference pages: Pro data you look things up in, under one "Reference" menu. */
export const HAMILTON_REFERENCE_NAV = [
  { label: "Market",       href: `${HAMILTON_BASE}/market`,     description: "Beige Book themes and market reading" },
  { label: "Financial performance", href: `${HAMILTON_BASE}/financials`, description: "Your filed fee income and deposits by quarter, beside peers" },
  { label: "Institutions", href: `${HAMILTON_BASE}/data`,       description: "Find any bank or credit union" },
  { label: "Fee categories", href: `${HAMILTON_BASE}/categories`, description: "Every fee type and its national median" },
  { label: "Fed districts", href: `${HAMILTON_BASE}/districts`, description: "Fees and coverage by Federal Reserve district" },
] as const;

/** Left rail workspace memory config per screen (per D-17, 02-navigation doc) */
export const LEFT_RAIL_CONFIG: Record<HamiltonScreen, {
  primaryAction: string;
  sections: string[];
}> = {
  "This month":  { primaryAction: "Look at My Fees", sections: ["Saved Analyses", "Recent Work", "Pinned Institutions"] },
  "My fees":     { primaryAction: "Try a Price",     sections: ["Saved Analyses", "Recent Work"] },
  "Try a price": { primaryAction: "Build a Report",  sections: ["Scenarios", "Saved Analyses"] },
  "Reports":     { primaryAction: "Generate Brief",  sections: ["Your Reports", "Templates"] },
  "Admin":       { primaryAction: "",                sections: [] },
} as const;

export const PRIMARY_ACTION_HREF: Record<HamiltonScreen, string> = {
  "This month":  "/pro/research",
  "My fees":     "/pro/simulate",
  "Try a price": "/pro/reports",
  // Opens the builder with the executive brief template already chosen,
  // not the page the user is already on.
  "Reports":     "/pro/reports?intent=executive-briefing",
  "Admin":       "/admin",
} as const;

export function getPrimaryActionHref(screen: HamiltonScreen): string {
  return PRIMARY_ACTION_HREF[screen];
}

/** CTA hierarchy per screen (per 09-copy-and-ux-rules.md). "Analyze" is where Ask answers open. */
export const CTA_HIERARCHY: Record<Exclude<HamiltonScreen, "Admin"> | "Analyze", {
  primary: string;
  secondary: string[];
}> = {
  "Analyze":     { primary: "Try a Price",     secondary: ["Show the Market", "View Risk Drivers"] },
  "This month":  { primary: "Look at My Fees", secondary: [] },
  "My fees":     { primary: "Try a Price",     secondary: [] },
  "Try a price": { primary: "Plan the Change", secondary: [] },
  "Reports":     { primary: "Generate Brief",  secondary: [] },
} as const;

/** Analysis Focus tabs — used inside Analyze screen (per 02-navigation doc) */
export const ANALYSIS_FOCUS_TABS = ["Pricing", "Risk", "Peer Position", "Trend"] as const;
export type AnalysisFocus = (typeof ANALYSIS_FOCUS_TABS)[number];

/** Consistent label language across all screens (per D-08) */
export const HAMILTON_LABELS = {
  hamiltonsView:       "Hamilton's View",
  whatChanged:         "What Changed",
  whatThisMeans:       "What This Means",
  whyItMatters:        "Why It Matters",
  recommendedPosition: "Market Position",
  priorityAlert:       "Priority Alert",
  signalFeed:          "Signal Feed",
  analysisFocus:       "Analysis Focus",
} as const;
