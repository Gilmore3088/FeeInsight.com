/**
 * Regenerated in the background (ISR) at most every 15 minutes, and sooner when a
 * takedown invalidates the public read cache, whose tag every read below carries.
 *
 * The page reads no session, cookies or search params: the header's signed-in parts are
 * client islands (consumer-nav.tsx). It used to render per request (`force-dynamic`), and
 * on Oct 8-15 its function TTFB was 146 ms at p50 but 3,834 ms at p75 (#1168), the slow
 * renders being the ones whose cached reads had to go to the database.
 *
 * Each read keeps serving its last good value while the database is down
 * (`cachedPublicRead`), so a render only has a failed read when no good value is cached
 * at all. Such a render (`homeReadsCacheable` false) is cached for one minute instead of
 * fifteen (`shortenPageLife`): the visitor gets the page with the failed parts hidden,
 * never an error page, and the next render a minute later reads the database again
 * (#1572). It used to opt out of the cache with `connection()`, which on a cold cache
 * miss turned the failed read into a 500.
 */
export const revalidate = 900;

import type { Metadata } from "next";
import { getPublicSnapshot } from "@/lib/public-stats";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { DEMO_SAMPLE_INSTITUTION_ID, loadSampleReport } from "@/lib/custom-report/sample-report";
import { getRevenueContextCached } from "@/lib/custom-report/revenue-context";
import { getReportPeerContextCached, getReportPeerFinancialCached, peerLinesFor } from "@/lib/custom-report/peer-context";
import { createReadBudget } from "@/lib/read-deadline";
import type { MarketBranchFootprint } from "@/lib/data-store/branches";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import type { IndexRow } from "@/lib/data-store";
import { getIndexRowsCached, getMarketBranchFootprintCached } from "@/lib/data-store/public-cached-reads";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { getSpotlightCategories, publicFeeTypes } from "@/lib/fee-taxonomy";
import { LandingHero, LandingProof } from "./landing-hero";
import { LandingHamilton } from "./landing-hamilton";
import { LandingResearch } from "./landing-research-section";
import { LandingDeliverable } from "./landing-deliverable";
import { LandingPricing } from "./landing-pricing";
import { buildIndexCard } from "./landing-index";
import { HOME_READ_BUDGET_MS, homeReadsCacheable } from "./landing-shared";
import { homeSerif } from "./landing-serif";
import "./landing-motion.css";

