/**
 * /reports — the reports hub.
 * Leads with the Competitive Fee Position Report (its position map drawn from the
 * committed sample report), then the live state fee reports (cached published-catalog
 * counts), then published research with server-side filters (hidden while empty).
 * Every number on the page is read from the sample report or the database; when the
 * database is slow or down, the affected section says so instead of showing figures.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/data-store/connection";
import type { PublishedReport, ReportType } from "@/lib/report-engine/types";
import { timeAgo } from "@/lib/format";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, REPORT_OFFER, SAMPLE_REPORT_LIVE, SITE_NAME } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { ReportFaq } from "./report-faq";
import { HamiltonLine } from "./hamilton-line";

import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { extractPositionMap, readSampleReportHtml } from "@/lib/hosted-reports";
import { getMarketReadinessCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import { MARKET_READY_MIN_RICH, type MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES } from "@/lib/us-states";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";
import { PositionPreview } from "./position-preview";
import { SamplePages } from "@/app/for-institutions/report-offer";
import { StateReportGrid, type StateCoverage } from "./state-report-grid";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Fee Reports",
  description: `See where your fees stand against your competitors: free national, Fed district and state fee reports, and the ${REPORT_OFFER.name}.`,
};

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REQUEST_HREF = "/reports?report=institution#request";

const PRIMARY_BUTTON =
  "inline-flex items-center rounded-md bg-brick px-4 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-brick-ink";
const SECONDARY_BUTTON =
  "inline-flex items-center rounded-md border border-border bg-white px-4 py-2.5 text-sm font-semibold text-ink no-underline transition-colors hover:border-brick hover:text-brick";
const SERIF = { fontFamily: "var(--fi-font-sans)" } as const;

/** The sample report's six sections, by their headings. */
const REPORT_CONTENTS = [
  "The three findings that matter",
  "Your position on every fee",
  "Where you sit above or below",
  "The revenue lens",
  "Named competitors",
  "A source for every number",
];

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
    // Render the rest of the hub gracefully if the DB is unavailable at build time
    return { reports: [] as PublishedReport[], unavailable: true };
  }
}

async function loadStateCoverage(): Promise<StateCoverage[] | null> {
  try {
    const rows = await withDeadline<StateCoverage[] | null>(getStatesWithFeeDataCached(), null, QUERY_DEADLINE_MS);
    if (!rows || rows.length === 0) return null;
    const inScope = new Set(STATE_CODES);
    return rows.filter((row) => inScope.has(row.state_code));
  } catch {
    return null;
  }
}

async function loadMarketReadiness(): Promise<MarketReadiness[] | null> {
  try {
    const rows = await withDeadline<MarketReadiness[] | null>(getMarketReadinessCached(), null, QUERY_DEADLINE_MS);
    if (!rows || rows.length === 0) return null;
    const inScope = new Set(STATE_CODES);
    return rows.filter((row) => inScope.has(row.state_code));
  } catch {
    return null;
  }
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 max-w-[640px]">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brick">{eyebrow}</p>
      <h2 className="text-[28px] font-bold leading-tight tracking-[-0.015em] text-ink" style={SERIF}>
        {title}
      </h2>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{children}</p>}
    </div>
  );
}

