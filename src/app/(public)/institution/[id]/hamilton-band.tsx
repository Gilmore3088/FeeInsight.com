import Link from "next/link";
import { ArrowRight, Play, Search } from "lucide-react";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { HAMILTON_MODES, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatFeeAmount } from "@/lib/format";
import { MarketRange, rangeDomain, type HeadlineRow } from "./market-position";

/**
 * Hamilton as it opens on this institution, drawn from the same live rows as the page. It sits in
 * a video slot: when the recorded clip of Hamilton opening on an institution exists, it replaces
 * this frame and the frame becomes its poster.
 */
function HamiltonView({
  institutionName,
  rows,
  marketLabel,
  stateLabel,
}: {
  institutionName: string;
  rows: HeadlineRow[];
  marketLabel: string;
  stateLabel: string | null;
}) {
  return (
    <figure
      data-video-slot="institution-hamilton"
      className="relative min-w-0 overflow-hidden rounded-2xl border border-warm-ink-700 bg-warm-ink-800 shadow-fi-2"
    >
      <div className="flex items-center gap-2 border-b border-warm-ink-700 px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-warm-ink-500" />
        <span className="h-2 w-2 rounded-full bg-warm-ink-500" />
        <span className="h-2 w-2 rounded-full bg-warm-ink-500" />
        <span className="ml-2 text-[12px] font-semibold tracking-wide text-warm-ink-50">Hamilton</span>
      </div>
      <div className="flex gap-1 overflow-hidden border-b border-warm-ink-700 px-3 py-2" aria-hidden="true">
        {HAMILTON_MODES.map((mode, i) => (
          <span
            key={mode}
            className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium ${
              i === 1 ? "bg-warm-ink-50 text-warm-ink-900" : "text-warm-ink-300"
            }`}
          >
            {mode}
          </span>
        ))}
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warm-ink-500">My fees</p>
          <p className="mt-1 text-[17px] font-semibold leading-snug text-warm-ink-50">{institutionName}</p>
          <p className="text-[12px] text-warm-ink-300">against {marketLabel}</p>
        </div>
        <ul className="space-y-3">
          {rows.map((row) => {
            const band = row.state ?? row.nation;
            if (!band) return null;
            return (
              <li key={row.category}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-warm-ink-50">{row.label}</span>
                  <span className="font-mono font-semibold tabular-nums text-warm-ink-50">{formatFeeAmount(row.amount)}</span>
                </div>
                <MarketRange
                  label={row.state && stateLabel ? stateLabel : "U.S."}
                  band={band}
                  amount={row.amount}
                  domainMax={rangeDomain(row.amount, [band])}
                  tone="dark"
                />
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-2 rounded-lg border border-warm-ink-700 bg-warm-ink-900 px-3 py-2.5 text-[13px] text-warm-ink-300">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Ask Hamilton about {institutionName}</span>
        </div>
      </div>
      <figcaption className="absolute right-3 top-2 inline-flex items-center gap-1.5 rounded-full bg-warm-ink-900/80 px-2.5 py-1 text-[11px] font-medium text-warm-ink-300">
        <Play className="h-3 w-3" aria-hidden="true" />
        Tour video coming
      </figcaption>
    </figure>
  );
}

/** The one Pro ask on the page: Hamilton opened on this institution, then plans or a demo. */
export function HamiltonBand({
  institutionName,
  rows,
  marketLabel,
  stateLabel,
  plansHref,
  reportOfferHref,
}: {
  institutionName: string;
  rows: HeadlineRow[];
  marketLabel: string;
  stateLabel: string | null;
  plansHref: string;
  reportOfferHref: string;
}) {
  return (
    <section aria-labelledby="hamilton-band-heading" className="bg-warm-ink-900 text-warm-ink-50">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-warm-ink-300">
            Work at {institutionName}?
          </p>
          <h2
            id="hamilton-band-heading"
            className="mt-3 text-[30px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[40px]"
          >
            See every fee against your competitors.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-warm-ink-300">
            Hamilton, the Fee Insight Pro workspace, opens on your institution with your market, your peers and a
            sourced brief for the board.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <TrackLink
              event="upgrade_click"
              eventProps={{ placement: "institution_hamilton_band" }}
              href={plansHref}
              className="inline-flex items-center gap-2 rounded-full bg-warm-ink-50 px-6 py-3 text-[15px] font-semibold text-warm-ink-900 transition-opacity hover:opacity-90"
            >
              {PRO_PLANS_NAV.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </TrackLink>
            <TrackLink
              event="contact_sales"
              eventProps={{ placement: "institution_hamilton_band_demo" }}
              href={DEMO_REQUEST_NAV.href}
              className="text-[14px] font-semibold text-warm-ink-50 underline decoration-warm-ink-500 underline-offset-4 hover:decoration-warm-ink-50"
            >
              {DEMO_REQUEST_NAV.label}
            </TrackLink>
          </div>
          <p className="mt-6 text-[13px] text-warm-ink-500">
            Prefer one document?{" "}
            <Link href={reportOfferHref} className="underline underline-offset-2 hover:text-warm-ink-50">
              {REPORT_OFFER.name}, {REPORT_PRICE_INLINE}
            </Link>
          </p>
        </div>
        <HamiltonView institutionName={institutionName} rows={rows} marketLabel={marketLabel} stateLabel={stateLabel} />
      </div>
    </section>
  );
}
