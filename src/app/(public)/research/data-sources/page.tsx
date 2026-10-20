/**
 * Regenerated in the background (ISR) at most hourly, and sooner when a takedown
 * invalidates the public read cache its reads carry (#1811). The page reads no session,
 * cookies or search params; the header's signed-in parts are client islands. A render
 * with a failed read is cached for a minute instead (`shortenPageLife`, as the homepage).
 */
export const revalidate = 3600;

import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { PRODUCT_NAME, SITE_NAME, SITE_URL } from "@/lib/constants";
import { getPublicStatsSummary, UNAVAILABLE_LABEL } from "@/lib/public-stats";
import { getDataCoverageSummaryCached, getStatsCached } from "@/lib/data-store/public-cached-reads";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { DATA_SOURCES, coverageBar, nextAction, sourceMap, type SourceCounts } from "./data-sources-view";
import { DataSourcesHero, MethodologyLine, NextAction, SourceMap, SourceTable } from "./data-sources-exhibits";

const PAGE_URL = `${SITE_URL}/research/data-sources`;
const TITLE = "Data sources: where every number comes from";
const DESCRIPTION = `The sources behind the ${PRODUCT_NAME}: each institution's own fee schedule, FDIC and NCUA data, Federal Reserve districts, and the public data used for context.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESCRIPTION, url: PAGE_URL, siteName: SITE_NAME, type: "website" },
  keywords: ["bank fee data sources", "FDIC call reports", "NCUA 5300", "bank fee schedules", "bank fee methodology"],
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: TITLE,
  description: DESCRIPTION,
  url: PAGE_URL,
};

export default async function DataSourcesPage() {
  // Every read is served from the public cache between publishes; a failed read hides its number.
  const [summary, collection, coverage, sampleLive] = await Promise.all([
    getPublicStatsSummary().catch(() => null),
    getStatsCached().catch(() => null),
    getDataCoverageSummaryCached().catch(() => null),
    sampleReportAvailable().catch(() => false),
  ]);
  if (!summary?.complete || !collection || !coverage) await shortenPageLife();

  const counts: SourceCounts = {
    observations: summary && summary.observationsLabel !== UNAVAILABLE_LABEL ? summary.observations : null,
    institutions: summary && summary.institutionsLabel !== UNAVAILABLE_LABEL ? summary.institutions : null,
    banks: collection?.banks ?? null,
    creditUnions: collection?.credit_unions ?? null,
    fdicReports: coverage?.fdic_financials ?? null,
    ncuaReports: coverage?.ncua_financials ?? null,
  };

  return (
    <div className="bg-paper">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Research", href: "/research" },
          { name: "Data sources", href: "/research/data-sources" },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      <DataSourcesHero freshnessLabel={summary?.freshnessLabel ?? null} />

      <div className="mx-auto max-w-page space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <SourceMap map={sourceMap(counts)} coverage={coverageBar(counts)} />
        <SourceTable sources={DATA_SOURCES} />
        <MethodologyLine />
        <NextAction action={nextAction(sampleLive)} />
      </div>
    </div>
  );
}
