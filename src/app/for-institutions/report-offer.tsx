import Link from "next/link";
import { REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import type { CustomReportAnalysis, ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { money, POSITION_LABEL } from "@/app/market-report/report-body";

/** The one report request form (site v3 brief 05 §3-4, #1171): /reports sells the one-off. */
const REPORT_FORM_PATH = "/reports";
const REPORT_FORM_ANCHOR = "#request";
/** Lead attribution for a request that started here, when the link carried no `src`. */
const DEFAULT_SRC = "for-institutions";

type QueryParams = Record<string, string | string[] | undefined>;

/**
 * The /reports form link for a visitor who landed on `#report`. Older links (sent emails, profile
 * pages, /waitlist) carry the bank, the report type and `src` in the query, so those pass
 * through and the form opens prefilled; with none, it opens on the institution report.
 */
export function reportFormHref(query: QueryParams = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first !== "") params.set(key, first);
  }
  if (!params.has("report")) params.set("report", "institution");
  if (!params.has("src")) params.set("src", DEFAULT_SRC);
  return `${REPORT_FORM_PATH}?${params.toString()}${REPORT_FORM_ANCHOR}`;
}

/**
 * The paid report as the no-subscription option (site v3 brief 03 section 4, 08 B.10). `#report`
 * is linked from sent emails, /subscribe history and the /waitlist redirect, so the anchor stays;
 * the form itself lives on /reports (05 section 3-4), and this section links to it.
 */
export function ReportOfferSection({ sampleLive, query }: { sampleLive: boolean; query?: QueryParams }) {
  return (
    <section id="report" aria-labelledby="report-heading" className="scroll-mt-20 border-b border-border bg-surface-0">
      <div className="mx-auto max-w-page px-6 py-14">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">One report</p>
          <h2 id="report-heading" className="mt-3 text-[28px] font-bold leading-tight text-ink">
            {REPORT_OFFER.name}
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            For your institution against named local competitors, without a subscription. Each report is quoted,{" "}
            {REPORT_PRICE_INLINE}. {REPORT_OFFER.nextStep}.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <Link href={reportFormHref(query)} className="fi-btn fi-btn-secondary justify-center">
              {REPORT_OFFER.institutionCtaLabel}
            </Link>
            {sampleLive ? (
              <Link href={SAMPLE_HREF} className="text-[14px] font-semibold text-ink underline underline-offset-2">
                Read the full sample report
              </Link>
            ) : null}
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
