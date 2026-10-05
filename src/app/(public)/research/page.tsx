export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { US_TERRITORIES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { AudiencePaths } from "@/components/public/audience-paths";
import { SITE_URL } from "@/lib/constants";
import { getPublicStatsSummary } from "@/lib/public-stats";
import {
  getPublishedArticleSummariesCached,
  getResearchCoverageCached,
} from "@/lib/data-store/public-cached-reads";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import type { ArticleSummary } from "@/lib/data-store/articles";
import { ResearchHero, ResearchSectionNav, SectionHeading } from "./research-hero";
import { BenchmarkBoard, pickBenchmarks } from "./benchmark-board";
import { StateExplorer } from "./state-explorer";
import { DistrictBoard } from "./district-board";
import { ResearchLibrary } from "./research-library";
import { MethodFlow } from "./method-flow";

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
  // All four reads are served from the public cache between publishes.
  const [summary, coverage, summaries, articles] = await Promise.all([
    getPublicStatsSummary(),
    getResearchCoverageCached(),
    getCachedFeeCategorySummaries(),
    loadArticles(),
  ]);

  const statesWithFees = coverage.states.filter((s) => s.verified_institutions > 0);
  // US_TERRITORIES includes DC; count DC separately.
  const territoryCount = statesWithFees.filter((s) => US_TERRITORIES.has(s.state_code) && s.state_code !== "DC").length;
  const hasDc = statesWithFees.some((s) => s.state_code === "DC");
  const stateCount = statesWithFees.length - territoryCount - (hasDc ? 1 : 0);
  const coverageLabel = `${stateCount} states${hasDc ? ", DC" : ""}${territoryCount > 0 ? ` and ${territoryCount} territories` : ""}`;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
        ]}
      />

      <ResearchHero summary={summary} stateCount={stateCount} hasDc={hasDc} territoryCount={territoryCount} />
      <ResearchSectionNav />

      <div className="mx-auto max-w-7xl space-y-20 px-4 py-14 sm:px-6">
        <BenchmarkBoard benchmarks={pickBenchmarks(summaries)} institutionsLabel={summary.institutionsLabel} />

        <section id="states" className="scroll-mt-28">
          <SectionHeading eyebrow="State reports" title="Where the data is">
            Every state report is built from the same verified fees. Switch the map between how many institutions we
            have, how many fees, and what share of each state&apos;s institutions are covered so far.
          </SectionHeading>
          <div className="mt-7">
            <StateExplorer states={coverage.states} />
          </div>
        </section>

        <section id="districts" className="scroll-mt-28">
          <SectionHeading eyebrow="Federal Reserve districts" title="Twelve districts, one view">
            District reports pair fees with Beige Book economic context. The bars show how many of each
            district&apos;s monitored institutions have verified fees today.
          </SectionHeading>
          <div className="mt-7">
            <DistrictBoard districts={coverage.districts} />
          </div>
        </section>

        <ResearchLibrary articles={articles} />

        <MethodFlow coverageLabel={coverageLabel} />

        <section aria-label="Where to start">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Not sure where to start?</p>
          <AudiencePaths />
        </section>
      </div>

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
