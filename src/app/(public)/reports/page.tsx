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
import { CONTACT_EMAIL, REPORT_INCLUDES, REPORT_OFFER, RESEARCH_IMPRINT, SAMPLE_REPORT_LIVE, SITE_NAME } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { extractPositionMap, readSampleReportHtml } from "@/lib/hosted-reports";
import { getMarketReadinessCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import { HEADLINE_FEE_KEYS, MARKET_READY_MIN_RICH, RICH_MIN_CATEGORIES, type MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";
import { PositionPreview } from "./position-preview";
import { bestMarket, StateReportGrid, type StateCoverage } from "./state-report-grid";
import {
  AmbientGlow,
  BAND,
  BODY,
  CheckList,
  CTA_PRIMARY,
  CTA_SECONDARY,
  EYEBROW,
  GLASS,
  GLASS_SOFT,
  H1,
  H2,
  INTERACTION,
  LEAD,
  NUM,
  TEXT_LINK,
} from "@/components/public/site-look";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Fee Reports",
  description: `See where your fees stand against the institutions you compete with. Free national and Fed district fee reports, the ${REPORT_OFFER.name}, live state fee reports, and published research from ${RESEARCH_IMPRINT}.`,
};

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REQUEST_HREF = "/reports?report=institution#request";

const PRIMARY_BUTTON = `${CTA_PRIMARY} no-underline`;
const SECONDARY_BUTTON = `${CTA_SECONDARY} no-underline`;

const REPORT_CONTENTS = [
  {
    title: "The three findings that matter",
    body: "A one-page summary your pricing committee can read in two minutes.",
  },
  {
    title: "Your position on every fee",
    body: "Each published fee against the peer median and the middle half of the market.",
  },
  {
    title: "Where you sit above or below",
    body: "The lines outside the market range, with what each one means for customers.",
  },
  {
    title: "The revenue lens",
    body: "Posted prices next to the fee income in your FDIC or NCUA Call Report.",
  },
  {
    title: "Named competitors",
    body: "The institutions you compete with, by name, on the headline fees.",
  },
  {
    title: "A source for every number",
    body: "The disclosure, the page and the date collected, plus your full schedule.",
  },
];

const STEPS = [
  {
    title: "Tell us who you are",
    body: "Your institution, your name and a work email. Nothing to install, no call required.",
  },
  {
    title: "We build your peer set",
    body: "We pull your published fees and your competitors' from their own disclosures, then check each line.",
  },
  {
    title: "You get a board-ready PDF",
    body: `Delivered by email on the date we agree when we confirm your peer set. ${REPORT_OFFER.refreshLabel}.`,
  },
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

const CHARTER_NOUN: Record<string, string> = { bank: "banks", credit_union: "credit unions" };

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-8 max-w-3xl">
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 className={`mt-3 ${H2}`}>{title}</h2>
      {children && <p className={`mt-3 ${BODY}`}>{children}</p>}
    </div>
  );
}

