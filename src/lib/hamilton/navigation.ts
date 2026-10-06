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

/** Account menu: the bank and its data, and what changed, outside the four tabs. */
export const HAMILTON_ACCOUNT_NAV = [
  { label: "My bank and data", href: `${HAMILTON_BASE}/settings` },
  { label: "All changes",      href: `${HAMILTON_BASE}/monitor`  },
] as const;

export type HamiltonScreen = (typeof HAMILTON_NAV)[number]["label"];

/** Reference pages: Pro data you look things up in, under one "Reference" menu. */
export const HAMILTON_REFERENCE_NAV = [
  { label: "Market",       href: `${HAMILTON_BASE}/market`,     description: "Beige Book themes and market reading" },
  { label: "Institutions", href: `${HAMILTON_BASE}/data`,       description: "Find any bank or credit union" },
  { label: "Fee categories", href: `${HAMILTON_BASE}/categories`, description: "Every fee type and its national median" },
  { label: "Fed districts", href: `${HAMILTON_BASE}/districts`, description: "Fees and coverage by Federal Reserve district" },
  { label: "Regulatory news", href: `${HAMILTON_BASE}/news`,    description: "CFPB, OCC and Fed updates" },
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
