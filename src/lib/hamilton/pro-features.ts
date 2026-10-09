/**
 * What Pro opens, in the words the workspace itself uses. Settings links to each one, and
 * /subscribe lists the same items so a buyer reads exactly what they get. Only screens that
 * ship belong here.
 */
export interface ProFeature {
  key: string;
  label: string;
  href: string;
  description: string;
}

export const PRO_WORKSPACE_FEATURES: readonly ProFeature[] = [
  {
    key: "benchmarking",
    label: "This month",
    href: "/pro/hamilton",
    description: "Where your fees sit against peer medians, with the number of institutions behind each one.",
  },
  {
    key: "my_fees",
    label: "My fees",
    href: "/pro/research",
    description: "One fee at a time against your peers, your state and the nation, with the filings behind it.",
  },
  {
    key: "analysis",
    label: "Ask Hamilton",
    href: "/pro/analyze",
    description: "Ask about any bank or credit union; every figure is checked against the data it came from.",
  },
  {
    key: "scenario_modeling",
    label: "Try a price",
    href: "/pro/simulate",
    description: "See where a different fee would land among your peers, and the notice and approvals a change takes.",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/pro/reports",
    description: "Board-ready reports written from your bank's verified fee schedule.",
  },
  {
    key: "market_monitor",
    label: "All changes",
    href: "/pro/monitor",
    description: "Alerts when a bank you watch changes its published fees.",
  },
];

/** Pro pages outside the workspace tabs that a buyer also gets. */
export const PRO_EXTRA_FEATURES: readonly ProFeature[] = [
  {
    key: "wire",
    label: "Regulatory Wire",
    href: "/pro/news",
    description: "Federal Register rules and state bills that touch bank fees, in one feed you can filter by state.",
  },
  {
    key: "csv",
    label: "CSV downloads",
    href: "/pro/research",
    description: "Download any peer comparison from My fees or Try a price as a spreadsheet.",
  },
];
