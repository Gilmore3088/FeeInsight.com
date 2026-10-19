/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown
 * invalidates the public read cache its reads carry (#1811). The page reads no session,
 * cookies or search params; the header's signed-in parts are client islands. A render
 * with a failed read is cached for a minute instead (`shortenPageLife`, as the homepage).
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import Link from "next/link";
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
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { softRead } from "@/lib/soft-read";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { STATE_FINDING_MIN_INSTITUTIONS } from "@/lib/research-report/state-findings";
import { ResearchHero, ResearchSectionNav } from "../research-hero";
import { BenchmarkBoard, pickBenchmarks } from "../benchmark-board";
import { GeoReports } from "../geo-reports";
import { ResearchLibrary } from "../research-library";
import { MethodFlow, ProBand } from "../method-flow";
import { HubFindings } from "../hub-findings";
import { computeFindings, sentenceName } from "../findings";
import { DistrictsExhibit, type DistrictCard, type DistrictFeeCell, type MapFee } from "../districts-exhibit";
import { ExploreMarket } from "../explore-market";
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

export default async function ResearchHubPage() {
  // The page renders what a signed-out reader sees, so it can be cached for everyone.
  const showAllCategories = false;

  // All reads are served from the public cache between publishes. Counts and benchmarks
  // come from one shared snapshot, so they match the homepage and fee index.
  // The coverage read is required: without it the page would state a wrong state count, so a
  // failure goes to the error boundary. A failed optional read hides its part, and the render
  // is cached for a minute, not an hour.
  const [{ summary, categories: summaries }, coverage, articlesRead, nationalIndex, districtReads, sampleRead] = await Promise.all([
    getPublicSnapshot(),
    getResearchCoverageCached(),
    softRead(getPublishedArticleSummariesCached(ARTICLE_LIMIT), [] as ArticleSummary[]),
    getPublicNationalIndex(),
    Promise.all(DISTRICT_IDS.map((id) => softRead(getDistrictFeeIndexesCached(id), null as StateFeeIndexes | null))),
    softRead(sampleReportAvailable(), false),
  ]);
  const articles = articlesRead.value;
  const districtIndexes = districtReads.map((r) => r.value);
  const sampleLive = sampleRead.value;
  if (!summary.complete || summaries.length === 0 || articlesRead.failed || sampleRead.failed || districtReads.some((r) => r.failed)) {
    await shortenPageLife();
  }

  const statesWithFees = coverage.states.filter((s) => s.verified_institutions > 0);
  // US_TERRITORIES includes DC; count DC separately.
  const territoryCount = statesWithFees.filter((s) => US_TERRITORIES.has(s.state_code) && s.state_code !== "DC").length;
  const hasDc = statesWithFees.some((s) => s.state_code === "DC");
  const stateCount = statesWithFees.length - territoryCount - (hasDc ? 1 : 0);
  const benchmarks = pickBenchmarks(summaries);
  const findings = computeFindings(benchmarks);
  const asOf = summary.refreshedOn;
  const coverageLabel = `${stateCount} states${hasDc ? ", DC" : ""}${territoryCount > 0 ? ` and ${territoryCount} territories` : ""}`;

  // Every district card reads the same fee; each district's other large gaps sit in its own report.
  const openings = DISTRICT_IDS.map((id, i) => {
    const indexes = districtIndexes[i];
    const name = DISTRICT_NAMES[id] ?? `District ${id}`;
    const opening = indexes ? districtOpening(indexes, nationalIndex, showAllCategories, `${name} district`) : null;
    return { id, name, indexes, opening };
  });
  // The map's fees: the district hub's fees this reader may see, kept only where at least half the districts compare.
  const mapFees: MapFee[] = hubFeeKeys(showAllCategories)
    .filter((key) => openings.filter((o) => o.opening && feeSide(o.opening, key) !== null).length >= DISTRICT_IDS.length / 2)
    .map((key) => ({ key, name: sentenceStart(key) }));
  // The map opens on an everyday account fee rather than overdraft, so overdraft isn't the page's lead story.
  const initialFee = mapFees.find((f) => f.key === "monthly_maintenance")?.key ?? mapFees[0]?.key ?? "overdraft";
  const districts: DistrictCard[] = openings.map(({ id, name, indexes, opening }) => ({
    id,
    name,
    region: DISTRICT_REGIONS[id] ?? `the ${name} district`,
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
  const LINK = "inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink";

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
        <HubFindings findings={findings} asOf={asOf} />

        <HubSection
          id="explore"
          title="Explore your market"
          line={`Reports for ${coverageLabel}, all 12 Federal Reserve districts and the U.S.`}
          source={
            <>
              {PRODUCT_NAME}, verified published fee schedules, one value per institution. A state is listed once any of its institutions
              has published fees.{asOf ? ` Data as of ${asOf}.` : ""}
            </>
          }
        >
          <ExploreMarket
            state={<GeoReports states={coverage.states} />}
            district={
              <div>
                <DistrictsExhibit
                  districts={districts}
                  mapFees={mapFees}
                  initialFee={initialFee}
                  findings={districtLines}
                  fallback={districtsFallback(initialFee)}
                  minInstitutions={STATE_FINDING_MIN_INSTITUTIONS}
                />
                <details className="group mt-3">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
                    How districts are compared
                    <span aria-hidden="true" className="transition-transform group-open:rotate-90">&rsaquo;</span>
                  </summary>
                  <p className="max-w-3xl text-[13px] leading-relaxed text-ink-muted">
                    Each institution counts once, at the median of its published prices for a fee (overdraft: its highest), and a
                    district&apos;s median is taken across its institutions. A district is shaded only when at least{" "}
                    {STATE_FINDING_MIN_INSTITUTIONS} of its institutions publish the fee. A gap under 1% of the national median is
                    shaded as &ldquo;within 1%&rdquo;; the card still shows both figures. Each state is shaded by the district that
                    covers most of it. A district&apos;s own report lists its other notable differences.
                  </p>
                </details>
              </div>
            }
            national={
              <div className="max-w-3xl">
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  U.S. medians for {summary.categoriesLabel} fee categories from {summary.institutionsLabel} banks and credit unions.
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-6">
                  <li>
                    <a href="#benchmarks" className={LINK}>
                      Everyday fees, banks against credit unions
                    </a>
                  </li>
                  <li>
                    <Link href="/research/national-fee-index" className={LINK}>
                      The national fee index
                    </Link>
                  </li>
                  <li>
                    <Link href="/fees" className={LINK}>
                      Every fee category
                    </Link>
                  </li>
                </ul>
              </div>
            }
          />
        </HubSection>

        <BenchmarkBoard benchmarks={benchmarks} asOf={asOf} />

        <ProBand sampleLive={sampleLive} />

        <MethodFlow summary={summary} stateCount={stateCount} coverageLabel={coverageLabel} />

        <ResearchLibrary articles={articles} asOf={asOf} />
      </div>

      {/* Anchors clear the sticky header and section bar. Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`#findings, #explore, #districts, #benchmarks, #apply, #about-data, #in-progress { scroll-margin-top: 7.5rem; }
      @media (min-width: 640px) { #findings, #explore, #districts, #benchmarks, #apply, #about-data, #in-progress { scroll-margin-top: 7rem; } }
      @media print {
        header, footer, nextjs-portal, #geo-filter, #district-fee, [role="tablist"] { display: none !important; }
        [role="tabpanel"][hidden] { display: block !important; }
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
