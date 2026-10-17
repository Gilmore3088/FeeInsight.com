import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { FrameVideo } from "@/components/marketing/frame-media";
import { FrameMedia } from "@/components/marketing/frame-media";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatCompactDollars } from "@/lib/format";
import { formatReportQuarter, type NormalizedFinancial } from "./financial-units";

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
  /** "$1B to $10B": the asset tier the peers share. */
  sizeRange: string | null;
  /** "credit union" or "bank". */
  kind: string;
}

/**
 * One quarter's service-charge income, oldest first. NCUA 5300 income is year to date, so a
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
  const sourceName = latest?.source === "ncua" ? "NCUA call reports" : "FDIC call reports";
  const span = first && last ? `${formatReportQuarter(first.reportDate)} to ${formatReportQuarter(last.reportDate)}` : null;

  return (
    <figure className="min-w-0">
      {comparePeers ? (
        <>
          <p className="font-mono text-[34px] font-semibold leading-none tabular-nums text-ink">
            {pct(insight.ownSharePct as number)}
            <span className="ml-2 align-middle font-sans text-[15px] font-normal text-ink-muted">vs {pct(insight.peerSharePct as number)} peer median</span>
          </p>
          <p className="mt-2 text-[15px] leading-snug text-ink">
            Service charges were {pct(insight.ownSharePct as number)} of {institutionName}&apos;s revenue
            {latest ? ` ${latest.source === "ncua" ? "through" : "in"} ${formatReportQuarter(latest.reportDate)}` : ""}. The median for{" "}
            {(insight.peerCount as number).toLocaleString("en-US")} {insight.kind === "bank" ? "banks" : "credit unions"}
            {insight.sizeRange ? ` with ${insight.sizeRange} in assets` : " its size"} was {pct(insight.peerSharePct as number)}.
          </p>
        </>
      ) : (
        last && last.value > 0 && (
          <p className="text-[15px] leading-snug text-ink">
            Service-charge income was {formatCompactDollars(last.value)} in {formatReportQuarter(last.reportDate)}
            {change !== null ? `, ${change >= 0 ? "up" : "down"} ${pct(Math.abs(change))} since ${formatReportQuarter(first.reportDate)}` : ""}.
          </p>
        )
      )}
      {series.length > 1 && (
        <div className="mt-4" role="img" aria-label={`Service-charge income by quarter, ${span}`}>
          <p className="text-[12px] font-medium text-ink-muted">Service-charge income by quarter</p>
          <div className="mt-2 flex h-24 items-end gap-2">
            {series.map((q) => (
              <div key={q.reportDate} className="flex flex-1 flex-col items-center gap-1">
                <span className="font-mono text-[11px] tabular-nums text-ink-muted">{formatCompactDollars(q.value)}</span>
                <span
                  className="w-3/5 rounded-t-[3px] bg-warm-ink-500"
                  style={{ height: `${Math.max(4, (Math.max(0, q.value) / top) * 64)}px` }}
                />
                <span className="text-[11px] text-ink-muted">{formatReportQuarter(q.reportDate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {span && (
        <figcaption className="mt-3 text-[12px] text-ink-muted">
          From {sourceName}, {span}
          {comparePeers
            ? `. Revenue is ${latest?.source === "ncua" ? "interest income" : "net interest income"} plus noninterest income.`
            : "."}
        </figcaption>
      )}
    </figure>
  );
}

/** The page's one next step: one complete Hamilton insight on this institution, then plans or a demo. */
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
    <section aria-labelledby="hamilton-heading" className="rounded-2xl border border-border bg-surface-0 p-5 shadow-fi-1 sm:p-7">
      <div className={`grid gap-6 ${hasInsight ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-10" : ""}`}>
        {hasInsight && insight && (
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">A Hamilton finding</p>
            <div className="mt-3">
              <InsightView insight={insight} institutionName={institutionName} />
            </div>
          </div>
        )}
        <div className="min-w-0 space-y-4 lg:border-l lg:border-border lg:pl-10">
          <h2 id="hamilton-heading" className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[26px]">
            Work at {institutionName}? See every fee and filing against your peers.
          </h2>
          <p className="text-[14px] leading-relaxed text-ink-muted">
            Hamilton, the Fee Insight Pro workspace, opens on your institution with your market, your call reports and a
            sourced brief for the board.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "institution_hamilton_band" }}
              href={plansHref}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-on-ink hover:opacity-90"
            >
              {PRO_PLANS_NAV.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </TrackLink>
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "institution_hamilton_band_demo" }}
              href={DEMO_REQUEST_NAV.href}
              className="text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
            >
              {DEMO_REQUEST_NAV.label}
            </TrackLink>
          </div>
          {/* The tour shows only once the clip exists; no "coming soon" slot in the meantime. */}
          {INSTITUTION_TOUR_VIDEO && (
            <FrameMedia video={INSTITUTION_TOUR_VIDEO}>
              <TourVideoSlot />
            </FrameMedia>
          )}
          <p className="text-[12px] text-ink-muted sm:mx-0 sm:text-left">
            Prefer one document?{" "}
            {sampleReportHref ? (
              <>
                <Link href={sampleReportHref} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-ink">
                  See a free sample {REPORT_OFFER.name}
                </Link>
                , then{" "}
                <Link href={reportOfferHref} className="underline underline-offset-2 hover:text-ink">
                  order one {REPORT_PRICE_INLINE}
                </Link>
                .
              </>
            ) : (
              <Link href={reportOfferHref} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-ink">
                {REPORT_OFFER.name}, {REPORT_PRICE_INLINE}
              </Link>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
