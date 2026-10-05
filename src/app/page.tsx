// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { getNationalIndexCached, type IndexEntry } from "@/lib/data-store";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { CONTACT_EMAIL, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { LandingHero } from "./landing-hero";
import { LandingPriceStrip } from "./landing-price-strip";
import { LandingTrustStats } from "./landing-trust-stats";
import { LandingBankOffer } from "./landing-bank-offer";
import { extractExecutiveSummary, readSampleReportHtml, type ReportFinding } from "@/lib/hosted-reports";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getInstitutionStateDirectorySummariesCached } from "@/lib/data-store/public-cached-reads";

const HOME_TITLE = `${SITE_NAME} — The ${PRODUCT_NAME}`;

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

/** The public sample's executive-summary findings; a missing or changed file just hides them. */
function sampleFindings(): ReportFinding[] {
  try {
    return extractExecutiveSummary(readSampleReportHtml()).findings;
  } catch {
    return [];
  }
}

export default async function LandingPage() {
  const [summary, nationalIndex, stateCoverage] = await Promise.all([
    getPublicStatsSummary(),
    // The price strip and coverage map are optional: a failed read hides them, not the page.
    getNationalIndexCached().catch((): IndexEntry[] => []),
    getInstitutionStateDirectorySummariesCached({}).catch((): InstitutionStateDirectorySummary[] => []),
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
        <LandingHero institutionsLabel={summary.institutionsLabel} />
        <LandingPriceStrip entries={nationalIndex} institutionsLabel={summary.institutionsLabel} />
        <LandingBankOffer findings={sampleFindings()} />
        <LandingTrustStats summary={summary} states={stateCoverage} />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
