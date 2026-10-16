/**
 * /reports/sample-competitive-fee-position — the public sample Competitive Fee Position
 * Report. It is a live report for one real community bank, rendered by the same body as
 * a buyer's report (src/app/market-report/report-body.tsx), so the sample always shows
 * today's layout and data: source links on every competitor amount, the at-a-glance rank
 * and the CSV. When no candidate market passes the readiness bar it says a new sample is
 * on its way. Site chrome (nav + footer) comes from the (public) layout.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { TrackLink } from "@/components/track-link";
import { TrackView } from "@/components/track-view";
import { PAGE_CRUMBS, PAGE_HEADER } from "@/components/public/page-header";
import { HamiltonLine } from "../hamilton-line";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL, REPORT_OFFER } from "@/lib/constants";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { getRevenueContextCached } from "@/lib/custom-report/revenue-context";
import { getMarketBranchFootprintCached } from "@/lib/data-store/public-cached-reads";
import { MarketReportBody } from "@/app/market-report/report-body";
import { PrintButton } from "@/app/market-report/[token]/print-button";

export const dynamic = "force-dynamic";

const SAMPLE_PATH = "/reports/sample-competitive-fee-position";
const SAMPLE_CSV_PATH = "/reports/sample-competitive-fee-position/csv";
const REQUEST_HREF = "/reports?report=institution&src=sample-report#request";
const REPORT_TITLE = "Sample Competitive Fee Position Report";
const REPORT_DESCRIPTION = `A live ${REPORT_OFFER.name} for a community bank: its fees against its local competitors, the lines outside the local middle half, and named competitors with the schedule behind every amount.`;

export async function generateMetadata(): Promise<Metadata> {
  const report = await loadSampleReport().catch(() => null);
  return {
    title: REPORT_TITLE,
    description: `See what the ${REPORT_OFFER.name} from ${SITE_NAME} contains: an institution's fees against its local competitors, each competitor amount linked to the schedule it was read from.`,
    alternates: { canonical: SAMPLE_PATH },
    robots: { index: report !== null, follow: true },
    openGraph: {
      type: "article",
      title: REPORT_TITLE,
      description: REPORT_DESCRIPTION,
      url: `${SITE_URL}${SAMPLE_PATH}`,
      siteName: SITE_NAME,
    },
  };
}

const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink transition-opacity hover:opacity-90";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center rounded-full border border-control-border px-5 text-[14px] font-semibold text-ink transition-colors hover:border-ink";

/** The report's cover, drawn without figures: what arrives, while the live sample is rebuilt. */
function SampleCoverArt() {
  return (
    <div className="relative mx-auto mt-10 w-full max-w-[26rem] py-4 text-left sm:mx-0" aria-hidden="true">
      <div className="absolute inset-x-6 inset-y-2 -rotate-3 rounded-xl bg-brick-tint" />
      <div className="absolute inset-x-4 inset-y-3 rotate-2 rounded-xl bg-surface-200" />
      <div className="relative rounded-xl border border-border bg-surface-0 p-6 shadow-fi-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brick">{REPORT_OFFER.name}</p>
        <p className="mt-3 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">Your institution against its local market</p>
        <div className="mt-5 space-y-2.5">
          {[62, 78, 48, 70, 56].map((w, i) => (
            <span key={i} className="relative block h-2 rounded-full bg-paper">
              <span className="absolute inset-y-0 left-[18%] rounded-full bg-brick-tint" style={{ width: `${w - 18}%` }} />
              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${w - 8}%` }} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Shown while the sample is offline for a re-render, so no stale figures stay public. */
function SampleComingSoon() {
  return (
    <div className={`mx-auto max-w-3xl px-6 pb-24 pt-14 ${PAGE_HEADER}`}>
      <nav aria-label="Breadcrumb" className={`mb-6 ${PAGE_CRUMBS}`}>
        <Link href="/reports" className="transition-colors hover:text-ink">
          Reports
        </Link>
        <span className="text-border">/</span>
        <span className="text-ink-soft">Sample</span>
      </nav>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-brick">
        Sample: {REPORT_OFFER.name}
      </p>
      <h1
        className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[40px]"
      >
        A new sample report is on its way.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
        We are rebuilding it from current, source-checked data. You can still request one for your institution.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
        <TrackLink
          event="request_report_click"
          eventProps={{ placement: "sample_report_offline" }}
          href={REQUEST_HREF}
          className={PRIMARY_BUTTON}
        >
          {REPORT_OFFER.institutionCtaLabel}
        </TrackLink>
        <Link href="/research" className={SECONDARY_BUTTON}>
          Browse the research
        </Link>
      </div>
      <SampleCoverArt />
      <p className="mt-6 text-[13px] text-ink-muted">
        Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink-soft underline">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}

export default async function SampleReportPage() {
  const report = await loadSampleReport().catch((error) => {
    console.error("[sample-report] unavailable", { error: error instanceof Error ? error.message : String(error) });
    return null;
  });
  if (!report) return <SampleComingSoon />;
  const name = report.data.subject.institution_name;
  const market = report.data.market;
  const branches = market
    ? await getMarketBranchFootprintCached(market.county_fips, market.sod_year).catch(() => null)
    : null;
  const revenue = await getRevenueContextCached(report.data.subject.institution_id).catch(() => null);

  return (
    <div className="mx-auto max-w-page px-6 pb-24 pt-14">
      <TrackView event="sample_report_view" eventProps={{ institution_id: report.data.subject.institution_id }} />
      <nav aria-label="Breadcrumb" className={`mb-6 ${PAGE_CRUMBS}`}>
        <Link href="/reports" className="transition-colors hover:text-ink">
          Reports
        </Link>
        <span className="text-border">/</span>
        <span className="text-ink-soft">Sample</span>
      </nav>

      <header className={`border-b border-border pb-8 ${PAGE_HEADER}`}>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-brick">
          Sample: {REPORT_OFFER.name}
        </p>
        <h1
          className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]"
        >
          This is what your institution report looks like.
        </h1>
        <p className="mx-auto mt-4 max-w-[680px] sm:mx-0 text-[16px] leading-relaxed text-ink-soft">
          Today&apos;s report for {name}, built live by the same code that builds yours, every amount linked to its
          fee schedule.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "sample_report_header" }}
            href={REQUEST_HREF}
            className={PRIMARY_BUTTON}
          >
            {REPORT_OFFER.institutionCtaLabel}
          </TrackLink>
          <HamiltonLine placement="sample_report_header" firstMention className="max-w-[420px]" />
        </div>
      </header>

      <div className="pt-2">
        <MarketReportBody
          report={report}
          revenue={revenue}
          branches={branches}
          eyebrow={REPORT_OFFER.name}
          titleAs="h2"
          preparedOn={new Date()}
          contactHref="/contact?source=sample_report"
          actions={
            <>
              <PrintButton className={SECONDARY_BUTTON} />
              <a href={SAMPLE_CSV_PATH} className={SECONDARY_BUTTON}>
                Download CSV
              </a>
            </>
          }
          correctionNote={
            <>
              If a figure does not match an institution&apos;s current schedule,{" "}
              <a href="/contact?source=sample_report" className="underline">
                tell us through the contact form
              </a>{" "}
              and we will correct it.
            </>
          }
        />
      </div>

      <section className="mt-10 flex flex-col items-start gap-4 rounded-xl border border-border bg-surface-0 p-6 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <p className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Get this report for your institution.</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {REPORT_OFFER.priceLabel}. {REPORT_OFFER.refreshLabel}. Questions:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink-soft underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "sample_report_footer" }}
            href={REQUEST_HREF}
            className={PRIMARY_BUTTON}
          >
            {REPORT_OFFER.institutionCtaLabel}
          </TrackLink>
        </div>
      </section>
    </div>
  );
}
