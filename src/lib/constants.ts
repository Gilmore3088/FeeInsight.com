export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://feeinsight.com";

// Brand contract: Fee Insight is the company/site; Bank Fee Index is its product.
export const SITE_NAME = "Fee Insight";
export const PRODUCT_NAME = "Bank Fee Index";
export const SITE_DOMAIN = "feeinsight.com";
export const CONTACT_EMAIL = "hello@bankfeeindex.com";
export const RESEARCH_IMPRINT = "Fee Insight Research";
export const HAMILTON_ATTRIBUTION = "Hamilton — Fee Insight";
/** Credit line returned with every public API response, for partners to display with the data. */
export const API_ATTRIBUTION = {
  text: `Source: ${PRODUCT_NAME}, ${SITE_DOMAIN}`,
  url: `https://${SITE_DOMAIN}`,
} as const;
export const SITE_TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

/** Full document title for pages that must set one outside the root title template. */
export function pageTitle(section: string): string {
  return `${section} | ${SITE_NAME}`;
}

// The one commissioned product: one name, one offer, one turnaround, everywhere.
// The report is free; its list value anchors what it is worth. Never pair "free"
// with a bare price the visitor would pay.
export const REPORT_OFFER = {
  name: "Competitive Fee Position Report",
  priceUsd: 0,
  priceLabel: "Free",
  valueLabel: "a $300 value",
  ctaLabel: "Get your free report",
  turnaround: "delivered in 48 hours",
  refreshLabel: "Quarterly refreshes on request",
} as const;
export const REPORT_OFFER_LINE = `${REPORT_OFFER.name} — free (${REPORT_OFFER.valueLabel}), ${REPORT_OFFER.turnaround}`;

// Hamilton, described the same way everywhere. Never "our AI analyst".
export const HAMILTON_CANONICAL =
  `Hamilton is the ${SITE_NAME} Pro workspace: benchmark, scenario, report and monitor ` +
  "your fee position against a verified peer set.";
export const HAMILTON_MODES = ["Analyze", "Benchmark", "Scenario", "Report", "Monitor"] as const;
export type HamiltonMode = (typeof HAMILTON_MODES)[number];
