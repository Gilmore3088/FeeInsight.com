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

// The one commissioned product, described the same way everywhere. It is built for one
// institution against named competitors, so it is priced on request and never promises a
// delivery time. The free offer is the instant national and Fed district reports, which
// need no one's time (James, 2026-10-05: "never reference 48 hours with a free report").
export const REPORT_OFFER = {
  name: "Competitive Fee Position Report",
  priceUsd: 0,
  priceLabel: "Priced on request",
  ctaLabel: "Get a free fee report",
  nextStep: "We reply within one business day with scope and price",
  refreshLabel: "Quarterly refreshes on request",
} as const;
// The public sample report (Reports/studio/sample + public/reports/sample-*) is offline
// until it is re-rendered from live data that passes the per-fee source check. While false,
// the sample page shows a "new sample coming soon" note, its PDF redirects there
// (next.config.ts), and the homepage previews and the Hamilton benchmark example
// (rows copied from the sample) are hidden.
export const SAMPLE_REPORT_LIVE = false;
/** The free offer, in one line: the instant national and Fed district reports. */
export const REPORT_OFFER_LINE = "National and Fed district fee reports — free, and ready in a minute";

// Hamilton, described the same way everywhere. Never "our AI analyst".
export const HAMILTON_CANONICAL =
  `Hamilton is the ${SITE_NAME} Pro workspace: benchmark, scenario, report and monitor ` +
  "your fee position against a verified peer set.";
export const HAMILTON_MODES = ["Analyze", "Benchmark", "Scenario", "Report", "Monitor"] as const;
export type HamiltonMode = (typeof HAMILTON_MODES)[number];
