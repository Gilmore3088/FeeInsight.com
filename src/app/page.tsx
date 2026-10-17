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
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { LandingHero } from "./landing-hero";
import { LandingProducts } from "./landing-products";
import { LandingHamilton } from "./landing-hamilton";
import { parseShowcaseAnswer, showcaseAnswerId } from "./landing-hamilton-answer";
import { getShowcaseAnalysisRow } from "@/lib/data-store/hamilton-analyses";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { LandingPricing } from "./landing-pricing";
import { LandingFaq } from "./landing-faq";
import { buildHomeData, buildSampleView, homeReadsCacheable } from "./landing-shared";
import { buildScenario } from "./subscribe/scenario";

// The saved Hamilton answer the Hamilton section shows; a stored row, so it shares the public read cache.
const showcaseRowCached = cachedPublicRead("home-hamilton-showcase", getShowcaseAnalysisRow);

// The promise (James, Oct 16); no counts, so nothing goes stale.
const HOME_TITLE = `Your next fee review doesn't need to take weeks | ${SITE_NAME}`;
const HOME_DESCRIPTION =
  `Compare your fees with competitors using the ${PRODUCT_NAME}, then turn the evidence into analysis and ` +
  "board reports with Hamilton. Every figure traces to the institution's own published fee schedule.";

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
  // Counts and the national ranges come from one shared snapshot, so they match the fee
  // index, research hub and directory to the number. The district medians are the cached
  // read /fees/overdraft already makes; a failed read only hides the district rows. The
  // live sample report (the same one /for-institutions and the sample page show) gives the
  // named bank, its competitors and its report for the workflow section; a failed read hides it.
  // The sample is read once: it is null both when none passes the bar today and on error.
  // The saved Hamilton answer is read the same way; a failed read hides the demonstration.
  const [{ summary, categories }, sampleRead, overdraftRead, showcaseRead] = await Promise.all([
    getPublicSnapshot(),
    loadSampleReport().then(
      (report) => ({ report, failed: false }),
      (error: unknown) => {
        console.error("[home] sample report read failed; sample exhibits hidden", error);
        return { report: null, failed: true };
      },
    ),
    getFeeCategoryDetailCached("overdraft").then(
      // The overdraft category always has fees; an empty detail is a read that went wrong.
      (detail) => ({ detail, failed: detail.fees.length === 0 }),
      (error: unknown) => {
        console.error("[home] overdraft district read failed; district rows hidden", error);
        return { detail: null, failed: true };
      },
    ),
    showcaseRowCached(showcaseAnswerId()).then(
      (row) => ({ answer: parseShowcaseAnswer(row), failed: false }),
      (error: unknown) => {
        console.error("[home] Hamilton answer read failed; Hamilton demonstration hidden", error);
        return { answer: null, failed: true };
      },
    ),
  ]);
  const liveSample = sampleRead.report;
  const cacheable = homeReadsCacheable({
    summary,
    categories,
    sampleFailed: sampleRead.failed,
    overdraftFailed: overdraftRead.failed,
    showcaseFailed: showcaseRead.failed,
  });
  // A render with a failed read is cached for a minute, not fifteen (see the note at the top).
  if (!cacheable) await shortenPageLife();
  const data = buildHomeData(summary, categories, overdraftRead.detail?.by_fed_district, {
    sample: buildSampleView(liveSample),
    scenario: buildScenario("Overdraft", categories.find((c) => c.fee_category === "overdraft")),
  });

  return (
    <div className="min-h-screen overflow-x-clip bg-paper consumer-brand">
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
        {/* James's order (Oct 16, Oct 17): the promise, the Index, Hamilton in its own section
            (one institution from question to report), the subscription, then the questions. */}
        <LandingHero />
        <LandingProducts data={data} summary={summary} />
        <LandingHamilton report={liveSample} answer={showcaseRead.answer} />
        <LandingPricing />
        <LandingFaq summary={summary} />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
