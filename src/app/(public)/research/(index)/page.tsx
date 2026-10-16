export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { US_TERRITORIES } from "@/lib/us-states";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { SITE_URL } from "@/lib/constants";
import { getPublicSnapshot } from "@/lib/public-stats";
import {
  getPublishedArticleSummariesCached,
  getResearchCoverageCached,
} from "@/lib/data-store/public-cached-reads";
import type { ArticleSummary } from "@/lib/data-store/articles";
import { ResearchHero, ResearchSectionNav, SectionHeading } from "../research-hero";
import { BenchmarkBoard, pickBenchmarks } from "../benchmark-board";
import { GeoReports } from "../geo-reports";
import { ResearchLibrary } from "../research-library";
import { MethodFlow } from "../method-flow";
import { HubFindings } from "../hub-findings";
import { computeFindings } from "../findings";

export const metadata: Metadata = {
  title: "Research - Bank & Credit Union Fee Analysis",
  description:
    "Findings on bank and credit union fees, with national benchmarks and state and Federal Reserve district reports. Every figure traces to a published fee schedule.",
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

      <ResearchHero summary={summary} />
      <ResearchSectionNav />

      <div className="mx-auto max-w-page space-y-14 px-4 py-10 sm:space-y-16 sm:px-6 sm:py-12">
        <HubFindings findings={findings} asOf={asOf} />

        <BenchmarkBoard benchmarks={benchmarks} asOf={asOf} />

        <section id="geography" className="scroll-mt-28">
          <SectionHeading eyebrow="Regional reports" title="States and Federal Reserve districts">
            The same benchmarks for one state or district, with its coverage and economic context.
          </SectionHeading>
          <div className="mt-5">
            <GeoReports states={coverage.states} districts={coverage.districts} />
          </div>
        </section>

        <ResearchLibrary articles={articles} asOf={asOf} />

        <MethodFlow summary={summary} stateCount={stateCount} coverageLabel={coverageLabel} />
      </div>

      {/* Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */}
      <style>{`@media print {
        header, footer, nextjs-portal, #geo-filter, #geo-pick, [role="radiogroup"] { display: none !important; }
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
