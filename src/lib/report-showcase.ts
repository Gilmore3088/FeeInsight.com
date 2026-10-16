/**
 * The one place the site's pictures of the paid report come from. Every page that shows the
 * Competitive Fee Position report as delivered (the /reports hero, the for-institutions offer,
 * the Pro plans example, the sample download) reads this module.
 *
 * To update the report everywhere when the report changes (for example, the Fee Insight rebrand
 * of the PDF): export new page images at 850 x 1100 into `public/reports/sample-preview/`, list
 * them below in the order to show them, and replace the PDF at `pdfHref`. Nothing else changes.
 */

export interface ReportShowcasePage {
  /** Path under /public, 850 x 1100. */
  src: string;
  /** What the page shows, for screen readers. */
  alt: string;
}

export const REPORT_SHOWCASE = {
  /** The page that renders the live sample report on the site. */
  sampleHref: "/reports/sample-competitive-fee-position",
  /** The sample report as a PDF download. */
  pdfHref: "/reports/sample-competitive-fee-position.pdf",
  width: 850,
  height: 1100,
  /** Cover first, then the pages worth showing, in order. */
  pages: [
    { src: "/reports/sample-preview/page-1.webp", alt: "Cover of the sample Competitive Fee Position report" },
    { src: "/reports/sample-preview/page-2.webp", alt: "Summary of findings page from the sample report" },
    { src: "/reports/sample-preview/page-3.webp", alt: "Position map page from the sample report: each fee against the peer range" },
  ] satisfies ReportShowcasePage[],
} as const;
