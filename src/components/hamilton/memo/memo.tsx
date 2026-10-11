/**
 * The "living memo" building blocks for Hamilton's Briefing, Research, Model and Plan screens,
 * in the Fee Insight brand: warm parchment, Newsreader display type, terracotta accent,
 * numbered exhibits with their source under each. Server components only.
 */
import Link from "next/link";
import { LinkPending } from "./LinkPending";
import { TabSelect } from "./TabSelect";
import type { ReactNode } from "react";
import { priceBands } from "@/lib/hamilton/fee-scenario";
import type { AuditTrail } from "@/lib/hamilton/audit-trail";

export const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

/** "reading" keeps a page to one column at a comfortable reading width; most pages use the wide grid. */
export function MemoPage({ children, width = "wide" }: { children: ReactNode; width?: "wide" | "reading" }) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-8 text-warm-800 ${width === "reading" ? "max-w-3xl" : "max-w-5xl"}`}>
      {children}
    </div>
  );
}

export function MemoHeader({
  kicker,
  title,
  dek,
  actions,
  compact = false,
}: {
  kicker: string;
  title: string;
  /** A long title (a long question) set smaller so it never fills the screen. */
  compact?: boolean;
  dek?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-warm-300 pb-5">
      <div className="min-w-0 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terra-text">{kicker}</p>
        <h1 className={`mt-1.5 leading-tight text-warm-900 ${compact ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl"}`} style={SERIF}>
          {title}
        </h1>
        {dek ? <p className="mt-2 text-pretty text-base leading-relaxed text-warm-700">{dek}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function MemoSection({
  title,
  note,
  children,
  id,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl text-warm-900 sm:text-2xl" style={SERIF}>
          {title}
        </h2>
        {note ? <p className="mt-1 text-pretty text-sm text-warm-600">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Exhibit({
  number,
  title,
  source,
  children,
}: {
  number: number;
  title: string;
  source: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="rounded-lg border border-warm-300 bg-warm-50 p-5">
      <figcaption className="mb-4 flex flex-wrap items-baseline gap-x-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-terra-text">Exhibit {number}</span>
        <span className="text-base text-warm-900" style={SERIF}>
          {title}
        </span>
      </figcaption>
      {children}
      <p className="mt-4 border-t border-warm-200 pt-2 text-xs text-warm-600">Source: {source}</p>
    </figure>
  );
}

export function LinkButton({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "inline-flex min-h-11 items-center rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white no-underline hover:bg-terra-dark sm:min-h-9"
          : "inline-flex min-h-11 items-center rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 no-underline hover:border-warm-500 sm:min-h-9"
      }
    >
      {children}
      <LinkPending />
    </Link>
  );
}

export interface TabItem {
  label: string;
  href: string;
  active: boolean;
  meta?: string;
}

export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  // More than four pills wrap into a wall on a phone; there they become one menu.
  const asMenu = items.length > 4;
  return (
    <>
    {asMenu ? <TabSelect items={items} label={label} /> : null}
    <nav aria-label={label} className={asMenu ? "hidden flex-wrap gap-1.5 sm:flex" : "flex flex-wrap gap-1.5"}>
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={
            "inline-flex min-h-11 items-center rounded-md border px-3 py-1.5 text-sm no-underline sm:min-h-9 " +
            (t.active
              ? "border-warm-900 bg-warm-900 text-warm-ink-50"
              : "border-warm-300 bg-warm-50 text-warm-700 hover:border-warm-500")
          }
        >
          {t.label}
          {t.meta ? <span className={t.active ? "ml-1.5 text-warm-ink-300" : "ml-1.5 text-warm-600"}>{t.meta}</span> : null}
          <LinkPending />
        </Link>
      ))}
    </nav>
    </>
  );
}

export function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-warm-600">{label}</p>
      <p className="mt-1 text-2xl text-warm-900" style={SERIF}>
        {value}
      </p>
      {note ? <p className="mt-0.5 text-xs text-warm-600">{note}</p> : null}
    </div>
  );
}

