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
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import type { IndexRow } from "@/lib/data-store";
import { getIndexRowsCached } from "@/lib/data-store/public-cached-reads";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { getSpotlightCategories, publicFeeTypes } from "@/lib/fee-taxonomy";
import { LandingHero, LandingProof } from "./landing-hero";
import { LandingHamilton } from "./landing-hamilton";
import { LandingResearch } from "./landing-research-section";
import { LandingPricing } from "./landing-pricing";
import { buildIndexCard } from "./landing-index";
import { homeReadsCacheable } from "./landing-shared";
import { homeSerif } from "./landing-serif";
import "./landing-motion.css";

// James's headline (Oct 17); no counts, so nothing goes stale.
const HOME_TITLE = `Know your market. Price with confidence. | ${SITE_NAME}`;
const HOME_DESCRIPTION =
  `Benchmark your fees with the ${PRODUCT_NAME}, then put Hamilton to work for your institution. ` +
  "Every figure traces to the institution's own published fee schedule.";

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
  // report (the one /for-institutions and the sample page show) gives the Hamilton examples
  // their figures; a failed read shows the examples without figures. It is null both when none
  // passes the bar today and on error.
  const { summary, categories } = await getPublicSnapshot();
  // The fee types the public site lists (the top 50, as /fees counts them) that have published fees.
  const listed = publicFeeTypes(categories);
  const publicKeys = new Set(categories.filter((c) => listed.has(c.fee_category) && Number(c.institution_count ?? 0) > 0).map((c) => c.fee_category));
  const cardFees = getSpotlightCategories().filter((fee) => publicKeys.has(fee));
  const [sampleRead, indexReads] = await Promise.all([
    loadSampleReport().then(
      (report) => ({ report, failed: false }),
      (error: unknown) => {
        console.error("[home] sample report read failed; Hamilton examples shown without figures", error);
        return { report: null, failed: true };
      },
    ),
    Promise.all(
      cardFees.map((fee) =>
        getIndexRowsCached(fee).then(
          (rows) => ({ fee, rows, failed: false }),
          (error: unknown) => {
            console.error(`[home] index rows for ${fee} failed; left out of the hero card`, error);
            return { fee, rows: [] as IndexRow[], failed: true };
          },
        ),
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
  const index = buildIndexCard(new Map(indexReads.map((r) => [r.fee, r.rows])));

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
        {/* James's example (Oct 17): the hero with the working Index, the proof strip, Hamilton's
            examples, the connected research, then the plans. */}
        <LandingHero index={index} freshness={summary.refreshedOn || summary.freshnessLabel} />
        <LandingProof summary={summary} feeTypes={publicKeys.size} />
        <LandingHamilton report={sampleRead.report} />
        <LandingResearch />
        <LandingPricing />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
