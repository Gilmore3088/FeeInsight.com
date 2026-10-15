"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import type { MarketLadderData } from "@/app/for-institutions/market-ladder";
import type { DistrictPoint, HomeData, RangeEntry, SampleRow, SampleView } from "./landing-shared";

/**
 * The homepage's interactive exhibits: the Fed district map, the sample bank's fees against
 * its market, Try a price and the market ladder. Every figure comes from HomeData (live
 * reads); nothing here is typed by hand. Colors are the --fi-viz-* tokens in globals.css.
 */

const money = (v: number) => `$${v.toFixed(2)}`;
const signed = (v: number) => (Math.abs(v) < 0.005 ? "at median" : `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`);
const top10 = (v: number) => Math.max(10, Math.ceil(v / 10) * 10);
const pct = (v: number, hi: number) => `${Math.max(0, Math.min(100, (v / hi) * 100))}%`;
const at = (ms: number) => ({ "--fi-d": `${ms}ms` }) as CSSProperties;
const COUNT = new Intl.NumberFormat("en-US");

/* ───────────────────────── District map ───────────────────────── */

/** Where each district's number sits on the 960x600 map (the middle of its states' boxes). */
const ANCHORS: Record<number, [number, number]> = {
  1: [884, 112],
  2: [808, 160],
  3: [764, 204],
  4: [676, 268],
  5: [768, 300],
  6: [664, 404],
  7: [604, 196],
  8: [548, 322],
  9: [394, 112],
  10: [360, 284],
  11: [404, 448],
  12: [156, 236],
};

const STATES_BY_DISTRICT = new Map<number, typeof US_STATES>();
for (const state of US_STATES) {
  const district = STATE_TO_DISTRICT[state.id];
  if (!district) continue;
  STATES_BY_DISTRICT.set(district, [...(STATES_BY_DISTRICT.get(district) ?? []), state]);
}
/** West to east, the order the districts fill in. */
const SWEEP = [...STATES_BY_DISTRICT.keys()].sort((a, b) => ANCHORS[a][0] - ANCHORS[b][0]);

const STEPS = 5;
const STEP_FILL = (step: number) => `var(--fi-viz-${step})`;
const NONE_FILL = "var(--fi-viz-none)";

type Metric = "median" | "institutions";
const METRICS: { key: Metric; label: string }[] = [
  { key: "median", label: "Median fee" },
  { key: "institutions", label: "Institutions" },
];

function metricOf(d: DistrictPoint, metric: Metric): number | null {
  return metric === "median" ? d.median : d.institutions > 0 ? d.institutions : null;
}

/** Equal steps from the lowest district to the highest; one value lands in the middle step. */
export function stepOf(value: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 3;
  return 1 + Math.min(STEPS - 1, Math.floor(((value - lo) / (hi - lo)) * STEPS));
}

/** The district a visitor sees first: the one with the highest median, else the first listed. */
export function firstDistrict(districts: DistrictPoint[]): number | null {
  const drawn = districts.filter((d) => d.median !== null);
  const pick = [...drawn].sort((a, b) => (b.median ?? 0) - (a.median ?? 0) || a.district - b.district)[0] ?? districts[0];
  return pick?.district ?? null;
}

/**
 * The hero exhibit: the 12 Fed districts, each state shaded by its district's overdraft
 * median (no read gives a median for every state, so the district carries it). Hover, click
 * or Enter on a district updates the panel; arrow keys move between districts.
 */
