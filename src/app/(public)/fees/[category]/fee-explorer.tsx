"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { buildHistogram, type HistogramBin } from "@/components/public/distribution-chart";
import type { MarketDot, NationalBand } from "./category-view";
import { MARKET_ROW_GRID, MarketRowBody, marketScale, money } from "./exhibits";

/**
 * The page's one interactive exhibit. Tapping a bar of the distribution shows how many
 * institutions are counted in that range and, in every market list, what share of that market does.
 * Tapping a market (a district, banks or credit unions, and for Pro a size group or state)
 * redraws the distribution for that market over the national one.
 */

export type MarketDim = "district" | "charter" | "tier" | "state";

/**
 * One institution's value and the markets it sits in, in short keys because every
 * institution is sent to the page: d is the Fed district number, c is "b" (bank) or "c"
 * (credit union). Size group (t) and state (s) are sent only to Pro.
 */
export interface ExplorerPoint {
  v: number;
  d: number | null;
  c: "b" | "c" | null;
  t?: string | null;
  s?: string | null;
}

type Selection =
  | null
  | { kind: "bin"; index: number }
  | { kind: "market"; dim: MarketDim; key: string; label: string; median: number };

interface ExplorerState {
  points: ExplorerPoint[];
  bins: HistogramBin[];
  binOf: (v: number) => number;
  selection: Selection;
  select: (next: Selection) => void;
  chartRef: RefObject<HTMLDivElement | null>;
}

const ExplorerContext = createContext<ExplorerState | null>(null);

function useExplorer(): ExplorerState {
  const state = useContext(ExplorerContext);
  if (!state) throw new Error("Fee explorer parts must sit inside FeeExplorer");
  return state;
}

const COUNT = new Intl.NumberFormat("en-US");

/** The bin a value falls in, by the same edges buildHistogram counts with. */
function binIndexer(bins: HistogramBin[]): (v: number) => number {
  if (bins.length === 0) return () => -1;
  const width = (bins[0].high ?? bins[0].low + 1) - bins[0].low;
  // Values past the closed bins all land in the last one (the open "and up" bin when there is one).
  return (v: number) => Math.min(Math.floor(v / width), bins.length - 1);
}

function rangeLabel(bin: HistogramBin): string {
  if (bin.high === null) return `${money(bin.low)} or more`;
  return `${money(bin.low)} to ${money(bin.high - 0.01)}`;
}

/** A market's name inside a sentence: "credit unions", "institutions with under $300M in assets". */
function inSentence(dim: MarketDim, label: string): string {
  if (dim === "charter") return label.toLowerCase();
  if (dim === "tier") return `institutions with ${label.charAt(0).toLowerCase()}${label.slice(1)} in assets`;
  return label;
}

/** The point's market, keyed the way the market lists key their rows ("District 3", "Bank"). */
function marketOf(point: ExplorerPoint, dim: MarketDim): string | null | undefined {
  if (dim === "district") return point.d === null ? null : `District ${point.d}`;
  if (dim === "charter") return point.c === "b" ? "Bank" : point.c === "c" ? "Credit Union" : null;
  return dim === "tier" ? point.t : point.s;
}

export function FeeExplorer({ points, children }: { points: ExplorerPoint[]; children: ReactNode }) {
  const [selection, setSelection] = useState<Selection>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const bins = useMemo(() => buildHistogram(points.map((p) => p.v)), [points]);
  const binOf = useMemo(() => binIndexer(bins), [bins]);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    // A market tapped far below the chart brings the chart back into view, so the change is seen.
    const chart = chartRef.current;
    if (next?.kind === "market" && chart && chart.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      chart.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, []);

  const value = useMemo(() => ({ points, bins, binOf, selection, select, chartRef }), [points, bins, binOf, selection, select]);
  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>;
}

