/**
 * The "living memo" building blocks for Hamilton's Briefing, Research, Model and Plan screens,
 * in the Fee Insight brand: warm parchment, Newsreader display type, terracotta accent,
 * numbered exhibits with their source under each. Server components only.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { priceBands } from "@/lib/hamilton/fee-scenario";

export const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

export function MemoPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-5xl flex-col gap-8 text-warm-800">{children}</div>;
}

export function MemoHeader({
  kicker,
  title,
  dek,
  actions,
}: {
  kicker: string;
  title: string;
  dek?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-warm-300 pb-5">
      <div className="min-w-0 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terra-text">{kicker}</p>
        <h1 className="mt-1.5 text-3xl leading-tight text-warm-900 sm:text-4xl" style={SERIF}>
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
          ? "rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white no-underline hover:bg-terra-dark"
          : "rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 no-underline hover:border-warm-500"
      }
    >
      {children}
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
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={
            "rounded-md border px-3 py-1.5 text-sm no-underline " +
            (t.active
              ? "border-warm-900 bg-warm-900 text-warm-ink-50"
              : "border-warm-300 bg-warm-50 text-warm-700 hover:border-warm-500")
          }
        >
          {t.label}
          {t.meta ? <span className={t.active ? "ml-1.5 text-warm-ink-300" : "ml-1.5 text-warm-600"}>{t.meta}</span> : null}
        </Link>
      ))}
    </nav>
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
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
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
                  {mine ? "You" : "Tested"}
                </span>
              ) : null}
            </span>
            <span role="cell" className="text-right tabular-nums text-warm-700">
              {b.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border-l-2 border-terra bg-terra-soft px-4 py-3 text-sm leading-relaxed text-warm-800">
      {children}
    </div>
  );
}
