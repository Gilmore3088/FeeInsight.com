import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/constants";
import { formatCompactDollars } from "@/lib/format";
import { hamiltonHandoffs } from "@/lib/hamilton-handoff";
import type { ConnectedPanel as Panel, Direction } from "./connected-panel-view";
import { HandoffLinks } from "./handoff-links";
import { FreeOnly } from "./viewer-islands";
import { SERIF } from "./profile-serif";

const pct = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;
const NUM = "[font-variant-numeric:tabular-nums]";
const KIND = "text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted";

function QuarterBars({ panel }: { panel: Panel }) {
  const { quarters, incomeLabel } = panel.reported;
  if (quarters.length < 2) return null;
  const top = Math.max(1, ...quarters.map((q) => q.value));
  return (
    <div
      className="mt-5"
      role="img"
      aria-label={`${incomeLabel} by quarter: ${quarters.map((q) => `${q.label} ${formatCompactDollars(q.value)}`).join(", ")}`}
    >
      <div className="flex h-24 items-end gap-2">
        {quarters.map((q, i) => (
          <div key={q.label} className="flex flex-1 flex-col items-center gap-1">
            <span className={`text-[11px] text-ink-muted ${NUM}`}>{formatCompactDollars(q.value)}</span>
            <span
              className={`w-3/5 rounded-t-[3px] ${i === quarters.length - 1 ? "bg-ink" : "bg-ink/35"}`}
              style={{ height: `${Math.max(4, (Math.max(0, q.value) / top) * 64)}px` }}
            />
            <span className="text-[11px] text-ink-muted">{q.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One row of the exhibit: its value as a dot against the median as a tick, on its own scale. */
function Dumbbell({ label, own, median, ownText, medianText, direction }: {
  label: string;
  own: number;
  median: number;
  ownText: string;
  medianText: string;
  direction: Direction;
}) {
  const top = Math.max(own, median) * 1.15 || 1;
  const at = (n: number) => `${(Math.max(0, n) / top) * 100}%`;
  const [lo, hi] = own < median ? [own, median] : [median, own];
  return (
    <li className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
      <span className="text-[13px] leading-snug text-ink-soft">{label.replace(/-/g, "\u2011")}</span>
      <span
        className="relative h-5"
        role="img"
        aria-label={`${label}: ${ownText}, median ${medianText}, ${direction === "same" ? "about the same" : direction}`}
      >
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <span className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-ink/25" style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }} />
        <span className="absolute top-0 h-5 w-0.5 -translate-x-1/2 bg-ink-muted" style={{ left: at(median) }} />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: at(own) }} />
      </span>
      <span className={`text-right text-[14px] ${NUM}`}>
        <span className="font-medium text-ink">{ownText}</span>
        <span className="text-ink-muted"> / {medianText}</span>
      </span>
    </li>
  );
}

/**
 * Fee income beside fee prices (James's brief §6), cut to two exhibits (James, Oct 18: "too much
 * text"): the reported quarters, and its share and fees against their medians. Sources and the
 * questions the figures can't answer sit in one drawer; the Hamilton hand-offs carry the rest.
 */
export function ConnectedPanel({
  panel,
  sampleReportHref,
}: {
  panel: Panel;
  /** The free sample report, offered to readers who aren't Pro. */
  sampleReportHref: string | null;
}) {
  const { reported, share, fees, questions } = panel;
  const handoffs = hamiltonHandoffs(panel.handoff);
  const placeOf = fees[0]?.place;
  return (
    <section aria-labelledby="connected-heading" className="scroll-mt-20 border-t border-border pt-10">
      <h2
        id="connected-heading"
        className="text-[36px] font-medium leading-[1.04] tracking-[-0.02em] text-ink sm:text-[54px]"
        style={SERIF}
      >
        Fee income beside fee prices
      </h2>
      <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-ink-soft sm:text-[18px]">{panel.observation}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
        <figure className="min-w-0">
          <figcaption className={KIND}>
            {reported.incomeLabel}, {reported.latest.label}
          </figcaption>
          <p className={`mt-2 text-[44px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`} style={SERIF}>
            {formatCompactDollars(reported.latest.value)}
          </p>
          <QuarterBars panel={panel} />
        </figure>

        <figure className="min-w-0">
          <figcaption className={KIND}>Against the median{placeOf ? ` (${placeOf === "U.S." ? "U.S." : placeOf} for fees)` : ""}</figcaption>
          <ul className="mt-2 divide-y divide-border">
            {share && (
              <Dumbbell
                label="Share of revenue"
                own={share.own}
                median={share.median}
                ownText={pct(share.own)}
                medianText={pct(share.median)}
                direction={share.direction}
              />
            )}
            {fees.map((fee) => (
              <Dumbbell
                key={fee.key}
                label={fee.label}
                own={fee.value}
                median={fee.medianValue}
                ownText={`${fee.amount}${fee.basis ? "*" : ""}`}
                medianText={fee.median}
                direction={fee.direction}
              />
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-4 text-[12px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ink" aria-hidden="true" />{panel.handoff.institutionName}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-ink-muted" aria-hidden="true" />Median</span>
          </p>
        </figure>
      </div>

      <div className="mt-8">
        <HandoffLinks institutionId={panel.handoff.institutionId} handoffs={handoffs} />
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-1">
        <details className="group/src min-w-0 flex-1">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="text-[10px] transition-transform group-open/src:rotate-90">&#9654;</span>
            Sources and open questions
          </summary>
          <div className="max-w-3xl space-y-2 text-[12px] leading-relaxed text-ink-muted">
            <p>
              {reported.source}s, {reported.entity.toLowerCase()} level, standalone quarters.{panel.caution ? ` ${panel.caution}` : ""}
            </p>
            {share && (
              <p>
                Share of revenue: median of {share.peers.toLocaleString("en-US")} {share.cohort}, {panel.handoff.quarter}.
              </p>
            )}
            {fees.length > 0 && (
              <p>
                Fees from each institution&rsquo;s own schedule against {PRODUCT_NAME} medians, not weighted by revenue
                {fees.some((fee) => fee.basis) ? `. *${fees.filter((fee) => fee.basis).map((fee) => `${fee.label}: ${fee.basis}`).join(" ")}` : "."}
              </p>
            )}
            <ul className="list-disc space-y-1 pl-4">
              {questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        </details>
        {sampleReportHref && (
          <FreeOnly>
            <Link
              href={sampleReportHref}
              className="inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-ink underline decoration-border underline-offset-[6px] hover:decoration-ink"
            >
              See a free sample report
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </FreeOnly>
        )}
      </div>
    </section>
  );
}
