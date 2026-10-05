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
import { CONTACT_EMAIL, PRODUCT_NAME, REPORT_OFFER, REPORT_OFFER_LINE, RESEARCH_IMPRINT, SITE_NAME } from "@/lib/constants";
import { RequestReportForm } from "@/app/for-institutions/request-report-form";
import { extractPositionMap, readSampleReportHtml } from "@/lib/hosted-reports";
import { getMarketReadinessCached, getStatesWithFeeDataCached } from "@/lib/data-store/public-cached-reads";
import { HEADLINE_FEE_KEYS, MARKET_READY_MIN_RICH, RICH_MIN_CATEGORIES, type MarketReadiness } from "@/lib/data-store/market-readiness";
import { STATE_CODES, STATE_NAMES } from "@/lib/us-states";
import { REPORT_TYPE_LABELS, ReportFilters } from "./report-filters";
import { PositionPreview } from "./position-preview";
import { bestMarket, StateReportGrid, type StateCoverage } from "./state-report-grid";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Fee Reports",
  description: `See where your fees stand against the institutions you compete with. A free ${REPORT_OFFER.name} (${REPORT_OFFER.valueLabel}), live state fee reports, and published research from ${RESEARCH_IMPRINT}.`,
};

const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";
const REQUEST_HREF = "#request";

const PRIMARY_BUTTON =
  "inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#A93D25]";