export function fmtMoney(amount: number | null | undefined): string {
  if (amount == null) return "Not published";
  // Thousands are grouped: a fee income of 209400 reads "$209,400", not "$209400".
  return Number.isInteger(amount)
    ? `$${amount.toLocaleString("en-US")}`
    : `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtSignedMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return amount === 0 ? "$0" : `${amount > 0 ? "+" : "−"}$${abs}`;
}

/** A per-item price change, cents kept: "+$2.50", "−$32". */
export function fmtSignedPrice(amount: number): string {
  return amount === 0 ? "$0" : `${amount > 0 ? "+" : "−"}${fmtMoney(Math.abs(amount))}`;
}

/** Plain-language price bands derived from the data's own spread. */
export function bandEdges(amounts: readonly number[]): number[] {
  const positive = amounts.filter((a) => a > 0);
  if (positive.length === 0) return [1];
  const max = Math.max(...positive);
  const step = max <= 5 ? 1 : max <= 15 ? 2.5 : max <= 40 ? 5 : max <= 100 ? 10 : 25;
  const edges = [0.01];
  for (let e = step; e <= max; e += step) edges.push(e);
  return edges;
}

/**
 * A horizontal bar per price band, with the bank's own band and any tested price marked.
 * Real counts only; empty bands still show so the shape of the market is honest.
 */
export function DistributionBars({
  amounts,
  own,
  tested,
}: {
  amounts: readonly number[];
  own: number | null;
  tested?: number | null;
}) {
  const bands = priceBands(amounts, bandEdges(amounts));
  const max = Math.max(1, ...bands.map((b) => b.count));
  const inBand = (b: { lo: number; hi: number | null }, v: number | null | undefined) =>
    v != null && (b.lo === 0 && b.hi === 0 ? v === 0 : v >= b.lo && (b.hi == null || v < b.hi));
  const labelFor = (b: { lo: number; hi: number | null }) =>
    b.lo === 0 && b.hi === 0
      ? "No fee ($0)"
      : b.hi == null
        ? `${fmtMoney(Math.floor(b.lo))} and up`
        : `${fmtMoney(Math.floor(b.lo))} to ${fmtMoney(+(b.hi - 0.01).toFixed(2))}`;
  return (
    <div className="flex flex-col gap-1.5" role="table" aria-label="Institutions by price">
      {bands.map((b) => {
        const mine = inBand(b, own);
        const test = inBand(b, tested ?? null) && tested !== own;
        return (
          <div key={`${b.lo}-${b.hi}`} role="row" className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-sm">
            <span role="cell" className={mine ? "font-semibold text-warm-900" : "text-warm-700"}>
              {labelFor(b)}
            </span>
            <span role="cell" className="relative h-4 rounded-sm bg-warm-150">
              <span
                className={"absolute inset-y-0 left-0 rounded-sm " + (mine ? "bg-terra" : "bg-warm-500")}
                style={{ width: `${(b.count / max) * 100}%` }}
              />
              {mine || test ? (
                <span className="absolute inset-y-0 right-1 flex items-center text-[11px] font-medium text-warm-800">
                  {mine ? "Current price" : "Tested"}
                </span>
              ) : null}
            </span>
            <span role="cell" className="text-right [font-variant-numeric:tabular-nums] text-warm-700">
              {b.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Rows for price labels so no two labels closer than `gap` (in % of the width) share a row. */
export function labelRows(xs: readonly number[], gap = 9): number[] {
  const lastInRow: number[] = [];
  return xs.map((x) => {
    let row = lastInRow.findIndex((last) => x - last >= gap);
    if (row === -1) row = lastInRow.length;
    lastInRow[row] = x;
    return row;
  });
}

/** Even dollar ticks for a $0..max axis: every $1, $2, $5, $10, $25, $50 or $100. */
export function dollarTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 25, 50, 100, 250, 500].find((s) => max / s <= 8) ?? 1000;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return ticks;
}

/**
 * Where each price lands among the peers: a bar for every price point, as tall as the number of
 * institutions charging it, with today's price and each tested price drawn as a line through it.
 * Read left (lower) to right (higher).
 */
export function PriceStrip({
  amounts,
  marks,
  scopeLabel,
}: {
  amounts: readonly number[];
  marks: { label: string; price: number; today?: boolean }[];
  scopeLabel?: string;
}) {
  const top = Math.max(1, ...amounts, ...marks.map((m) => m.price));
  const binWidth = Math.max(1, Math.ceil(top / 60));
  const bins = Math.floor(top / binWidth) + 1;
  const counts = new Array<number>(bins).fill(0);
  for (const a of amounts) counts[Math.min(bins - 1, Math.floor(Math.round(a) / binWidth))]++;
  const tallest = Math.max(1, ...counts);
  const tallestAt = counts.indexOf(tallest) * binWidth;
  const axisMax = bins * binWidth;
  const x = (v: number) => (Math.min(axisMax, Math.floor(Math.round(v) / binWidth) * binWidth + binWidth / 2) / axisMax) * 100;
  const sorted = [...marks].sort((a, b) => a.price - b.price);
  const rows = labelRows(sorted.map((m) => x(m.price)));
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  const markIn = (i: number) => sorted.find((m) => m.today && Math.floor(Math.round(m.price) / binWidth) === i);

  return (
    <figure className="flex flex-col gap-2" aria-label="How many institutions charge each price, with current and tested prices marked">
      <div className="relative" style={{ height: `${rowCount * 1.6}rem` }}>
        {sorted.map((m, i) => (
          <span
            key={m.label}
            className={
              "absolute -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium " +
              (m.today ? "bg-terra text-white" : "bg-warm-900 text-warm-50")
            }
            style={{ left: `${x(m.price)}%`, top: `${rows[i] * 1.6}rem` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative h-36 border-b border-warm-500">
        <div className="absolute inset-0 flex items-end gap-px">
          {counts.map((c, i) => {
            const mark = markIn(i);
            return (
              <span
                key={i}
                title={`${c} ${c === 1 ? "institution charges" : "institutions charge"} ${binWidth === 1 ? fmtMoney(i) : `${fmtMoney(i * binWidth)} to ${fmtMoney((i + 1) * binWidth - 1)}`}`}
                className={"flex-1 rounded-t-[1px] " + (mark?.today ? "bg-terra/50" : "bg-warm-400")}
                style={{ height: c > 0 ? `${Math.max(3, (c / tallest) * 100)}%` : 0 }}
              />
            );
          })}
        </div>
        {sorted.map((m) => (
          <span
            key={m.label}
            aria-hidden
            className={"absolute -top-1 bottom-0 w-0.5 -translate-x-1/2 " + (m.today ? "bg-terra" : "bg-warm-900")}
            style={{ left: `${x(m.price)}%` }}
          />
        ))}
      </div>
      <div className="relative h-4 text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
        {dollarTicks(axisMax - binWidth).map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${x(t)}%` }}>
            {fmtMoney(t)}
          </span>
        ))}
      </div>
      <figcaption className="mt-1 text-xs leading-relaxed text-warm-600">
        <span className="font-medium text-warm-800">How to read this.</span> Each bar is a price; its height is how many{" "}
        {scopeLabel ? `institutions in ${scopeLabel}` : "institutions"} charge it ({amounts.length} in all; the tallest bar is{" "}
        {tallest} at {fmtMoney(tallestAt)}). The lines mark the current published price and the prices being tested.
      </figcaption>
    </figure>
  );
}