// The title follows the hero h1 (conversion headlines, Oct 17); neither line carries a count, so nothing goes stale.
const HOME_TITLE = `Your next fee review doesn’t need to take weeks | ${SITE_NAME}`;
const HOME_DESCRIPTION =
  `Compare your fees with competitors using the ${PRODUCT_NAME}. ` +
  "Turn the evidence into analysis and board reports with Hamilton.";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  legalName: LEGAL_ENTITY_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon`,
  description: `${SITE_NAME} publishes the ${PRODUCT_NAME}: fees for U.S. banks and credit unions, each traced to the institution's own published fee schedule.`,
  brand: { "@type": "Brand", name: PRODUCT_NAME },
  knowsAbout: ["Bank fees", "Credit union fees", "Overdraft fees", "Fee benchmarking"],
  contactPoint: {
    "@type": "ContactPoint",
    email: CONTACT_EMAIL,
    contactType: "sales",
  },
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/institutions?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export default async function LandingPage() {
  // Counts come from the one shared snapshot, so they match the fee index, research hub and
  // directory to the number. The hero card reads each free fee's published rows, the same cached
  // read /fees makes; a failed fee read only leaves that fee out of the card. The live sample
  // report (the one /for-institutions and the sample page show) gives the One question demo
  // its figures; a failed read shows the demo without figures. It is null both when none
  // passes the bar today and on error. The One question section draws on it, the sample bank's
  // reported service-charge income and Call Report peers (the reads the sample report page shows),
  // and that page's peer-context and branch-footprint reads, from the same cache. The same report
  // draws the first page of the sample before the plans.
  const { summary, categories } = await getPublicSnapshot();
  // The fee types the public site lists (the top 50, as /fees counts them) that have published fees.
  const listed = publicFeeTypes(categories);
  const publicKeys = new Set(categories.filter((c) => listed.has(c.fee_category) && Number(c.institution_count ?? 0) > 0).map((c) => c.fee_category));
  const cardFees = getSpotlightCategories().filter((fee) => publicKeys.has(fee));
  // One deadline for every read below (#1988): a slow read during an ISR prerender or a
  // saturated pool leaves its part of the page out instead of holding the render or failing
  // the build. Every read is optional; a fallback counts as a failed read, so the render is
  // cached for a minute (shortenPageLife), not fifteen.
  const budget = createReadBudget(HOME_READ_BUDGET_MS, "Home");
  const optional = <T,>(read: Promise<T>, label: string) =>
    budget.optional(read.then((value) => ({ value, failed: false })), label, { value: null as T | null, failed: true });
  const [sampleRead, indexReads] = await Promise.all([
    optional(loadSampleReport(), "sample report").then(async ({ value: report, failed }) => {
      if (!report) return { report: null, revenue: null, financial: null, peers: null, branches: null, failed };
      const id = report.data.subject.institution_id;
      const market = report.data.market;
      const [revenue, financial, peers, branches] = await Promise.all([
        optional(getRevenueContextCached(id), "sample bank revenue"),
        optional(getReportPeerFinancialCached(id), "sample bank peer financial"),
        // The One question section's size-peer fee median and market footprint: the sample
        // report page's own reads, with the same arguments, so they share its cache entries.
        optional(getReportPeerContextCached(id, peerLinesFor(report.analysis.lines)), "sample bank peer context"),
        market
          ? optional(getMarketBranchFootprintCached(market.county_fips, market.sod_year), "sample market footprint")
          : Promise.resolve({ value: null as MarketBranchFootprint | null, failed: false }),
      ]);
      return {
        report,
        revenue: revenue.value,
        financial: financial.value,
        peers: peers.value,
        branches: branches.value,
        failed: revenue.failed || financial.failed || peers.failed || branches.failed,
      };
    }),
    Promise.all(
      cardFees.map((fee) =>
        optional(getIndexRowsCached(fee), `index rows for ${fee}`).then(({ value, failed }) => ({ fee, rows: value ?? ([] as IndexRow[]), failed })),
      ),
    ),
  ]);
  const cacheable = homeReadsCacheable({
    summary,
    categories,
    sampleFailed: sampleRead.failed,
    indexFailed: indexReads.some((r) => r.failed),
  });
  // A render with a failed read is cached for a minute, not fifteen (see the note at the top).
  if (!cacheable) await shortenPageLife();
  // The demo bank's own fees come from the same rows, so the card can mark it with no extra read.
  const index = buildIndexCard(new Map(indexReads.map((r) => [r.fee, r.rows])), [DEMO_SAMPLE_INSTITUTION_ID]);

  return (
    <div className={`${homeSerif.variable} min-h-screen overflow-x-clip bg-paper consumer-brand`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
      />
      <ConsumerNav />
      <main id="main-content">
        {/* James's landing critique (Oct 17, §8), six sections: the hero, live data (the Index card
            and the proof strip), the Hamilton introduction, the One question demo (James's review, Oct 19:
            the one interactive demonstration), the sample report's first page, the plans. */}
        <LandingHero index={index} freshness={summary.refreshedOn || summary.freshnessLabel} />
        <LandingProof summary={summary} feeTypes={publicKeys.size} />
        <LandingHamilton />
        <LandingResearch
          report={sampleRead.report}
          revenue={sampleRead.revenue}
          financial={sampleRead.financial}
          peers={sampleRead.peers}
          branches={sampleRead.branches}
        />
        <LandingDeliverable report={sampleRead.report} preparedOn={new Date()} />
        <LandingPricing />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
