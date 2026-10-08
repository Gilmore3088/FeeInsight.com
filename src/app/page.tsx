// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPublicSnapshot } from "@/lib/public-stats";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { LandingHero } from "./landing-hero";
import { LandingPriceStrip } from "./landing-price-strip";
import { LandingTrustStats } from "./landing-trust-stats";
import { LandingBankOffer } from "./landing-bank-offer";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getInstitutionStateDirectorySummariesCached } from "@/lib/data-store/public-cached-reads";

const HOME_TITLE = `${SITE_NAME} — Bank and credit union fees, traced to the source`;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description:
    "What does your bank charge? Look up overdraft, ATM, wire and monthly fees for U.S. banks and credit unions — every figure traced to the published schedule. Institutions: peer benchmarking, scenarios, and board-ready reports.",
  openGraph: {
    title: HOME_TITLE,
    description:
      "Look up overdraft, ATM, wire and monthly fees for U.S. banks and credit unions — every figure traced to the published schedule. Free lookup; peer benchmarking for banking teams.",
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  legalName: LEGAL_ENTITY_NAME,
  url: SITE_URL,
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
  // Counts and medians come from one shared snapshot, so they match the fee index,
  // research hub and directory to the number.
  const [{ summary, categories }, stateCoverage, sampleLive] = await Promise.all([
    getPublicSnapshot(),
    // The coverage map is optional: a failed read hides it, not the page.
    getInstitutionStateDirectorySummariesCached({}).catch((): InstitutionStateDirectorySummary[] => []),
    sampleReportAvailable(),
  ]);

  return (
    <div className="min-h-screen bg-[#FAF7F2] consumer-brand">
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
        <LandingHero institutionsLabel={summary.institutionsLabel} sampleLive={sampleLive} />
        <LandingPriceStrip categories={categories} refreshedOn={summary.refreshedOn} />
        <LandingBankOffer sampleLive={sampleLive} />
        <LandingTrustStats summary={summary} states={stateCoverage} />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
