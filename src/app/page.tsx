// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPublicSnapshot } from "@/lib/public-stats";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { buildSampleStory } from "@/components/home/sample-story";
import { buildHomeData } from "@/components/home/home-data";
import { HomeHero } from "@/components/home/home-hero";
import { EveryFeeSection, OneWorkspaceSection } from "@/components/home/home-pillars";
import { DrilldownSection } from "@/components/home/home-drilldown";
import { OperatingRecordSection, PricingPreviewSection } from "@/components/home/home-record-pricing";
import { ClosingBand, FaqSection, homeFaq } from "@/components/home/home-faq-close";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";

const HOME_TITLE = `${SITE_NAME} — Bank and credit union fees, traced to the source`;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description:
    "Look up overdraft, ATM, wire and monthly fees at U.S. banks and credit unions, each traced to its published schedule. Peer benchmarks for banking teams.",
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
  // Counts and medians come from one shared snapshot, so they match the fee index,
  // research hub and directory to the number.
  const [snapshot, sampleReport] = await Promise.all([
    getPublicSnapshot(),
    // The live sample is optional: without it the sizzle shows labelled example scenes.
    loadSampleReport().catch(() => null),
  ]);
  const sample = buildSampleStory(sampleReport);
  const data = buildHomeData(snapshot);
  const faq = homeFaq(data);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <div className="min-h-screen bg-paper">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <ConsumerNav />
      <main id="main-content">
        <HomeHero data={data} sample={sample} />
        <EveryFeeSection data={data} />
        <DrilldownSection data={data} sample={sample} />
        <OneWorkspaceSection />
        <OperatingRecordSection data={data} />
        <PricingPreviewSection />
        <FaqSection items={faq} />
        <ClosingBand />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
