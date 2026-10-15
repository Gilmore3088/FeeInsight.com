// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPublicSnapshot } from "@/lib/public-stats";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getFeeCategoryDetailCached } from "@/lib/data-store/public-cached-reads";
import { LandingHero } from "./landing-hero";
import { LandingSizzle } from "./landing-sizzle";
import { LandingBeforeAfter } from "./landing-before-after";
import { LandingPillars } from "./landing-pillars";
import { LandingProvenance } from "./landing-provenance";
import { LandingPricing } from "./landing-pricing";
import { LandingFaq } from "./landing-faq";
import { LandingClose } from "./landing-close";
import { buildHomeData } from "./landing-shared";

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
  // read /fees/overdraft already makes; a failed read only hides the district rows.
  const [{ summary, categories }, sampleLive, overdraftDetail] = await Promise.all([
    getPublicSnapshot(),
    sampleReportAvailable(),
    getFeeCategoryDetailCached("overdraft").catch((error: unknown) => {
      console.error("[home] overdraft district read failed; district rows hidden", error);
      return null;
    }),
  ]);
  const data = buildHomeData(summary, categories, overdraftDetail?.by_fed_district);

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
        <LandingSizzle data={data} />
        <LandingBeforeAfter />
        <LandingPillars data={data} />
        <LandingProvenance summary={summary} />
        <LandingPricing />
        <LandingFaq summary={summary} />
        <LandingClose />
      </main>
      <CustomerFooter sampleReport={sampleLive} />
      <SearchModal />
    </div>
  );
}
