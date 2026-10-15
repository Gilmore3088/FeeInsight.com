import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { DistrictMedian, FeeRange, PublishedCount } from "./findings";

/**
 * The national page's charts. Each draws only the live figures it is handed; none holds a
 * number of its own. Colors are the brand tokens (navy ink, brick accent, the market-position
 * pair), so light and dark modes follow the site.
 */

const money = (value: number) => formatFeeAmount(value) ?? "";
const count = (n: number) => n.toLocaleString("en-US");

/** The five range figures of an index row, or null when any is missing. */
export function feeRange(
  e: Pick<IndexEntry, "min_amount" | "p25_amount" | "median_amount" | "p75_amount" | "max_amount">,
): FeeRange | null {
  const { min_amount: min, p25_amount: p25, median_amount: median, p75_amount: p75, max_amount: max } = e;
  if (min === null || p25 === null || median === null || p75 === null || max === null) return null;
  return { min, p25, median, p75, max };
}

/** The sentence a screen reader hears in place of a range strip. */
export function rangeSentence(name: string, r: FeeRange): string {
  return `${name}: lowest ${money(r.min)}, middle half ${money(r.p25)} to ${money(r.p75)}, median ${money(r.median)}, highest ${money(r.max)}.`;
}

/**
 * Lowest-to-highest whisker, the P25 to P75 band, and the median as a brick tick, on the
 * fee's own scale. One series, so no legend: the caption beside it names the figures.
 */
export function RangeStrip({ name, range, height = 36 }: { name: string; range: FeeRange; height?: number }) {
  const W = 320;
  const pad = 6;
  const span = range.max - range.min;
  const x = (v: number) => (span > 0 ? pad + ((v - range.min) / span) * (W - pad * 2) : W / 2);
  const mid = height / 2;
  const band = Math.max(10, Math.round(height * 0.5));
  const bandX = x(range.p25);
  const bandW = Math.max(3, x(range.p75) - bandX);
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={rangeSentence(name, range)}
    >
      <line x1={x(range.min)} x2={x(range.max)} y1={mid} y2={mid} stroke="var(--fi-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={x(range.min)} x2={x(range.min)} y1={mid - 6} y2={mid + 6} stroke="var(--fi-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={x(range.max)} x2={x(range.max)} y1={mid - 6} y2={mid + 6} stroke="var(--fi-muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect x={bandX} y={mid - band / 2} width={bandW} height={band} rx={3} fill="var(--fi-ink)" fillOpacity={0.3}>
        <title>{`Middle half: ${money(range.p25)} to ${money(range.p75)}`}</title>
      </rect>
      <rect
        x={x(range.median) - 2}
        y={mid - band / 2 - 5}
        width={4}
        height={band + 10}
        rx={1.5}
        fill="var(--fi-brick)"
        stroke="var(--fi-surface-0)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      >
        <title>{`Median: ${money(range.median)}`}</title>
      </rect>
    </svg>
  );
}

/**
 * How many institutions publish each of the most-published fees. The leader is brick, the rest
 * navy. A bar whose fee is in the table selects it; one that is not (the page leads with it
 * only when the reader's table lacks the top fee) links to that fee's own page.
 */
