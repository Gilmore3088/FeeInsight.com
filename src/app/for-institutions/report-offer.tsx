import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { CONTACT_EMAIL, REPORT_INCLUDES, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import type { CustomReportAnalysis, ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { money, POSITION_LABEL } from "@/app/market-report/report-body";
import { RequestReportForm } from "./request-report-form";

// The same list as the homepage offer and the pay page, so the paid report is described one way.
const REPORT_CONTENTS = REPORT_INCLUDES;

/**
 * The paid report as the no-subscription option (site v3 brief 03 section 4, 08 B.10). `#report`
 * is linked from sent emails, /subscribe and the /waitlist redirect, so it must keep landing on
 * the form (05 section 2).
 */
export function ReportOfferSection({ sampleLive }: { sampleLive: boolean }) {
  return (
    <section aria-labelledby="report-heading" className="border-b border-border bg-surface-0">
      <div className="mx-auto max-w-page px-6 py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-start">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">One report</p>
            <h2 id="report-heading" className="mt-3 text-[28px] font-bold leading-tight text-ink">
              {REPORT_OFFER.name}
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
              For your institution against named local competitors, without a subscription. Each report is quoted,{" "}
              {REPORT_PRICE_INLINE}. {REPORT_OFFER.nextStep}.
            </p>
            <ul className="mt-6 space-y-2.5">
              {REPORT_CONTENTS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-[14px] text-ink-soft">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            {sampleLive ? (
              <p className="mt-6 text-[14px]">
                <Link href={SAMPLE_HREF} className="font-semibold text-ink underline underline-offset-2">
                  Read the full sample report
                </Link>
              </p>
            ) : null}
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
export function SampleExcerpt({ report }: { report: MarketReport }) {
  const lines = sampleExcerptLines(report.analysis);
  if (lines.length === 0) return null;
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-surface-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">From the sample report</span>
        <span className="text-[11px] text-ink-muted">
          {report.data.subject.institution_name} vs. {report.analysis.readiness.competitorsWithData} local competitors
        </span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
              <th className="px-4 py-2 font-bold">Fee</th>
              <th className="px-3 py-2 text-right font-bold">Theirs</th>
              <th className="px-3 py-2 text-right font-bold">Local median</th>
              <th className="px-4 py-2 font-bold">Position</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 text-ink">{line.label}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{money(line.own!.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{money(line.peers!.median)}</td>
                <td className="px-4 py-2 text-ink-soft">{POSITION_LABEL[line.position!]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-ink-muted">
        <span>Live from each institution&apos;s own published fee schedule</span>
        <Link href={SAMPLE_HREF} className="font-semibold text-ink underline underline-offset-2">
          Read the full sample report
        </Link>
      </p>
    </figure>
  );
}
