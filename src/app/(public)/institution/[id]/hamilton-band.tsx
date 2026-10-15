import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { FrameMedia, type FrameVideo } from "@/components/marketing/frame-media";
import { ProductFrame } from "@/components/marketing/product-frame";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { HAMILTON_MODES, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatFeeAmount } from "@/lib/format";
import { MarketRange, rangeDomain, type HeadlineRow } from "./market-position";

/** The recorded clip of Hamilton opening on an institution; until it exists the live frame stands in. */
export const INSTITUTION_TOUR_VIDEO: FrameVideo | null = null;

/**
 * Hamilton as it opens on this institution, drawn from the same live rows as the page, in the
 * shared product window. When the tour clip exists it plays behind a button on this frame.
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
    <FrameMedia video={INSTITUTION_TOUR_VIDEO}>
      <ProductFrame label="Hamilton" className="shadow-fi-2">
        <div className="flex gap-1 overflow-hidden border-b border-border px-3 py-2" aria-hidden="true">
          {HAMILTON_MODES.map((mode, i) => (
            <span
              key={mode}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium ${
                i === 1 ? "bg-ink text-on-ink" : "text-ink-muted"
              }`}
            >
              {mode}
            </span>
          ))}
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <p className="text-[17px] font-semibold leading-snug text-ink">{institutionName}</p>
            <p className="text-[12px] text-ink-muted">against {marketLabel}</p>
          </div>
          <ul className="space-y-3">
            {rows.map((row) => {
              const band = row.state ?? row.nation;
              if (!band) return null;
              return (
                <li key={row.category}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 text-ink">{row.label}</span>
                    <span className="font-mono font-semibold tabular-nums text-ink">{formatFeeAmount(row.amount)}</span>
                  </div>
                  <MarketRange
                    label={row.state && stateLabel ? stateLabel : "U.S."}
                    band={band}
                    amount={row.amount}
                    domainMax={rangeDomain(row.amount, [band])}
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2 rounded-lg border border-control-border bg-paper px-3 py-2.5 text-[13px] text-ink-muted">
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Ask Hamilton about {institutionName}</span>
          </div>
        </div>
      </ProductFrame>
    </FrameMedia>
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
