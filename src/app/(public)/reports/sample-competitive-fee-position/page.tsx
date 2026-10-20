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
import { Download, FileText, LineChart } from "lucide-react";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { TrackView } from "@/components/track-view";
import { PAGE_CRUMBS, PAGE_HEADER } from "@/components/public/page-header";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL, REPORT_OFFER } from "@/lib/constants";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { getRevenueContextCached } from "@/lib/custom-report/revenue-context";
import { loadMarketCheckingLineup } from "@/lib/custom-report/checking-lineup-data";
import { getReportPeerContextCached, peerLinesFor } from "@/lib/custom-report/peer-context";
import { getMarketBranchFootprintCached } from "@/lib/data-store/public-cached-reads";
import { MarketReportBody } from "@/app/market-report/report-body";
import { PrintButton } from "@/app/market-report/[token]/print-button";

export const dynamic = "force-dynamic";

const SAMPLE_PATH = "/reports/sample-competitive-fee-position";
const SAMPLE_CSV_PATH = "/reports/sample-competitive-fee-position/csv";
const REQUEST_HREF = "/reports?report=institution&src=sample-report#request";
const REPORT_TITLE = "Sample Competitive Fee Position Report";
const REPORT_DESCRIPTION = `A live ${REPORT_OFFER.name} for a community bank: its fees against its local competitors, the lines outside the local middle 50%, and named competitors with the schedule behind every amount.`;

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

// The homepage's CTA pair (landing-hamilton.tsx): Hamilton is the goal, the report the second step.
const HAMILTON_BUTTON = "fi-btn fi-btn-brick min-h-12 px-6 text-[15px]";
const REPORT_BUTTON = "fi-btn fi-btn-secondary min-h-12 px-6 text-[15px]";
const QUIET_LINK =
  "inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px] font-medium text-ink-soft underline decoration-border underline-offset-4 hover:text-ink hover:decoration-ink";

/** The sample's two next steps, Hamilton first. `placement` names where on the page they sit. */
function NextSteps({ placement }: { placement: string }) {
  return (
    <>
      <TrackLink event="upgrade_click" eventProps={{ placement: `sample_report_${placement}` }} href={PRO_PLANS_NAV.href} className={HAMILTON_BUTTON}>
        Get Hamilton for your institution
      </TrackLink>
      <TrackLink event="request_report_click" eventProps={{ placement: `sample_report_${placement}` }} href={REQUEST_HREF} className={REPORT_BUTTON}>
        {REPORT_OFFER.institutionCtaLabel}
      </TrackLink>
    </>
  );
}

/**
 * The page's close (James, Oct 18: "add a Hamilton subscription action alongside the report
 * offer"): Hamilton, the subscription, on the wider navy side; the one-off report beside it.
 */
function SampleClose() {
  return (
    <section
      aria-labelledby="sample-close-heading"
      className="fi-on-navy mt-14 grid overflow-hidden rounded-2xl bg-ink text-paper lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] print:hidden"
    >
      <div className="p-6 sm:p-10">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brick-on-navy">
          <LineChart aria-hidden="true" className="size-4" />
          Hamilton
        </p>
        <h2 id="sample-close-heading" className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[36px]">
          Track your own market in Hamilton
        </h2>
        <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-paper/80">
          Hamilton compares your fees with the schedules your local competitors publish.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <TrackLink event="upgrade_click" eventProps={{ placement: "sample_report_footer" }} href={PRO_PLANS_NAV.href} className={HAMILTON_BUTTON}>
            Get Hamilton for your institution
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "sample_report_footer_demo" }}
            href={DEMO_REQUEST_NAV.href}
            className="inline-flex min-h-11 items-center text-[15px] font-medium text-paper underline decoration-paper/40 underline-offset-4 hover:decoration-paper"
          >
            {DEMO_REQUEST_NAV.label}
          </TrackLink>
        </div>
      </div>
      <div className="border-t border-white/15 p-6 sm:p-10 lg:border-l lg:border-t-0">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-paper/70">
          <FileText aria-hidden="true" className="size-4" />
          One report
        </p>
        <p className="mt-3 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-white">This report, for your institution</p>
        <p className="mt-2 text-[14px] text-paper/75">
          {REPORT_OFFER.priceLabel}. {REPORT_OFFER.refreshLabel}.
        </p>
        <TrackLink
          event="request_report_click"
          eventProps={{ placement: "sample_report_footer" }}
          href={REQUEST_HREF}
          className="mt-5 inline-flex min-h-12 items-center rounded-full border border-paper/40 px-6 text-[15px] font-semibold text-paper transition-colors hover:border-paper"
        >
          {REPORT_OFFER.institutionCtaLabel}
        </TrackLink>
        <p className="mt-5 text-[13px] text-paper/70">
          Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-paper underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}

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
    <div className={`mx-auto max-w-3xl px-4 pb-24 pt-14 sm:px-6 ${PAGE_HEADER}`}>
      <nav aria-label="Breadcrumb" className={`mb-6 ${PAGE_CRUMBS}`}>
        <Link href="/reports" className="inline-flex min-h-11 items-center transition-colors hover:text-ink sm:min-h-0">
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
        <NextSteps placement="offline" />
        <Link href="/research" className={QUIET_LINK}>
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
  const market = report.data.market;
  const branches = market
    ? await getMarketBranchFootprintCached(market.county_fips, market.sod_year).catch(() => null)
    : null;
  const revenue = await getRevenueContextCached(report.data.subject.institution_id).catch(() => null);
  // The same checking-account lineup a buyer's report shows, from live published fees.
  const lineup = await loadMarketCheckingLineup(report.data.subject.institution_id).catch(() => null);
  const peers = await getReportPeerContextCached(report.data.subject.institution_id, peerLinesFor(report.analysis.lines)).catch(() => null);

  return (
    <div className="mx-auto max-w-page px-4 pb-24 pt-14 sm:px-6">
      <TrackView event="sample_report_view" eventProps={{ institution_id: report.data.subject.institution_id }} />
      <nav aria-label="Breadcrumb" className={`mb-6 ${PAGE_CRUMBS}`}>
        <Link href="/reports" className="inline-flex min-h-11 items-center transition-colors hover:text-ink sm:min-h-0">
          Reports
        </Link>
        <span className="text-border">/</span>
        <span className="text-ink-soft">Sample</span>
      </nav>

      <div className="pt-2">
        <MarketReportBody
          report={report}
          revenue={revenue}
          lineup={lineup}
          peers={peers}
          branches={branches}
          eyebrow={`Sample ${REPORT_OFFER.name}`}
          close={false}
          preparedOn={new Date()}
          contactHref="/contact?source=sample_report"
          actions={
            <>
              <NextSteps placement="header" />
              <span className="flex w-full flex-wrap justify-center gap-x-4 sm:justify-start">
                <PrintButton icon className={QUIET_LINK} />
                <a href={SAMPLE_CSV_PATH} className={QUIET_LINK}>
                  <Download aria-hidden="true" className="size-4" />
                  Download CSV
                </a>
              </span>
            </>
          }
          correctionNote={
            <>
              If a figure does not match an institution&apos;s current schedule,{" "}
              <a href="/contact?source=sample_report" className="inline-flex min-h-11 items-center underline sm:min-h-0">
                tell us through the contact form
              </a>{" "}
              and we will correct it.
            </>
          }
        />
      </div>

      <SampleClose />
    </div>
  );
}
