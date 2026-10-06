/**
 * Hamilton Navigation — Single source of truth.
 * Top nav labels, left rail structure, CTA hierarchy, and label constants.
 *
 * Label set: Briefing | Research | Model | Reports | Watch | Data | Admin (HAMILTON_MODES in
 * constants.ts carries the first five for public copy). Hamilton is a neutral research and
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
 */

/** Base path for Hamilton screens. Change here if route group structure changes in Phase 40. */
export const HAMILTON_BASE = "/pro" as const;

export const HAMILTON_NAV = [
  { label: "Briefing", href: `${HAMILTON_BASE}/hamilton` },
  { label: "Research", href: `${HAMILTON_BASE}/research` },
  { label: "Model",    href: `${HAMILTON_BASE}/simulate` },
  { label: "Reports",  href: `${HAMILTON_BASE}/reports`  },
  { label: "Watch",    href: `${HAMILTON_BASE}/monitor`  },
  { label: "Data",     href: `${HAMILTON_BASE}/settings` },
  { label: "Admin",    href: "/admin"                    },
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
  "Briefing": { primaryAction: "Research a Fee",  sections: ["Saved Analyses", "Recent Work", "Pinned Institutions"] },
  "Research": { primaryAction: "Model a Price",   sections: ["Saved Analyses", "Recent Work"] },
  "Model":    { primaryAction: "Build a Report",  sections: ["Scenarios", "Saved Analyses"] },
  "Reports":  { primaryAction: "Generate Brief",  sections: ["Your Reports", "Templates"] },
  "Watch":    { primaryAction: "Ask Hamilton",    sections: ["Watchlist", "Signal Feed"] },
  "Data":     { primaryAction: "",                sections: [] },
  "Admin":    { primaryAction: "",                sections: [] },
} as const;

export const PRIMARY_ACTION_HREF: Record<HamiltonScreen, string> = {
  "Briefing": "/pro/research",
  "Research": "/pro/simulate",
  "Model":    "/pro/reports",
  // Opens the builder with the executive brief template already chosen,
  // not the page the user is already on.
  "Reports":  "/pro/reports?intent=executive-briefing",
  "Watch":    "/pro/analyze",
  "Data":     "/pro/settings",
  "Admin":    "/admin",
} as const;

export function getPrimaryActionHref(screen: HamiltonScreen): string {
  return PRIMARY_ACTION_HREF[screen];
}

/** CTA hierarchy per screen (per 09-copy-and-ux-rules.md). "Analyze" is where Ask answers open. */
export const CTA_HIERARCHY: Record<Exclude<HamiltonScreen, "Admin" | "Data"> | "Analyze", {
  primary: string;
  secondary: string[];
}> = {
  "Analyze":  { primary: "Model a Price",   secondary: ["Show the Market", "View Risk Drivers"] },
  "Briefing": { primary: "Research a Fee",  secondary: [] },
  "Research": { primary: "Model a Price",   secondary: [] },
  "Model":    { primary: "Plan the Change", secondary: [] },
  "Reports":  { primary: "Generate Brief",  secondary: [] },
  "Watch":    { primary: "Ask Hamilton",    secondary: ["Model a Price"] },
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