export function PublishBars({
  leaders,
  selected,
  selectable,
  onSelect,
}: {
  leaders: PublishedCount[];
  selected: string | null;
  selectable: (category: string) => boolean;
  onSelect: (category: string) => void;
}) {
  const top = Math.max(1, ...leaders.map((l) => l.institutions));
  return (
    <ul className="space-y-1">
      {leaders.map((l, i) => {
        const canSelect = selectable(l.category);
        const isSelected = selected === l.category;
        const row = (
          <>
            {/* Up to two lines, so a long name ("Wire Transfer (Domestic)") shows whole. */}
            <span className="line-clamp-2 min-w-0 break-words text-left text-[11px] leading-tight text-ink-soft">{l.label}</span>
            <span className="relative h-2 rounded-full bg-surface-200" aria-hidden="true">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(l.institutions / top) * 100}%`,
                  background: i === 0 ? "var(--fi-brick)" : "var(--fi-ink)",
                  opacity: i === 0 ? 1 : 0.55,
                }}
              />
            </span>
            <span className="text-right text-[11px] text-ink-muted [font-variant-numeric:tabular-nums]">
              {count(l.institutions)}
            </span>
          </>
        );
        const grid =
          "grid w-full grid-cols-[minmax(0,8.5rem)_minmax(2rem,1fr)_2.5rem] items-center gap-2 rounded px-1 py-0.5";
        return (
          <li key={l.category}>
            {canSelect ? (
              <button
                type="button"
                onClick={() => onSelect(l.category)}
                aria-pressed={isSelected}
                aria-label={`Show ${l.label}: ${count(l.institutions)} institutions publish it`}
                className={`${grid} transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${isSelected ? "bg-paper" : ""}`}
              >
                {row}
              </button>
            ) : (
              <Link
                href={`/fees/${l.category}`}
                aria-label={`${l.label}: ${count(l.institutions)} institutions publish it. See ${l.label} in detail`}
                className={`${grid} transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink`}
              >
                {row}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Twelve-month price change, bank services against all items, from one zero line. */
export function CpiBars({ bankPct, allPct }: { bankPct: number; allPct: number }) {
  const lo = Math.min(0, bankPct, allPct);
  const hi = Math.max(0, bankPct, allPct);
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100;
  const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Number(Math.abs(v).toFixed(1))}%`;
  const rows = [
    { label: "Bank services", value: bankPct, color: "var(--fi-brick)", opacity: 1 },
    { label: "All items", value: allPct, color: "var(--fi-ink)", opacity: 0.55 },
  ];
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const left = Math.min(zero, ((r.value - lo) / span) * 100);
        const width = Math.abs(((r.value - 0) / span) * 100);
        return (
          <li key={r.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 px-1">
            <span className="text-[12px] leading-tight text-ink-soft">{r.label}</span>
            <span className="relative h-3 rounded-full bg-surface-200" aria-hidden="true">
              <span
                className="absolute inset-y-0 rounded-full"
                style={{ left: `${left}%`, width: `${Math.max(width, 1)}%`, background: r.color, opacity: r.opacity }}
              />
            </span>
            <span className="text-right text-[12px] font-semibold text-ink [font-variant-numeric:tabular-nums]">{pct(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export type DistrictPosition = "above" | "same" | "below" | "thin";

export function districtPosition(median: number | null, national: number): DistrictPosition {
  if (median === null) return "thin";
  if (median > national) return "above";
  if (median < national) return "below";
  return "same";
}

const POSITION_FILL: Record<DistrictPosition, string> = {
  above: "var(--fi-above-market)",
  same: "color-mix(in srgb, var(--fi-in-range) 24%, var(--fi-surface-0))",
  below: "var(--fi-below-market)",
  thin: "var(--fi-surface-200)",
};

export const positionFill = (p: DistrictPosition) => POSITION_FILL[p];

export const POSITION_LABEL: Record<DistrictPosition, string> = {
  above: "Above national",
  same: "Same as national",
  below: "Below national",
  thin: "Too few to compare",
};

/**
 * States shaded by their main Fed district's median against the national median (above,
 * same, below), the market-position colors used across the site. Clicking a state selects
 * its district.
 */
export function DistrictMap({
  districts,
  national,
  selected,
  onSelect,
  mapClassName = "",
}: {
  districts: DistrictMedian[];
  national: number;
  selected: number | null;
  onSelect: (district: number) => void;
  /** Extra classes for the map drawing alone (a max width), so the legend keeps the full width. */
  mapClassName?: string;
}) {
  const byDistrict = new Map(districts.map((d) => [d.district, d]));
  const present = new Set<DistrictPosition>(districts.map((d) => districtPosition(d.median, national)));
  return (
    <div>
      <svg viewBox="0 0 960 600" className={`mx-auto block h-auto w-full ${mapClassName}`} aria-hidden="true">
        {US_STATES.map((st) => {
          const d = STATE_TO_DISTRICT[st.id];
          const row = d ? byDistrict.get(d) : undefined;
          const position = row ? districtPosition(row.median, national) : "thin";
          const dim = selected !== null && d !== selected;
          return (
            <path
              key={st.id}
              d={st.d}
              fill={POSITION_FILL[position]}
              fillOpacity={dim ? 0.35 : 1}
              stroke={selected !== null && d === selected ? "var(--fi-ink)" : "var(--fi-surface-0)"}
              strokeWidth={selected !== null && d === selected ? 2 : 1.2}
              className={row ? "cursor-pointer transition-[fill-opacity] duration-150" : undefined}
              onClick={row ? () => onSelect(row.district) : undefined}
            >
              {row ? (
                <title>{`${row.name}: ${row.median === null ? "too few institutions" : `${money(row.median)} median`}`}</title>
              ) : null}
            </path>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
        {(["above", "same", "below", "thin"] as const)
          .filter((p) => present.has(p))
          .map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: POSITION_FILL[p] }} aria-hidden="true" />
              {POSITION_LABEL[p]}
            </li>
          ))}
      </ul>
    </div>
  );
}

/** One fee's national median, for the family bars. */
export interface FamilyMedian {
  category: string;
  label: string;
  median: number;
}

/**
 * The medians of the fees in the selected fee's family, from a zero baseline. The selected fee
 * is brick; every bar selects its fee.
 */
export function FamilyBars({
  items,
  selected,
  onSelect,
}: {
  items: FamilyMedian[];
  selected: string;
  onSelect: (category: string) => void;
}) {
  const top = Math.max(...items.map((i) => i.median), 0) || 1;
  return (
    <ul className="space-y-1">
      {items.map((i) => {
        const isSelected = i.category === selected;
        return (
          <li key={i.category}>
            <button
              type="button"
              onClick={() => onSelect(i.category)}
              aria-pressed={isSelected}
              aria-label={`Show ${i.label}: ${money(i.median)} median`}
              className={`grid w-full grid-cols-[10.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${isSelected ? "bg-paper" : ""}`}
            >
              <span className={`min-w-0 text-left text-[12px] leading-tight ${isSelected ? "font-semibold text-ink" : "text-ink-soft"}`}>
                {i.label}
              </span>
              <span className="relative h-2.5 rounded-full bg-surface-200" aria-hidden="true">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.max((i.median / top) * 100, 1)}%`,
                    background: isSelected ? "var(--fi-brick)" : "var(--fi-ink)",
                    opacity: isSelected ? 1 : 0.5,
                  }}
                />
              </span>
              <span className="text-right text-[12px] font-semibold text-ink tabular-nums">{money(i.median)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
