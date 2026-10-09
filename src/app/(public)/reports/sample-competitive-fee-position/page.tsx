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
import { CONTACT_EMAIL, SITE_NAME, SITE_URL, REPORT_OFFER, REPORT_OFFER_LINE } from "@/lib/constants";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { getRevenueContextCached } from "@/lib/custom-report/revenue-context";
import { getMarketBranchFootprintCached } from "@/lib/data-store/public-cached-reads";
import { MarketReportBody } from "@/app/market-report/report-body";
import { PrintButton } from "@/app/market-report/[token]/print-button";

export const dynamic = "force-dynamic";

const SAMPLE_PATH = "/reports/sample-competitive-fee-position";
const SAMPLE_CSV_PATH = "/reports/sample-competitive-fee-position/csv";
const REQUEST_HREF = "/for-institutions?report=institution#report";
const REPORT_TITLE = "Sample Competitive Fee Position Report";
const REPORT_DESCRIPTION = `A live ${REPORT_OFFER.name} for a community bank: its fees against its local competitors, the lines outside the local range, and named competitors with the schedule behind every amount. ${REPORT_OFFER_LINE}.`;

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
  "inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]";
const SECONDARY_BUTTON =
  "inline-flex items-center rounded-md border border-[#D5CBBF] px-4 py-2.5 text-sm font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]";

/** Shown while the sample is offline for a re-render, so no stale figures stay public. */
function SampleComingSoon() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-14">
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[12px] text-[#6B6255]">
        <Link href="/reports" className="transition-colors hover:text-[#1A1815]">
          Reports
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347]">Sample</span>
      </nav>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
        Sample — {REPORT_OFFER.name}
      </p>
      <h1
        className="text-[2rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815] sm:text-[2.5rem]"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        A new sample report is on its way.
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[#5A5347]">
        We took the previous sample down while we rebuild it from current data, with every fee
        checked against the institution&apos;s own published schedule. It will be back here once that
        is done.
      </p>
      <p className="mt-3 text-[16px] leading-relaxed text-[#5A5347]">
        You can still request a report for your own institution. We confirm your peer set with you
        before anything is sent.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
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
      <p className="mt-6 text-[13px] text-[#6B6255]">
        Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#5A5347] underline">
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
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14">
      <TrackView event="sample_report_view" eventProps={{ institution_id: report.data.subject.institution_id }} />
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[12px] text-[#6B6255]">
        <Link href="/reports" className="transition-colors hover:text-[#1A1815]">
          Reports
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347]">Sample</span>
      </nav>

      <header className="border-b border-[#E0D7C9] pb-8">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
          Sample — {REPORT_OFFER.name}
        </p>
        <h1
          className="text-[2rem] leading-[1.15] tracking-[-0.02em] text-[#1A1815] sm:text-[2.5rem]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          This is what your institution report looks like.
        </h1>
        <p className="mt-4 max-w-[680px] text-[16px] leading-relaxed text-[#5A5347]">
          Below is today&apos;s report for {name}, built from live data by the same code that builds yours. Every
          competitor amount links to the fee schedule it was read from, and every fee here is public on the
          institution&apos;s own site. Yours compares your institution against the competitors in your own market.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <TrackLink
            event="request_report_click"
            eventProps={{ placement: "sample_report_header" }}
            href={REQUEST_HREF}
            className={PRIMARY_BUTTON}
          >
            {REPORT_OFFER.institutionCtaLabel}
          </TrackLink>
          <p className="text-[13px] text-[#6B6255]">{REPORT_OFFER_LINE}.</p>
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
              <PrintButton className={PRIMARY_BUTTON} />
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

      <section className="mt-10 flex flex-col items-start gap-4 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <p className="text-[20px] text-[#1A1815]" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
            Get this report for your institution.
          </p>
          <p className="mt-1 text-[13px] text-[#6B6255]">
            {REPORT_OFFER_LINE}. {REPORT_OFFER.refreshLabel}. Questions:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#5A5347] underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
        <TrackLink
          event="request_report_click"
          eventProps={{ placement: "sample_report_footer" }}
          href={REQUEST_HREF}
          className={PRIMARY_BUTTON}
        >
          {REPORT_OFFER.institutionCtaLabel}
        </TrackLink>
      </section>
    </div>
  );
}