/** For each price: how many peers charge less, the same and more, as one stacked bar. */
export function PeerSplitBars({
  rows,
}: {
  rows: { label: string; less: number; same: number; more: number; today?: boolean; note?: string }[];
}) {
  const n = rows[0] ? rows[0].less + rows[0].same + rows[0].more : 0;
  const seg = (count: number, total: number, word: string, cls: string) =>
    count > 0 ? (
      <span
        className={"flex items-center justify-center overflow-hidden whitespace-nowrap px-1 " + cls}
        style={{ width: `${(count / total) * 100}%` }}
        title={`${count} ${word}`}
      >
        {count / total >= 0.2 ? `${count} ${word}` : count}
      </span>
    ) : null;
  return (
    <figure className="flex flex-col gap-3">
      <p className="text-sm text-warm-800">
        At each price, how the {n} institutions compare with that price
      </p>
      {rows.map((r) => {
        const total = Math.max(1, r.less + r.same + r.more);
        return (
          <div key={r.label} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[7rem_1fr_11rem]">
            <span className={"text-sm " + (r.today ? "font-semibold text-terra-text" : "text-warm-900")}>{r.label}</span>
            <span className="flex h-7 overflow-hidden rounded-sm text-[11px] font-medium [font-variant-numeric:tabular-nums]">
              {seg(r.less, total, "charge less", "bg-warm-300 text-warm-900")}
              {seg(r.same, total, "the same", "bg-warm-600 text-white")}
              {seg(r.more, total, "charge more", "bg-terra text-white")}
            </span>
            <span className="text-sm text-warm-700 [font-variant-numeric:tabular-nums] sm:text-right">{r.note ?? ""}</span>
          </div>
        );
      })}
      <figcaption className="text-xs leading-relaxed text-warm-600">
        <span className="font-medium text-warm-800">How to read this.</span> Each bar splits the institutions three ways:{" "}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-warm-300" />charge less than that price</span>,{" "}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-warm-600" />charge the same</span> and{" "}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-terra" />charge more</span>. The more
        grey on the left, the higher that price sits in the market.
      </figcaption>
    </figure>
  );
}

