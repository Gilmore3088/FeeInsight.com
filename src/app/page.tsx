// Renders live DB-backed stats at request time; must not be statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getPublicSnapshot } from "@/lib/public-stats";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { CONTACT_EMAIL, LEGAL_ENTITY_NAME, PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { LandingHero } from "./landing-hero";
import { LandingTrustStats } from "./landing-trust-stats";
import { LandingBankOffer } from "./landing-bank-offer";
import { LandingValueShowcase } from "./landing-value-showcase";
import type { BenchmarkRow } from "./subscribe/benchmark-preview";
import type { AnalyzeScenario } from "./subscribe/analyze-demo";
import { getFeeChangeEvents } from "@/lib/data-store/fee-changes";
import { getDisplayName } from "@/lib/fee-taxonomy";

import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getInstitutionStateDirectorySummariesCached } from "@/lib/data-store/public-cached-reads";
import { AmbientGlow, INTERACTION } from "@/components/public/site-look";

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
  const [{ summary, categories }, stateCoverage, recentChanges] = await Promise.all([
    getPublicSnapshot(),
    // The coverage map is optional: a failed read hides it, not the page.
    getInstitutionStateDirectorySummariesCached({}).catch((): InstitutionStateDirectorySummary[] => []),
    getFeeChangeEvents({ limit: 3 }).catch(() => []),
  ]);

  const showcaseOrder = ["overdraft", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing", "nsf"];
  const benchmarkRows: BenchmarkRow[] = showcaseOrder
    .map((category) => categories.find((entry) => entry.fee_category === category))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.median_amount != null))
    .slice(0, 5)
    .map((entry) => ({
      category: entry.fee_category,
      label: getDisplayName(entry.fee_category).replace(/\s*\([^)]*\)/g, ""),
      median: Number(entry.median_amount),
      p25: entry.p25_amount == null ? null : Number(entry.p25_amount),
      p75: entry.p75_amount == null ? null : Number(entry.p75_amount),
      institutions: entry.institution_count,
      value: null,
      position: null,
    }));

  const scenarioEntry =
    categories.find((entry) => entry.fee_category === "overdraft" && entry.median_amount != null) ??
    categories.find((entry) => entry.median_amount != null);
  const scenario: AnalyzeScenario | null = scenarioEntry?.median_amount == null
    ? null
    : {
        feeLabel: getDisplayName(scenarioEntry.fee_category).replace(/\s*\([^)]*\)/g, ""),
        price:
          Number(scenarioEntry.median_amount) >= 10
            ? Math.max(0, Math.round(Number(scenarioEntry.median_amount)) - 5)
            : Math.round(Number(scenarioEntry.median_amount) * 80) / 100,
        median: Number(scenarioEntry.median_amount),
        p25: scenarioEntry.p25_amount == null ? null : Number(scenarioEntry.p25_amount),
        p75: scenarioEntry.p75_amount == null ? null : Number(scenarioEntry.p75_amount),
        institutions: scenarioEntry.institution_count,
      };

  const monitorChanges = recentChanges.map((change) => ({
    id: change.id,
    institution: change.institution_name,
    feeLabel: getDisplayName(change.fee_category).replace(/\s*\([^)]*\)/g, ""),
    oldAmount: change.old_amount,
    newAmount: change.new_amount,
    changedAt: change.changed_at,
  }));

  return (
    <div className={`consumer-brand relative isolate min-h-screen overflow-x-clip bg-[#FAF7F2] ${INTERACTION}`}>
      {/* The glass surfaces need colour behind them: the /subscribe light sources, no motion. */}
      <AmbientGlow />
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
        {scenario && benchmarkRows.length > 0 ? (
          <LandingHero
            institutionsLabel={summary.institutionsLabel}
            showcase={
              <LandingValueShowcase
                rows={benchmarkRows}
                totalInstitutions={summary.institutions}
                scenario={scenario}
                changes={monitorChanges}
              />
            }
          />
        ) : (
          <LandingHero
            institutionsLabel={summary.institutionsLabel}
            showcase={<div className="rounded-2xl bg-white/70 p-6 ring-1 ring-[#E8E1D6]">Live examples are loading.</div>}
          />
        )}
        <LandingBankOffer />
        <LandingTrustStats summary={summary} states={stateCoverage} />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