function PublishedReportItem({ report }: { report: PublishedReport }) {
  const typeLabel = REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded bg-[#F5F0E8] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          {typeLabel}
        </span>
        <span className="text-[12px] text-ink-muted">{timeAgo(report.published_at)}</span>
      </div>
      <Link
        href={`/reports/${report.slug}`}
        className="report-title-link text-[20px] font-semibold leading-snug tracking-[-0.01em] text-ink no-underline"
        style={{ fontFamily: "var(--fi-font-sans)" }}
      >
        {report.title}
      </Link>
      <Link
        href={`/reports/${report.slug}`}
        className="inline-flex items-center gap-1 text-[13px] font-medium text-brick no-underline"
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

  const [{ reports, unavailable }, stateCoverage, readiness] = await Promise.all([
    loadReports(typeFilter, fromIso),
    loadStateCoverage(),
    loadMarketReadiness(),
  ]);
  // The sample is offline until it is re-rendered from source-checked data.
  const positionMap = SAMPLE_REPORT_LIVE ? extractPositionMap(readSampleReportHtml()) : null;
  const sampleLive = await sampleReportAvailable();
  const hasReports = reports.length > 0;
  // Only show filter controls once there is a catalog to filter (or a filter is already applied).
  const showFilters = hasReports || filtersActive;

  const coveredStates = stateCoverage?.filter((s) => s.institution_count > 0) ?? [];
  const coveredStateCount = coveredStates.filter((s) => s.state_code !== "DC").length;
  const dcCovered = coveredStates.some((s) => s.state_code === "DC");
  const coveredInstitutions = coveredStates.reduce((sum, s) => sum + s.institution_count, 0);
  const coveredFees = coveredStates.reduce((sum, s) => sum + s.fee_count, 0);
  const readyMarkets = readiness?.filter((m) => m.ready).length ?? 0;

  return (
    <div className="pb-24">
      {/* Hero: the report, with its real position map */}
      <section className="border-b border-border bg-[linear-gradient(180deg,#FBF7F1_0%,#FDFBF8_100%)]">
        <div className="mx-auto grid max-w-page gap-10 px-6 pb-14 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center">
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-brick">
              {REPORT_OFFER.name}
            </p>
            <h1
              className="text-[2.25rem] font-extrabold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.75rem]"
              style={SERIF}
            >
              Know where your fees stand against your market.
            </h1>
            <p className="mt-5 max-w-[540px] text-[16px] leading-relaxed text-ink-soft">
              Your published fees next to the competitors you name, line by line, with a source for every figure.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <TrackLink
                event="request_report_click"
                eventProps={{ placement: "reports_hub_hero" }}
                href={REQUEST_HREF}
                className={PRIMARY_BUTTON}
              >
                {REPORT_OFFER.institutionCtaLabel}
              </TrackLink>
              {sampleLive && (
                <Link href={SAMPLE_REPORT_HREF} className={SECONDARY_BUTTON}>
                  Read the full sample
                </Link>
              )}
            </div>
            <dl className="mt-8 grid max-w-[520px] grid-cols-3 gap-4 border-t border-border pt-5">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">Price</dt>
                <dd className="mt-1 text-[15px] font-semibold text-ink">
                  {REPORT_OFFER.priceLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">Next step</dt>
                <dd className="mt-1 text-[15px] font-semibold text-ink">Reply in 1 business day</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">Format</dt>
                <dd className="mt-1 text-[15px] font-semibold text-ink">Board-ready PDF</dd>
              </div>
            </dl>
          </div>

          {positionMap && positionMap.rows.length > 0 && (
            <div>
              <PositionPreview map={positionMap} />
              <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                <Link href={SAMPLE_REPORT_HREF} className="text-brick underline-offset-2 hover:underline">
                  See the whole sample report
                </Link>
              </p>
            </div>
          )}
        </div>
      </section>

      {/* What's inside: the sample's own pages, and its six section headings */}
      <section className="mx-auto max-w-page px-6 pt-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading eyebrow="What's inside" title="Six sections in one PDF for your pricing committee." />
            <ol className="m-0 grid list-none gap-x-6 p-0 sm:grid-cols-2">
              {REPORT_CONTENTS.map((title, index) => (
                <li key={title} className="flex items-baseline gap-3 border-b border-border py-2.5">
                  <span className="text-[13px] font-semibold tabular-nums text-brick">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[15px] font-semibold text-ink">{title}</span>
                </li>
              ))}
            </ol>
          </div>
          <SamplePages />
        </div>
      </section>

      {/* Request form: the lead lands in the leads table (/admin/leads) */}
      <section id="request" className="mx-auto max-w-page scroll-mt-20 px-6 pt-16">
        <div className="grid gap-8 rounded-xl border border-border bg-[#FBF7F1] p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] lg:items-start">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brick">
              Request your report
            </p>
            <h2 className="text-[28px] font-bold leading-tight tracking-[-0.015em] text-ink" style={SERIF}>
              Tell us where to send it.
            </h2>
            <p className="mt-3 max-w-[460px] text-[15px] leading-relaxed text-ink-soft">
              {REPORT_OFFER.nextStep}, and we confirm your peers before any work starts.
            </p>
            <p className="mt-4 text-[13px] text-ink-muted">
              Prefer to write?{" "}
              <Link href="/contact?source=report" className="text-brick underline-offset-2 hover:underline">
                Send us a message
              </Link>
            </p>
            <HamiltonLine placement="reports_hub_form" firstMention className="mt-4 max-w-[460px]" />
          </div>
          <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="reports-hub" />
        </div>
      </section>

      <ReportFaq />

      {/* State reports, live from the index */}
      <section className="mx-auto max-w-page px-6 pt-20">
        <SectionHeading eyebrow="Free state fee reports" title="Every state, built live from verified fee schedules.">
          Each state against the nation, banks and credit unions apart. Darker states are closer to a full local comparison.
        </SectionHeading>
        {stateCoverage ? (
          <>
            <p className="mb-4 text-[13px] text-ink-muted">
              <b className="font-semibold text-ink">{coveredInstitutions.toLocaleString()}</b> institutions
              with verified fees across <b className="font-semibold text-ink">{coveredStateCount}</b> states
              {dcCovered ? " plus DC" : ""} · <b className="font-semibold text-ink">{coveredFees.toLocaleString()}</b> fee lines
            </p>
            {readiness && (
              <p className="mb-4 text-[13px] text-ink-muted">
                <b className="font-semibold text-ink">{readyMarkets}</b> of {readiness.length} state markets are ready for a
                full local comparison. Each tile counts its closest market against the {MARKET_READY_MIN_RICH} institutions
                needed.
              </p>
            )}
            <StateReportGrid states={stateCoverage} readiness={readiness} />
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-surface-0 px-5 py-4 text-[14px] text-ink-muted">
            State coverage is temporarily unavailable. Try again shortly, or browse the{" "}
            <Link href="/research" className="text-brick underline-offset-2 hover:underline">
              research hub
            </Link>
            .
          </p>
        )}
      </section>

      {/* Published research: hidden while nothing is published (#1174), shown when filters or an outage explain an empty list. */}
      {(hasReports || filtersActive || unavailable) && (
      <section className="mx-auto max-w-page px-6 pt-20" id="research">
        <SectionHeading eyebrow="Published research" title={`Research and analysis from ${SITE_NAME}`} />
        {showFilters && (
          <ReportFilters typeFilter={typeFilter} rawRange={rawRange} filtersActive={filtersActive} />
        )}
        {hasReports ? (
          <>
            <ul className="m-0 max-w-[800px] list-none p-0">
              {reports.map((report) => (
                <PublishedReportItem key={report.id} report={report} />
              ))}
            </ul>
            <p className="mt-6 text-[12px] text-ink-muted">
              Showing {reports.length} report{reports.length !== 1 ? "s" : ""}.
            </p>
          </>
        ) : (
          <p className="max-w-[640px] text-[14px] leading-relaxed text-ink-muted">
            {unavailable
              ? "The research catalog is temporarily unavailable. Try again shortly."
              : filtersActive
                ? "No published reports match these filters."
                : "No national or peer reports are published yet."}
          </p>
        )}
      </section>
      )}

      {/* Closing call to action */}
      <section className="mx-auto max-w-page px-6 pt-20">
        <div className="flex flex-col items-start gap-5 rounded-xl bg-ink px-7 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-[24px] leading-snug text-white" style={SERIF}>
              See your own fees against your market.
            </p>
            <HamiltonLine placement="reports_hub_closing" tone="dark" className="mt-3" />
          </div>
          <div className="flex flex-wrap gap-3">
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "reports_hub_footer" }}
              href={REQUEST_HREF}
              className={PRIMARY_BUTTON}
            >
              {REPORT_OFFER.institutionCtaLabel}
            </TrackLink>
            {sampleLive && (
              <Link
                href={SAMPLE_REPORT_HREF}
                className="inline-flex items-center rounded-md border border-ink-soft px-4 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:border-white"
              >
                Read the sample
              </Link>
            )}
          </div>
        </div>
      </section>

      <style>{`
        .report-title-link:hover { color: #b23a32; }
        .state-tile { transition: transform 120ms ease, box-shadow 120ms ease; }
        .state-tile:hover { transform: translateY(-1px); box-shadow: 0 0 0 2px #132338; }
        .state-tile:focus-visible { outline: 2px solid #132338; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