/**
 * How a price change moves you among each comparison group: a line from the lowest price in the
 * group (left) to the highest (right), an open circle where the starting price sits and a filled one
 * where the new price would.
 */
export function PositionShift({
  rows,
  fromLabel,
  toLabel,
}: {
  rows: { label: string; n: number; median: number | null; from: { less: number; same: number }; to: { less: number; same: number } }[];
  fromLabel: string;
  toLabel: string;
}) {
  const pct = (p: { less: number; same: number }, n: number) => (n > 0 ? ((p.less + p.same / 2) / n) * 100 : 0);
  return (
    <figure className="flex flex-col gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5 break-inside-avoid">
      <div className="hidden grid-cols-[11rem_1fr_12rem] gap-4 text-xs uppercase tracking-[0.08em] text-warm-600 sm:grid">
        <span>Compared with</span>
        <span className="flex justify-between">
          <span>Lowest price</span>
          <span>Highest price</span>
        </span>
        <span className="text-right">Charge less than the price</span>
      </div>
      {rows.map((r) => {
        const a = pct(r.from, r.n);
        const b = pct(r.to, r.n);
        return (
          <div key={r.label} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[11rem_1fr_12rem]">
            <span className="text-sm text-warm-900">
              {r.label} <span className="text-warm-600">({r.n})</span>
              <span className="block text-xs text-warm-600">Middle {fmtMoney(r.median)}</span>
            </span>
            <span className="relative h-6">
              <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-warm-200" />
              <span className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-warm-500" style={{ left: "50%" }} title="The middle institution" />
              <span
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-terra/40"
                style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
              />
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-warm-800 bg-white"
                style={{ left: `${a}%` }}
                title={`${fromLabel}: ${r.from.less} of ${r.n} charge less`}
              />
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-terra"
                style={{ left: `${b}%` }}
                title={`${toLabel}: ${r.to.less} of ${r.n} charge less`}
              />
            </span>
            <span className="text-sm text-warm-800 [font-variant-numeric:tabular-nums] sm:text-right">
              {r.from.less} → <span className="font-semibold text-terra-text">{r.to.less}</span> of {r.n}
            </span>
          </div>
        );
      })}
      <figcaption className="border-t border-warm-200 pt-3 text-xs leading-relaxed text-warm-600">
        <span className="font-medium text-warm-800">How to read this.</span> Each line runs from the institution with the lowest price in the group
        to the one with the highest; the tick is the middle one.{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-warm-800 bg-white" />
          {fromLabel}
        </span>{" "}
        is where the price sits today;{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-terra" />
          {toLabel}
        </span>{" "}
        is where it would sit. The right column counts institutions charging less than the current and tested prices.
      </figcaption>
    </figure>
  );
}

/** Thousands of dollars as filed, in words: "$8.8 million", "$450 thousand", "$2.6 billion". */
export function fmtFiledThousands(value: number): string {
  const dollars = value * 1000;
  if (Math.abs(dollars) >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(2)} billion`;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(value).toLocaleString("en-US")} thousand`;
}

/**
 * Two quarterly series on one scale (oldest left, newest right): the institution's own filed
 * figure and its peer median, values in thousands as filed.
 */
export function QuarterLines({
  quarters,
  series,
}: {
  quarters: readonly string[];
  series: { label: string; values: readonly (number | null)[]; own?: boolean }[];
}) {
  const W = 600;
  const H = 180;
  const pad = { l: 64, r: 40, t: 12, b: 26 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (all.length === 0 || quarters.length < 2) return null;
  const hi = Math.max(...all) * 1.1;
  const step = [1, 2, 2.5, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10(hi / 4))).find((s) => hi / s <= 5) ?? hi / 4;
  const ticks: number[] = [];
  for (let t = 0; t <= hi; t += step) ticks.push(t);
  const top = ticks[ticks.length - 1] < hi ? ticks[ticks.length - 1] + step : ticks[ticks.length - 1];
  if (top > ticks[ticks.length - 1]) ticks.push(top);
  const x = (i: number) => pad.l + (i / (quarters.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  // Values are thousands of dollars as filed.
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  const short = (v: number) =>
    v === 0 ? "$0" : v >= 1_000_000 ? `$${trim(v / 1_000_000)}B` : v >= 1_000 ? `$${trim(v / 1_000)}M` : `$${Math.round(v)}K`;
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-3xl" role="img" aria-label={series.map((s) => s.label).join(" and ") + " by quarter"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-warm-200" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-warm-600 text-[11px]">
              {short(t)}
            </text>
          </g>
        ))}
        {quarters.map((q, i) => (
          <text key={q} x={x(i)} y={H - 6} textAnchor="middle" className="fill-warm-600 text-[11px]">
            {i === 0 || i === quarters.length - 1 || q.endsWith("Q1") ? q.replace("-", " ") : q.slice(5)}
          </text>
        ))}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={s.label}>
              <polyline points={pts.join(" ")} fill="none" strokeWidth={s.own ? 2.5 : 2} className={s.own ? "stroke-terra" : "stroke-warm-600"} strokeDasharray={s.own ? undefined : "5 4"} />
              {s.values.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={s.own ? 3 : 2.5} className={s.own ? "fill-terra" : "fill-warm-600"} />))}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-warm-700">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className={"inline-block h-0.5 w-5 " + (s.own ? "bg-terra" : "border-t-2 border-dashed border-warm-600")} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Detail a reader can open: the reasoning, the full list, the long caption. Keeps each screen to
 * its headline, its numbers and its chart.
 */
