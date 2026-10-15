import Link from "next/link";
import { FeeRange } from "@/brand/components";
import { formatFeeAmount } from "@/lib/format";
import type { MarketDot, NationalBand, Position } from "./category-view";

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

/** The upper end of a shared axis: just past the highest figure, on a round number. */
export function axisTop(...values: number[]): number {
  const top = Math.max(1, ...values);
  const step = top > 200 ? 50 : top > 50 ? 10 : top > 10 ? 5 : 1;
  return Math.ceil((top * 1.05) / step) * step;
}

const DOT: Record<Position, string> = {
  below: "bg-below-market",
  within: "bg-in-range",
  above: "bg-above-market",
};

/** The hero: the fee's whole national spread as one large range, with its four figures named. */
export function HeroRange({ band, label }: { band: NationalBand; label: string }) {
  // The bar ends just past the highest fee, unless one outlier would squeeze the middle half flat.
  const top = axisTop(Math.min(band.max, Math.max(band.p75 * 2.5, band.median * 2)));
  const domain: [number, number] = [0, top];
  const figures = [
    { name: "Low", value: money(band.min) },
    { name: "Middle half", value: `${money(band.p25)}–${money(band.p75)}` },
    { name: "Median", value: money(band.median) },
    { name: "High", value: money(band.max) },
  ];
  return (
    // The median is the headline figure just above, so the range's own right-hand figure is hidden.
    <figure className="fi-range-stack rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6 [&_.fi-range-value]:hidden">
      <FeeRange
        label={label}
        min={band.min}
        q1={band.p25}
        median={band.median}
        q3={band.p75}
        max={Math.min(band.max, top)}
        domain={domain}
        format={money}
        figure="median"
      />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={f.name}>
            <dt className="text-[12px] text-ink-muted">{f.name}</dt>
            <dd className="font-mono text-[17px] font-semibold tabular-nums text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
      {band.max > top && (
        <figcaption className="mt-2 text-[12px] text-ink-muted">The highest fee runs past the end of the bar.</figcaption>
      )}
    </figure>
  );
}

/**
 * Markets as dots on one axis, each read against the national middle half drawn behind it.
 * Used for Fed districts, banks against credit unions, and (for Pro) asset size and state.
 */
export function MarketDots({ dots, band, ariaLabel }: { dots: MarketDot[]; band: NationalBand; ariaLabel: string }) {
  // The axis spans the national middle half and every market's median, with a little room, so
  // a few dollars between markets reads as distance rather than one pile of dots.
  const values = [band.p25, band.p75, ...dots.map((d) => d.median)];
  const span = Math.max(...values) - Math.min(...values) || 1;
  const lo = Math.max(0, Math.min(...values) - span * 0.25);
  const hi = Math.max(...values) + span * 0.25;
  const pct = (v: number) => `${((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100}%`;
  return (
    <ol aria-label={ariaLabel} className="divide-y divide-border">
      {dots.map((d) => (
        <li key={d.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-1.5 text-[14px] sm:grid-cols-[10rem_minmax(0,1fr)_4.5rem]">
          <span className="min-w-0 leading-tight text-ink">
            {d.label}
            <span className="block text-[11px] text-ink-muted">{d.institutions.toLocaleString("en-US")} institutions</span>
          </span>
          <span className="relative h-5" aria-hidden="true">
            <span className="absolute inset-x-0 top-1/2 border-t border-border" />
            <span
              className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-brick-tint"
              style={{ left: pct(band.p25), width: `calc(${pct(band.p75)} - ${pct(band.p25)})` }}
            />
            <span className="absolute top-0 h-5 w-[2px] bg-ink/60" style={{ left: pct(band.median) }} />
            <span
              className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 ${DOT[d.position]}`}
              style={{ left: pct(d.median) }}
            />
          </span>
          <span className="text-right font-mono text-[14px] font-semibold tabular-nums text-ink">{money(d.median)}</span>
        </li>
      ))}
    </ol>
  );
}

const POSITION_WORD: Record<Position, string> = { below: "below", within: "inside", above: "above" };

/** What the dots and bands mean, said once per section that draws them, naming only the colours drawn. */
export function DotLegend({ positions }: { positions: Position[] }) {
  const only = positions.length === 1 ? positions[0] : null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-full bg-brick-tint" />
        U.S. middle half
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-[2px] bg-ink/60" />
        U.S. median
      </span>
      {positions.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-0.5">
            {positions.map((p) => (
              <span key={p} className={`h-2.5 w-2.5 rounded-full ${DOT[p]}`} />
            ))}
          </span>
          {only
            ? `Every median here is ${POSITION_WORD[only]} the U.S. middle half`
            : `Median: ${positions.map((p) => POSITION_WORD[p]).join(", ")} the U.S. middle half`}
        </span>
      )}
    </p>
  );
}

/**
 * The Pro rows a free visitor can't read yet: each group's name and size, with no figure.
 * Nothing is blurred; the figures are simply not sent to the page.
 */
export function LockedRows({ rows }: { rows: { key: string; label: string; institutions: number }[] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
          <span className="min-w-0 leading-tight text-ink">
            {r.label}
            <span className="block text-[11px] text-ink-muted">{r.institutions.toLocaleString("en-US")} institutions</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ink-muted">
            <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
              <path d="M3.5 5V3.75a2.5 2.5 0 0 1 5 0V5M2.5 5h7v5.5h-7z" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            In Hamilton
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The family's other fees, each as a small national range that links to its own page. */
export function RelatedRanges({ items }: { items: { category: string; label: string; band: NationalBand }[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map(({ category, label, band }) => {
        const top = axisTop(Math.min(band.max, Math.max(band.p75 * 2.5, band.median * 2)));
        return (
          <li key={category}>
            <Link
              href={`/fees/${category}`}
              className="fi-range-stack block rounded-xl border border-border bg-surface-0 px-3 py-1 no-underline transition-colors hover:border-ink/30 [&_.fi-range]:border-b-0"
            >
              <FeeRange
                label={label}
                min={band.min}
                q1={band.p25}
                median={band.median}
                q3={band.p75}
                max={Math.min(band.max, top)}
                domain={[0, top]}
                format={money}
                figure="median"
              />
              <p className="-mt-1 pb-1.5 text-[12px] text-ink-muted">
                Middle half <span className="font-mono text-ink">{money(band.p25)}–{money(band.p75)}</span>
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Where a recorded clip will play: a small marked slot under the exhibit it will replace. It is a
 * picture, not a control, so nothing on the page pretends to play.
 */
export function VideoSlot({ title }: { title: string }) {
  return (
    <figure className="flex items-center gap-3 rounded-lg border border-border bg-paper p-2 pr-4">
      <span aria-hidden="true" className="flex h-12 w-20 shrink-0 items-center justify-center rounded-md bg-warm-ink-900">
        <svg viewBox="0 0 12 12" className="ml-0.5 h-4 w-4 text-warm-ink-50">
          <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
        </svg>
      </span>
      <figcaption className="min-w-0 text-[13px]">
        <span className="block font-medium text-ink">{title}</span>
        <span className="text-ink-muted">Video coming</span>
      </figcaption>
    </figure>
  );
}
