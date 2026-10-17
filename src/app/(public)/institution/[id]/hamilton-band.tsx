import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { FrameVideo } from "@/components/marketing/frame-media";
import { FrameMedia } from "@/components/marketing/frame-media";
import { TrackLink } from "@/components/track-link";
import { REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatCompactDollars } from "@/lib/format";
import { feeIncomeTerms, formatReportQuarter, type NormalizedFinancial } from "./financial-units";
import { SERIF } from "./profile-serif";

/** The recorded clip of the Hamilton tour; until it exists a marked slot holds its place. */
export const INSTITUTION_TOUR_VIDEO: FrameVideo | null = null;

/** The one Hamilton insight shown free: its fee-income share against peers its size, from call reports. */
export interface HamiltonInsight {
  /** Newest first, as selectFinancialsByQuarter returns them. */
  quarters: NormalizedFinancial[];
  ownSharePct: number | null;
  peerSharePct: number | null;
  /** The peers behind peerSharePct. */
  peerCount: number | null;
  /** Every same-charter, same-size institution that filed for the quarter, itself included. */
  filerCount?: number | null;
  /** "$1B to $10B": the asset tier the peers share. */
  sizeRange: string | null;
  /** "credit union" or "bank". */
  kind: string;
}

/**
 * One quarter's call-report fee income (feeIncomeTerms names it per filing), oldest first. NCUA 5300 income is year to date, so a
 * credit union's quarter is its YTD less the prior quarter's in the same year (Q1 stands alone);
 * a quarter whose prior quarter is missing is left out rather than shown as a year's total.
 */
export function quarterlyServiceCharges(quarters: NormalizedFinancial[]): { reportDate: string; value: number }[] {
  const oldestFirst = [...quarters].reverse();
  const out: { reportDate: string; value: number }[] = [];
  oldestFirst.forEach((q, index) => {
    if (q.serviceChargeIncome === null) return;
    if (q.source !== "ncua") return void out.push({ reportDate: q.reportDate, value: q.serviceChargeIncome });
    const n = Math.ceil(Number(q.reportDate.slice(5, 7)) / 3);
    if (n === 1) return void out.push({ reportDate: q.reportDate, value: q.serviceChargeIncome });
    const prev = oldestFirst[index - 1];
    const contiguous =
      prev && prev.serviceChargeIncome !== null && prev.source === "ncua" &&
      prev.reportDate.slice(0, 4) === q.reportDate.slice(0, 4) && Math.ceil(Number(prev.reportDate.slice(5, 7)) / 3) === n - 1;
    if (contiguous) out.push({ reportDate: q.reportDate, value: q.serviceChargeIncome - (prev.serviceChargeIncome as number) });
  });
  return out;
}

const pct = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
/** A share outside this range is a filing artefact, not a figure to lead with. */
const plausibleShare = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0 && n < 60;

/**
 * Where the tour clip will play. The clip is one generic recording on a demo institution, so the
 * slot never names the page's institution. It is a picture, not a control, so nothing on the page
 * pretends to play; once the clip exists FrameMedia's play button sits on it.
 */
function TourVideoSlot() {
  return (
    <figure className="flex items-center gap-3 rounded-lg border border-border bg-paper p-2 pr-4">
      <span aria-hidden="true" className="flex h-14 w-24 shrink-0 items-center justify-center rounded-md bg-warm-ink-900">
        <svg viewBox="0 0 12 12" className="ml-0.5 h-4 w-4 text-warm-ink-50">
          <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
        </svg>
      </span>
      <figcaption className="min-w-0 text-[13px]">
        <span className="block font-medium text-ink">The Hamilton tour</span>
      </figcaption>
    </figure>
  );
}

