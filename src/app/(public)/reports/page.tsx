/**
 * /reports — the report's one home (page template briefs, "Reports").
 * The hero is the report itself, drawn from the live sample, beside the request form; then the
 * video, the sample's own fee lines as one tappable exhibit, how a request runs, every state's
 * free report on one map, Hamilton once, the questions, and published research (hidden while
 * empty). Every figure is read from the live sample or the cached catalog reads; when either is
 * slow or down, its section drops its figures rather than show stale ones.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/data-store/connection";
import type { PublishedReport, ReportType } from "@/lib/report-engine/types";
import { timeAgo } from "@/lib/format";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { ReportFaq } from "./report-faq";
import { HamiltonLine } from "./hamilton-line";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { getMarketReadinessCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import type { MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";
import { ReportCover, ReportVideo } from "./report-cover";
import { SampleLines, StateReportMap } from "./report-exhibits";
import { mapStates, sampleExhibit, type StateCoverage } from "./report-view";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Fee Reports",
  description: `See where your fees stand against your competitors: free national, Fed district and state fee reports, and the ${REPORT_OFFER.name}.`,
};

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REQUEST_HREF = "/reports?report=institution#request";

const H2 = "text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]";

/** How a request runs, in the offer's own words. */
const STEPS = [
  { title: "Name your institution", body: "And any competitors you want included." },
  { title: "We confirm your market", body: `${REPORT_OFFER.nextStep}.` },
  { title: "Get the report", body: "A PDF with a source for every figure." },
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

async function loadSample() {
  return withDeadline(loadSampleReport().then(sampleExhibit), null, QUERY_DEADLINE_MS * 2);
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

function PublishedReportItem({ report }: { report: PublishedReport }) {
  const typeLabel = REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded bg-paper px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          {typeLabel}
        </span>
        <span className="text-[12px] text-ink-muted">{timeAgo(report.published_at)}</span>
      </div>
      <Link href={`/reports/${report.slug}`} className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-ink no-underline hover:text-brick">
        {report.title}
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

  const [{ reports, unavailable }, stateCoverage, readiness, sample] = await Promise.all([
    loadReports(typeFilter, fromIso),
    loadStateCoverage(),
    loadMarketReadiness(),
    loadSample(),
  ]);
  const hasReports = reports.length > 0;
  // Only show filter controls once there is a catalog to filter (or a filter is already applied).
  const showFilters = hasReports || filtersActive;

  const readyStates = new Set((readiness ?? []).filter((m) => m.ready).map((m) => m.state_code));
  const states = stateCoverage ? mapStates(stateCoverage.filter((s) => s.institution_count > 0), STATE_NAMES, readyStates) : [];
  const coveredInstitutions = states.reduce((sum, s) => sum + s.institutions, 0);

  return (
    <div className="pb-20">
      {/* 1. The report and the form, side by side. On a phone the form comes before the picture. */}
      <section className="border-b border-border bg-paper">
        <div className="mx-auto grid max-w-page gap-x-12 gap-y-8 px-4 pb-12 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:pb-16 lg:pt-14">
          <div className="lg:col-start-1 lg:row-start-1">
            <h1 className="text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[46px]">
              Know where your fees stand against your market
            </h1>
            <p className="mt-4 max-w-[34rem] text-[16px] text-ink-soft">
              Your published fees next to the competitors you name, with a source for every figure.
            </p>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-ink">
              {[REPORT_OFFER.priceLabel, "Reply within one business day", "Board-ready PDF"].map((item) => (
                <li key={item} className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brick" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div id="request" className="scroll-mt-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
            <RequestReportForm
              contactEmail={CONTACT_EMAIL}
              defaultSrc="reports-hub"
              defaultReportType="institution"
              title="Get your fee report"
            />
          </div>
          <div className="lg:col-start-1 lg:row-start-2">
            <ReportCover sample={sample} />
          </div>
        </div>
      </section>

      {/* 2. The video, in its own section. */}
      <ReportVideo sample={sample} />

      {/* 3. What's inside: the live sample's own fee lines. */}
      {sample && (
        <section aria-labelledby="inside-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h2 id="inside-heading" className={H2}>
                Inside: {sample.name} against {sample.competitorsWithData} local competitors
              </h2>
              <p className="mt-1 text-[14px] text-ink-muted">A live sample, rebuilt from verified fees.</p>
            </div>
            <Link
              href={SAMPLE_REPORT_HREF}
              className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              Read the whole sample
            </Link>
          </div>
          <SampleLines sample={sample} />
        </section>
      )}

      {/* 4. How a request runs. */}
      <section aria-labelledby="steps-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <h2 id="steps-heading" className={H2}>
          How it works
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-2xl border border-border bg-surface-0 p-5">
              <span className="font-mono text-[28px] font-semibold leading-none text-brick">{i + 1}</span>
              <p className="mt-3 text-[16px] font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-[14px] text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "reports_hub_steps" }}
            href={REQUEST_HREF}
            className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
          >
            {REPORT_OFFER.institutionCtaLabel}
          </TrackLink>
        </p>
      </section>

      {/* 5. Every state's free report on one map. */}
      <section aria-labelledby="states-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <h2 id="states-heading" className={H2}>
          Free state fee reports
        </h2>
        {states.length > 0 ? (
          <>
            <p className="mt-1 text-[14px] text-ink-muted">
              {coveredInstitutions.toLocaleString("en-US")} institutions with verified fees. Darker states have more.
            </p>
            <div className="mt-5">
              <StateReportMap states={states} />
            </div>
          </>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-border bg-surface-0 px-5 py-4 text-[14px] text-ink-muted">
            State coverage is temporarily unavailable. Try again shortly, or browse the{" "}
            <Link href="/research" className="font-medium text-ink underline underline-offset-2">
              research hub
            </Link>
            .
          </p>
        )}
      </section>

      {/* 6. Hamilton, once. */}
      <section className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="rounded-2xl bg-ink px-6 py-7 sm:px-8">
          <p className="text-[22px] font-semibold tracking-[-0.02em] text-white">Keep your market current</p>
          <HamiltonLine placement="reports_hub_closing" tone="dark" firstMention className="mt-2 max-w-[40rem] text-[14px]" />
        </div>
      </section>

      <ReportFaq />

      {/* Published research: hidden while nothing is published (#1174), shown when filters or an outage explain an empty list. */}
      {(hasReports || filtersActive || unavailable) && (
        <section className="mx-auto max-w-page px-4 pt-16 sm:px-6" id="research">
          <h2 className={H2}>Research and analysis from {SITE_NAME}</h2>
          {showFilters && (
            <ReportFilters typeFilter={typeFilter} rawRange={rawRange} filtersActive={filtersActive} />
          )}
          {hasReports ? (
            <ul className="m-0 max-w-[800px] list-none p-0">
              {reports.map((report) => (
                <PublishedReportItem key={report.id} report={report} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 max-w-[640px] text-[14px] leading-relaxed text-ink-muted">
              {unavailable
                ? "The research catalog is temporarily unavailable. Try again shortly."
                : filtersActive
                  ? "No published reports match these filters."
                  : "No national or peer reports are published yet."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
