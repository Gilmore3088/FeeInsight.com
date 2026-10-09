import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { CONTACT_EMAIL, REPORT_INCLUDES } from "@/lib/constants";
import type { CustomReportAnalysis, ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { loadSampleReport } from "@/lib/custom-report/sample-report";
import { money, POSITION_LABEL } from "@/app/market-report/report-body";
import { RequestReportForm } from "./request-report-form";


// The same list as the homepage offer and the pay page, so the paid report is described one way.
const REPORT_CONTENTS = REPORT_INCLUDES;

export async function ReportOfferSection() {
  const sample = await loadSampleReport().catch(() => null);
  return (
    <section aria-label="Fee reports" className="border-b border-warm-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-start">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
              Fee reports
            </p>
            <h2
              className="mt-3 text-warm-900 text-[28px] leading-tight"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              Free national reports, and a paid report on your institution
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-warm-700">
              Pick the national report or your Fed district and it opens right away: the median
              and typical range for the 15 headline fees, from each institution&apos;s own
              published schedule. When you want your own institution against named competitors,
              that is the paid institution report.
            </p>
            <p className="mt-6 text-[13px] font-semibold text-warm-900">The institution report adds</p>
            <ul className="mt-3 space-y-2.5">
              {REPORT_CONTENTS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[14px] text-warm-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-terra" />
                  {item}
                </li>
              ))}
            </ul>
            {/* Live rows from the sample report; hidden when no sample market passes the rule today. */}
            {sample && <SampleExcerpt report={sample} />}
          </div>
          {/* `#report` lands on the form itself, so a phone reader isn't left below the offer list. */}
          <div id="report" className="scroll-mt-20">
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
    <figure className="mt-8 overflow-hidden rounded-lg border border-warm-300 bg-warm-50">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-warm-200 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">From the sample report</span>
        <span className="text-[11px] text-warm-600">
          {report.data.subject.institution_name} vs. {report.analysis.readiness.competitorsWithData} local competitors
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
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
