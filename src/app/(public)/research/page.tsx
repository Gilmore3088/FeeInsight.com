export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { US_TERRITORIES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { AudiencePaths } from "@/components/public/audience-paths";
import { SITE_URL } from "@/lib/constants";
import { getPublicSnapshot } from "@/lib/public-stats";
import {
  getPublishedArticleSummariesCached,
  getResearchCoverageCached,
} from "@/lib/data-store/public-cached-reads";
import type { ArticleSummary } from "@/lib/data-store/articles";
import { ResearchHero, ResearchSectionNav, SectionHeading } from "./research-hero";
import { BenchmarkBoard, pickBenchmarks } from "./benchmark-board";
import { StateExplorer } from "./state-explorer";
import { DistrictBoard } from "./district-board";
import { ResearchLibrary } from "./research-library";
import { MethodFlow } from "./method-flow";
import { CharterExhibit, ExhibitSource, KeyFindings } from "./exhibits";
import { computeFindings } from "./findings";
import { AmbientGlow, INTERACTION } from "@/components/public/site-look";

export const metadata: Metadata = {
  title: "Research - Bank & Credit Union Fee Analysis",
  description:
    "National fee benchmarks, state and Federal Reserve district coverage, and original studies on bank and credit union fees — every figure traced to a published schedule.",
};

const ARTICLE_LIMIT = 5;

async function loadArticles(): Promise<ArticleSummary[]> {
  try {
    return await getPublishedArticleSummariesCached(ARTICLE_LIMIT);
  } catch {
    // The article list is optional; a failed read hides it rather than failing the page.
    return [];
  }
}

export default async function ResearchHubPage() {
  // All reads are served from the public cache between publishes. Counts and benchmarks
  // come from one shared snapshot, so they match the homepage and fee index.
  const [{ summary, categories: summaries }, coverage, articles] = await Promise.all([
    getPublicSnapshot(),
    getResearchCoverageCached(),
    loadArticles(),
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

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
        ]}
      />

      <div className={`relative isolate overflow-x-clip ${INTERACTION}`}>
      <AmbientGlow height={900} />
      <ResearchHero summary={summary} stateCount={stateCount} hasDc={hasDc} territoryCount={territoryCount} />
      <ResearchSectionNav />

      <div className="mx-auto max-w-page space-y-20 px-6 py-14">
        <KeyFindings findings={findings} asOf={asOf} />

        <BenchmarkBoard benchmarks={benchmarks} institutionsLabel={summary.institutionsLabel} asOf={asOf} />

        <CharterExhibit benchmarks={benchmarks} asOf={asOf} />

        <section id="states" className="scroll-mt-28">
          <SectionHeading eyebrow="Exhibit 3 · State reports" title="Where the data is">
            Every state report is built from the same published fees. Switch the map between how many institutions we
            have, how many fees, and what share of each state&apos;s institutions are covered so far.
          </SectionHeading>
          <div className="mt-7">
            <StateExplorer states={coverage.states} />
          </div>
          <ExhibitSource asOf={asOf}>
            Coverage is institutions with at least one published fee divided by institutions monitored in the state.
          </ExhibitSource>
        </section>

        <section id="districts" className="scroll-mt-28">
          <SectionHeading eyebrow="Exhibit 4 · Federal Reserve districts" title="Twelve districts, one view">
            District reports pair fees with Beige Book economic context. The bars show how many of each
            district&apos;s monitored institutions have published fees today.
          </SectionHeading>
          <div className="mt-7">
            <DistrictBoard districts={coverage.districts} />
          </div>
          <ExhibitSource asOf={asOf}>Counts use each institution&apos;s own Federal Reserve district.</ExhibitSource>
        </section>

        <ResearchLibrary articles={articles} />

        <MethodFlow coverageLabel={coverageLabel} />

        <section aria-label="Where to start" className="print:hidden">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">Not sure where to start?</h2>
          <AudiencePaths />
        </section>
      </div>
      </div>

      {/* Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`@media print {
        header, footer, nextjs-portal, #state-filter, #state-sort, [role="radiogroup"] { display: none !important; }
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
            name: "Bank Fee Research Reports",
            description:
              "National benchmarks and geographic analysis of bank and credit union fees by state and Federal Reserve district.",
            url: `${SITE_URL}/research`,
          }).replace(/</g, "\\u003c"),
        }}
      />
    </>
  );
}
