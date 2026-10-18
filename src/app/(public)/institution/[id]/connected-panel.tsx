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
const SOURCE = "mt-3 text-[12px] leading-relaxed text-ink-muted";

/** Above and below in words beside a neutral mark: no red or green price judgement (brief §8). */
function Position({ direction }: { direction: Direction }) {
  const word = direction === "same" ? "about the same" : direction;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
      <span aria-hidden="true">{direction === "above" ? "▲" : direction === "below" ? "▼" : "●"}</span>
      {word}
    </span>
  );
}

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

/**
 * Fee income beside fee prices (James's brief §6): reported call-report figures, calculated
 * comparisons with their medians, and the questions neither answers, each in its own column,
 * then the Hamilton hand-offs that carry this institution, cohort, quarter and fees with them.
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
      {panel.caution && <p className="mt-2 text-[13px] text-ink-muted">{panel.caution}</p>}

      <div className="mt-8 grid gap-8 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-border">
        {/* Reported: the filing's own figures. */}
        <div className="min-w-0 lg:pr-8">
          <p className={KIND}>Reported</p>
          <p className="mt-3 text-[13px] text-ink-soft">
            {reported.incomeLabel}, {reported.latest.label}
          </p>
          <p className={`mt-1 text-[40px] font-medium leading-none tracking-[-0.02em] text-ink ${NUM}`} style={SERIF}>
            {formatCompactDollars(reported.latest.value)}
          </p>
          <QuarterBars panel={panel} />
          <p className={SOURCE}>
            {reported.source}, {reported.entity.toLowerCase()} level, standalone quarters.
          </p>
        </div>

        {/* Compared: calculated against a stated median. */}
        <div className="min-w-0 border-t border-border pt-8 lg:border-t-0 lg:px-8 lg:pt-0">
          <p className={KIND}>Compared</p>
          <dl className="mt-3 divide-y divide-border">
            {share && (
              <div className="pb-3">
                <dt className="text-[13px] text-ink-soft">Share of revenue</dt>
                <dd className="mt-1">
                  <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${NUM}`}>
                    <span className="text-[22px] font-medium text-ink">{pct(share.own)}</span>
                    <span className="text-[14px] text-ink-muted">median {pct(share.median)}</span>
                    <Position direction={share.direction} />
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-ink-muted">
                    {reported.source}s, {panel.handoff.quarter}: median of {share.peers.toLocaleString("en-US")} {share.cohort}.
                  </p>
                </dd>
              </div>
            )}
            {fees.map((fee) => (
              <div key={fee.key} className="py-3">
                <dt className="text-[13px] text-ink-soft">{fee.label}</dt>
                <dd className="mt-1">
                  <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${NUM}`}>
                    <span className="text-[22px] font-medium text-ink">{fee.amount}</span>
                    <span className="text-[14px] text-ink-muted">
                      {fee.place} median {fee.median}
                    </span>
                    {fee.difference ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[13px] text-ink-soft">{fee.difference}</span>
                        <Position direction={fee.direction} />
                      </span>
                    ) : (
                      <Position direction={fee.direction} />
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-ink-muted">
                    {fee.basis ? `${fee.basis} ` : ""}
                    {fee.institutions.toLocaleString("en-US")} institutions in the median.
                  </p>
                </dd>
              </div>
            ))}
          </dl>
          <p className={SOURCE}>Fees from each institution&rsquo;s own schedule, against {PRODUCT_NAME} medians. Not weighted by revenue.</p>
        </div>

        {/* Open questions: what the figures raise and can't settle. */}
        <div className="min-w-0 border-t border-border pt-8 lg:border-t-0 lg:pl-8 lg:pt-0">
          <p className={KIND}>Open questions</p>
          <ul className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink">
            {questions.map((question) => (
              <li key={question} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-muted">
                  ?
                </span>
                <span>{question}</span>
              </li>
            ))}
          </ul>
          <p className={SOURCE}>Prices alone can&rsquo;t explain a revenue share. Fee volumes and account mix aren&rsquo;t public.</p>
        </div>
      </div>

      <div className="mt-10">
        <p className="text-[15px] font-medium text-ink">Look into this in Hamilton</p>
        <p className="mt-1 text-[13px] text-ink-muted">Each opens on this {panel.handoff.kind} in Hamilton, part of a paid subscription.</p>
        <div className="mt-4">
          <HandoffLinks institutionId={panel.handoff.institutionId} handoffs={handoffs} />
        </div>
        {sampleReportHref && (
          <FreeOnly>
            <p className="mt-4">
              <Link
                href={sampleReportHref}
                className="inline-flex min-h-11 items-center gap-2 text-[14px] font-medium text-ink underline decoration-border underline-offset-[6px] hover:decoration-ink"
              >
                See a free sample report
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </p>
          </FreeOnly>
        )}
      </div>
    </section>
  );
}