function InsightView({ insight, institutionName }: { insight: HamiltonInsight; institutionName: string }) {
  const series = quarterlyServiceCharges(insight.quarters);
  const latest = insight.quarters[0];
  const first = series[0];
  const last = series[series.length - 1];
  const change =
    first && last && first !== last && first.value > 0 ? ((last.value - first.value) / first.value) * 100 : null;
  const comparePeers = plausibleShare(insight.ownSharePct) && plausibleShare(insight.peerSharePct) && (insight.peerCount ?? 0) >= 3;
  const top = Math.max(1, ...series.map((q) => q.value));
  const sourceName = latest?.source === "ncua" ? "NCUA 5300 call reports" : "FDIC call reports";
  const terms = feeIncomeTerms(latest?.source);
  const span = first && last ? `${formatReportQuarter(first.reportDate)} to ${formatReportQuarter(last.reportDate)}` : null;

  const chart = series.length > 1 && (
    <div className="mt-4" role="img" aria-label={`${terms.amount} by quarter, ${span}`}>
      <p className="text-[12px] font-medium text-ink-muted">{terms.amount} by quarter</p>
      <div className="mt-2 flex h-24 items-end gap-2">
        {series.map((q) => (
          <div key={q.reportDate} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[11px] [font-variant-numeric:tabular-nums] text-ink-muted">{formatCompactDollars(q.value)}</span>
            <span className="w-3/5 rounded-t-[3px] bg-ink/45" style={{ height: `${Math.max(4, (Math.max(0, q.value) / top) * 64)}px` }} />
            <span className="text-[11px] text-ink-muted">{formatReportQuarter(q.reportDate)}</span>
          </div>
        ))}
      </div>
      {span && <p className="mt-2 text-[12px] text-ink-muted">From {sourceName}, {span}.</p>}
    </div>
  );

  return (
    <figure className="min-w-0">
      {comparePeers ? (
        <>
          <p className="flex items-baseline gap-4 [font-variant-numeric:tabular-nums]">
            <span className="text-[58px] font-medium leading-none tracking-[-0.02em] text-ink sm:text-[68px]" style={SERIF}>{pct(insight.ownSharePct as number)}</span>
            <span className="border-l border-border pl-4 text-[30px] font-medium leading-none text-ink-muted sm:text-[34px]" style={SERIF}>
              vs {pct(insight.peerSharePct as number)}
            </span>
          </p>
          <figcaption className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink">
            {terms.subject} {terms.was} {pct(insight.ownSharePct as number)} of {institutionName}&apos;s revenue
            {latest ? ` ${latest.source === "ncua" ? "through" : "in"} ${formatReportQuarter(latest.reportDate)}` : ""}. The median for{" "}
            {(insight.peerCount as number).toLocaleString("en-US")} {insight.kind === "bank" ? "banks" : "credit unions"}
            {insight.sizeRange ? ` with ${insight.sizeRange} in assets` : " its size"} was {pct(insight.peerSharePct as number)}.
          </figcaption>
          {latest && (
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-ink-muted">
              Peers are {insight.kind === "bank" ? "banks filing FDIC call reports" : "credit unions filing NCUA 5300 call reports"}
              {insight.sizeRange ? ` with ${insight.sizeRange} in assets` : " of the same asset size"} that reported{" "}
              {terms.amount.toLowerCase()} above $0 for {formatReportQuarter(latest.reportDate)}. {institutionName} itself is left out.
            </p>
          )}
          {latest && (
            <details className="group/fin mt-2">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="text-[10px] transition-transform group-open/fin:rotate-90">
                  &#9654;
                </span>
                How this financial comparison is made
              </summary>
              <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px] leading-snug text-ink-muted">
                <dt className="font-medium text-ink-soft">Counted</dt>
                <dd>
                  {(insight.peerCount as number).toLocaleString("en-US")}
                  {insight.filerCount && insight.filerCount - 1 >= (insight.peerCount as number)
                    ? ` of the ${(insight.filerCount - 1).toLocaleString("en-US")} peers that filed for ${formatReportQuarter(latest.reportDate)}`
                    : ` peers that filed for ${formatReportQuarter(latest.reportDate)}`}{" "}
                  reported {terms.amount.toLowerCase()} above $0.
                </dd>
                <dt className="font-medium text-ink-soft">Share</dt>
                <dd>
                  {terms.definition} divided by revenue ({latest.source === "ncua" ? "interest income" : "net interest income"} plus
                  noninterest income).
                </dd>
              </dl>
              {chart}
            </details>
          )}
        </>
      ) : (
        <>
          {last && last.value > 0 && (
            <figcaption className="text-[16px] leading-relaxed text-ink">
              {terms.amount} was {formatCompactDollars(last.value)} in {formatReportQuarter(last.reportDate)}
              {change !== null ? `, ${change >= 0 ? "up" : "down"} ${pct(Math.abs(change))} since ${formatReportQuarter(first.reportDate)}` : ""}.
            </figcaption>
          )}
          {chart}
        </>
      )}
    </figure>
  );
}

/**
 * The page's one next step (James's design file): one complete Hamilton finding on the left, and
 * "Hey Hamilton, what deserves a closer look?" on the right with Hamilton plans and the free
 * sample report (the paid report when no sample is live).
 */
export function HamiltonBand({
  institutionName,
  insight,
  plansHref,
  reportOfferHref,
  sampleReportHref = null,
}: {
  institutionName: string;
  insight: HamiltonInsight | null;
  plansHref: string;
  reportOfferHref: string;
  /** The live sample report, when one is published: the free first step before the paid report. */
  sampleReportHref?: string | null;
}) {
  const hasInsight = Boolean(insight && quarterlyServiceCharges(insight.quarters).length > 0);
  return (
    <section aria-labelledby="hamilton-heading" className="border-t border-border pt-10">
      <div className={`grid gap-10 ${hasInsight ? "lg:grid-cols-2 lg:gap-0" : ""}`}>
        {hasInsight && insight && (
          <div className="min-w-0 lg:pr-12">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brick">A Hamilton finding</p>
            <div className="mt-4">
              <InsightView insight={insight} institutionName={institutionName} />
            </div>
          </div>
        )}
        <div className={`min-w-0 ${hasInsight ? "border-t border-border pt-10 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0" : ""}`}>
          <h2 id="hamilton-heading" className="text-[36px] font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-[46px]" style={SERIF}>
            <span className="block text-brick">Hey Hamilton,</span>
            <span className="block">What deserves a closer look?</span>
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">Bring fees, filings and market context together.</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-4">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "institution_hamilton_band" }}
              href={plansHref}
              className="fi-btn fi-btn-brick min-h-12 px-8 text-[15px]"
            >
              Explore Hamilton
            </TrackLink>
            {sampleReportHref ? (
              <Link
                href={sampleReportHref}
                className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-ink underline decoration-border underline-offset-[6px] hover:decoration-ink"
              >
                View sample report
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <Link
                href={reportOfferHref}
                className="inline-flex min-h-11 items-center gap-2 text-[15px] font-medium text-ink underline decoration-border underline-offset-[6px] hover:decoration-ink"
              >
                Order a {REPORT_OFFER.name} {REPORT_PRICE_INLINE}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
          {/* The tour shows only once the clip exists; no "coming soon" slot in the meantime. */}
          {INSTITUTION_TOUR_VIDEO && (
            <div className="mt-6">
              <FrameMedia video={INSTITUTION_TOUR_VIDEO}>
                <TourVideoSlot />
              </FrameMedia>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
