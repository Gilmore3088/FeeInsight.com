import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { CustomReportAnalysis, ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { POSITION_LABEL } from "@/app/market-report/report-body";
// One money format on every marketing exhibit: always with cents ("$10.00").
import { SAMPLE_REPORT_HREF, money } from "@/app/landing-shared";
import { verifiedSourceQuote } from "./sample-sources";

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
 * the form itself lives on /reports (05 section 3-4), and this section links to it. The pages
 * shown are the committed sample report's own (the same images /subscribe shows).
 */
export function ReportOfferSection({
  sampleLive,
  query,
  excerpt,
}: {
  sampleLive: boolean;
  query?: QueryParams;
  /** The live sample's rows (`SampleExcerpt`), shown under the offer. */
  excerpt?: ReactNode;
}) {
  return (
    <section id="report" aria-labelledby="report-heading" className="scroll-mt-20 border-b border-border bg-surface-0">
      <div className="mx-auto grid max-w-page gap-10 px-6 py-14 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">One report</p>
          <h2 id="report-heading" className="mt-3 text-[28px] font-bold leading-tight text-ink">
            {REPORT_OFFER.name}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            Your fees against named local competitors in one PDF, {REPORT_PRICE_INLINE}, with no subscription.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <Link href={reportFormHref(query)} className="fi-btn fi-btn-secondary justify-center">
              {REPORT_OFFER.institutionCtaLabel}
            </Link>
            {sampleLive ? (
              <Link href={SAMPLE_REPORT_HREF} className="text-[14px] font-semibold text-ink underline underline-offset-2">
                Read the full sample report
              </Link>
            ) : null}
          </div>
          {excerpt ? <div className="mt-8">{excerpt}</div> : null}
        </div>
        <SamplePages />
      </div>
    </section>
  );
}

/** The sample report's cover and findings page, as delivered. */
export function SamplePages() {
  return (
    <div className="relative mx-auto h-[300px] w-full max-w-[460px] sm:h-[340px]">
      <Image
        src="/reports/sample-preview/page-1.webp"
        alt="Cover of the sample Competitive Fee Position report"
        width={850}
        height={1100}
        sizes="(min-width: 1024px) 220px, 45vw"
        className="absolute left-[4%] top-4 w-[46%] -rotate-2 rounded-sm shadow-[0_10px_30px_-12px_rgba(26,24,21,0.45)] ring-1 ring-border"
      />
      <Image
        src="/reports/sample-preview/page-2.webp"
        alt="Summary of findings page from the sample report"
        width={850}
        height={1100}
        sizes="(min-width: 1024px) 240px, 50vw"
        className="absolute right-[4%] top-8 w-[50%] rotate-1 rounded-sm shadow-[0_14px_36px_-12px_rgba(26,24,21,0.5)] ring-1 ring-border"
      />
    </div>
  );
}

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

/**
 * Excerpt of the live sample Competitive Fee Position Report (value funnel A1). A row's source
 * line shows only when it passes the shared source check (`verifiedSourceQuote`); a row whose
 * line does not shows its figures without one. On a phone each row is a card, so the amounts
 * stay in view; from `sm` it is a table.
 */
export function SampleExcerpt({ report }: { report: MarketReport }) {
  const lines = sampleExcerptLines(report.analysis);
  if (lines.length === 0) return null;
  const rows = lines.map((line) => ({ line, quote: verifiedSourceQuote(line) }));
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-surface-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">From the sample report</span>
        <span className="text-[11px] text-ink-muted">
          {report.data.subject.institution_name} vs. {report.analysis.readiness.competitorsWithData} local competitors
        </span>
      </figcaption>
      <ul className="divide-y divide-border sm:hidden">
        {rows.map(({ line, quote }) => (
          <li key={line.key} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-[14px] font-semibold text-ink">{getDisplayName(line.key)}</span>
              <span className="shrink-0 font-mono text-[17px] font-semibold tabular-nums text-ink">{money(line.own!.amount)}</span>
            </div>
            <p className="max-w-[none] mt-0.5 flex items-baseline justify-between gap-3 text-[12px] text-ink-muted">
              <span>Local median {money(line.peers!.median)}</span>
              <span className="shrink-0">{POSITION_LABEL[line.position!]}</span>
            </p>
            {quote ? <p className="mt-1.5 text-[12px] leading-5 text-ink-muted">Source: &ldquo;{quote}&rdquo;</p> : null}
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-[13px] sm:table">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            <th className="px-4 py-2 font-bold">Fee</th>
            <th className="px-3 py-2 text-right font-bold">Theirs</th>
            <th className="px-3 py-2 text-right font-bold">Local median</th>
            <th className="px-4 py-2 font-bold">Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ line, quote }) => (
            <tr key={line.key} className="border-b border-border align-top last:border-b-0">
              <td className="px-4 py-2 text-ink">
                {getDisplayName(line.key)}
                {quote ? <span className="mt-0.5 block text-[11px] leading-4 text-ink-muted">Source: &ldquo;{quote}&rdquo;</span> : null}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{money(line.own!.amount)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{money(line.peers!.median)}</td>
              <td className="px-4 py-2 text-ink-soft">{POSITION_LABEL[line.position!]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="max-w-[none] flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-ink-muted">
        <span>Live, each line from the bank&apos;s own fee schedule</span>
        <Link href={SAMPLE_REPORT_HREF} className="font-semibold text-ink underline underline-offset-2">
          Read the full sample report
        </Link>
      </p>
    </figure>
  );
}