export function DistrictMap({ data }: { data: HomeData }) {
  const { districts, overdraft, summary } = data;
  const [selected, setSelected] = useState<number | null>(() => firstDistrict(districts));
  const [hovered, setHovered] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("median");
  const byNumber = new Map(districts.map((d) => [d.district, d]));
  const activeNumber = hovered ?? selected;
  const active = activeNumber !== null ? byNumber.get(activeNumber) ?? null : null;

  const values = districts.map((d) => metricOf(d, metric)).filter((v): v is number => v !== null);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 0;
  const fillOf = (n: number) => {
    const d = byNumber.get(n);
    const v = d ? metricOf(d, metric) : null;
    return v === null ? NONE_FILL : STEP_FILL(stepOf(v, lo, hi));
  };
  /** A district's map color, and a text color that reads on it (light and dark themes alike). */
  const swatchOf = (n: number) => {
    const d = byNumber.get(n);
    const v = d ? metricOf(d, metric) : null;
    const step = v === null ? 0 : stepOf(v, lo, hi);
    return { fill: fillOf(n), text: step >= 4 ? "var(--fi-surface-0)" : "var(--fi-ink)" };
  };
  const fmt = (v: number) => (metric === "median" ? money(v) : COUNT.format(v));
  const anyThin = districts.some((d) => metricOf(d, metric) === null) || SWEEP.some((n) => !byNumber.has(n));

  const order = SWEEP.filter((n) => byNumber.has(n));
  const onKey = (event: KeyboardEvent<SVGGElement>, n: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(n);
      return;
    }
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = order[(order.indexOf(n) + step + order.length) % order.length];
    const svg = event.currentTarget.ownerSVGElement;
    (svg?.querySelector(`[data-district="${next}"]`) as SVGGElement | null)?.focus();
    setSelected(next);
  };

  const label = (d: DistrictPoint | undefined, n: number) =>
    d
      ? `${d.name}, district ${n}: ${d.median !== null ? `overdraft median ${money(d.median)}` : "too few institutions for a median"}, ${COUNT.format(d.institutions)} institutions`
      : `District ${n}: no overdraft figures`;

  return (
    <div className="grid gap-5 p-4 sm:px-6 sm:pb-5 sm:pt-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-[13px] font-semibold text-ink">Overdraft by Fed district</p>
          <div role="radiogroup" aria-label="Shade the map by" className="inline-flex rounded-full border border-border bg-paper p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={`fi-map-cell rounded-full px-3 py-1 text-[12px] font-semibold ${
                  metric === m.key ? "bg-ink text-on-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <svg
          viewBox="0 20 960 570"
          className="mt-2 h-auto w-full"
          role="group"
          aria-label={`Map of the 12 Federal Reserve districts, shaded by ${metric === "median" ? "overdraft median" : "institutions"}`}
          data-district-map=""
        >
          {SWEEP.map((n, i) => {
            const d = byNumber.get(n);
            const states = STATES_BY_DISTRICT.get(n) ?? [];
            return (
              <g
                key={n}
                data-district={n}
                role="button"
                tabIndex={0}
                aria-label={label(d, n)}
                aria-pressed={selected === n}
                className="fi-map-district fi-a-sweep"
                style={at(80 + i * 70)}
                onClick={() => setSelected(n)}
                onKeyDown={(event) => onKey(event, n)}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(null)}
              >
                {states.map((st) => (
                  <path key={st.id} d={st.d} fill={fillOf(n)} stroke="var(--fi-surface-0)" strokeWidth={1} />
                ))}
              </g>
            );
          })}
          {activeNumber !== null ? (
            <g aria-hidden="true" pointerEvents="none">
              {(STATES_BY_DISTRICT.get(activeNumber) ?? []).map((st) => (
                <path key={st.id} d={st.d} fill="none" stroke="var(--fi-ink)" strokeWidth={2.25} strokeLinejoin="round" />
              ))}
            </g>
          ) : null}
          <g aria-hidden="true" pointerEvents="none">
            {SWEEP.map((n) => {
              const [x, y] = ANCHORS[n];
              const on = n === activeNumber;
              return (
                <g key={n} transform={`translate(${x} ${y})`}>
                  <circle r={13} fill={on ? "var(--fi-ink)" : "var(--fi-surface-0)"} stroke="var(--fi-ink)" strokeOpacity={on ? 1 : 0.25} />
                  <text textAnchor="middle" dy="0.35em" fontSize={13} fontWeight={600} fill={on ? "var(--fi-on-ink)" : "var(--fi-ink)"}>
                    {n}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted" data-map-legend="">
          {values.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums">{fmt(lo)}</span>
              <span className="flex overflow-hidden rounded-sm" aria-hidden="true">
                {Array.from({ length: STEPS }, (_, i) => (
                  <span key={i} className="h-2.5 w-6" style={{ background: STEP_FILL(i + 1) }} />
                ))}
              </span>
              <span className="tabular-nums">{fmt(hi)}</span>
              <span className="sr-only">{metric === "median" ? "Lower to higher overdraft median" : "Fewer to more institutions"}</span>
            </span>
          ) : null}
          {anyThin ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: NONE_FILL }} />
              Too few institutions
            </span>
          ) : null}
          <span>{summary.freshnessLabel}</span>
        </div>
      </div>
      <DistrictPanel district={active} number={activeNumber} districts={districts} national={overdraft} onPick={setSelected} swatchOf={swatchOf} />
    </div>
  );
}

