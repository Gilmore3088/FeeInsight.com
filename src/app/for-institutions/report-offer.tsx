import Link from "next/link";
import { CONTACT_EMAIL, REPORT_INCLUDES } from "@/lib/constants";
import type { CustomReportAnalysis, ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { money, POSITION_LABEL } from "@/app/market-report/report-body";
import { RequestReportForm } from "./request-report-form";
import { BAND, BODY, CheckList, EYEBROW, GLASS_SOFT, H2 } from "@/components/public/site-look";


// The same list as the homepage offer and the pay page, so the paid report is described one way.
const REPORT_CONTENTS = REPORT_INCLUDES;

export async function ReportOfferSection() {
  const sample = await loadSampleReport().catch(() => null);
  return (
    <section aria-labelledby="fee-reports-title" className={BAND}>
      <div className="mx-auto max-w-page px-6 py-14 sm:py-16">
        {/* grid-cols-1 + min-w-0: below xl the single column is the viewport, so the excerpt
            table scrolls inside its own box instead of widening the form past 320px. Two equal
            columns at xl (the /subscribe layout). */}
        <div className="grid grid-cols-1 gap-10 xl:grid-cols-2 xl:items-start xl:gap-14">
          <div className="min-w-0">
            <p className={EYEBROW}>Fee reports</p>
            <h2 id="fee-reports-title" className={`mt-3 ${H2}`}>
              Free national reports, and a paid report on your institution
            </h2>
            <p className={`mt-4 ${BODY}`}>
              Pick the national report or your Fed district and it opens right away: the median
              and typical range for the 15 headline fees, from each institution&apos;s own
              published schedule. When you want your own institution against named competitors,
              that is the paid institution report.
            </p>
            <h3 className="mt-7 text-sm font-semibold text-warm-900">The institution report adds</h3>
            <CheckList items={REPORT_CONTENTS} className="mt-3" />
            {/* Live rows from the sample report; hidden when no sample market passes the rule today. */}
            {sample && <SampleExcerpt report={sample} />}
          </div>
          {/* `#report` lands on the form itself, so a phone reader isn't left below the offer list. */}
          <div id="report" className="min-w-0 scroll-mt-20">
            <RequestReportForm contactEmail={CONTACT_EMAIL} />
          </div>
        </div>
      </div>
    </section>
  );
}

const SAMPLE_HREF = "/reports/sample-competitive-fee-position";
const EXCERPT_ROWS = 3;

/**
 * Three comparable lines from the live sample report: lines outside the local range first,
 * since those are what a buyer learns from, then lines inside it, in report order.
 */
export function sampleExcerptLines(analysis: CustomReportAnalysis): ReportLine[] {
  const comparable = analysis.lines.filter((line) => line.comparable && line.own && line.peers && line.position);
  const outside = comparable.filter((line) => line.position !== "in_market");
  const inside = comparable.filter((line) => line.position === "in_market");
  return [...outside, ...inside].slice(0, EXCERPT_ROWS);
}

/** Excerpt of the live sample Competitive Fee Position Report (value funnel A1). */
function SampleExcerpt({ report }: { report: MarketReport }) {
  const lines = sampleExcerptLines(report.analysis);
  if (lines.length === 0) return null;
  return (
    <figure className={`mt-8 overflow-hidden ${GLASS_SOFT}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-warm-200 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">From the sample report</span>
        <span className="text-[11px] text-warm-600">
          {report.data.subject.institution_name} vs. {report.analysis.readiness.competitorsWithData} local competitors
        </span>
      </figcaption>
      <p className="border-b border-warm-200 px-4 py-1.5 text-[12px] text-warm-700 min-[480px]:hidden">
        Scroll the table sideways to see every column.
      </p>
      {/* On a phone the table scrolls inside this box (keyboard-focusable and named), never the page. */}
      <div className="overflow-x-auto" role="region" aria-label="Sample report excerpt" tabIndex={0}>
        <table className="w-full min-w-[26rem] text-[13px]">
          <thead>
            <tr className="border-b border-warm-200 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">
              <th className="px-4 py-2 font-bold">Fee</th>
              <th className="px-3 py-2 text-right font-bold">Theirs</th>
              <th className="px-3 py-2 text-right font-bold">Local median</th>
              <th className="px-4 py-2 font-bold">Position</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b border-warm-200 last:border-b-0">
                <td className="px-4 py-2 text-warm-900">{line.label}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-warm-900">{money(line.own!.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-warm-700">{money(line.peers!.median)}</td>
                <td className="px-4 py-2 text-warm-700">{POSITION_LABEL[line.position!]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-warm-200 px-4 py-2 text-[11px] text-warm-600">
        <span>Live from each institution&apos;s own published fee schedule</span>
        <Link href={SAMPLE_HREF} className="font-semibold text-terra hover:underline">
          Read the full sample report
        </Link>
      </p>
    </figure>
  );
}
