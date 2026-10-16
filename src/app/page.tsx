/**
 * Regenerated in the background (ISR) at most every 15 minutes, and sooner when a
 * takedown invalidates the public read cache, whose tag every read below carries.
 *
 * The page reads no session, cookies or search params: the header's signed-in parts are
 * client islands (consumer-nav.tsx). It used to render per request (`force-dynamic`), and
 * on Oct 8-15 its function TTFB was 146 ms at p50 but 3,834 ms at p75 (#1168), the slow
 * renders being the ones whose cached reads had to go to the database.
 *
 * A render with a failed read is never cached (`homeReadsCacheable`): at build time it
 * falls back to rendering per request for that deployment, and in a background
 * regeneration it fails, so the last good page keeps being served. A database blip
 * therefore never bakes a homepage with blank numbers.
 */
export const revalidate = 900;

import type { Metadata } from "next";
import { connection } from "next/server";
import { getPublicSnapshot } from "@/lib/public-stats";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { LandingHero } from "./landing-hero";
import { LandingResearch } from "./landing-demo";
import { LandingWorkflow } from "./landing-workflow";
import { LandingProvenance } from "./landing-provenance";
import { LandingPricing } from "./landing-pricing";
import { LandingFaq } from "./landing-faq";
import { LandingClose } from "./landing-close";
import { buildHomeData, buildSampleView, homeReadsCacheable } from "./landing-shared";
import { buildScenario } from "./subscribe/scenario";

// The buyer promise from site v3 brief 08 §B.3 (h1) and its subhead; no counts, so nothing goes stale.
const HOME_TITLE = `Know where your fees stand, with a source for every figure | ${SITE_NAME}`;
const HOME_DESCRIPTION =
  `The ${PRODUCT_NAME} reads the published fee schedules of U.S. banks and credit unions. ` +
  "See each of your fees against your market, your state, your Fed district, your peer group and the nation.";

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
  const [{ summary, categories }, sampleRead, overdraftRead] = await Promise.all([
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
  ]);
  const liveSample = sampleRead.report;
  const cacheable = homeReadsCacheable({
    summary,
    categories,
    sampleFailed: sampleRead.failed,
    overdraftFailed: overdraftRead.failed,
  });
  // Opts this render out of the page cache (see the note at the top of the file).
  if (!cacheable) await connection();
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
        <LandingHero summary={summary} />
        <LandingResearch data={data} />
        <LandingWorkflow report={liveSample} />
        <LandingProvenance summary={summary} />
        <LandingPricing />
        <LandingFaq summary={summary} />
        <LandingClose />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
