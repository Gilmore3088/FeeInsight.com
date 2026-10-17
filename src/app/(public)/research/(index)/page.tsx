export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { US_TERRITORIES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_URL } from "@/lib/constants";
import { getPublicNationalIndex, getPublicSnapshot } from "@/lib/public-stats";
import {
  getDistrictFeeIndexesCached,
  getPublishedArticleSummariesCached,
  getResearchCoverageCached,
} from "@/lib/data-store/public-cached-reads";
import type { ArticleSummary } from "@/lib/data-store/articles";
import type { StateFeeIndexes } from "@/lib/data-store";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getStatesForDistrict } from "@/lib/us-map-paths";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAllCategories } from "@/lib/access";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { STATE_FINDING_MIN_INSTITUTIONS } from "@/lib/research-report/state-findings";
import { ResearchHero, ResearchSectionNav } from "../research-hero";
import { BenchmarkBoard, pickBenchmarks } from "../benchmark-board";
import { GeoReports } from "../geo-reports";
import { ResearchLibrary } from "../research-library";
import { MethodFlow, ProBand } from "../method-flow";
import { HubFindings } from "../hub-findings";
import { charterCountLine, computeFindings } from "../findings";
import { DistrictsExhibit, type DistrictCard } from "../districts-exhibit";
import { HubSection } from "../district/[id]/district-hub";
import { DISTRICT_REGIONS } from "../district/[id]/district-exhibits";
import { stateShape } from "../district/[id]/district-geo";
import { districtOpening, districtsFinding, overdraftSide } from "../district/[id]/district-opening";

export const metadata: Metadata = {
  title: "Bank Fee Research by State and Fed District",
  description:
    "National medians for everyday bank and credit union fees, all 12 Federal Reserve districts against the U.S., and a report for each state.",
  alternates: { canonical: "/research" },
};

const ARTICLE_LIMIT = 5;
const DISTRICT_IDS = Array.from({ length: 12 }, (_, i) => i + 1);
/** Alaska, Hawaii and the territories sit in insets or off the map, so they don't place a district's label. */
const OFF_MAINLAND = new Set(["AK", "HI", "PR", "VI", "GU", "AS", "MP"]);

async function loadArticles(): Promise<ArticleSummary[]> {
  try {
    return await getPublishedArticleSummariesCached(ARTICLE_LIMIT);
  } catch {
    // The article list is optional; a failed read hides it rather than failing the page.
    return [];
  }
}

/**
 * District 7's size-weighted center falls on Lake Michigan, so its number sits on Illinois's
 * label point instead.
 */
const LABEL_STATE: Record<number, string> = { 7: "IL" };

/** Where a district's number sits: its mainland states' label points, weighted by each state's size. */
function districtLabel(district: number): { x: number; y: number } | null {
  const fixed = LABEL_STATE[district] ? stateShape(LABEL_STATE[district]) : null;
  if (fixed) return fixed.label;
  const shapes = getStatesForDistrict(district)
    .filter((c) => !OFF_MAINLAND.has(c))
    .map((c) => stateShape(c))
    .filter((s) => s !== null);
  const weight = shapes.reduce((sum, s) => sum + s.box.w * s.box.h, 0);
  if (weight <= 0) return null;
  return {
    x: shapes.reduce((sum, s) => sum + s.label.x * s.box.w * s.box.h, 0) / weight,
    y: shapes.reduce((sum, s) => sum + s.label.y * s.box.w * s.box.h, 0) / weight,
  };
}