/** The panel beside the map: the chosen district against the nation, and where all 12 sit. */
function DistrictPanel({
  district,
  number,
  districts,
  national,
  onPick,
  swatchOf,
}: {
  district: DistrictPoint | null;
  number: number | null;
  districts: DistrictPoint[];
  national: RangeEntry | null;
  onPick: (n: number) => void;
  swatchOf: (n: number) => { fill: string; text: string };
}) {
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null);
  const scaleHi = top10(Math.max(national?.median_amount ?? 0, ...drawn.map((d) => d.median)));
  return (
    <div className="flex min-w-0 flex-col" aria-live="polite" data-district-panel="">
      {district && number !== null ? (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">District {number}</p>
          <p className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink" data-panel-name="">
            {district.name}
          </p>
          {district.median !== null && national ? (
            <div className="mt-4 space-y-2.5" data-panel-bars="">
              {[
                { name: district.name, value: district.median, color: swatchOf(number).fill },
                { name: "Nation", value: national.median_amount, color: "var(--fi-viz-bar)" },
              ].map((row) => (
                <div key={row.name} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 text-[13px]">
                  <span className="truncate text-ink-soft">{row.name}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="block h-4 rounded-r-[4px] transition-[width] duration-500 ease-out motion-reduce:transition-none"
                      style={{ width: pct(row.value, scaleHi), background: row.color }}
                    />
                    <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-ink">{money(row.value)}</span>
                  </span>
                </div>
              ))}
              <p className="text-[13px] text-ink-muted" data-panel-gap="">
                {gapWords(district.median - national.median_amount)}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-ink-muted">Too few institutions here for a median.</p>
          )}
          <p className="mt-3 text-[13px] text-ink-soft">
            <span className="font-semibold tabular-nums text-ink">{COUNT.format(district.institutions)}</span> institutions publish an overdraft fee
          </p>
        </>
      ) : (
        <p className="text-[13px] text-ink-muted">Pick a district on the map.</p>
      )}
      {drawn.length > 1 && national ? <DistrictGroups districts={drawn} national={national.median_amount} active={number} onPick={onPick} swatchOf={swatchOf} /> : null}
      {number !== null ? (
        <Link
          href={`/research/district/${number}`}
          className="mt-4 inline-flex min-h-10 items-center gap-1 self-start text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {district ? `The ${district.name} district report` : "The district report"}
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}

/** The district's median against the nation's, in words. */
export function gapWords(gap: number): string {
  if (Math.abs(gap) < 0.005) return "The same as the national median";
  return `${money(Math.abs(gap))} ${gap > 0 ? "above" : "below"} the national median`;
}

/**
 * All 12 districts grouped by their median: each district is its numbered map dot, in its
 * map color; the group holding the national median is marked. A dot picks its district.
 */
function DistrictGroups({
  districts,
  national,
  active,
  onPick,
  swatchOf,
}: {
  districts: (DistrictPoint & { median: number })[];
  national: number;
  active: number | null;
  onPick: (n: number) => void;
  swatchOf: (n: number) => { fill: string; text: string };
}) {
  const groups = new Map<number, number[]>();
  for (const d of [...districts].sort((a, b) => a.district - b.district)) {
    const key = Math.round(d.median * 100) / 100;
    groups.set(key, [...(groups.get(key) ?? []), d.district]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div className="mt-5 border-t border-border pt-3" data-district-groups="">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Districts by median</p>
      <div className="mt-2.5 flex flex-wrap items-end gap-x-5 gap-y-3">
        {ordered.map(([value, members]) => (
          <div key={value} className="flex flex-col items-center">
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(3, members.length)}, 1.375rem)` }}>
              {members.map((n) => {
                const sw = swatchOf(n);
                return (
                  <button
                    key={n}
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={() => onPick(n)}
                    className={`flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                      n === active ? "ring-2 ring-ink ring-offset-1 ring-offset-surface-0" : ""
                    }`}
                    style={{ background: sw.fill, color: sw.text }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <span className={`mt-1 font-mono text-[11px] tabular-nums ${Math.abs(value - national) < 0.005 ? "font-semibold text-ink" : "text-ink-muted"}`}>
              {money(value)}
            </span>
            {Math.abs(value - national) < 0.005 ? <span className="text-[10px] text-ink-muted">nation</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── My fees ───────────────────────── */

const POSITION_FILL: Record<SampleRow["position"], string> = {
  above_market: "var(--fi-viz-above)",
  in_market: "var(--fi-viz-inside)",
  below_market: "var(--fi-viz-below)",
  free: "var(--fi-viz-below)",
};
const POSITION_WORDS: Record<SampleRow["position"], string> = {
  above_market: "Above the local middle half",
  in_market: "Inside the local middle half",
  below_market: "Below the local middle half",
  free: "Free, below the local market",
};

/** The fee to open on: the furthest from its local median. */
export function firstFee(rows: SampleRow[]): string | null {
  return [...rows].sort((a, b) => Math.abs(b.amount - b.median) - Math.abs(a.amount - a.median))[0]?.key ?? null;
}

/**
 * My fees: the sample bank's fees as bars that grow left (below its local median) or right
 * (above it), colored by where each sits against the local middle half. Clicking a bar opens
 * that fee: its amount on the local range, and the words of the schedule that state it.
 */
export function MyFeesChart({ sample, freshness }: { sample: SampleView; freshness: string }) {
  const rows = [...sample.rows].sort((a, b) => b.amount - b.median - (a.amount - a.median));
  const [selected, setSelected] = useState<string | null>(() => firstFee(rows));
  const row = rows.find((r) => r.key === selected) ?? rows[0];
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.amount - r.median)));
  const quote = sample.fees.find((f) => f.key === row?.key) ?? null;
  return (
    <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-8">
      <div className="min-w-0">
        <p className="text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">{sample.institutionName}</span> against {COUNT.format(sample.competitors)} local
          competitors
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted" aria-label="Legend">
          {(["above_market", "in_market", "below_market"] as const).map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: POSITION_FILL[p] }} />
              {POSITION_WORDS[p].replace(" the local middle half", "")}
            </li>
          ))}
          <li>Bars: its fee less the local median</li>
        </ul>
        <div className="relative mt-3" role="group" aria-label={`${sample.institutionName}: each fee against its local median`}>
          {rows.map((r, i) => {
            const diff = r.amount - r.median;
            const width = `${(Math.abs(diff) / maxAbs) * 50}%`;
            const on = r.key === row?.key;
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={on}
                aria-label={`${r.label}: ${money(r.amount)}, local median ${money(r.median)}`}
                onClick={() => setSelected(r.key)}
                data-fee={r.key}
                className={`fi-map-cell grid w-full grid-cols-[minmax(0,1fr)_5rem] items-center gap-y-1 rounded-md py-[5px] sm:grid-cols-[13rem_minmax(0,1fr)_5rem] sm:gap-y-0 text-left text-[13px] ${
                  on ? "bg-paper" : "hover:bg-paper/60"
                }`}
              >
                <span className={`truncate pl-2 pr-2 ${on ? "font-semibold text-ink" : "text-ink-soft"}`}>{r.label}</span>
                <span className="relative order-last col-span-2 mx-2 h-4 sm:order-none sm:col-span-1 sm:mx-0" aria-hidden="true">
                  <span className="absolute -bottom-[5px] -top-[5px] left-1/2 w-px bg-border" />
                  {Math.abs(diff) < 0.005 ? (
                    <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: POSITION_FILL[r.position] }} />
                  ) : (
                    <span
                      className={`fi-a-bar absolute top-0 h-4 ${diff > 0 ? "rounded-r-[4px]" : "rounded-l-[4px]"}`}
                      style={{
                        background: POSITION_FILL[r.position],
                        width,
                        ...(diff > 0 ? { left: "50%" } : { right: "50%" }),
                        ...at(120 + i * 60),
                        ["--fi-o" as string]: diff > 0 ? "left center" : "right center",
                      }}
                    />
                  )}
                </span>
                <span className="whitespace-nowrap pr-2 text-right font-mono text-[12px] tabular-nums text-ink">{signed(diff)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {row ? (
        <div className="flex min-w-0 flex-col rounded-xl border border-border bg-paper/50 p-4 sm:p-5" aria-live="polite" data-fee-detail="">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{row.label}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">{money(row.amount)}</span>
            <span className="text-[13px] text-ink-muted">local median {money(row.median)}</span>
          </p>
          <p className="mt-2 text-[13px] font-semibold text-ink">{POSITION_WORDS[row.position]}</p>
          <RangeStrip p25={row.p25} median={row.median} p75={row.p75} value={row.amount} color={POSITION_FILL[row.position]} />
          <p className="mt-2 text-[12px] text-ink-muted">
            Band: middle half of {COUNT.format(row.competitors)} local competitors · Line: median · Dot: its fee
          </p>
          {quote ? (
            <p className="mt-auto border-t border-border pt-3 text-[12px] leading-5 text-ink-muted">
              <span className="mr-1.5 rounded bg-brick-tint px-1.5 py-0.5 text-[11px] font-semibold text-ink">Source</span>
              &ldquo;{quote.quote}&rdquo;
            </p>
          ) : (
            <p className="mt-auto border-t border-border pt-3 text-[12px] text-ink-muted">{freshness}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One fee on its market: the middle half as a band, the median as a line, a fee as a dot. */
export function RangeStrip({
  p25,
  median,
  p75,
  value,
  color = "var(--fi-viz-above)",
  hi: forcedHi,
}: {
  p25: number;
  median: number;
  p75: number;
  value?: number;
  color?: string;
  hi?: number;
}) {
  const hi = forcedHi ?? top10(Math.max(p75, median, value ?? 0) * 1.15);
  return (
    <div className="mt-4" aria-hidden="true">
      <div className="relative h-9">
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <span className="absolute top-1 bottom-1 rounded-[3px] bg-ink/12" style={{ left: pct(p25, hi), width: `calc(${pct(p75, hi)} - ${pct(p25, hi)})` }} />
        <span className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-ink" style={{ left: pct(median, hi) }} />
        {value !== undefined ? (
          <span
            className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-0 transition-[left] duration-500 ease-out motion-reduce:transition-none"
            style={{ left: pct(value, hi), background: color }}
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-ink-muted">
        <span>$0</span>
        <span>{money(hi)}</span>
      </div>
    </div>
  );
}

/* ───────────────────────── Try a price ───────────────────────── */

/**
 * Try a price: drag the slider and the price line moves across the national overdraft
 * market (its middle half and median) and the 12 district medians. Districts whose median
 * the price passes light up.
 */
export function PriceSlider({ data }: { data: HomeData }) {
  const { overdraft, scenario, districts } = data;
  const inputId = useId();
  const [price, setPrice] = useState(() => scenario?.price ?? overdraft?.median_amount ?? 0);
  if (!overdraft || !scenario) return null;
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null);
  const hi = top10(Math.max(overdraft.max_amount, scenario.price, ...drawn.map((d) => d.median)));
  const passed = drawn.filter((d) => price > d.median).length;
  const diff = price - overdraft.median_amount;
  const band =
    price < overdraft.p25_amount ? "Below the middle half" : price > overdraft.p75_amount ? "Above the middle half" : "Inside the middle half";
  // Equal medians cluster three to a row, so a crowded value reads as a group, not a pole.
  const stacks = new Map<number, number>();
  const dots = drawn.map((d) => {
    const key = Math.round(d.median * 2) / 2;
    const index = stacks.get(key) ?? 0;
    stacks.set(key, index + 1);
    return { d, key, index };
  });
  const offset = (key: number, index: number) => {
    const size = stacks.get(key) ?? 1;
    const inRow = Math.min(3, size - Math.floor(index / 3) * 3);
    return ((index % 3) - (inRow - 1) / 2) * 14;
  };
  const ticks = Array.from({ length: hi / 10 + 1 }, (_, i) => i * 10);
  return (
    <div className="p-4 sm:p-6" data-price-slider="">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <label htmlFor={inputId} className="text-[13px] font-semibold text-ink">
            {scenario.feeLabel} price
          </label>
          <p className="mt-0.5 text-[44px] font-semibold leading-none tracking-[-0.035em] text-ink tabular-nums" data-price="">
            {money(price)}
          </p>
        </div>
        <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
          {[
            { k: "Vs national median", v: signed(diff).replace("at median", "Equal") },
            { k: "National middle half", v: band.replace(" the middle half", "") },
            { k: "District medians under it", v: `${passed} of ${drawn.length}` },
          ].map((s) => (
            <div key={s.k} className="min-w-0 rounded-lg border border-border bg-paper/60 px-2.5 py-2 sm:px-3">
              <dt className="text-[11px] leading-4 text-ink-muted sm:text-[12px]">{s.k}</dt>
              <dd className="mt-0.5 whitespace-nowrap font-mono text-[14px] font-semibold tabular-nums text-ink sm:text-[15px]">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-5 px-2">
        <div className="relative h-24" aria-hidden="true">
          <span
            className="absolute bottom-0 top-5 rounded-md bg-ink/[0.07]"
            style={{ left: pct(overdraft.p25_amount, hi), width: `calc(${pct(overdraft.p75_amount, hi)} - ${pct(overdraft.p25_amount, hi)})` }}
          />
          <span className="absolute bottom-0 top-5 w-px -translate-x-1/2 bg-ink/50" style={{ left: pct(overdraft.median_amount, hi) }} />
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold text-ink"
            style={{ left: pct(overdraft.median_amount, hi) }}
          >
            Nation {money(overdraft.median_amount)}
          </span>
          {dots.map(({ d, key, index }) => (
            <span
              key={d.district}
              title={`${d.name} ${money(d.median)}`}
              className="absolute h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-surface-0 transition-colors duration-200"
              style={{
                left: `calc(${pct(d.median, hi)} + ${offset(key, index)}px)`,
                bottom: `${4 + Math.floor(index / 3) * 14}px`,
                background: price > d.median ? "var(--fi-viz-above)" : "var(--fi-viz-inside)",
              }}
            />
          ))}
          <span className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-ink" style={{ left: pct(price, hi) }} />
        </div>
        <input
          id={inputId}
          type="range"
          min={0}
          max={hi}
          step={0.5}
          value={price}
          aria-valuetext={money(price)}
          onChange={(event) => setPrice(Number(event.target.value))}
          className="-mx-2 mt-1 block w-[calc(100%+1rem)] cursor-pointer accent-ink"
        />
        <div className="relative mt-0.5 h-4 font-mono text-[11px] tabular-nums text-ink-muted" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t, hi) }}>
              ${t}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-4 rounded-sm bg-ink/[0.07]" />
          Middle half, {COUNT.format(overdraft.institution_count)} institutions
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--fi-viz-above)" }} />
          A district median under this price
        </span>
        <span>A scenario, not advice</span>
      </p>
    </div>
  );
}

/* ───────────────────────── Market ladder ───────────────────────── */

/**
 * One fee in every market: a column per market (its median), the middle half as a whisker,
 * and the bank's own fee as a line across them all. A column opens its market's figures.
 */
export function LadderColumns({ ladder }: { ladder: MarketLadderData }) {
  const [selected, setSelected] = useState(0);
  const hi = top10(Math.max(ladder.value, ...ladder.rows.map((r) => r.q3)) * 1.1);
  const row = ladder.rows[selected] ?? ladder.rows[0];
  const H = 170;
  const y = (v: number) => H - (v / hi) * H;
  return (
    <div className="p-4 sm:p-6">
      <p className="text-[13px] text-ink-soft">
        <span className="font-semibold text-ink">{ladder.institutionName}</span> · {ladder.feeLabel}
      </p>
      <div className="relative mt-6" style={{ height: `${H}px` }}>
        <span className="absolute inset-x-0 bottom-0 h-px bg-border" aria-hidden="true" />
        <span className="absolute inset-x-0 z-10 h-[2px] bg-brick" style={{ top: `${y(ladder.value)}px` }} aria-hidden="true" />
        <span
          className="absolute right-0 z-10 -translate-y-full whitespace-nowrap pb-1 text-[11px] font-semibold text-ink"
          style={{ top: `${y(ladder.value)}px` }}
        >
          Its fee {money(ladder.value)}
        </span>
        <div className="absolute inset-0 grid gap-3" style={{ gridTemplateColumns: `repeat(${ladder.rows.length}, minmax(0, 1fr))` }}>
          {ladder.rows.map((r, i) => {
            const on = i === selected;
            return (
              <button
                key={r.label}
                type="button"
                aria-pressed={on}
                aria-label={`${r.label}: median ${money(r.median)}`}
                onClick={() => setSelected(i)}
                className="fi-map-cell group relative h-full"
              >
                <span
                  className="fi-a-col absolute inset-x-[22%] bottom-0 rounded-t-[4px] transition-colors"
                  style={{ height: `${H - y(r.median)}px`, background: on ? "var(--fi-ink)" : "var(--fi-viz-inside)", ...at(150 + i * 120) }}
                />
                <span className="absolute left-1/2 w-px -translate-x-1/2 bg-ink-muted" style={{ top: `${y(r.q3)}px`, height: `${y(r.q1) - y(r.q3)}px` }} />
                <span className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-ink-muted" style={{ top: `${y(r.q3)}px` }} />
                <span className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-ink-muted" style={{ top: `${y(r.q1)}px` }} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 grid gap-3 text-center text-[12px] leading-4" style={{ gridTemplateColumns: `repeat(${ladder.rows.length}, minmax(0, 1fr))` }}>
        {ladder.rows.map((r, i) => (
          <span key={r.label} className={i === selected ? "font-semibold text-ink" : "text-ink-muted"}>
            {r.label}
          </span>
        ))}
      </div>
      <p className="mt-4 border-t border-border pt-3 text-[13px] text-ink-soft" aria-live="polite">
        <span className="font-semibold text-ink">{row.label}</span>: median {money(row.median)}, middle half {money(row.q1)} to{" "}
        {money(row.q3)}, {COUNT.format(row.institutions)} institutions
      </p>
    </div>
  );
}