export function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group text-sm text-warm-800">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-terra-text hover:underline sm:min-h-0">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
        {label}
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border-l-2 border-terra bg-terra-soft px-4 py-3 text-sm leading-relaxed text-warm-800">
      {children}
    </div>
  );
}

/**
 * Hamilton's one clarifying question, answered in place. A plain GET form: the answer joins the
 * page's link as `name`, with `keep` carried along so the rest of the page stays as it was.
 */
export function QuestionCard({
  prompt,
  why,
  name,
  inputKind,
  action,
  keep,
}: {
  prompt: string;
  /** What the answer changes, in one sentence. */
  why: string;
  name: string;
  inputKind: "number" | "percent" | "text";
  action: string;
  keep: Record<string, string | null | undefined>;
}) {
  const id = `ask-${name}`;
  return (
    <form method="get" action={action} className="flex flex-col gap-3 rounded-lg border border-terra/40 bg-white p-5 shadow-sm">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-terra-text">Hamilton has one question</p>
      <label htmlFor={id} className="text-lg leading-snug text-warm-900" style={SERIF}>
        {prompt}
      </label>
      <p className="text-sm text-warm-700">{why}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-48">
          <input
            id={id}
            name={name}
            required
            inputMode={inputKind === "text" ? "text" : inputKind === "percent" ? "decimal" : "numeric"}
            autoComplete="off"
            className={`w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra [font-variant-numeric:tabular-nums] ${inputKind === "percent" ? "pr-8" : ""}`}
          />
          {inputKind === "percent" ? <span className="pointer-events-none absolute right-3 top-2 text-sm text-warm-600">%</span> : null}
        </div>
        <button type="submit" className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark">
          Use this figure
        </button>
      </div>
    </form>
  );
}