function PublishedReportItem({ report }: { report: PublishedReport }) {
  const typeLabel = REPORT_TYPE_LABELS[report.report_type as ReportType] ?? report.report_type;
  return (
    <li className="flex flex-col gap-2 border-b border-[#E0D7C9] py-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-full bg-[#F3EEE6] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#5A5347]">
          {typeLabel}
        </span>
        <span className="text-[13px] text-[#5A5347]">{timeAgo(report.published_at)}</span>
      </div>
      <Link
        href={`/reports/${report.slug}`}
        className="report-title-link text-xl font-semibold leading-snug tracking-tight text-[#1A1815] no-underline"
      >
        {report.title}
      </Link>
      <Link
        href={`/reports/${report.slug}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#A93D25] no-underline"
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
  const closestMarket = readiness ? bestMarket(readiness.filter((m) => !m.ready)) : null;

  return (
    <div className={`relative isolate overflow-x-clip pb-24 ${INTERACTION}`}>
      <AmbientGlow />
      {/* Hero: the headline and pitch beside one glass box with the offer's terms and contents
          (or the sample's real position map once the sample is live), equal columns at xl. */}
      <section aria-labelledby="reports-title">
        <div className="mx-auto grid max-w-page grid-cols-1 gap-10 px-6 pb-14 pt-12 sm:pt-16 xl:grid-cols-2 xl:items-center xl:gap-14">
          <div className="min-w-0">
            <p className={EYEBROW}>{REPORT_OFFER.name}</p>
            <h1 id="reports-title" className={`mt-3 ${H1}`}>
              Know where your fees stand against your market.
            </h1>
            <p className={`mt-5 ${LEAD}`}>
              We put your published fees next to the banks and credit unions you compete with, line by
              line, and show where you are priced above, inside or below the market. Every number cites
              the fee schedule it came from.
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
            {positionMap && positionMap.rows.length > 0 && (
              <p className="mt-6 text-sm text-[#5A5347]">
                <span className="font-semibold text-[#1A1815]">{REPORT_OFFER.priceLabel}</span> · reply in 1 business
                day · board-ready PDF
              </p>
            )}
          </div>

          {positionMap && positionMap.rows.length > 0 ? (
            <div className="min-w-0">
              <PositionPreview map={positionMap} />
              <p className="mt-3 text-[13px] leading-relaxed text-[#5A5347]">
                Real figures from a report prepared for a ~$400M community bank; only the bank&apos;s name
                is hidden.{" "}
                <Link href={SAMPLE_REPORT_HREF} className={TEXT_LINK}>
                  See the whole report
                </Link>
              </p>
            </div>
          ) : (
            <div className={`min-w-0 p-6 sm:p-8 ${GLASS}`}>
              <dl className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5A5347]">Price</dt>
                  <dd className={`mt-1 text-2xl font-semibold tracking-tight text-[#1A1815] ${NUM}`}>
                    {REPORT_OFFER.priceLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5A5347]">Next step</dt>
                  <dd className="mt-1 text-[15px] font-semibold leading-snug text-[#1A1815]">Reply in 1 business day</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5A5347]">Format</dt>
                  <dd className="mt-1 text-[15px] font-semibold leading-snug text-[#1A1815]">Board-ready PDF</dd>
                </div>
              </dl>
              <CheckList items={REPORT_INCLUDES} className="mt-6 border-t border-[#E8E1D6] pt-6" />
            </div>
          )}
        </div>
      </section>

      {/* What's inside */}
      <section className="mx-auto max-w-page px-6 pt-12">
        <SectionHeading eyebrow="What's inside" title="Six sections, one PDF you can hand to your pricing committee." />
        <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 xl:gap-5">
          {REPORT_CONTENTS.map((item, index) => (
            <li key={item.title} className={`h-full p-6 ${GLASS_SOFT}`}>
              <span className={`text-sm font-semibold text-[#A93D25] ${NUM}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#1A1815]">{item.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-[#3D3830]">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-page px-6 pt-16">
        <SectionHeading eyebrow="How it works" title="Three steps, and you don't lift a finger after the first." />
        <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3 xl:gap-5">
          {STEPS.map((step, index) => (
            <li key={step.title} className={`relative h-full p-6 ${GLASS_SOFT}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1A1815] text-[13px] font-semibold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-[#1A1815]">{step.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-[#3D3830]">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Request form: the lead lands in the leads table (/admin/leads) */}
      <section id="request" aria-labelledby="request-title" className={`mt-16 scroll-mt-20 ${BAND}`}>
        {/* A frosted band with two equal columns at xl: the terms, then the form. One shrinkable
            column below that, so the form keeps its width at 320px. */}
        <div className="mx-auto grid max-w-page grid-cols-1 gap-8 px-4 py-12 sm:px-6 sm:py-16 xl:grid-cols-2 xl:items-start xl:gap-14">
          <div className="min-w-0">
            <p className={EYEBROW}>Request your report</p>
            <h2 id="request-title" className={`mt-3 ${H2}`}>
              Tell us where to send it.
            </h2>
            <p className={`mt-3 ${BODY}`}>
              The national and Fed district reports are free and open right away with just an email.
              For your institution against named competitors ({REPORT_OFFER.priceLabel.toLowerCase()}), leave
              your institution and work email. {REPORT_OFFER.nextStep}, and we confirm your peer set before
              any work starts.
            </p>
            <p className="mt-4 text-sm text-[#5A5347]">
              Prefer to write?{" "}
              <Link href="/contact?source=report" className={TEXT_LINK}>
                Send us a message
              </Link>
            </p>
          </div>
          <div className="min-w-0">
            <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="reports-hub" />
          </div>
        </div>
      </section>

      {/* State reports, live from the index */}
      <section className="mx-auto max-w-page px-6 pt-20">
        <SectionHeading eyebrow="Free state fee reports" title="Every state, built live from verified fee schedules.">
          Each state report compares fees there with the national picture and shows how banks and
          credit unions differ.{" "}
          {readiness
            ? `Darker states are closer to a full local peer comparison: ${MARKET_READY_MIN_RICH} banks or ${MARKET_READY_MIN_RICH} credit unions in the state with at least ${RICH_MIN_CATEGORIES} of the ${HEADLINE_FEE_KEYS.length} headline fees published.`
            : "Darker states have more institutions with verified fees."}
        </SectionHeading>
        {stateCoverage ? (
          <>
            <p className="mb-4 text-sm text-[#5A5347]">
              <b className="font-semibold text-[#1A1815]">{coveredInstitutions.toLocaleString()}</b> institutions
              with verified fees across <b className="font-semibold text-[#1A1815]">{coveredStateCount}</b> states
              {dcCovered ? " plus DC" : ""} · <b className="font-semibold text-[#1A1815]">{coveredFees.toLocaleString()}</b> fee lines
            </p>
            {readiness && (
              <p className="mb-4 text-sm text-[#5A5347]">
                {readyMarkets > 0 ? (
                  <>
                    <b className="font-semibold text-[#1A1815]">{readyMarkets}</b> of {readiness.length} state
                    markets have enough complete fee schedules for a full local comparison today.
                  </>
                ) : (
                  <>No state market has enough complete fee schedules for a full local comparison yet.</>
                )}
                {closestMarket && closestMarket.rich > 0 && (
                  <>
                    {" "}
                    Closest{readyMarkets > 0 ? " of the rest" : ""}: {STATE_NAMES[closestMarket.state_code] ?? closestMarket.state_code}{" "}
                    {CHARTER_NOUN[closestMarket.charter_type] ?? closestMarket.charter_type.replace(/_/g, " ")}, with{" "}
                    {closestMarket.rich} of {MARKET_READY_MIN_RICH}.
                  </>
                )}
              </p>
            )}
            <StateReportGrid states={stateCoverage} readiness={readiness} />
          </>
        ) : (
          <p className={`px-5 py-4 text-[15px] text-[#3D3830] ${GLASS_SOFT}`}>
            State coverage is temporarily unavailable. Try again shortly, or browse the{" "}
            <Link href="/research" className="text-[#A93D25] underline-offset-2 hover:underline">
              research hub
            </Link>
            .
          </p>
        )}
      </section>

      {/* Published research */}
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
            <p className="mt-6 text-[13px] text-[#5A5347]">
              Showing {reports.length} report{reports.length !== 1 ? "s" : ""}.
            </p>
          </>
        ) : (
          <p className={`max-w-[640px] px-5 py-4 text-[15px] leading-relaxed text-[#3D3830] ${GLASS_SOFT}`}>
            {unavailable
              ? "The research catalog is temporarily unavailable. Try again shortly."
              : filtersActive
                ? "No published reports match these filters."
                : "No national or peer reports are published yet. They will appear here as they are released; the state reports above are live today."}
          </p>
        )}
      </section>

      {/* Closing call to action: the /subscribe closing panel (centered glass, one primary). */}
      <section aria-labelledby="reports-cta" className="mx-auto max-w-page px-6 pt-20">
        <div className={`px-6 py-10 text-center sm:px-10 ${GLASS}`}>
          <h2 id="reports-cta" className={H2}>
            See your own fees against your market.
          </h2>
          <p className={`mx-auto mt-3 ${BODY}`}>
            The {REPORT_OFFER.name}, {REPORT_OFFER.priceLabel.toLowerCase()}: your fees next to named competitors in your market, with a source for every figure.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <TrackLink
              event="request_report_click"
              eventProps={{ placement: "reports_hub_footer" }}
              href={REQUEST_HREF}
              className={PRIMARY_BUTTON}
            >
              {REPORT_OFFER.institutionCtaLabel}
            </TrackLink>
            {sampleLive && (
              <Link href={SAMPLE_REPORT_HREF} className={SECONDARY_BUTTON}>
                Read the sample
              </Link>
            )}
          </div>
        </div>
      </section>

      <style>{`
        .report-title-link:hover { color: #C44B2E; }
        .state-tile { transition: transform 120ms ease, box-shadow 120ms ease; }
        .state-tile:hover { transform: translateY(-1px); box-shadow: 0 0 0 2px #1A1815; }
        .state-tile:focus-visible { outline: 2px solid #A93D25; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .state-tile, .state-tile:hover { transition: none; transform: none; } }
      `}</style>
    </div>
  );
}
