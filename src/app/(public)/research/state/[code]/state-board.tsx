"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { buildHistogram, type HistogramBin } from "@/components/public/distribution-chart";
import { DotLegend, MARKET_ROW_GRID, MarketRowBody, marketScale, money } from "../../../fees/[category]/exhibits";
import { bandFor, positionIn, type Against, type BoardFee, type LeadFinding } from "./state-view";

/**
 * The state page's one interactive exhibit. A fee picked anywhere on the page (a finding, a
 * row of the board, a row of the banks and credit unions list) redraws the chart for it; on
 * the chart, banks or credit unions redraw the bars, and a tapped bar counts who charges that much.
 * Everything is read against the U.S. or, at a tap, the state's own Fed district.
 */

type Charter = 0 | 1 | 2;

interface BoardState {
  fees: BoardFee[];
  stateName: string;
  /** "Dallas Fed district", or null when the district has no medians to compare. */
  districtName: string | null;
  against: Against;
  setAgainst: (a: Against) => void;
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

const POSITION_WORD = { below: "below", within: "within", above: "above" } as const;

export function StateBoard({
  fees,
  stateName,
  districtName = null,
  children,
}: {
  fees: BoardFee[];
  stateName: string;
  districtName?: string | null;
  children: ReactNode;
}) {
  const [feeKey, setFeeKey] = useState(fees[0]?.key ?? "");
  const [against, setAgainstState] = useState<Against>("us");
  const [charter, setCharterState] = useState<Charter>(0);
  const [bin, setBin] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const fee = fees.find((f) => f.key === feeKey) ?? fees[0];

  const pickFee = useCallback((key: string) => {
    setFeeKey(key);
    setBin(null);
    // A fee with no banks (or no credit unions) opens on everyone rather than an empty chart.
    const next = fees.find((f) => f.key === key);
    setCharterState((c) => (next && ((c === 1 && next.bank.institutions === 0) || (c === 2 && next.cu.institutions === 0)) ? 0 : c));
    // A fee picked far from the chart brings the chart into view, so the change is seen.
    const chart = chartRef.current;
    if (!chart) return;
    const { top, bottom } = chart.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      chart.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, [fees]);
  const setCharter = useCallback((c: Charter) => {
    setCharterState(c);
    setBin(null);
  }, []);

  const setAgainst = useCallback((a: Against) => setAgainstState(districtName ? a : "us"), [districtName]);

  const value = useMemo(
    () =>
      fee
        ? { fees, stateName, districtName, against, setAgainst, fee, charter, bin, pickFee, setCharter, setBin, chartRef }
        : null,
    [fees, stateName, districtName, against, setAgainst, fee, charter, bin, pickFee, setCharter],
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

/** "the U.S." or "the Dallas Fed district", as the board's sentences name it. */
function againstName(against: Against, districtName: string | null): string {
  return against === "district" && districtName ? `the ${districtName}` : "the U.S.";
}

/** The short label on the chart's line and legend: "U.S." or "District". */
function againstShort(against: Against): string {
  return against === "district" ? "District" : "U.S.";
}

/** The board's heading names what the state is read against, and the switch beside it changes that. */
export function BoardHeading({ id }: { id: string }) {
  const { stateName, districtName, against, setAgainst } = useBoard();
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <h2 id={id} className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
        {stateName} against {againstName(against, districtName)}
      </h2>
      {districtName && (
        <div role="group" aria-label="Compare with" className="inline-flex rounded-full bg-paper p-0.5 ring-1 ring-border print:hidden">
          {(
            [
              ["us", "U.S."],
              ["district", districtName],
            ] as const
          ).map(([a, label]) => (
            <button
              key={a}
              type="button"
              aria-pressed={against === a}
              onClick={() => setAgainst(a)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                against === a ? "bg-ink text-on-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The fee list's key, for whichever comparison is showing. */
export function BoardLegend({ fees }: { fees: BoardFee[] }) {
  const { against } = useBoard();
  const positions = (["below", "within", "above"] as const).filter((p) =>
    fees.some((f) => {
      const band = bandFor(f, against);
      return band && positionIn(f.median, band) === p;
    }),
  );
  return <DotLegend positions={[...positions]} against={againstShort(against)} />;
}

/** The picked fee's spread in the state, drawn over where the middle half of the U.S. (or district) sits. */
export function BoardChart() {
  const { fee, stateName, districtName, against, charter, bin, setCharter, setBin, chartRef } = useBoard();
  const ref = bandFor(fee, against);
  const refShort = againstShort(against);
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
  const noun = charter === 1 ? "banks" : charter === 2 ? "credit unions" : "institutions";
  const refAt = ref ? x(ref.median) : 0;

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
              {COUNT.format(counts[bin])} {noun}
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
              Median of {COUNT.format(shownCount)} {who}.{" "}
              {ref
                ? `${against === "district" && districtName ? districtName : "U.S."} ${money(ref.median)}.`
                : against === "district"
                  ? "Too few district institutions for a median yet."
                  : ""}
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-[22px] font-semibold tabular-nums leading-tight text-ink">{COUNT.format(shownCount)} institutions</p>
            <p className="text-[13px] text-ink-muted">Too few {charter === 1 ? "banks" : "credit unions"} for a median yet.</p>
          </>
        )}
      </div>

      {/* The top strip holds the comparison median's label, so it never sits on a bar. */}
      <div className="relative mt-3 h-44 sm:h-56">
        <div className="absolute inset-x-0 bottom-0 top-6 flex items-end gap-[3px]" role="group" aria-label={`${fee.name}: ${who} by fee amount`}>
          {bins.map((b, i) => {
            const pressed = bin === i;
            return (
              <button
                key={b.low}
                type="button"
                aria-pressed={pressed}
                aria-label={`${rangeLabel(b)}: ${COUNT.format(counts[i])} ${noun}`}
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
        {ref && (
          <div className="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-ink" style={{ left: `${refAt}%` }} aria-hidden="true">
            {/* The label sits on the open side of the line, so it never runs past the card. */}
            <span
              className={`absolute top-0 ${refAt > 60 ? "right-1.5" : "left-1.5"} whitespace-nowrap px-1 text-[12px] font-semibold leading-5 text-ink`}
            >
              {refShort} {money(ref.median)}
            </span>
          </div>
        )}
      </div>
      {ref && (
        // The comparison's middle half as the same pink band the fee list below uses, on the chart's own axis.
        <div className="relative mt-1.5 h-3" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 border-t border-border" />
          <span
            className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-brick-tint"
            style={{ left: `${x(ref.p25)}%`, width: `${Math.max(x(ref.p75) - x(ref.p25), 1)}%` }}
          />
          <span className="absolute top-0 h-3 w-[2px] bg-ink/60" style={{ left: `${refAt}%` }} />
        </div>
      )}
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
        {ref && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-5 rounded-full bg-brick-tint" />
            {refShort} middle range
          </span>
        )}
        <span>Tap a bar to count it.</span>
      </p>
    </div>
  );
}

/**
 * The fee list: each fee's state median as a dot on its own U.S. (or district) middle half.
 * Tapping one draws it above.
 */
export function BoardRows({ fees, ariaLabel, limit }: { fees: BoardFee[]; ariaLabel: string; limit?: number }) {
  const { fee: current, pickFee, against } = useBoard();
  const [expanded, setExpanded] = useState(false);
  const refShort = againstShort(against);
  const cut = limit != null && !expanded && fees.length > limit;
  const listed = cut ? fees.slice(0, limit) : fees;
  return (
    <>
      <ol aria-label={ariaLabel} className="divide-y divide-border">
        {listed.map((f) => {
          const pressed = f.key === current.key;
          const ref = bandFor(f, against);
          const position = ref ? positionIn(f.median, ref) : null;
          const dot = { key: f.key, label: f.name, median: f.median, institutions: f.institutions, position: position ?? "within" };
          const band = ref ? { min: 0, max: 0, institutions: 0, p25: ref.p25, median: ref.median, p75: ref.p75 } : null;
          return (
            <li key={f.key}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => pickFee(f.key)}
                aria-label={`${f.name}: ${money(f.median)} across ${COUNT.format(f.institutions)} institutions${
                  ref && position
                    ? `, ${POSITION_WORD[position]} the ${refShort === "U.S." ? "U.S." : "district"} middle range; ${refShort === "U.S." ? "U.S." : "district"} median ${money(ref.median)}`
                    : ""
                }`}
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
                    <span className="text-[12px] text-ink-muted">No {refShort === "U.S." ? "U.S." : "district"} median</span>
                    <span className="text-right font-mono text-[14px] font-semibold tabular-nums text-ink">{money(f.median)}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {cut && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          Show all {COUNT.format(fees.length)} fees
        </button>
      )}
    </>
  );
}

/** Widest gap the bank and credit union rows draw, in percent; wider gaps sit at the edge. */
const CHARTER_AXIS_PCT = 60;

/**
 * Banks and credit unions for each fee on one shared axis: the bank median on the centre line,
 * the credit union dot at its percent difference, so a wide gap looks wide on every row.
 */
export function CharterRows({ fees }: { fees: BoardFee[] }) {
  const { fee: current, pickFee } = useBoard();
  return (
    <ol aria-label="Bank and credit union medians by fee" className="divide-y divide-border">
      {fees.map((f) => {
        const bank = f.bank.median!;
        const cu = f.cu.median!;
        const gap = bank > 0 ? ((cu - bank) / bank) * 100 : cu > 0 ? CHARTER_AXIS_PCT : 0;
        const at = 50 + (Math.max(-CHARTER_AXIS_PCT, Math.min(CHARTER_AXIS_PCT, gap)) / CHARTER_AXIS_PCT) * 50;
        const rounded = Math.round(gap);
        const pressed = f.key === current.key;
        return (
          <li key={f.key}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => pickFee(f.key)}
              aria-label={`${f.name}: banks ${money(bank)} across ${f.bank.institutions}, credit unions ${money(cu)} across ${f.cu.institutions}`}
              className={`grid w-[calc(100%+1rem)] -mx-2 grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-ink sm:grid-cols-[10rem_minmax(0,1fr)_4.5rem] ${
                pressed ? "bg-paper ring-1 ring-ink/30" : ""
              }`}
            >
              <span className="min-w-0 leading-tight text-ink">
                {f.name}
                <span className="block text-[11px] text-ink-muted">
                  {rounded === 0 ? (cu === bank ? "Same" : "Under 1% apart") : `Credit unions ${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`}
                </span>
              </span>
              <span className="relative h-5" aria-hidden="true">
                <span className="absolute inset-x-0 top-1/2 border-t border-border" />
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <span
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/20"
                  style={{ left: `${Math.min(50, at)}%`, width: `${Math.abs(at - 50)}%` }}
                />
                <span className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface-0" />
                <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brick ring-2 ring-surface-0" style={{ left: `${at}%` }} />
              </span>
              <span className="text-right font-mono text-[13px] tabular-nums leading-tight">
                <span className="block text-ink">{money(bank)}</span>
                <span className="block text-brick">{money(cu)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The lead findings; one about a fee draws that fee on the chart when tapped. */
export function FindingButtons({ findings }: { findings: LeadFinding[] }) {
  const { pickFee } = useBoard();
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {findings.map((f) => {
        const body = (
          <>
            <span className="block font-mono text-[26px] font-semibold leading-none tabular-nums text-ink">{f.figure}</span>
            <span className="mt-1.5 block text-[14px] leading-snug text-ink">{f.headline}</span>
            {f.note && <span className="mt-1 block font-mono text-[12px] tabular-nums text-ink-muted">{f.note}</span>}
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
