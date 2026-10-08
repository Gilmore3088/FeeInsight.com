export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://feeinsight.com";

// Brand contract: Fee Insight is the company/site; Bank Fee Index is its product.
export const SITE_NAME = "Fee Insight";
export const PRODUCT_NAME = "Bank Fee Index";
export const SITE_DOMAIN = "feeinsight.com";
// The legal entity behind the site: formed in Washington, approved by the state Oct 7 2026.
export const LEGAL_ENTITY_NAME = "Fee Insight LLC";
export const LEGAL_ENTITY_STATE = "Washington";
export const LEGAL_ENTITY_LINE = `${LEGAL_ENTITY_NAME}, a ${LEGAL_ENTITY_STATE} limited liability company`;
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
  /** Label for links that open the request form on the paid institution report. */
  institutionCtaLabel: "Request your institution report",
  nextStep: "We reply within one business day with scope and price",
  refreshLabel: "Quarterly refreshes on request",
} as const;
// The sample report page (/reports/sample-competitive-fee-position) is a live report rendered
// from published data (src/lib/custom-report/sample-report.ts); links to it show whenever
// sampleReportAvailable() is true. This flag gates only the OLD static sample
// (Reports/studio/sample + public/reports/sample-*): its PDF redirects to the live page
// (next.config.ts), and the homepage page images, the reports-hub position preview and the
// Hamilton benchmark example (rows copied from the old sample) stay hidden while false.
export const SAMPLE_REPORT_LIVE = false;
/** The free offer, in one line: the instant national and Fed district reports. */
/** What the institution report contains; the bank landing offer and the pay page list it. */
export const REPORT_INCLUDES = [
  "Your published fees next to your competitors', line by line",
  "Each fee marked above, inside or below the market range",
  "Named peers, not anonymous averages",
  "A source for every figure: the document, the page, the date",
] as const;

export const REPORT_OFFER_LINE = "National and Fed district fee reports — free and instant";

// Hamilton, described the same way everywhere. Never "our AI analyst".
export const HAMILTON_CANONICAL =
  `Hamilton is the ${SITE_NAME} Pro workspace: research, model and report your fee position ` +
  "against a verified market, from your own counties to the nation.";
export const HAMILTON_MODES = ["This month", "My fees", "Try a price", "Reports"] as const;
export type HamiltonMode = (typeof HAMILTON_MODES)[number];
