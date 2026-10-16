/**
 * /reports — the report's one home (page template briefs, "Reports").
 * One column throughout: the promise and two actions over the report as delivered (its pictures
 * come from `REPORT_SHOWCASE`); then the video, the sample's own fee lines as one tappable
 * exhibit, the request (steps over the form), every state's free report on one full-width map,
 * Hamilton once, the questions, and published research (hidden while empty). Every figure is read from the live sample or the cached catalog reads; when either is
 * slow or down, its section drops its figures rather than show stale ones.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/data-store/connection";
import type { PublishedReport, ReportType } from "@/lib/report-engine/types";
import { timeAgo } from "@/lib/format";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { ReportFaq } from "./report-faq";
import { HamiltonLine } from "../hamilton-line";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { getMarketReadinessCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import type { MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";
import { ReportShowcase, ReportVideo } from "./report-cover";
import { SampleLines, StateReportMap } from "./report-exhibits";
import { formatReadOn, mapStates, sampleExhibit, type StateCoverage } from "./report-view";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Fee Reports",
  description: `See where your fees stand against your competitors: free national, Fed district and state fee reports, and the ${REPORT_OFFER.name}.`,
};

const SAMPLE_REPORT_HREF = REPORT_SHOWCASE.sampleHref;

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
      {/* 1. One column: the promise, the two actions, then the report as delivered. */}
      <section className="border-b border-border bg-paper">
        <div className="mx-auto max-w-page px-4 pb-12 pt-10 text-center sm:px-6 lg:pb-16 lg:pt-16">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brick">{REPORT_OFFER.name}</p>
          <h1 className="mx-auto mt-3 max-w-[46rem] text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[52px]">
            Know where your fees stand against your market
          </h1>
          <p className="mx-auto mt-4 max-w-[34rem] text-[16px] text-ink-soft sm:text-[18px]">
            Your published fees next to the competitors you name.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "reports_hub_hero" }}
              href="#request"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-ink px-6 text-[15px] font-semibold text-on-ink hover:opacity-90 sm:w-auto"
            >
              {REPORT_OFFER.institutionCtaLabel}
            </TrackLink>
            {sample && (
              <TrackLink
                event="sample_report_click"
                eventProps={{ placement: "reports_hero_sample" }}
                href={SAMPLE_REPORT_HREF}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-border bg-surface-0 px-6 text-[15px] font-semibold text-ink hover:border-ink sm:w-auto"
              >
                Read a free sample
              </TrackLink>
            )}
          </div>
          <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] font-medium text-ink-muted">
            {[REPORT_OFFER.priceLabel, "Board-ready PDF", "A source for every figure"].map((item) => (
              <li key={item} className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brick" />
                {item}
              </li>
            ))}
          </ul>
          <ReportShowcase />
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
              <p className="mt-1 text-[14px] text-ink-muted">
                Live, from each bank&apos;s own published fee schedule
                {sample.readOn ? `, schedules read through ${formatReadOn(sample.readOn)}` : ""}.
              </p>
            </div>
            <TrackLink
              event="sample_report_click"
              eventProps={{ placement: "reports_inside_sample" }}
              href={SAMPLE_REPORT_HREF}
              className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              Read the whole sample, with sources
            </TrackLink>
          </div>
          <SampleLines sample={sample} />
        </section>
      )}

      {/* 4. The request: how it runs, then the form, in one column. */}
      <section id="request" aria-labelledby="request-heading" className="scroll-mt-24 mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-[36rem]">
          <h2 id="request-heading" className={`${H2} text-center`}>
            Get your fee report
          </h2>
          <ol className="mt-5 grid gap-2">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-center gap-4 rounded-xl bg-paper px-4 py-3">
                <span className="font-mono text-[20px] font-semibold leading-none text-brick">{i + 1}</span>
                <span>
                  <span className="block text-[14px] font-semibold text-ink">{step.title}</span>
                  <span className="block text-[13px] text-ink-muted">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5">
            <RequestReportForm
              contactEmail={CONTACT_EMAIL}
              defaultSrc="reports-hub"
              defaultReportType="institution"
            />
          </div>
        </div>
      </section>

      {/* 5. Every state's free report on one map, full width. */}
      <section aria-labelledby="states-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-[44rem] text-center">
          <h2 id="states-heading" className={H2}>
            Free state fee reports
          </h2>
          {states.length > 0 && (
            <p className="mt-2 text-[14px] text-ink-muted">
              {coveredInstitutions.toLocaleString("en-US")} institutions with verified fees. Tap a state.{" "}
              <Link href="/methodology" className="inline-flex min-h-11 items-center font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
                How we verify
              </Link>
            </p>
          )}
        </div>
        {states.length > 0 ? (
          <div className="mt-6">
            <StateReportMap states={states} />
          </div>
        ) : (
          <p className="mx-auto mt-3 max-w-[44rem] rounded-lg border border-dashed border-border bg-surface-0 px-5 py-4 text-[14px] text-ink-muted">
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
        <div className="rounded-2xl border border-border bg-surface-0 px-6 py-7 sm:px-8">
          <p className="text-[20px] font-semibold tracking-[-0.02em] text-ink">After the report</p>
          <HamiltonLine placement="reports_hub_closing" firstMention className="mt-2 max-w-[40rem] text-[14px]" />
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
