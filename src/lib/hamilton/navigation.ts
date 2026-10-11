/** Hamilton workspace navigation. October 11 consulting-workspace design supersedes the old four-tab layout. Canonical URLs remain stable. */

/** Base path for Hamilton screens. Change here if route group structure changes in Phase 40. */
export const HAMILTON_BASE = "/pro" as const;

export const HAMILTON_NAV = [
  { label: "Overview", href: `${HAMILTON_BASE}/hamilton`, icon: "ChartNoAxesColumnIncreasing" },
  { label: "Ask Hamilton", href: `${HAMILTON_BASE}/analyze`, icon: "MessageCircle" },
  { label: "Research", href: `${HAMILTON_BASE}/intelligence`, icon: "Search" },
  { label: "Try a price", href: `${HAMILTON_BASE}/simulate`, icon: "Calculator" },
  { label: "Reports", href: `${HAMILTON_BASE}/reports`, icon: "FileText" },
  { label: "Monitor", href: `${HAMILTON_BASE}/monitor`, icon: "Activity" },
  { label: "Saved analyses", href: `${HAMILTON_BASE}/saved`, icon: "Bookmark" },
  { label: "Admin", href: "/admin", icon: "Settings" },
] as const;

/** Account menu: the bank and its data, and what changed, outside the four tabs. */
export const HAMILTON_ACCOUNT_NAV = [
  { label: "My bank and data", href: `${HAMILTON_BASE}/settings` },
  { label: "All changes",      href: `${HAMILTON_BASE}/monitor`  },
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
  { label: "Institutions", href: `${HAMILTON_BASE}/data`,       description: "Find any bank or credit union" },
  { label: "Fee categories", href: `${HAMILTON_BASE}/categories`, description: "Every fee type and its national median" },
  { label: "Fed districts", href: `${HAMILTON_BASE}/districts`, description: "Fees and coverage by Federal Reserve district" },
] as const;

/** Retained exports for consumers; workspace actions stay in the page context. */
export const LEFT_RAIL_CONFIG: Record<HamiltonScreen, { primaryAction: string; sections: string[] }> = {
  Overview: { primaryAction: "Ask Hamilton", sections: [] },
  "Ask Hamilton": { primaryAction: "Create report", sections: [] },
  Research: { primaryAction: "Ask Hamilton", sections: [] },
  "Try a price": { primaryAction: "Build report", sections: [] },
  Reports: { primaryAction: "Create board brief", sections: [] },
  Monitor: { primaryAction: "Ask Hamilton", sections: [] },
  "Saved analyses": { primaryAction: "Ask Hamilton", sections: [] },
  Admin: { primaryAction: "", sections: [] },
};
export const PRIMARY_ACTION_HREF: Record<HamiltonScreen, string> = {
  Overview: "/pro/analyze", "Ask Hamilton": "/pro/reports?intent=board-brief",
  Research: "/pro/analyze", "Try a price": "/pro/reports?intent=board-brief",
  Reports: "/pro/reports?intent=board-brief", Monitor: "/pro/analyze",
  "Saved analyses": "/pro/analyze", Admin: "/admin",
};
export function getPrimaryActionHref(screen: HamiltonScreen): string { return PRIMARY_ACTION_HREF[screen]; }
export const CTA_HIERARCHY = Object.fromEntries(Object.entries(LEFT_RAIL_CONFIG).map(([key, value]) => [key, { primary: value.primaryAction, secondary: [] }]));

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