export default async function ResearchHubPage() {
  const user = await getCurrentUser();
  // The districts exhibit prints each district page's opening line for the same reader.
  const showAllCategories = canAccessAllCategories(user);

  // All reads are served from the public cache between publishes. Counts and benchmarks
  // come from one shared snapshot, so they match the homepage and fee index.
  const [{ summary, categories: summaries }, coverage, articles, nationalIndex, districtIndexes, sampleLive] = await Promise.all([
    getPublicSnapshot(),
    getResearchCoverageCached(),
    loadArticles(),
    getPublicNationalIndex(),
    Promise.all(DISTRICT_IDS.map((id) => getDistrictFeeIndexesCached(id).catch((): StateFeeIndexes | null => null))),
    sampleReportAvailable().catch(() => false),
  ]);

  const statesWithFees = coverage.states.filter((s) => s.verified_institutions > 0);
  // US_TERRITORIES includes DC; count DC separately.
  const territoryCount = statesWithFees.filter((s) => US_TERRITORIES.has(s.state_code) && s.state_code !== "DC").length;
  const hasDc = statesWithFees.some((s) => s.state_code === "DC");
  const stateCount = statesWithFees.length - territoryCount - (hasDc ? 1 : 0);
  const benchmarks = pickBenchmarks(summaries);
  const findings = computeFindings(benchmarks);
  const asOf = summary.refreshedOn;
  const coverageLabel = `${stateCount} states${hasDc ? ", DC" : ""}${territoryCount > 0 ? ` and ${territoryCount} territories` : ""}`;

  // Each district's line is the one its own page opens with, from the same index and helper.
  const openings = DISTRICT_IDS.map((id, i) => {
    const indexes = districtIndexes[i];
    const name = DISTRICT_NAMES[id] ?? `District ${id}`;
    const opening = indexes ? districtOpening(indexes, nationalIndex, showAllCategories, `${name} district`) : null;
    return { id, name, indexes, opening };
  });
  const districts: DistrictCard[] = openings.map(({ id, name, indexes, opening }) => ({
    id,
    name,
    region: DISTRICT_REGIONS[id] ?? `the ${name} district`,
    statement: opening?.statement ?? null,
    institutions: indexes?.verified_institutions ?? 0,
    side: opening ? overdraftSide(opening) : null,
    label: districtLabel(id),
  }));
  const districtLine = districtsFinding(
    districts.map((d) => d.side),
    DISTRICT_IDS.length,
  );
  const withoutLine = districts.filter((d) => !d.statement).length;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
        ]}
      />

      <ResearchHero summary={summary} sampleHref={sampleLive ? "/reports/sample-competitive-fee-position" : null} />
      <ResearchSectionNav />

      <div className="mx-auto max-w-page space-y-16 px-4 py-10 sm:space-y-24 sm:px-6 sm:py-14">
        <HubFindings findings={findings} line={charterCountLine(benchmarks)} asOf={asOf} />

        <BenchmarkBoard benchmarks={benchmarks} asOf={asOf} />

        <HubSection
          id="districts"
          title="Federal Reserve districts"
          line={districtLine ?? "Too few districts have enough published overdraft fees yet for a comparison."}
          source={
            <>
              {PRODUCT_NAME}, verified published fee schedules, one value per institution, against the national median.
              {asOf ? ` Data as of ${asOf}.` : ""}
            </>
          }
        >
          <div>
            <DistrictsExhibit districts={districts} />
            {withoutLine > 0 && (
              <p className="mt-3 text-[13px] text-ink-muted sm:mx-0 sm:text-left">
                {withoutLine === 1 ? "One district has" : `${withoutLine} districts have`} too few published fees yet for a headline.
              </p>
            )}
            <details className="group mt-3">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-brick [&::-webkit-details-marker]:hidden">
                How districts are compared
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">&rsaquo;</span>
              </summary>
              <p className="max-w-3xl text-[13px] leading-relaxed text-ink-muted sm:mx-0 sm:text-left">
                Each institution counts once, at its highest published overdraft price, and a district&apos;s median is taken across
                its institutions. A district is shaded and counted only when at least {STATE_FINDING_MIN_INSTITUTIONS} of its
                institutions publish an overdraft fee; a median within 1% of the national median reads as about the same. Each
                state is shaded by the district that covers most of it. A district&apos;s line is the opening finding of its own
                report, which ranks only fees with at least {STATE_FINDING_MIN_INSTITUTIONS} district institutions.
              </p>
            </details>
          </div>
        </HubSection>

        <HubSection
          id="states"
          title="State reports"
          source={`${PRODUCT_NAME}, verified published fee schedules. Reports cover ${coverageLabel}; a state is listed once any of its institutions has published fees.`}
        >
          <GeoReports states={coverage.states} />
        </HubSection>

        <ResearchLibrary articles={articles} asOf={asOf} />

        <MethodFlow summary={summary} stateCount={stateCount} coverageLabel={coverageLabel} />

        <ProBand sampleLive={sampleLive} />
      </div>

      {/* Anchors clear the sticky header and section bar (/districts lands on #districts). Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`#findings, #benchmarks, #districts, #states, #in-progress, #about-data { scroll-margin-top: 7.5rem; }
      @media (min-width: 640px) { #findings, #benchmarks, #districts, #states, #in-progress, #about-data { scroll-margin-top: 7rem; } }
      @media print {
        header, footer, nextjs-portal, #geo-filter, #geo-pick { display: none !important; }
        body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        section { break-inside: avoid-page; }
        a { text-decoration: none !important; }
      }`}</style>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Bank Fee Research",
            description:
              "National benchmarks and geographic analysis of bank and credit union fees by Federal Reserve district and state.",
            url: `${SITE_URL}/research`,
            hasPart: DISTRICT_IDS.map((id) => ({
              "@type": "WebPage",
              name: `${DISTRICT_NAMES[id]} Fed District ${id} Fee Analysis`,
              url: `${SITE_URL}/research/district/${id}`,
            })),
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
