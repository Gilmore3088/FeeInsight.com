"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { buildHistogram, type HistogramBin } from "@/components/public/distribution-chart";
import { MARKET_ROW_GRID, MarketRowBody, marketScale, money } from "../../../fees/[category]/exhibits";
import type { BoardFee } from "./state-view";

/**
 * The state page's one interactive exhibit. A fee picked anywhere on the page (a finding, a
 * row of the board, a row of the banks and credit unions list) redraws the chart for it; on
 * the chart, banks or credit unions redraw the bars, and a tapped bar counts who charges that much.
 */

type Charter = 0 | 1 | 2;

interface BoardState {
  fees: BoardFee[];
  stateName: string;
  fee: BoardFee;
  charter: Charter;
  bin: number | null;
  pickFee: (key: string) => void;
  setCharter: (c: Charter) => void;
  setBin: (i: number | null) => void;
  chartRef: RefObject<HTMLDivElement | null>;
}

const BoardContext = createContext<BoardState | null>(null);

function useBoard(): BoardState {
  const state = useContext(BoardContext);
  if (!state) throw new Error("State board parts must sit inside StateBoard");
  return state;
}

const COUNT = new Intl.NumberFormat("en-US");

export function StateBoard({ fees, stateName, children }: { fees: BoardFee[]; stateName: string; children: ReactNode }) {
  const [feeKey, setFeeKey] = useState(fees[0]?.key ?? "");
  const [charter, setCharterState] = useState<Charter>(0);
  const [bin, setBin] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const fee = fees.find((f) => f.key === feeKey) ?? fees[0];

  const pickFee = useCallback((key: string) => {
    setFeeKey(key);
    setBin(null);
    // A fee picked far from the chart brings the chart into view, so the change is seen.
    const chart = chartRef.current;
    if (!chart) return;
    const { top, bottom } = chart.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      chart.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, []);
  const setCharter = useCallback((c: Charter) => {
    setCharterState(c);
    setBin(null);
  }, []);

  const value = useMemo(
    () => (fee ? { fees, stateName, fee, charter, bin, pickFee, setCharter, setBin, chartRef } : null),
    [fees, stateName, fee, charter, bin, pickFee, setCharter],
  );
  if (!value) return <>{children}</>;
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

/** The bin a value falls in, by the same edges buildHistogram counts with. */
function binIndexer(bins: HistogramBin[]): (v: number) => number {
  if (bins.length === 0) return () => -1;
  const width = (bins[0].high ?? bins[0].low + 1) - bins[0].low;
  return (v: number) => Math.min(Math.floor(v / width), bins.length - 1);
}

function rangeLabel(bin: HistogramBin): string {
  if (bin.high === null) return `${money(bin.low)} or more`;
  return `${money(bin.low)} to ${money(bin.high - 0.01)}`;
}

/** Who the bars count: "New York institutions", "New York banks", "New York credit unions". */
function charterWord(charter: Charter, stateName: string): string {
  if (charter === 1) return `${stateName} banks`;
  if (charter === 2) return `${stateName} credit unions`;
  return `${stateName} institutions`;
}

const CHARTERS: { c: Charter; label: string }[] = [
  { c: 0, label: "All" },
  { c: 1, label: "Banks" },
  { c: 2, label: "Credit unions" },
];

/** The picked fee's spread in the state, drawn over where the middle half of the U.S. sits. */
export function BoardChart() {
  const { fee, stateName, charter, bin, setCharter, setBin, chartRef } = useBoard();
  const bins = useMemo(() => buildHistogram(fee.values.map(([v]) => v), 12), [fee]);
  const binOf = useMemo(() => binIndexer(bins), [bins]);
  const counts = useMemo(() => {
    const c = bins.map(() => 0);
    for (const [v, ch] of fee.values) if (charter === 0 || ch === charter) c[binOf(v)]++;
    return c;
  }, [fee, bins, binOf, charter]);

  const shownCount = charter === 0 ? fee.institutions : charter === 1 ? fee.bank.institutions : fee.cu.institutions;
  const shownMedian = charter === 0 ? fee.median : charter === 1 ? fee.bank.median : fee.cu.median;
  const top = Math.max(...counts, 1);
  const width = bins.length > 0 ? (bins[0].high ?? 1) - bins[0].low : 1;
  const closed = bins.filter((b) => b.high !== null).length;
  const x = (v: number) => {
    if (bins.length === 0) return 0;
    const at = v >= closed * width && closed < bins.length ? closed + 0.5 : Math.min(v / width, bins.length);
    return Math.max(0, Math.min(100, (at / bins.length) * 100));
  };
  const labelEvery = Math.ceil(bins.length / 6);
  const picked = bin !== null ? bins[bin] : null;
  const who = charterWord(charter, stateName);

  return (
    <div ref={chartRef} className="scroll-mt-20 rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-ink">{fee.name}</h3>
        <div role="group" aria-label="Institutions shown" className="inline-flex rounded-full bg-paper p-0.5 ring-1 ring-border">
          {CHARTERS.map(({ c, label }) => {
            const n = c === 0 ? fee.institutions : c === 1 ? fee.bank.institutions : fee.cu.institutions;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={charter === c}
                disabled={n === 0}
                onClick={() => setCharter(c)}
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
                  charter === c ? "bg-ink text-on-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {label} <span className="font-mono tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 min-h-[3.25rem]" aria-live="polite">
        {picked && bin !== null ? (
          <>
            <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">
              {COUNT.format(counts[bin])} institutions
            </p>
            <p className="text-[13px] text-ink-muted">
              charge {rangeLabel(picked)}: {shownCount ? Math.round((counts[bin] / shownCount) * 100) : 0}% of{" "}
              {COUNT.format(shownCount)} {who}
            </p>
          </>
        ) : shownMedian != null ? (
          <>
            <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">{money(shownMedian)}</p>
            <p className="text-[13px] text-ink-muted">
              Median of {COUNT.format(shownCount)} {who}
              {fee.us ? `. U.S. ${money(fee.us.median)}.` : "."}
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">{COUNT.format(shownCount)} institutions</p>
            <p className="text-[13px] text-ink-muted">Too few {charter === 1 ? "banks" : "credit unions"} for a median yet.</p>
          </>
        )}
      </div>

      <div className="relative mt-4 h-40 sm:h-52">
        {fee.us && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 rounded-sm bg-ink/[0.07]"
            style={{ left: `${x(fee.us.p25)}%`, width: `${Math.max(x(fee.us.p75) - x(fee.us.p25), 0.8)}%` }}
          />
        )}
        <div className="absolute inset-0 flex items-end gap-[3px]" role="group" aria-label={`${fee.name}: ${who} by fee amount`}>
          {bins.map((b, i) => {
            const pressed = bin === i;
            return (
              <button
                key={b.low}
                type="button"
                aria-pressed={pressed}
                aria-label={`${rangeLabel(b)}: ${COUNT.format(counts[i])} institutions`}
                onClick={() => setBin(pressed ? null : i)}
                className="group relative flex h-full min-w-0 flex-1 items-end focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <span
                  className={`block w-full rounded-t-[3px] transition-colors ${
                    pressed ? "bg-ink" : bin !== null ? "bg-brick-tint" : "bg-brick group-hover:bg-brick-ink"
                  }`}
                  style={{ height: `${counts[i] > 0 ? Math.max((counts[i] / top) * 100, 2) : 0}%` }}
                />
              </button>
            );
          })}
        </div>
        {fee.us && (
          <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-ink" style={{ left: `${x(fee.us.median)}%` }} aria-hidden="true">
            <span className="absolute -top-1 left-1.5 whitespace-nowrap rounded bg-surface-0/90 px-1 text-[12px] font-semibold text-ink">
              U.S. {money(fee.us.median)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1 flex gap-[3px] text-[11px] text-ink-muted" aria-hidden="true">
        {bins.map((b, i) => (
          <span key={b.low} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 && b.high !== null ? money(b.low) : ""}
          </span>
        ))}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-2 rounded-t-[2px] bg-brick" />
          {who}
        </span>
        {fee.us && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-4 rounded-sm bg-ink/[0.12]" />
            U.S. middle half
          </span>
        )}
        <span>Tap a bar to count it.</span>
      </p>
    </div>
  );
}

/** The fee list: each fee's state median as a dot on its own U.S. middle half. Tapping one draws it above. */
export function BoardRows({ fees, ariaLabel }: { fees: BoardFee[]; ariaLabel: string }) {
  const { fee: current, pickFee } = useBoard();
  return (
    <ol aria-label={ariaLabel} className="divide-y divide-border">
      {fees.map((f) => {
        const pressed = f.key === current.key;
        const dot = { key: f.key, label: f.name, median: f.median, institutions: f.institutions, position: f.position ?? "within" };
        const band = f.us ? { min: 0, max: 0, institutions: 0, ...f.us } : null;
        return (
          <li key={f.key}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => pickFee(f.key)}
              className={`${MARKET_ROW_GRID} -mx-2 w-[calc(100%+1rem)] rounded-lg px-2 text-left transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-ink ${
                pressed ? "bg-paper ring-1 ring-ink/30" : ""
              }`}
            >
              {band ? (
                <MarketRowBody dot={dot} band={band} pct={marketScale([dot], band)} figure={money(f.median)} />
              ) : (
                <>
                  <span className="min-w-0 leading-tight text-ink">
                    {f.name}
                    <span className="block text-[11px] text-ink-muted">{COUNT.format(f.institutions)} institutions</span>
                  </span>
                  <span className="text-[12px] text-ink-muted">No U.S. median</span>
                  <span className="text-right font-mono text-[14px] font-semibold tabular-nums text-ink">{money(f.median)}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Banks and credit unions side by side for each fee, on the fee's own scale. */
export function CharterRows({ fees }: { fees: BoardFee[] }) {
  const { fee: current, pickFee } = useBoard();
  return (
    <ol aria-label="Bank and credit union medians by fee" className="divide-y divide-border">
      {fees.map((f) => {
        const bank = f.bank.median!;
        const cu = f.cu.median!;
        const lo = Math.min(bank, cu);
        const hi = Math.max(bank, cu);
        const pad = (hi - lo || hi || 1) * 0.35;
        const at = (v: number) => `${((v - Math.max(0, lo - pad)) / (hi + pad - Math.max(0, lo - pad))) * 100}%`;
        const pressed = f.key === current.key;
        return (
          <li key={f.key}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => pickFee(f.key)}
              aria-label={`${f.name}: banks ${money(bank)}, credit unions ${money(cu)}`}
              className={`grid w-[calc(100%+1rem)] -mx-2 grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-ink sm:grid-cols-[10rem_minmax(0,1fr)_7rem] ${
                pressed ? "bg-paper ring-1 ring-ink/30" : ""
              }`}
            >
              <span className="min-w-0 leading-tight text-ink">{f.name}</span>
              <span className="relative h-5" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                <span
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/20"
                  style={{ left: at(lo), width: `calc(${at(hi)} - ${at(lo)})` }}
                />
                <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface-0" style={{ left: at(bank) }} />
                <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brick ring-2 ring-surface-0" style={{ left: at(cu) }} />
              </span>
              <span className="text-right font-mono text-[13px] tabular-nums leading-tight text-ink">
                {money(bank)}
                <span className="text-ink-muted"> · </span>
                <span className="text-brick">{money(cu)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The lead findings; one about a fee draws that fee on the chart when tapped. */
export function FindingButtons({ findings }: { findings: { key: string; figure: string; headline: string; fee: string | null }[] }) {
  const { pickFee } = useBoard();
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {findings.map((f) => {
        const body = (
          <>
            <span className="block font-mono text-[26px] font-semibold leading-none tabular-nums text-ink">{f.figure}</span>
            <span className="mt-1.5 block text-[14px] leading-snug text-ink">{f.headline}</span>
          </>
        );
        return (
          <li key={f.key}>
            {f.fee ? (
              <button
                type="button"
                onClick={() => pickFee(f.fee!)}
                className="block h-full w-full rounded-xl border border-border bg-surface-0 p-4 text-left transition-colors hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-ink"
              >
                {body}
              </button>
            ) : (
              <div className="h-full rounded-xl border border-border bg-surface-0 p-4">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
