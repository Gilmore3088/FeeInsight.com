export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://feeinsight.com";

/** The site header logo as a 2x PNG for email headers (mail clients block SVG); 124x22 on screen. */
export const EMAIL_LOGO_URL = `${SITE_URL.replace(/\/$/, "")}/brand/png/fee-insight-oneline@2x.png`; // the site header wordmark: Oxford Navy with the brick mark, never a recoloured variant

// Brand contract: Fee Insight is the company/site; Bank Fee Index is its product.
export const SITE_NAME = "Fee Insight";
export const PRODUCT_NAME = "Bank Fee Index";
export const SITE_DOMAIN = "feeinsight.com";
// The legal entity behind the site: formed in Washington, approved by the state Oct 7 2026.
export const LEGAL_ENTITY_NAME = "Fee Insight LLC";
export const LEGAL_ENTITY_STATE = "Washington";
export const LEGAL_ENTITY_LINE = `${LEGAL_ENTITY_NAME}, a ${LEGAL_ENTITY_STATE} limited liability company`;
// Unregistered marks take ™; switch to ® only for a mark the USPTO has registered.
export const TRADEMARK_NOTICE = `${SITE_NAME}™ and The ${PRODUCT_NAME}™ are trademarks of ${LEGAL_ENTITY_NAME}.`;
export const CONTACT_EMAIL = "hello@bankfeeindex.com";
/**
 * The postal address subscription and marketing email carry in the footer (CAN-SPAM). Blank
 * until the state registration comes through (DECISIONS 2026-10-06): MARKETING_MAILING_ADDRESS
 * sets it, and until then marketing sends stay refused and site email omits the line.
 */
export const MAILING_ADDRESS = "";
/** Every email we send goes out under this display name. */
export const EMAIL_SENDER_NAME = SITE_NAME;
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
// institution against named competitors, so each one is quoted (from $300, James 2026-10-08) and never promises a
// delivery time. The free offer is the instant national and Fed district reports, which
// need no one's time (James, 2026-10-05: "never reference 48 hours with a free report").
export const REPORT_OFFER = {
  name: "Competitive Fee Position Report",
  priceUsd: 0,
  priceLabel: "From $300",
  /** The lowest quote (James, 2026-10-08: "from $300"); each report is still quoted. */
  fromPriceUsd: 300,
  ctaLabel: "Get a free fee report",
  /** Label for links that open the request form on the paid institution report. */
  institutionCtaLabel: "Request your institution report",
  nextStep: "We reply within one business day with scope and price",
  refreshLabel: "Quarterly refreshes on request",
  /** Who buys it (the FAQ's "Who is it for?", #1174). */
  audience: "Marketing, product and pricing managers at banks and credit unions",
} as const;
/** The report price inside a sentence ("a report from $300"), from the one label (#1176). */
export const REPORT_PRICE_INLINE = `${REPORT_OFFER.priceLabel.charAt(0).toLowerCase()}${REPORT_OFFER.priceLabel.slice(1)}`;
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
  "Each fee marked above, inside or below the middle half of local fees",
  "Named peers, not anonymous averages",
  "A source for every figure: the document, the page, the date",
] as const;

export const REPORT_OFFER_LINE = "National and Fed district fee reports — free and instant";

// Hamilton, described the same way everywhere. Never "our AI analyst".
export const HAMILTON_CANONICAL =
  `Hamilton is the ${SITE_NAME} workspace: research, model and report your fee position ` +
  "against your market, from your own counties to the nation.";
export const HAMILTON_MODES = ["This month", "My fees", "Try a price", "Reports"] as const;
export type HamiltonMode = (typeof HAMILTON_MODES)[number];
