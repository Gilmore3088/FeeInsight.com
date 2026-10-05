export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { getNationalIndexCached } from "@/lib/data-store";
import { getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import { benchmarkReportTitle, parseBenchmarkScope, type BenchmarkScope } from "@/lib/benchmark-report";
import { buildBenchmarkRows, MIN_BENCHMARK_INSTITUTIONS, type BenchmarkRow } from "@/lib/benchmark-report-rows";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { formatAmount } from "@/lib/format";
import { PRODUCT_NAME } from "@/lib/constants";
import { DataFreshness } from "@/components/data-freshness";
import { TrackView } from "@/components/track-view";

interface PageProps {
  params: Promise<{ scope: string }>;
}

/** Where the locked institution report's button goes: the paid request on For Institutions. */
const INSTITUTION_REPORT_HREF = "/for-institutions?report=institution#report";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const scope = parseBenchmarkScope((await params).scope);
  if (!scope) return { title: "Report not found" };
  return {
    title: benchmarkReportTitle(scope),
    description: `Median and typical range for the 15 headline bank and credit union fees, from the ${PRODUCT_NAME}.`,
    robots: { index: false, follow: true },
  };
}

async function loadRows(scope: BenchmarkScope): Promise<BenchmarkRow[]> {
  if (scope.kind === "national") return buildBenchmarkRows(await getNationalIndexCached(), null);
  const [district, national] = await Promise.all([
    getPeerIndexCached({ fed_districts: [scope.district] }),
    getNationalIndexCached(),
  ]);
  return buildBenchmarkRows(district, national);
}

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[#6B6255]">–</span>;
  if (Math.abs(delta) < 2) return <span className="text-[#6B6255]">In line</span>;
  const above = delta > 0;
  return (
    <span className={above ? "text-[#A93D25]" : "text-[#2F6B4F]"}>
      {above ? "+" : ""}
      {delta.toFixed(0)}%
    </span>
  );
}

export default async function BenchmarkReportPage({ params }: PageProps) {
  const scope = parseBenchmarkScope((await params).scope);
  if (!scope) notFound();

  const rows = await loadRows(scope);
  const isDistrict = scope.kind === "district";
  const area = isDistrict ? `the ${DISTRICT_NAMES[scope.district]} Fed district` : "the United States";
  const omitted = HEADLINE_FEE_KEYS.length - rows.length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <TrackView event="benchmark_report_view" eventProps={{ scope: isDistrict ? `district-${scope.district}` : "national" }} />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A93D25]">
        {PRODUCT_NAME} · Free report
      </p>
      <h1 className="mt-1 font-[family-name:var(--font-newsreader)] text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]">
        {benchmarkReportTitle(scope)}
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5A5347]">
        What banks and credit unions in {area} charge for the 15 fees customers notice most. Each
        line is the median and the middle half of published fees, taken from each
        institution&apos;s own fee schedule.
        {isDistrict && " The last column compares the district median with the national one."}
      </p>
      <div className="mt-1">
        <DataFreshness />
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-[#E8DFD1] bg-white">
        <table className="w-full text-[14px] tabular-nums">
          <thead>
            <tr className="border-b border-[#E8DFD1] text-left text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
              <th className="px-4 py-2.5">Fee</th>
              <th className="px-3 py-2.5 text-right">Median</th>
              <th className="px-3 py-2.5 text-right">Typical range</th>
              <th className="px-3 py-2.5 text-right">Institutions</th>
              {isDistrict && <th className="px-4 py-2.5 text-right">vs. national</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-b border-[#F0EAE0] last:border-b-0">
                <td className="px-4 py-2.5 text-[#1A1815]">{row.label}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-[#1A1815]">{formatAmount(row.median)}</td>
                <td className="px-3 py-2.5 text-right text-[#5A5347]">
                  {row.p25 !== null && row.p75 !== null ? `${formatAmount(row.p25)} – ${formatAmount(row.p75)}` : "–"}
                </td>
                <td className="px-3 py-2.5 text-right text-[#5A5347]">{row.institutions.toLocaleString()}</td>
                {isDistrict && (
                  <td className="px-4 py-2.5 text-right">
                    <DeltaCell delta={row.deltaPct} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-[#6B6255]">
        Typical range is the 25th to 75th percentile. A line appears only when at least{" "}
        {MIN_BENCHMARK_INSTITUTIONS} institutions publish that fee
        {omitted > 0 ? `, so ${omitted} of the 15 are left out here until more schedules are collected.` : "."}
      </p>

      <LockedInstitutionSection />
    </div>
  );
}

const LOCKED_ROWS = ["Overdraft", "NSF / returned item", "Monthly maintenance", "Outgoing domestic wire"];

/** The paid next step, shown grayed out: one institution against named competitors. */
function LockedInstitutionSection() {
  return (
    <section className="mt-12 rounded-lg border border-dashed border-[#D5CBBF] bg-[#F4EFE7] p-6">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        Institution report · paid
      </div>
      <h2 className="mt-2 font-[family-name:var(--font-newsreader)] text-[1.35rem] leading-tight text-[#1A1815]">
        Where does your institution stand against its competitors?
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#5A5347]">
        The institution report puts your own published fees next to named competitors in your
        market, line by line, and flags where you sit above or below them.
      </p>
      <div aria-hidden="true" className="mt-5 overflow-hidden rounded-md border border-[#E0D7C9] bg-white/60 select-none">
        <table className="w-full text-[13px] text-[#9A9083]">
          <thead>
            <tr className="border-b border-[#E0D7C9] text-left text-[11px] uppercase tracking-wider">
              <th className="px-4 py-2 font-semibold">Fee</th>
              <th className="px-3 py-2 text-right font-semibold">You</th>
              <th className="px-3 py-2 text-right font-semibold">Competitors</th>
              <th className="px-4 py-2 font-semibold">Position</th>
            </tr>
          </thead>
          <tbody>
            {LOCKED_ROWS.map((fee) => (
              <tr key={fee} className="border-b border-[#EFE8DC] last:border-b-0">
                <td className="px-4 py-2">{fee}</td>
                <td className="px-3 py-2 text-right"><span className="inline-block h-2.5 w-10 rounded bg-[#E0D7C9]" /></td>
                <td className="px-3 py-2 text-right"><span className="inline-block h-2.5 w-16 rounded bg-[#E0D7C9]" /></td>
                <td className="px-4 py-2"><span className="inline-block h-2.5 w-20 rounded bg-[#E0D7C9]" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link
        href={INSTITUTION_REPORT_HREF}
        className="mt-5 inline-flex items-center rounded-md bg-[#C44B2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#A93D25]"
      >
        Request your institution report
      </Link>
      <p className="mt-2 text-[12px] text-[#6B6255]">We reply within one business day with scope and price.</p>
    </section>
  );
}
