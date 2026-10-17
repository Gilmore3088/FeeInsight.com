export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { STATE_NAMES, US_TERRITORIES } from "@/lib/us-states";
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
import { charterCountLine, computeFindings, sentenceName } from "../findings";
import { DistrictsExhibit, type DistrictCard, type DistrictFeeCell, type MapFee } from "../districts-exhibit";
import { FindPlace } from "../find-place";
import { HubSection } from "../district/[id]/district-hub";
import { DISTRICT_REGIONS } from "../district/[id]/district-exhibits";
import { stateShape } from "../district/[id]/district-geo";
import { districtOpening, districtsFallback, districtsFinding, feeSide } from "../district/[id]/district-opening";
import { hubFeeKeys } from "../district/[id]/district-hub-view";

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

function sentenceStart(key: string): string {
  const name = sentenceName(key);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export default async function ResearchHubPage({ searchParams }: { searchParams: Promise<{ fee?: string | string[] }> }) {
  const params = await searchParams;
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
  const placeStates = statesWithFees
    .map((s) => ({ code: s.state_code, name: STATE_NAMES[s.state_code] ?? s.state_code, institutions: s.verified_institutions }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    // The hub's card leads with the district's strongest difference; the district page keeps its own opening.
    const opening = indexes
      ? districtOpening(indexes, nationalIndex, showAllCategories, `${name} district`, { lead: "strongest" })
      : null;
    return { id, name, indexes, opening };
  });
  // The map's fees: the district hub's fees this reader may see, kept only where at least half the districts compare.
  const mapFees: MapFee[] = hubFeeKeys(showAllCategories)
    .filter((key) => openings.filter((o) => o.opening && feeSide(o.opening, key) !== null).length >= DISTRICT_IDS.length / 2)
    .map((key) => ({ key, name: sentenceStart(key) }));
  const requestedFee = Array.isArray(params.fee) ? params.fee[0] : params.fee;
  const initialFee = mapFees.find((f) => f.key === requestedFee)?.key ?? mapFees[0]?.key ?? "overdraft";
  const districts: DistrictCard[] = openings.map(({ id, name, indexes, opening }) => ({
    id,
    name,
    region: DISTRICT_REGIONS[id] ?? `the ${name} district`,
    statement: opening?.statement ?? null,
    leadKey: opening?.leadKey ?? null,
    institutions: indexes?.verified_institutions ?? 0,
    fees: Object.fromEntries(
      mapFees.map(({ key }): [string, DistrictFeeCell] => {
        const f = opening?.againstUs.find((x) => x.key === key);
        return [key, { side: opening ? feeSide(opening, key) : null, median: f?.median ?? null, us: f?.us?.median ?? null }];
      }),
    ),
    label: districtLabel(id),
  }));
  // The section's finding for each map fee; the exhibit shows the one for the selected fee.
  const districtLines: Record<string, string> = Object.fromEntries(
    mapFees.map(({ key }) => [
      key,
      districtsFinding(
        openings.map(({ opening }) => (opening ? feeSide(opening, key) : null)),
        DISTRICT_IDS.length,
        key,
      ) ?? districtsFallback(key),
    ]),
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
        <HubSection
          id="find"
          title="Find your state or district"
          line={`Reports cover ${coverageLabel}, plus all 12 Federal Reserve districts.`}
          source={`${PRODUCT_NAME}, verified published fee schedules.${asOf ? ` Data as of ${asOf}.` : ""}`}
        >
          <FindPlace states={placeStates} districts={DISTRICT_IDS.map((id) => ({ id, name: DISTRICT_NAMES[id] ?? `District ${id}` }))} />
        </HubSection>

        <HubFindings findings={findings} line={charterCountLine(benchmarks)} asOf={asOf} />

        <BenchmarkBoard benchmarks={benchmarks} asOf={asOf} />

        <HubSection
          id="districts"
          title="Federal Reserve districts"
          source={
            <>
              {PRODUCT_NAME}, verified published fee schedules, one value per institution, against the national median.
              {asOf ? ` Data as of ${asOf}.` : ""}
            </>
          }
        >
          <div>
            <DistrictsExhibit
              districts={districts}
              mapFees={mapFees}
              initialFee={initialFee}
              findings={districtLines}
              fallback={districtsFallback("overdraft")}
              minInstitutions={STATE_FINDING_MIN_INSTITUTIONS}
            />
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
                Each institution counts once, at the median of its published prices for a fee (overdraft: its highest), and a
                district&apos;s median is taken across its institutions. A district is shaded for a fee only when at least{" "}
                {STATE_FINDING_MIN_INSTITUTIONS} of its institutions publish it; a median within 1% of the national median reads as
                about the same. Each state is shaded by the district that covers most of it. A district&apos;s line names its fee with
                the largest gap from the national median, measured as a percent of that median. The gap must be more than $1. Only fees with at least{" "}
                {STATE_FINDING_MIN_INSTITUTIONS} district institutions count. The district&apos;s own report opens with overdraft and NSF.
              </p>
            </details>
          </div>
        </HubSection>

        {/* Phones reach a state from the finder at the top; the map and directory are for wider screens. */}
        <div className="hidden sm:block">
        <HubSection
          id="states"
          title="State reports"
          source={`${PRODUCT_NAME}, verified published fee schedules. Reports cover ${coverageLabel}; a state is listed once any of its institutions has published fees.`}
        >
          <GeoReports states={coverage.states} />
        </HubSection>
        </div>

        <ResearchLibrary articles={articles} asOf={asOf} />

        <MethodFlow summary={summary} stateCount={stateCount} coverageLabel={coverageLabel} />

        <ProBand sampleLive={sampleLive} />
      </div>

      {/* Anchors clear the sticky header and section bar (/districts lands on #districts). Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`#find, #findings, #benchmarks, #districts, #states, #in-progress, #about-data { scroll-margin-top: 7.5rem; }
      @media (min-width: 640px) { #find, #findings, #benchmarks, #districts, #states, #in-progress, #about-data { scroll-margin-top: 7rem; } }
      @media print {
        header, footer, nextjs-portal, #geo-filter, #find, #district-fee { display: none !important; }
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
