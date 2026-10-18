/**
 * /reports — the report's one home (page template briefs, "Reports").
 * One column throughout: the promise and two actions over the report as delivered (drawn from
 * the live sample, so the picture and the sample agree); then the sample's own fee lines as one
 * tappable exhibit, the paid request (steps, what the price includes, the form), the free
 * national and district reports in their own section, every state's free report on one
 * full-width map, Hamilton once, the questions, and published research (hidden while empty). Every figure is read from the live sample or the cached catalog reads; when either is
 * slow or down, its section drops its figures rather than show stale ones.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/data-store/connection";
import type { PublishedReport } from "@/lib/report-engine/types";
import { timeAgo } from "@/lib/format";
import { shortenPageLife } from "@/lib/data-store/public-read-cache";
import { TrackLink } from "@/components/track-link";
import { CONTACT_EMAIL, REPORT_INCLUDES, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { REPORT_SHOWCASE } from "@/lib/report-showcase";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { COVERAGE_LABELS, getPublicStatsSummary } from "@/lib/public-stats";
import { ReportFaq } from "./report-faq";
import { HamiltonLine } from "../hamilton-line";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { getMarketReadinessCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import type { MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { PublishedResearch, RequestSection, type PublishedReportItemView } from "./report-query";
import { ReportShowcase } from "./report-cover";
import { SampleLines, StateReportMap } from "./report-exhibits";
import { formatReadOn, mapStates, sampleExhibit, type StateCoverage } from "./report-view";

/**
 * Regenerated in the background (ISR) at most hourly (#1811). The page reads no session and no
 * search params: `?report=`, `?type=` and `?range=` are read in the browser (report-query.tsx).
 * A render with a failed read is cached for a minute instead (`shortenPageLife`, as the homepage).
 */
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

function isoOrNull(value: unknown): string | null {
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function toItemView(report: PublishedReport): PublishedReportItemView {
  const publishedAt = isoOrNull(report.published_at);
  return {
    id: String(report.id),
    report_type: report.report_type,
    slug: report.slug,
    title: report.title,
    published_at: publishedAt,
    ago: publishedAt ? timeAgo(publishedAt) : "",
  };
}

/** Every public report; the `?type=` and `?range=` filters apply in the browser. */
async function loadReports() {
  try {
    const sql = getSql();
    const reportQuery = sql<PublishedReport[]>`
      SELECT id, report_type, slug, title, published_at
      FROM published_reports
      WHERE is_public = true
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

/** `failed` is a read that errored or ran out of time, apart from a day with no sample. */
async function loadSample() {
  return withDeadline(
    loadSampleReport().then((report) => ({ sample: sampleExhibit(report), failed: false })),
    { sample: null, failed: true },
    QUERY_DEADLINE_MS * 2,
  );
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

export default async function ReportsPage() {
  const [{ reports, unavailable }, stateCoverage, readiness, sampleRead, coverage] = await Promise.all([
    loadReports(),
    loadStateCoverage(),
    loadMarketReadiness(),
    loadSample(),
    // The headline count is the shared snapshot's, the same figure /fees and /about show (#1591);
    // the per-state reader below only shades the map.
    getPublicStatsSummary(),
  ]);
  const sample = sampleRead.sample;
  const hasReports = reports.length > 0;
  // A render with a failed read is cached for a minute, not an hour (see the note at the top).
  if (unavailable || !stateCoverage || !readiness || sampleRead.failed || !coverage.complete) await shortenPageLife();

  const readyStates = new Set((readiness ?? []).filter((m) => m.ready).map((m) => m.state_code));
  const states = stateCoverage ? mapStates(stateCoverage.filter((s) => s.institution_count > 0), STATE_NAMES, readyStates) : [];

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
            Every fee you publish, set against the competitors you name. Each of their figures links to the page of
            their own fee schedule it came from.
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
          <ReportShowcase sample={sample} preparedOn={new Date()} />
        </div>
      </section>

      {/* 3. What's inside: the live sample's own fee lines. */}
      {sample && (
        <section aria-labelledby="inside-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h2 id="inside-heading" className={H2}>
                Inside: {sample.name} against {sample.competitorsWithData} local competitors
              </h2>
              <p className="mt-1 text-[14px] text-ink-muted">
                The shaded band is the middle half of local competitors&apos; fees. Live, from each bank&apos;s own
                published fee schedule{sample.readOn ? `, read through ${formatReadOn(sample.readOn)}` : ""}.
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

      {/* 4. The paid request: how it runs, what the price includes, then the form, in one column. */}
      <RequestSection kind="paid" aria-labelledby="request-heading" className="scroll-mt-24 mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
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
          <div className="mt-5 rounded-xl border border-border px-4 py-3">
            <p className="text-[14px] font-semibold text-ink">{REPORT_OFFER.priceLabel} includes</p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-ink-soft">
              {REPORT_INCLUDES.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brick" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-5">
            <RequestReportForm
              contactEmail={CONTACT_EMAIL}
              defaultSrc="reports-hub"
              defaultReportType="institution"
              offer="institution"
            />
          </div>
        </div>
      </RequestSection>

      {/* 5. The free reports, apart from the paid request. */}
      <RequestSection kind="free" aria-labelledby="free-heading" className="scroll-mt-24 mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-[36rem]">
          <h2 id="free-heading" className={`${H2} text-center`}>
            Free national and Fed district reports
          </h2>
          <p className="mt-2 text-center text-[14px] text-ink-muted">The headline fees for the U.S. or for one Fed district.</p>
          <div className="mt-5">
            <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="reports-hub-free" defaultReportType="national" offer="free" idScope="-free" />
          </div>
        </div>
      </RequestSection>

      {/* 6. Every state's free report on one map, full width. */}
      <section aria-labelledby="states-heading" className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-[44rem] text-center">
          <h2 id="states-heading" className={H2}>
            Free state fee reports
          </h2>
          {states.length > 0 && (
            <p className="mt-2 text-[14px] text-ink-muted">
              {coverage.complete ? `${coverage.institutionsLabel} ${COVERAGE_LABELS.institutions.toLowerCase()}. ` : null}Tap a state.{" "}
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

      {/* 7. Hamilton, once. */}
      <section className="mx-auto max-w-page px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="rounded-2xl border border-border bg-surface-0 px-6 py-7 sm:px-8">
          <p className="text-[20px] font-semibold tracking-[-0.02em] text-ink">After the report</p>
          <HamiltonLine placement="reports_hub_closing" firstMention className="mt-2 max-w-[40rem] text-[14px]" />
        </div>
      </section>

      <ReportFaq />

      {/* Published research: hidden while nothing is published (#1174), shown when an outage explains an empty list. */}
      {(hasReports || unavailable) && (
        <section className="mx-auto max-w-page px-4 pt-16 sm:px-6" id="research">
          <h2 className={H2}>Research and analysis from {SITE_NAME}</h2>
          <PublishedResearch reports={reports.map(toItemView)} unavailable={unavailable} />
        </section>
      )}
    </div>
  );
}
