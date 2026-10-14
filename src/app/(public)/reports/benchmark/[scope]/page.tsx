export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNationalIndexCached } from "@/lib/data-store";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { getDistrictStatsCached, getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { benchmarkReportTitle, parseBenchmarkScope, type BenchmarkScope } from "@/lib/benchmark-report";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { formatCount, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { PRODUCT_NAME } from "@/lib/constants";
import { TrackView } from "@/components/track-view";
import { ResearchSectionNav } from "../../../research/research-hero";
import { CharterExhibit, KeyFindings } from "../../../research/exhibits";
import { FullTable, PositionExhibit } from "../../../research/state/[code]/state-exhibits";
import {
  buildReportCharterPairs,
  buildReportRows,
  computeDistrictFindings,
  computeNationalFindings,
} from "./report-data";
import {
  BenchmarkBoard,
  LockedInstitutionReport,
  ReportHero,
  ReportMethodology,
  type HeroStat,
} from "./report-exhibits";

interface PageProps {
  params: Promise<{ scope: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const scope = parseBenchmarkScope((await params).scope);
  if (!scope) return { title: "Report not found" };
  return {
    title: benchmarkReportTitle(scope),
    description: `Median and typical range for the 15 headline bank and credit union fees, from the ${PRODUCT_NAME}.`,
    robots: { index: false, follow: true },
  };
}

interface Indexes {
  area: IndexEntry[];
  national: IndexEntry[] | null;
  bank: IndexEntry[];
  cu: IndexEntry[];
}

async function loadIndexes(scope: BenchmarkScope): Promise<Indexes> {
  const area = scope.kind === "district" ? { fed_districts: [scope.district] } : {};
  const [areaIndex, national, bank, cu] = await Promise.all([
    scope.kind === "district" ? getPeerIndexCached(area) : getNationalIndexCached(),
    scope.kind === "district" ? getNationalIndexCached() : Promise.resolve(null),
    getPeerIndexCached({ ...area, charter_type: "bank" }),
    getPeerIndexCached({ ...area, charter_type: "credit_union" }),
  ]);
  return { area: areaIndex, national, bank, cu };
}

const DISTRICT_SECTIONS = [
  { id: "findings", label: "Key findings" },
  { id: "benchmarks", label: "Headline fees" },
  { id: "position", label: "vs national" },
  { id: "charters", label: "Banks vs CUs" },
  { id: "table", label: "Full table" },
  { id: "institution", label: "Your institution" },
  { id: "methodology", label: "Methodology" },
];
const NATIONAL_SECTIONS = DISTRICT_SECTIONS.filter((s) => s.id !== "position" && s.id !== "table");

function districtStats(
  district: number,
  stats: { with_fees: number; institution_count: number; bank_count: number; cu_count: number },
  lines: number,
): HeroStat[] {
  const states = Object.entries(STATE_TO_DISTRICT)
    .filter(([code, d]) => d === district && STATE_NAMES[code])
    .map(([code]) => STATE_NAMES[code])
    .sort();
  return [
    {
      value: formatCount(stats.with_fees),
      label: "institutions with published fees",
      note: `of ${formatCount(stats.institution_count)} we monitor in the district`,
    },
    { value: `${lines} of 15`, label: "headline fees with a median", note: "each with 20 or more institutions" },
    { value: formatCount(stats.bank_count), label: "banks monitored", note: `and ${formatCount(stats.cu_count)} credit unions` },
    { value: String(states.length), label: states.length === 1 ? "state covered" : "states covered", note: states.join(", ") },
  ];
}

export default async function BenchmarkReportPage({ params }: PageProps) {
  const scope = parseBenchmarkScope((await params).scope);
  if (!scope) notFound();

  const district = scope.kind === "district" ? scope.district : null;
  const [indexes, summary, stats] = await Promise.all([
    loadIndexes(scope),
    getPublicStatsSummary(),
    district ? getDistrictStatsCached(district) : Promise.resolve(null),
  ]);
  const asOf = summary.refreshedOn;

  const rows = buildReportRows(indexes.area, indexes.national);
  const charterPairs = buildReportCharterPairs(indexes.bank, indexes.cu, rows);
  const omitted = HEADLINE_FEE_KEYS.length - rows.length;

  if (district === null || stats === null) {
    return (
      <>
        <TrackView event="benchmark_report_view" eventProps={{ scope: "national" }} />
        <ReportHero
          eyebrow="Free report · United States"
          title="National fee benchmark"
          lede="What U.S. banks and credit unions charge for the 15 fees customers notice most. Every number comes from an institution's own published fee schedule."
          stats={[
            { value: summary.institutionsLabel, label: "institutions with published fees", note: `of ${summary.monitoredLabel} we monitor` },
            { value: `${rows.length} of 15`, label: "headline fees with a median", note: "each with 20 or more institutions" },
            { value: summary.observationsLabel, label: "verified fees", note: "each traced to a published schedule" },
            { value: summary.statesLabel, label: "states covered", note: "with at least one verified fee" },
          ]}
          freshnessLabel={summary.freshnessLabel}
        />
        <ResearchSectionNav sections={NATIONAL_SECTIONS} label="Report sections" />
        <div className="mx-auto max-w-page space-y-20 px-4 py-14 sm:px-6">
          <KeyFindings findings={computeNationalFindings(rows, charterPairs)} asOf={asOf} />
          <BenchmarkBoard rows={rows} place="the U.S." areaLabel="US" omitted={omitted} asOf={asOf} />
          <CharterExhibit benchmarks={charterPairs} asOf={asOf} />
          <LockedInstitutionReport />
          <ReportMethodology area="the United States" />
        </div>
        <PrintStyles />
      </>
    );
  }

  const name = DISTRICT_NAMES[district];
  const place = `${name} district`;
  return (
    <>
      <TrackView event="benchmark_report_view" eventProps={{ scope: `district-${district}` }} />
      <ReportHero
        eyebrow={`Free report · Federal Reserve District ${district}`}
        title={`${name} district fee benchmark`}
        lede={`What banks and credit unions in the ${name} Fed district charge for the 15 fees customers notice most, measured against the national ${PRODUCT_NAME}. Every number comes from an institution's own published fee schedule.`}
        stats={districtStats(district, stats, rows.length)}
        freshnessLabel={summary.freshnessLabel}
      />
      <ResearchSectionNav sections={DISTRICT_SECTIONS} label="Report sections" />
      <div className="mx-auto max-w-page space-y-20 px-4 py-14 sm:px-6">
        <KeyFindings findings={computeDistrictFindings(place, rows, charterPairs)} asOf={asOf} />
        <BenchmarkBoard rows={rows} place={`the ${place}`} areaLabel={`D${district}`} omitted={omitted} asOf={asOf} />
        <PositionExhibit rows={rows} stateName={place} asOf={asOf} />
        <CharterExhibit benchmarks={charterPairs} asOf={asOf} eyebrow="Exhibit 3 · Banks vs credit unions" place={place} />
        <FullTable rows={rows} stateName={place} asOf={asOf} />
        <LockedInstitutionReport />
        <ReportMethodology area={`the ${name} Fed district`} district />
      </div>
      <PrintStyles />
    </>
  );
}

/** Print / Save as PDF: drop site chrome and interactive controls, keep exhibits whole. */
function PrintStyles() {
  return (
    <style>{`@media print {
      header, footer, nextjs-portal { display: none !important; }
      body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      section { break-inside: avoid-page; }
      a { text-decoration: none !important; }
    }`}</style>
  );
}
