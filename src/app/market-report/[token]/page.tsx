/**
 * /market-report/[token] — a Competitive Fee Position Report built on request from live
 * data: the institution against the competitors in its own FDIC branch counties.
 * Private (signed link, not indexed). Numbers are computed at view time from
 * published_fee_catalog; when the market no longer passes the readiness bar the page
 * says so instead of showing thin numbers.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportChrome, ReportChromeFooter } from "@/components/public/report-chrome";
import { verifyReportToken } from "@/lib/custom-report/link";
import { isReportRevoked } from "@/lib/data-store/report-payments";
import { loadMarketReport } from "@/lib/custom-report/report-data";
import { loadMarketCheckingLineup } from "@/lib/custom-report/checking-lineup-data";
import { TrackView } from "@/components/track-view";
import { getRevenueContextCached } from "@/lib/custom-report/revenue-context";
import { getMarketBranchFootprintCached } from "@/lib/data-store/public-cached-reads";
import { MarketReportBody } from "../report-body";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// The district and state pages' button styles (Button in @/brand/components).
const PRIMARY_BUTTON = "fi-btn fi-btn-primary min-h-11";
const SECONDARY_BUTTON = "fi-btn fi-btn-secondary min-h-11";

export const metadata: Metadata = {
  title: "Competitive Fee Position Report",
  robots: { index: false, follow: false, nocache: true },
};

// No booking tool yet, so the page offers the contact form (stored and answered like every
// request), never "book". The institution is filled in for them.
function contactHref(institutionName: string): string {
  return `/contact?${new URLSearchParams({ source: "report", company: institutionName }).toString()}`;
}

export default async function MarketReportPage({ params }: PageProps) {
  const { token } = await params;
  const verified = verifyReportToken(token);
  if (!verified) notFound();
  // A refunded report's link closes.
  if (await isReportRevoked(verified.institutionId)) notFound();

  const report = await loadMarketReport(verified.institutionId);
  if (!report || !report.data.market) notFound();
  const { analysis, savedAt } = report;
  const name = report.data.subject.institution_name;
  const market = report.data.market;
  const branches = market
    ? await getMarketBranchFootprintCached(market.county_fips, market.sod_year).catch(() => null)
    : null;
  const revenue = await getRevenueContextCached(verified.institutionId).catch(() => null);
  const lineup = analysis.readiness.ready ? await loadMarketCheckingLineup(verified.institutionId) : null;

  return (
    <div className="min-h-screen bg-paper">
      <TrackView
        event="market_report_view"
        eventProps={{
          institution_id: verified.institutionId,
          ready: analysis.readiness.ready ? "yes" : "no",
          saved_copy: savedAt ? "yes" : "no",
        }}
      />
      <ReportChrome preparedFor={name} />
      <main className="mx-auto max-w-page px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <MarketReportBody
          report={report}
          revenue={revenue}
          branches={branches}
          lineup={lineup}
          eyebrow="Competitive Fee Position Report"
          preparedOn={verified.issuedOn}
          contactHref={contactHref(name)}
          actions={
            <>
              {report.analysis.readiness.ready && (
                <>
                  <PrintButton className={PRIMARY_BUTTON} />
                  <a href={`/market-report/${token}/csv`} className={SECONDARY_BUTTON}>
                    Download CSV
                  </a>
                </>
              )}
              <a href={contactHref(name)} className={report.analysis.readiness.ready ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
                Ask us about this report
              </a>
            </>
          }
          correctionNote={
            <>
              If a figure does not match {name}&apos;s current schedule,{" "}
              <a href={contactHref(name)} className="underline">
                tell us through the contact form
              </a>{" "}
              and we will correct it. This link resolves until {DATE.format(verified.expiresOn)}.
            </>
          }
        />
      </main>
      <p className="mx-auto max-w-page px-4 pb-6 text-[12px] leading-relaxed text-ink-muted sm:px-6">
        Compiled from each institution&apos;s published fee schedule. It is market information, not financial, legal
        or compliance advice; confirm current fees with the institution.
      </p>
      <ReportChromeFooter />
    </div>
  );
}