/** The distribution as tappable bars, with a readout of whatever is selected above it. */
export function ExplorerChart({ median, measure }: { median: number | null; measure: string }) {
  const { points, bins, binOf, selection, select, chartRef } = useExplorer();

  const market = selection?.kind === "market" ? selection : null;
  const marketCounts = useMemo(() => {
    if (!market) return null;
    const counts = bins.map(() => 0);
    let total = 0;
    for (const p of points) {
      if (marketOf(p, market.dim) !== market.key) continue;
      counts[binOf(p.v)]++;
      total++;
    }
    return { counts, total };
  }, [market, points, bins, binOf]);

  const total = points.length;
  // Shares, not counts, so a market of 97 institutions reads against the nation's 2,498.
  const nationShare = bins.map((b) => b.count / total);
  const marketShare = marketCounts ? marketCounts.counts.map((c) => (marketCounts.total ? c / marketCounts.total : 0)) : null;
  const top = Math.max(...nationShare, ...(marketShare ?? [0]), 0.0001);
  const shownMedian = market ? market.median : median;
  const medianLeft = (() => {
    if (shownMedian === null || bins.length === 0) return null;
    const i = binOf(shownMedian);
    const bin = bins[i];
    const frac = bin.high === null ? 0.5 : (shownMedian - bin.low) / (bin.high - bin.low);
    return ((i + frac) / bins.length) * 100;
  })();
  const labelEvery = Math.ceil(bins.length / 6);
  const overflow = bins.find((b) => b.high === null) ?? null;
  const selectedBin = selection?.kind === "bin" ? bins[selection.index] : null;

  return (
    <div ref={chartRef} className="scroll-mt-20 rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
      <div className="flex min-h-[3.25rem] items-start justify-between gap-3" aria-live="polite">
        <div className="min-w-0">
          {selectedBin && selection?.kind === "bin" ? (
            <>
              <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">
                {COUNT.format(selectedBin.count)} institutions
              </p>
              <p className="text-[13px] text-ink-muted">
                with a {measure} of {rangeLabel(selectedBin)}, {Math.round((selectedBin.count / total) * 100)}% of all
              </p>
            </>
          ) : market && marketCounts ? (
            <>
              <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">{money(market.median)}</p>
              <p className="text-[13px] text-ink-muted">
                {market.label}: the median of {COUNT.format(marketCounts.total)} institutions, drawn over the U.S.
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">{COUNT.format(total)} institutions</p>
              <p className="text-[13px] text-ink-muted">Tap a bar, or a market below, to explore.</p>
            </>
          )}
        </div>
        {selection && (
          <button
            type="button"
            onClick={() => select(null)}
            className="shrink-0 rounded-full border border-border px-3 py-1 text-[12px] font-semibold text-ink hover:border-ink/40"
          >
            Show all
          </button>
        )}
      </div>

      <div className="relative mt-4 h-44 sm:h-56">
        <div className="absolute inset-0 flex items-end gap-[3px]" role="group" aria-label="Institutions by fee amount">
          {bins.map((bin, i) => {
            const pressed = selection?.kind === "bin" && selection.index === i;
            const dim = (selection?.kind === "bin" && !pressed) || market !== null;
            return (
              <button
                key={bin.low}
                type="button"
                aria-pressed={pressed}
                aria-label={`${rangeLabel(bin)}: ${COUNT.format(bin.count)} institutions`}
                onClick={() => select(pressed ? null : { kind: "bin", index: i })}
                className="group relative flex h-full min-w-0 flex-1 items-end focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <span
                  className={`block w-full rounded-t-[3px] transition-colors ${
                    pressed ? "bg-ink" : dim ? "bg-brick-tint" : "bg-brick group-hover:bg-brick-ink"
                  }`}
                  style={{ height: `${Math.max((nationShare[i] / top) * 100, bin.count > 0 ? 1.5 : 0)}%` }}
                />
                {marketShare && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-[18%] bottom-0 rounded-t-[3px] bg-brick"
                    style={{ height: `${(marketShare[i] / top) * 100}%` }}
                  />
                )}
              </button>
            );
          })}
        </div>
        {medianLeft !== null && (
          <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-ink" style={{ left: `${medianLeft}%` }} aria-hidden="true">
            <span className="absolute -top-1 left-1.5 whitespace-nowrap rounded bg-surface-0/90 px-1 text-[12px] font-semibold text-ink">
              Median {money(shownMedian as number)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 flex gap-[3px] text-[11px] text-ink-muted" aria-hidden="true">
        {bins.map((bin, i) => (
          <span key={bin.low} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 && bin.high !== null ? money(bin.low) : ""}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-ink-muted">
        {market
          ? `Solid bars are ${inSentence(market.dim, market.label)}; pale bars are all ${COUNT.format(total)} U.S. institutions, each as a share of its own total.`
          : `Each bar counts the institutions whose ${measure} falls in that range; ${COUNT.format(total)} in all.`}
        {overflow ? ` The last bar is ${money(overflow.low)} and up.` : ""}
      </p>
    </div>
  );
}

/**
 * A market list whose rows are buttons. Tapping one redraws the chart for it; with a price
 * range selected on the chart, each row shows the share of its institutions in that range.
 */
export function ExplorerMarkets({ dots, band, dim, ariaLabel }: { dots: MarketDot[]; band: NationalBand; dim: MarketDim; ariaLabel: string }) {
  const { points, binOf, selection, select } = useExplorer();
  const pct = marketScale(dots, band);
  const binIndex = selection?.kind === "bin" ? selection.index : null;

  const shares = useMemo(() => {
    if (binIndex === null) return null;
    const inBin = new Map<string, number>();
    const all = new Map<string, number>();
    for (const p of points) {
      const key = marketOf(p, dim);
      if (!key) continue;
      all.set(key, (all.get(key) ?? 0) + 1);
      if (binOf(p.v) === binIndex) inBin.set(key, (inBin.get(key) ?? 0) + 1);
    }
    return { inBin, all };
  }, [binIndex, points, dim, binOf]);

  return (
    <ol aria-label={ariaLabel} className="divide-y divide-border">
      {dots.map((d) => {
        const pressed = selection?.kind === "market" && selection.dim === dim && selection.key === d.key;
        const all = shares?.all.get(d.key) ?? 0;
        const share = shares && all > 0 ? `${Math.round(((shares.inBin.get(d.key) ?? 0) / all) * 100)}%` : null;
        return (
          <li key={d.key}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => select(pressed ? null : { kind: "market", dim, key: d.key, label: d.label, median: d.median })}
              className={`${MARKET_ROW_GRID} -mx-2 w-[calc(100%+1rem)] rounded-lg px-2 text-left transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-ink ${
                pressed ? "bg-paper ring-1 ring-ink/30" : ""
              }`}
            >
              <MarketRowBody
                dot={d}
                band={band}
                pct={pct}
                figure={share ?? money(d.median)}
                note={share ? "in range" : undefined}
              />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
