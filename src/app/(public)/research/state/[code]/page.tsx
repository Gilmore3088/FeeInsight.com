export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { linkPreview } from "@/lib/link-preview";
import { notFound } from "next/navigation";
import { isFeaturedFee } from "@/lib/fee-taxonomy";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories, canAccessPremium } from "@/lib/access";
import { ProNextStep } from "@/components/public/pro-next-step";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { UpgradeGate } from "@/components/upgrade-gate";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { LeadCapture } from "@/components/public/lead-capture";
import { REPORT_OFFER, SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import {
  getCitiesInStateCached,
  getStateEconomicContextCached,
  getStateFeeIndexesCached,
  getStateStatsCached,
} from "@/lib/data-store/public-cached-reads";
import type { StateEconomicContext } from "@/lib/data-store/economic-context";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import type { CitySummary, StateFeeIndexes } from "@/lib/data-store";
import { ResearchSectionNav } from "../../research-hero";
import { BENCHMARK_KEYS } from "../../benchmark-board";
import { CharterExhibit, KeyFindings } from "../../exhibits";
import { EconomyExhibit } from "./economy-exhibit";
import { buildCharterPairs, buildComparisons, computeStateFindings } from "@/lib/research-report/state-findings";
import {
  CoverageExhibit,
  FullTable,
  PositionExhibit,
  STATE_SECTIONS,
  StateBenchmarkBoard,
  StateHero,
  StateMethodology,
} from "./state-exhibits";

interface PageProps {
  params: Promise<{ code: string }>;
}

const CITY_LIMIT = 12;

const EMPTY_INDEXES: StateFeeIndexes = {
  all: [],
  bank: [],
  credit_union: [],
  verified_institutions: 0,
  verified_bank_institutions: 0,
  verified_cu_institutions: 0,
  verified_fees: 0,
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const name = STATE_NAMES[stateCode];
  if (!name) return { title: "State Not Found" };
  // Thin states (fewer institutions with published fees than the median floor) stay out of
  // search; the sitemap leaves them out too. A failed read keeps the page indexable.
  const stats = await getStateStatsCached(stateCode).catch(() => null);
  const thin = stats !== null && stats.with_fees < MIN_INSTITUTIONS_FOR_MEDIAN;

  const title = `${name} Bank Fees - State Fee Report`;
  const description = `What ${name} banks and credit unions charge for overdraft, NSF, maintenance, ATM and wire fees, compared with national medians. Every figure from verified, published fee schedules.`;
  return {
    title,
    // One URL per state: /research/state/tx and /research/state/TX both render this page.
    alternates: { canonical: `/research/state/${stateCode}` },
    ...(thin ? { robots: { index: false, follow: true } } : {}),
    description,
    ...linkPreview({ title, description, path: `/research/state/${stateCode}` }),
    keywords: [
      `${name} bank fees`,
      `${name} overdraft fees`,
      `${name} credit union fees`,
      `bank fees by state`,
      `${name} ATM fees`,
    ],
  };
}

const EMPTY_ECONOMY: StateEconomicContext = {
  state_unemployment: null,
  state_payrolls: null,
  national_unemployment: null,
  fed_funds: null,
  cpi_all_items: null,
  cpi_bank_services: null,
  beige_book: null,
  regulatory: [],
};

async function loadCities(stateCode: string): Promise<CitySummary[]> {
  try {
    return (await getCitiesInStateCached(stateCode)).slice(0, CITY_LIMIT);
  } catch {
    // The city list is supporting detail; a failed read hides it rather than failing the report.
    return [];
  }
}

export default async function StateReportPage({ params }: PageProps) {
  const { code } = await params;
  const stateCode = code.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) notFound();

  const user = await getCurrentUser();
  const sampleLive = await sampleReportAvailable();
  const showAllCategories = canAccessAllCategories(user);

  // Every read is served from the public cache between publishes.
  const district = STATE_TO_DISTRICT[stateCode];
  const [summary, stats, indexes, nationalIndex, cities, economy] = await Promise.all([
    getPublicStatsSummary(),
    getStateStatsCached(stateCode),
    getStateFeeIndexesCached(stateCode).catch(() => EMPTY_INDEXES),
    getPublicNationalIndex(),
    loadCities(stateCode),
    // Context only: a failed read hides the exhibit rather than failing the report.
    getStateEconomicContextCached(stateCode, district ?? null).catch(() => EMPTY_ECONOMY),
  ]);
  const districtStates = district
    ? Object.entries(STATE_TO_DISTRICT)
        .filter(([s, d]) => d === district && s !== stateCode && STATE_NAMES[s])
        .map(([s]) => s)
    : [];
  const asOf = summary.refreshedOn;

  const comparisons = buildComparisons(indexes.all, nationalIndex);
  const featured = comparisons.filter((c) => isFeaturedFee(c.fee_category));
  const extended = comparisons.filter((c) => !isFeaturedFee(c.fee_category));
  const visible = showAllCategories ? comparisons : featured;
  const everyday = BENCHMARK_KEYS.map((k) => comparisons.find((c) => c.fee_category === k)).filter(
    (c): c is NonNullable<typeof c> => !!c,
  );
  const charterPairs = buildCharterPairs(
    indexes.bank,
    indexes.credit_union,
    visible.map((c) => c.fee_category),
  );
  const findings = computeStateFindings(stateName, visible, charterPairs);
  const gate =
    !showAllCategories && extended.length > 0 ? (
      <div className="mt-4 print:hidden">
        <UpgradeGate
          count={extended.length}
          message={`${extended.length} more ${stateName} fee categories in Pro`}
          from={`/research/state/${stateCode}`}
        />
      </div>
    ) : null;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: stateName, href: `/research/state/${stateCode}` },
        ]}
      />

      <StateHero
        stateCode={stateCode}
        stateName={stateName}
        district={district}
        monitored={stats.institution_count}
        verifiedInstitutions={indexes.verified_institutions}
        verifiedFees={indexes.verified_fees}
        categoriesWithMedian={comparisons.length}
        freshnessLabel={summary.freshnessLabel}
      />
      <ResearchSectionNav sections={STATE_SECTIONS} label={`${stateName} report sections`} />

      <div className="mx-auto max-w-page space-y-20 px-4 py-14 sm:px-6">
        <KeyFindings findings={findings} asOf={asOf} />

        <StateBenchmarkBoard rows={everyday} stateCode={stateCode} stateName={stateName} asOf={asOf} />

        <LeadCapture
          placement="state_benchmark"
          className="print:hidden"
          stateCode={stateCode}
          eyebrow="Free benchmark"
          headline={`Get the free ${stateName} fee benchmark`}
          body={`Leave your email and we'll send you the link to the ${stateName} medians against national, updated as new fee schedules are verified.`}
          buttonLabel="Send it to me"
          secondaryLink={
            sampleLive
              ? { href: "/reports/sample-competitive-fee-position", label: `See the sample ${REPORT_OFFER.name}` }
              : { href: `/for-institutions?report=institution&src=state-${stateCode.toLowerCase()}#report`, label: REPORT_OFFER.institutionCtaLabel }
          }
        />

        <PositionExhibit rows={visible} stateName={stateName} asOf={asOf} />

        <CharterExhibit benchmarks={charterPairs} asOf={asOf} eyebrow="Exhibit 3 · Banks vs credit unions" place={stateName} />

        <EconomyExhibit stateName={stateName} district={district} ctx={economy} />

        <CoverageExhibit
          stateCode={stateCode}
          stateName={stateName}
          district={district}
          districtStates={districtStates}
          banks={{ verified: indexes.verified_bank_institutions, monitored: stats.bank_count }}
          cus={{ verified: indexes.verified_cu_institutions, monitored: stats.cu_count }}
          cities={cities}
          asOf={asOf}
        />

        <FullTable rows={visible} stateName={stateName} gate={gate} asOf={asOf} />

        <StateMethodology stateName={stateName} />

        {!canAccessPremium(user) && <ProNextStep />}
      </div>

      {/* Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`@media print {
        header, footer, nextjs-portal { display: none !important; }
        body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        section { break-inside: avoid-page; }
        a { text-decoration: none !important; }
      }`}</style>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${stateName} Bank & Credit Union Fees`,
            description: `Fee benchmarks for banks and credit unions in ${stateName}, compared with national medians.`,
            url: `${SITE_URL}/research/state/${stateCode}`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