function longDateOrRange(asOf: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? new Date(`${asOf}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : asOf;
}

/**
 * "How this was built": the sources, dates, method, assumptions and evidence level behind a
 * screen, so nothing Hamilton shows is a black box. `open` renders it expanded (deliverables).
 */
export function AuditPanel({
  trail,
  downloadHref,
  open = false,
}: {
  trail: AuditTrail;
  downloadHref?: string | null;
  open?: boolean;
}) {
  return (
    <details open={open} className="group rounded-lg border border-warm-300 bg-warm-50 text-sm text-warm-800 print:border-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3">
        <span className="text-base text-warm-900" style={SERIF}>
          How this was built
        </span>
        <span className="flex items-center gap-3 text-xs text-warm-600">
          <span className="rounded-full border border-warm-300 px-2 py-0.5 text-warm-700">{trail.evidence}</span>
          <span>{trail.sources.length} sources</span>
          <span aria-hidden className="print:hidden group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-warm-200 px-5 py-4">
        {trail.peerGroup ? (
          <p>
            <span className="font-medium text-warm-900">Peer group:</span> {trail.peerGroup.label},{" "}
            {trail.peerGroup.n.toLocaleString("en-US")} {trail.peerGroup.n === 1 ? "institution" : "institutions"}.
          </p>
        ) : null}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Sources</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {trail.sources.map((s) => (
              <li key={s.label} className="grid gap-x-4 sm:grid-cols-[12rem_1fr_9rem]">
                <span className="font-medium text-warm-900">
                  {s.href ? (
                    <a href={s.href} target="_blank" rel="noreferrer" className="underline decoration-warm-400">
                      {s.label}
                    </a>
                  ) : (
                    s.label
                  )}
                </span>
                <span className="text-warm-700">{s.detail}</span>
                <span className="text-warm-600 sm:text-right">{s.asOf ? `As of ${longDateOrRange(s.asOf)}` : "Date not recorded"}</span>
              </li>
            ))}
          </ul>
          {downloadHref ? (
            <a href={downloadHref} className="mt-3 inline-block text-terra-text underline print:hidden">
              Download every institution behind this comparison (CSV)
            </a>
          ) : null}
        </div>
        {trail.ownFeeRows.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Research institution published fee lines</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {trail.ownFeeRows.map((r, i) => (
                <li key={`${r.id}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                  <span className="min-w-0">
                    {r.feeName}: {fmtMoney(r.amount)}
                  </span>
                  <span className="text-warm-600">
                    {r.publishedAt ? `Published ${longDateOrRange(r.publishedAt.slice(0, 10))}` : "Publish date not recorded"}
                    {r.verifiedByEventId ? <span title={`Verification record ${r.verifiedByEventId}`}> · Verified against the schedule</span> : null}
                    {r.documentUrl || r.sourceUrl ? (
                      <>
                        {" · "}
                        <a href={r.documentUrl || r.sourceUrl || undefined} target="_blank" rel="noreferrer" className="text-terra-text underline">
                          Published schedule
                        </a>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {trail.clientFacts.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Figures you gave Hamilton</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {trail.clientFacts.map((f) => (
                <li key={f.label} className="flex flex-wrap justify-between gap-x-3">
                  <span className="min-w-0">
                    {f.label}: {f.value}
                  </span>
                  <span className="text-warm-600">
                    Entered by {f.givenBy ?? "someone not recorded"},{" "}
                    {new Date(f.givenAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Method</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {trail.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
        {trail.assumptions.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-warm-600">Assumptions</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {trail.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-warm-600">
          Prepared {new Date(trail.preparedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
          by Hamilton engine {trail.engineVersion}.
          Hamilton doesn&apos;t recommend a price; it shows the evidence.
        </p>
      </div>
    </details>
  );
}
