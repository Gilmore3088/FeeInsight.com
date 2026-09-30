/**
 * /reports — Public report catalog
 * ISR-cached (1-hour revalidation). Server-rendered, no client components.
 * Lists the sample Competitive Fee Position Report first, then published research
 * reports with server-side filtering by type and date (filters hidden while empty).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/data-store/connection";
import type { PublishedReport, ReportType } from "@/lib/report-engine/types";
import { timeAgo } from "@/lib/format";
import { RESEARCH_IMPRINT } from "@/lib/constants";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Research Reports",
  description: `Published bank fee research from ${RESEARCH_IMPRINT} — a sample Competitive Fee Position Report, national indexes, state analysis, peer benchmarks, and monthly pulse reports.`,
};

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

const VALID_REPORT_TYPES: Set<string> = new Set<ReportType>([
  "national_index",
  "state_index",
  "peer_brief",
  "monthly_pulse",
]);

const QUERY_DEADLINE_MS = 2_500;

function withDeadline<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });

  return Promise.race([promise.catch(() => fallback), timeoutPromise]).finally(() =>
    clearTimeout(timeout),
  );
}

function dateRangeToIso(range: string): string | null {
  const days: Record<string, number> = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 };
  const n = days[range];
  if (!n) return null;
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function loadReports(typeFilter: string | null, fromIso: string | null) {
  try {
    const sql = getSql();
    const reportQuery = sql<PublishedReport[]>`
      SELECT id, report_type, slug, title, published_at
      FROM published_reports
      WHERE is_public = true
        ${typeFilter ? sql` AND report_type = ${typeFilter}` : sql``}
        ${fromIso ? sql` AND published_at >= ${fromIso}` : sql``}
      ORDER BY published_at DESC
      LIMIT 100
    `.then((rows) => ({ reports: [...rows] as PublishedReport[], unavailable: false }));
    return await withDeadline(reportQuery, { reports: [], unavailable: true }, QUERY_DEADLINE_MS);
  } catch {
    // Render the sample-only state gracefully if the DB is unavailable at build time
    return { reports: [] as PublishedReport[], unavailable: true };
  }
}

function SampleReportCard() {
  return (
    <li className="flex flex-col gap-2 border-b border-[#E0D7C9] py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded bg-[#FBEDE8] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A93D25]">
          Sample
        </span>
        <span className="text-[12px] text-[#6B6255]">Competitive Fee Position Report</span>
      </div>
      <Link
        href={SAMPLE_REPORT_HREF}
        className="report-title-link text-[20px] font-semibold leading-snug tracking-[-0.01em] text-[#1A1815] no-underline"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Sample: Competitive Fee Position Report — see what the free report contains
      </Link>
      <p className="max-w-[560px] text-[14px] leading-relaxed text-[#5A5347]">
        An anonymized report for a ~$400M community bank: fee position against a verified peer
        set, the outliers that matter, the revenue lens, and a named peer comparison. Yours is
        built for your institution and delivered in 48 hours.
      </p>
      <Link
        href={SAMPLE_REPORT_HREF}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-[#A93D25] no-underline"
      >
        Read the sample &rarr;
      </Link>
    </li>
  );
}

function PublishedReportItem({ report }: { report: PublishedReport }) {
  const typeLabel = REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type;
  return (
    <li className="flex flex-col gap-2 border-b border-[#E0D7C9] py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded bg-[#F5F0E8] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A5347]">
          {typeLabel}
        </span>
        <span className="text-[12px] text-[#6B6255]">{timeAgo(report.published_at)}</span>
      </div>
      <Link
        href={`/reports/${report.slug}`}
        className="report-title-link text-[20px] font-semibold leading-snug tracking-[-0.01em] text-[#1A1815] no-underline"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        {report.title}
      </Link>
      <Link
        href={`/reports/${report.slug}`}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-[#A93D25] no-underline"
      >
        Read report &rarr;
      </Link>
    </li>
  );
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const rawRange = Array.isArray(params.range) ? params.range[0] : params.range;

  // Sanitize inputs (T-16-03)
  const typeFilter = rawType && VALID_REPORT_TYPES.has(rawType) ? rawType : null;
  const fromIso = rawRange ? dateRangeToIso(rawRange) : null;
  const filtersActive = Boolean(typeFilter || rawRange);

  const { reports, unavailable } = await loadReports(typeFilter, fromIso);
  const hasReports = reports.length > 0;
  // Only show filter controls once there is a catalog to filter (or a filter is already applied).
  const showFilters = hasReports || filtersActive;

  return (
    <div className="mx-auto max-w-[800px] px-6 pb-24 pt-16">
      <div className="mb-10">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
          Research
        </p>
        <h1
          className="mb-3 text-[36px] font-semibold leading-tight tracking-[-0.02em] text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Research Reports
        </h1>
        <p className="max-w-[560px] text-[16px] leading-relaxed text-[#5A5347]">
          Published analysis from {RESEARCH_IMPRINT} — national indexes, state benchmarks, peer
          comparisons, and monthly fee intelligence.
        </p>
      </div>

      {showFilters && (
        <ReportFilters typeFilter={typeFilter} rawRange={rawRange} filtersActive={filtersActive} />
      )}

      <ul className="m-0 list-none p-0">
        {!filtersActive && <SampleReportCard />}
        {reports.map((report) => (
          <PublishedReportItem key={report.id} report={report} />
        ))}
      </ul>

      {!hasReports && (
        <p className="mt-8 text-[14px] leading-relaxed text-[#6B6255]">
          {unavailable
            ? "The report catalog is temporarily unavailable. Try again shortly."
            : filtersActive
              ? "No published reports match these filters."
              : `The ${RESEARCH_IMPRINT} program publishes national and state fee indexes, peer briefs, and a monthly pulse as the verified index grows — new reports appear here first.`}
        </p>
      )}

      {hasReports && (
        <p className="mt-10 text-[12px] text-[#6B6255]">
          Showing {reports.length} report{reports.length !== 1 ? "s" : ""}.
        </p>
      )}

      <style>{`
        .report-title-link:hover {
          color: #C44B2E;
        }
      `}</style>
    </div>
  );
}