const SECONDARY_BUTTON =
  "inline-flex items-center rounded-md border border-[#D5CBBF] bg-white px-4 py-2.5 text-sm font-semibold text-[#1A1815] no-underline transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

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
    body: `Delivered by email, ${REPORT_OFFER.turnaround}. ${REPORT_OFFER.refreshLabel}.`,
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
    <div className="mb-8 max-w-[640px]">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">{eyebrow}</p>
      <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-[#1A1815]" style={SERIF}>
        {title}
      </h2>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-[#5A5347]">{children}</p>}
    </div>
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

  const [{ reports, unavailable }, stateCoverage, readiness] = await Promise.all([
    loadReports(typeFilter, fromIso),
    loadStateCoverage(),
    loadMarketReadiness(),
  ]);
  const positionMap = extractPositionMap(readSampleReportHtml());
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
    <div className="pb-24">
      {/* Hero: the report, with its real position map */}
      <section className="border-b border-[#E8DFD1] bg-[linear-gradient(180deg,#FBF7F1_0%,#FDFBF8_100%)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-14 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center">
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
              {REPORT_OFFER.name}
            </p>
            <h1
              className="text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[#1A1815] sm:text-[2.75rem]"
              style={SERIF}
            >
              Know where your fees stand against your market.
            </h1>
            <p className="mt-5 max-w-[540px] text-[16px] leading-relaxed text-[#5A5347]">
              We put your published fees next to the banks and credit unions you compete with, line by
              line, and show where you are priced above, inside or below the market. Every number cites
              the fee schedule it came from.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <TrackLink
                event="request_report"
                eventProps={{ placement: "reports_hub_hero" }}
                href={REQUEST_HREF}
                className={PRIMARY_BUTTON}
              >
                {REPORT_OFFER.ctaLabel}
              </TrackLink>
              <Link href={SAMPLE_REPORT_HREF} className={SECONDARY_BUTTON}>
                Read the full sample
              </Link>
            </div>
            <dl className="mt-8 grid max-w-[520px] grid-cols-3 gap-4 border-t border-[#E8DFD1] pt-5">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-[#6B6255]">Price</dt>
                <dd className="mt-1 text-[15px] font-semibold text-[#1A1815]">
                  {REPORT_OFFER.priceLabel}{" "}
                  <span className="font-normal text-[#6B6255]">({REPORT_OFFER.valueLabel})</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-[#6B6255]">Turnaround</dt>
                <dd className="mt-1 text-[15px] font-semibold text-[#1A1815]">48 hours</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-[#6B6255]">Format</dt>
                <dd className="mt-1 text-[15px] font-semibold text-[#1A1815]">Board-ready PDF</dd>
              </div>
            </dl>
          </div>

          {positionMap.rows.length > 0 && (
            <div>
              <PositionPreview map={positionMap} />
              <p className="mt-3 text-[12px] leading-relaxed text-[#6B6255]">
                Real figures from a report prepared for a ~$400M community bank; only the bank&apos;s name
                is hidden.{" "}
                <Link href={SAMPLE_REPORT_HREF} className="text-[#A93D25] underline-offset-2 hover:underline">
                  See the whole report
                </Link>
              </p>
            </div>
          )}
        </div>
      </section>

      {/* What's inside */}
      <section className="mx-auto max-w-6xl px-6 pt-16">
        <SectionHeading eyebrow="What's inside" title="Six sections, one PDF you can hand to your pricing committee." />
        <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_CONTENTS.map((item, index) => (
            <li key={item.title} className="rounded-lg border border-[#E8DFD1] bg-white p-5">
              <span className="text-[13px] font-semibold tabular-nums text-[#C44B2E]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-[16px] font-semibold text-[#1A1815]">{item.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[#5A5347]">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 pt-16">
        <SectionHeading eyebrow="How it works" title="Three steps, and you don't lift a finger after the first." />
        <ol className="m-0 grid list-none gap-6 p-0 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1A1815] text-[13px] font-semibold text-white">
                  {index + 1}
                </span>
                {index < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-[#E0D7C9] md:block" />}
              </div>
              <h3 className="mt-4 text-[16px] font-semibold text-[#1A1815]">{step.title}</h3>
              <p className="mt-1.5 max-w-[320px] text-[14px] leading-relaxed text-[#5A5347]">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Request form: the lead lands in the leads table (/admin/leads) */}
      <section id="request" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-16">
        <div className="grid gap-8 rounded-xl border border-[#E8DFD1] bg-[#FBF7F1] p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] lg:items-start">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
              Request your report
            </p>
            <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.015em] text-[#1A1815]" style={SERIF}>
              Tell us where to send it.
            </h2>
            <p className="mt-3 max-w-[460px] text-[15px] leading-relaxed text-[#5A5347]">
              Leave your institution and work email. We confirm your peer set within one business day,
              then send the PDF. {REPORT_OFFER.priceLabel}, {REPORT_OFFER.valueLabel}.
            </p>
            <p className="mt-4 text-[13px] text-[#6B6255]">
              Prefer email?{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#A93D25] underline-offset-2 hover:underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
          <RequestReportForm contactEmail={CONTACT_EMAIL} defaultSrc="reports-hub" />
        </div>
      </section>

      {/* State reports, live from the index */}
      <section className="mx-auto max-w-6xl px-6 pt-20">
        <SectionHeading eyebrow="Free state fee reports" title="Every state, built live from verified fee schedules.">
          Each state report compares fees there with the national picture and shows how banks and
          credit unions differ.{" "}
          {readiness
            ? `Darker states are closer to a full local peer comparison: ${MARKET_READY_MIN_RICH} banks or ${MARKET_READY_MIN_RICH} credit unions in the state with at least ${RICH_MIN_CATEGORIES} of the ${HEADLINE_FEE_KEYS.length} headline fees published.`
            : "Darker states have more institutions with verified fees."}
        </SectionHeading>
        {stateCoverage ? (
          <>
            <p className="mb-4 text-[13px] text-[#6B6255]">
              <b className="font-semibold text-[#1A1815]">{coveredInstitutions.toLocaleString()}</b> institutions
              with verified fees across <b className="font-semibold text-[#1A1815]">{coveredStateCount}</b> states
              {dcCovered ? " plus DC" : ""} · <b className="font-semibold text-[#1A1815]">{coveredFees.toLocaleString()}</b> fee lines
            </p>
            {readiness && (
              <p className="mb-4 text-[13px] text-[#6B6255]">
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
          <p className="rounded-lg border border-dashed border-[#D5CBBF] bg-[#FDFBF8] px-5 py-4 text-[14px] text-[#6B6255]">
            State coverage is temporarily unavailable. Try again shortly, or browse the{" "}
            <Link href="/research" className="text-[#A93D25] underline-offset-2 hover:underline">
              research hub
            </Link>
            .
          </p>
        )}
      </section>

      {/* Published research */}
      <section className="mx-auto max-w-6xl px-6 pt-20" id="research">
        <SectionHeading eyebrow="Published research" title={`Research and analysis powered by ${SITE_NAME} and the ${PRODUCT_NAME}`} />
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
            <p className="mt-6 text-[12px] text-[#6B6255]">
              Showing {reports.length} report{reports.length !== 1 ? "s" : ""}.
            </p>
          </>
        ) : (
          <p className="max-w-[640px] text-[14px] leading-relaxed text-[#6B6255]">
            {unavailable
              ? "The research catalog is temporarily unavailable. Try again shortly."
              : filtersActive
                ? "No published reports match these filters."
                : "No national or peer reports are published yet. They will appear here as they are released; the state reports above are live today."}
          </p>
        )}
      </section>

      {/* Closing call to action */}
      <section className="mx-auto max-w-6xl px-6 pt-20">
        <div className="flex flex-col items-start gap-5 rounded-xl bg-[#1A1815] px-7 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[24px] leading-snug text-white" style={SERIF}>
              See your own fees against your market.
            </p>
            <p className="mt-1 text-[13px] text-[#C9BFB1]">{REPORT_OFFER_LINE}.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <TrackLink
              event="request_report"
              eventProps={{ placement: "reports_hub_footer" }}
              href={REQUEST_HREF}
              className={PRIMARY_BUTTON}
            >
              {REPORT_OFFER.ctaLabel}
            </TrackLink>
            <Link
              href={SAMPLE_REPORT_HREF}
              className="inline-flex items-center rounded-md border border-[#5A5347] px-4 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:border-white"
            >
              Read the sample
            </Link>
          </div>
        </div>
      </section>

      <style>{`
        .report-title-link:hover { color: #C44B2E; }
        .state-tile { transition: transform 120ms ease, box-shadow 120ms ease; }
        .state-tile:hover { transform: translateY(-1px); box-shadow: 0 0 0 2px #1A1815; }
        .state-tile:focus-visible { outline: 2px solid #1A1815; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
