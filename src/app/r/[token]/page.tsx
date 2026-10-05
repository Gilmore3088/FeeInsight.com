/**
 * /r/[token] — a prepared Competitive Fee Position Report, hosted for one institution.
 * Token map: Reports/studio/hosted-reports.json; HTML: Reports/studio/out/<id>.html.
 * Not indexed; unknown tokens 404, expired ones offer a fresh report.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportChrome, ReportChromeFooter } from "@/components/public/report-chrome";
import { ReportExecutiveSummaryBlock } from "@/components/public/report-executive-summary";
import { ReportFrame } from "@/components/public/report-frame";
import { TrackLink } from "@/components/track-link";
import { TrackView } from "@/components/track-view";
import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import {
  extractExecutiveSummary,
  formatReportDate,
  getHostedReport,
  hostedReportRequestHref,
  lookupHostedReport,
  prepareReportForEmbed,
  readHostedReportHtml,
  type HostedReport,
} from "@/lib/hosted-reports";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}


export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const report = getHostedReport(token);
  return {
    title: report
      ? `Competitive Fee Position Report — ${report.institution_name}`
      : "Report not found",
    description: report
      ? `Competitive Fee Position Report prepared for ${report.institution_name} by ${SITE_NAME} — 15 headline fees against a verified peer cohort, every figure sourced.`
      : undefined,
    openGraph: report
      ? {
          title: `Competitive Fee Position Report — ${report.institution_name}`,
          description: `Prepared for ${report.institution_name} by ${SITE_NAME}. 15 headline fees against a verified peer cohort, every figure traced to its published schedule.`,
          type: "article",
        }
      : undefined,
    robots: { index: false, follow: false, nocache: true },
  };
}

/** Until there is a booking link (J5), questions go through the contact form into the lead loop. */
const CONTACT_HREF = "/contact?source=report";

function ExpiredReport({ report }: { report: HostedReport }) {
  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ReportChrome preparedFor={report.institution_name} />
      <main className="mx-auto max-w-2xl px-6 pb-24 pt-16">
        <TrackView event="hosted_report_view" eventProps={{ institution_id: report.institution_id, expired: true }} />
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
          Competitive Fee Position Report
        </p>
        <h1
          className="mt-2 text-[1.6rem] leading-tight tracking-[-0.02em] text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          This report for {report.institution_name} has expired
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#5A5347]">
          It was prepared on {formatReportDate(report.prepared_on)}, and fee schedules change. Request an
          updated report, free, built from the fee schedules published today.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <TrackLink
            event="hosted_report_request"
            eventProps={{ placement: "hosted_report_expired", institution_id: report.institution_id }}
            href={hostedReportRequestHref(report, "hosted_report_expired")}
            className="inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
          >
            Request an updated report
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "hosted_report_expired", institution_id: report.institution_id }}
            href={CONTACT_HREF}
            className="inline-flex items-center rounded-md border border-[#D5CBBF] px-4 py-2.5 text-sm font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]"
          >
            Ask a question
          </TrackLink>
        </div>
      </main>
      <ReportChromeFooter />
    </div>
  );
}

export default async function HostedReportPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const lookup = lookupHostedReport(token);
  if (lookup.state === "missing") notFound();
  if (lookup.state === "expired") return <ExpiredReport report={lookup.report} />;
  const report = lookup.report;

  const query = await searchParams;
  if (query.print === "1") redirect(`/r/${report.token}/print`);

  const rawHtml = readHostedReportHtml(report.institution_id);
  if (!rawHtml) notFound();
  const html = prepareReportForEmbed(rawHtml);
  const summary = extractExecutiveSummary(rawHtml);
  const preparedOn = formatReportDate(report.prepared_on);
  const printHref = `/r/${report.token}/print`;

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ReportChrome preparedFor={report.institution_name} />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <section className="flex flex-col gap-5 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#A93D25]">
              Competitive Fee Position Report
            </p>
            <h1
              className="mt-2 text-[1.5rem] leading-tight tracking-[-0.02em] text-[#1A1815] sm:text-[1.85rem]"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              Prepared for {report.institution_name} by {SITE_NAME} · {preparedOn}
            </h1>
            <p className="mt-2 text-[14px] text-[#5A5347]">
              {REPORT_OFFER.refreshLabel} — your fee position against the same verified peer set.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={printHref}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
            >
              Download PDF
            </a>
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "hosted_report", institution_id: report.institution_id }}
              href={CONTACT_HREF}
              className="inline-flex items-center rounded-md border border-[#D5CBBF] px-4 py-2.5 text-sm font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]"
            >
              Ask a question
            </TrackLink>
          </div>
        </section>

        <div className="mt-8">
          <ReportExecutiveSummaryBlock summary={summary} />
        </div>

        <section className="mt-8" aria-label="Report">
          <ReportFrame
            html={html}
            title={`Competitive Fee Position Report — ${report.institution_name}`}
            pdfHref={printHref}
          />
        </section>

        <section className="mt-8 flex flex-col gap-4 rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[1.1rem] font-semibold text-[#1A1815]">Keep this current</h2>
            <p className="mt-1 text-[14px] text-[#5A5347]">
              Request a refreshed report next quarter, free, against the same peer set as
              competitors change their fees.
            </p>
          </div>
          <TrackLink
            event="hosted_report_request"
            eventProps={{ placement: "hosted_report", institution_id: report.institution_id }}
            href={hostedReportRequestHref(report, "hosted_report")}
            className="inline-flex shrink-0 items-center rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
          >
            Request a quarterly refresh
          </TrackLink>
        </section>

        <p className="mt-6 text-[12px] leading-relaxed text-[#6B6255]">
          This link was prepared for {report.institution_name} and is not listed publicly. It
          resolves until {formatReportDate(report.expires_on)}; after that it offers an
          updated report.
        </p>
        <TrackView event="hosted_report_view" eventProps={{ institution_id: report.institution_id }} />
      </main>
      <ReportChromeFooter />
    </div>
  );
}
