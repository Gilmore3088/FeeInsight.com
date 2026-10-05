/**
 * Hamilton Navigation — Single source of truth.
 * Top nav labels, left rail structure, CTA hierarchy, and label constants.
 *
 * Label set: Analyze | Benchmark | Scenario | Report | Monitor | Admin (the five Fee Insight Pro workspace modes,
 * HAMILTON_MODES in constants.ts). Each label opens the screen of the same name, and that
 * screen's <h1> and metadata title use the same word (2026-10-04 Pro audit: "Analyze"
 * used to open the briefing and "Benchmark" the Analyze screen).
 * URLs are unchanged to preserve bookmarks.
 *
 * Per D-17: Left rail + CTA hierarchy defined here, not in components.
 *
 * History:
 *   - D-16 (Phase 38) locked labels to Home | Analyze | Simulate | Reports | Monitor.
 *   - 2026-04-17 UX audit H-4 superseded D-16 with job-oriented labels (Option A).
 *   - 2026-08-17 executive-panel audit F8: one list of five mode names across public copy and the workspace.
 */

/** Base path for Hamilton screens. Change here if route group structure changes in Phase 40. */
export const HAMILTON_BASE = "/pro" as const;

export const HAMILTON_NAV = [
  { label: "Analyze",          href: `${HAMILTON_BASE}/analyze`   },
  { label: "Benchmark",        href: `${HAMILTON_BASE}/hamilton`  },
  { label: "Scenario",        href: `${HAMILTON_BASE}/simulate`  },
  { label: "Report", href: `${HAMILTON_BASE}/reports`   },
  { label: "Monitor",        href: `${HAMILTON_BASE}/monitor`   },
  { label: "Admin",            href: "/admin"                     },
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
  "Analyze":   { primaryAction: "Simulate a Change",        sections: ["Saved Analyses", "Recent Work", "Pinned Institutions"] },
  "Benchmark": { primaryAction: "Simulate Change",          sections: ["Saved Analyses", "Recent Work"] },
  "Scenario":  { primaryAction: "Generate Board Summary",   sections: ["Scenarios", "Saved Analyses"] },
  "Report":    { primaryAction: "Generate Brief",           sections: ["Your Reports", "Templates"] },
  "Monitor":   { primaryAction: "Review Pricing",           sections: ["Watchlist", "Signal Feed"] },
  "Admin":     { primaryAction: "",                         sections: [] },
} as const;

export const PRIMARY_ACTION_HREF: Record<HamiltonScreen, string> = {
  "Analyze":   "/pro/simulate",
  "Benchmark": "/pro/simulate",
  "Scenario":  "/pro/reports",
  // Opens the builder with the executive brief template already chosen,
  // not the page the user is already on.
  "Report":    "/pro/reports?intent=executive-briefing",
  "Monitor":   "/pro/analyze",
  "Admin":     "/admin",
} as const;

export function getPrimaryActionHref(screen: HamiltonScreen): string {
  return PRIMARY_ACTION_HREF[screen];
}

/** CTA hierarchy per screen (per 09-copy-and-ux-rules.md) */
export const CTA_HIERARCHY: Record<Exclude<HamiltonScreen, "Admin">, {
  primary: string;
  secondary: string[];
}> = {
  "Analyze":   { primary: "Simulate a Change",               secondary: ["Show Peer Distribution", "View Risk Drivers"] },
  "Benchmark": { primary: "Simulate Change",                 secondary: [] },
  "Scenario":  { primary: "Generate Board Scenario Summary", secondary: [] },
  "Report":    { primary: "Generate Brief",                  secondary: [] },
  "Monitor":   { primary: "Review Pricing",                  secondary: ["Run Scenario"] },
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
  recommendedPosition: "Recommended Position",
  priorityAlert:       "Priority Alert",
  signalFeed:          "Signal Feed",
  analysisFocus:       "Analysis Focus",
} as const;
