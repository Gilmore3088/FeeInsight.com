// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPublicSnapshot } from "@/lib/public-stats";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { HomeHeader } from "@/components/home/home-header";
import { HomeHero } from "@/components/home/home-hero";
import { HomeStats } from "@/components/home/home-stats";
import { HomeReport } from "@/components/home/home-report";
import { HomeClosing } from "@/components/home/home-closing";
import { HomeFooter } from "@/components/home/home-footer";

const HOME_TITLE = `${SITE_NAME} — See where your fees sit against your competitors`;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description:
    "Published overdraft, ATM, wire and monthly fees for U.S. banks and credit unions, each read from the institution's own schedule and compared with named peers in your market.",
  openGraph: {
    title: HOME_TITLE,
    description:
      "Published fees for U.S. banks and credit unions, each read from the institution's own schedule and compared with named peers in your market.",
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

/**
 * Homepage v2 in the Index look: header, hero with the walkthrough video, four live
 * numbers, the sample report, the walkthrough form, footer. One headline and one
 * sentence per section. The counts come from the shared public snapshot, so they match
 * the fee index and research hub to the number.
 */
export default async function LandingPage() {
  const { summary } = await getPublicSnapshot();

  return (
    <div className="index-look min-h-screen bg-white text-index-navy">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
      />
      <HomeHeader />
      <main id="main-content">
        <HomeHero />
        <HomeStats summary={summary} />
        <HomeReport />
        <HomeClosing />
      </main>
      <HomeFooter />
    </div>
  );
}
