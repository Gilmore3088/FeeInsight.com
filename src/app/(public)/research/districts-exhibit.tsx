"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";

/** Where a district's median sits against the national median; null when it can't be compared. */
export type Side = "above" | "below" | "same" | null;

/** One fee in one district, as the map and the card's fee line read it. */
export interface DistrictFeeCell {
  side: Side;
  /** The district median; null when the district has no median for the fee. */
  median: number | null;
  /** The national median it is compared with. */
  us: number | null;
}

/** One Fed district as the hub's districts exhibit draws it. */
export interface DistrictCard {
  id: number;
  /** The Fed's own name for the district, e.g. "Atlanta". */
  name: string;
  /** The region in a reader's words, e.g. "the Southeast". */
  region: string;
  /** The district's strongest supported difference from the national median; null when nothing clears the minimum. */
  statement: string | null;
  /** The fee the statement names, so its card doesn't repeat it as the selected fee's line. */
  leadKey: string | null;
  institutions: number;
  /** Each map fee's shading and figures, by fee key: the same rule as the section's finding. */
  fees: Record<string, DistrictFeeCell>;
  /** Where the district number sits on the map (mainland states only). */
  label: { x: number; y: number } | null;
}

/** A fee the map can be shaded by. */
export interface MapFee {
  key: string;
  /** Sentence-start name, e.g. "Out-of-network ATM". */
  name: string;
}

/** Darker means a higher median against the U.S.; a district that can't be compared is hatched. */
const SIDE_FILL: Record<"above" | "same" | "below", string> = {
  above: "var(--fi-viz-4)",
  same: "var(--fi-viz-2)",
  below: "var(--fi-viz-1)",
};
const NOT_COMPARED = "url(#district-not-compared)";
const NUMBER = new Intl.NumberFormat("en-US");
const noopSubscribe = () => () => {};
/** Rows a phone shows before "Show all". */
const PHONE_ROWS = 5;

function legendFor(minInstitutions: number): { key: "above" | "same" | "below" | "none"; label: string; fill: string }[] {
  return [
    { key: "above", label: "Above the national median", fill: SIDE_FILL.above },
    { key: "same", label: "About the same", fill: SIDE_FILL.same },
    { key: "below", label: "Below", fill: SIDE_FILL.below },
    { key: "none", label: `Fewer than ${minInstitutions} institutions publish it`, fill: "none" },
  ];
}

function fillFor(side: Side): string {
  return side ? SIDE_FILL[side] : NOT_COMPARED;
}

function Swatch({ fill }: { fill: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="h-3.5 w-3.5 shrink-0">
      <defs>
        <pattern id="legend-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="var(--color-surface-200)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-ink)" strokeOpacity={0.3} strokeWidth={1.5} />
        </pattern>
      </defs>
      <rect width="14" height="14" rx="3" fill={fill === "none" ? "url(#legend-hatch)" : fill} stroke="var(--color-ink)" strokeOpacity={0.25} />
    </svg>
  );
}

/**
 * All 12 Federal Reserve districts on one map, shaded by where the selected fee's median sits
 * against the national median, with each district's strongest supported difference. The map
 * is a picture; the cards carry the links for keyboards and screen readers, and on phones the
 * map is left out. The fee select is a GET form, so it re-shades the map without scripts too.
 */
export function DistrictsExhibit({
  districts,
  mapFees,
  initialFee,
  findings,
  fallback,
  minInstitutions,
}: {
  districts: DistrictCard[];
  mapFees: MapFee[];
  initialFee: string;
  /** The section's finding line for each map fee, computed on the server. */
  findings: Record<string, string>;
  /** The line when no fee can be mapped. */
  fallback: string;
  /** Institutions a district needs before it is shaded for a fee. */
  minInstitutions: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [feeKey, setFeeKey] = useState(initialFee);
  // Before hydration the form's button submits the choice; afterwards the select applies it in place.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const listRef = useRef<HTMLOListElement>(null);
  const byId = new Map(districts.map((d) => [d.id, d]));
  const fee = mapFees.find((f) => f.key === feeKey) ?? mapFees[0];
  const legend = legendFor(minInstitutions);
  const finding = (fee && findings[fee.key]) || fallback;
  const count = (key: string) => districts.filter((d) => (d.fees[fee?.key ?? ""]?.side ?? "none") === key).length;
  const sideOf = (d: DistrictCard): Side => (fee ? (d.fees[fee.key]?.side ?? null) : null);

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="-mt-5 max-w-3xl text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:text-left">
        {finding}
      </p>
      {mapFees.length > 1 && fee && (
        <form method="get" action="/research#districts" className="flex flex-wrap items-center gap-2">
          <label htmlFor="district-fee" className="text-[13px] font-semibold text-ink">
            Compare by fee
          </label>
          <select
            id="district-fee"
            name="fee"
            value={fee.key}
            onChange={(e) => {
              setFeeKey(e.target.value);
              history.replaceState(null, "", `?fee=${encodeURIComponent(e.target.value)}#districts`);
            }}
            className="min-h-11 min-w-0 max-w-full rounded-full border border-border bg-surface-0 px-4 text-[14px] font-semibold text-ink"
          >
            {mapFees.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
          {!hydrated && (
            <button type="submit" className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink">
              Show
            </button>
          )}
        </form>
      )}

      <figure className="hidden rounded-2xl border border-border bg-white p-4 sm:block lg:p-6">
        <svg viewBox="0 0 960 600" className="mx-auto h-auto max-h-[30rem] w-full" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="district-not-compared" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" fill="var(--color-surface-200)" />
              <line x1="0" y1="0" x2="0" y2="8" stroke="var(--color-ink)" strokeOpacity={0.25} strokeWidth={2} />
            </pattern>
          </defs>
          {US_STATES.map((st) => {
            const d = STATE_TO_DISTRICT[st.id];
            const card = d ? byId.get(d) : undefined;
            const path = (
              <path
                d={st.d}
                fill={card ? fillFor(sideOf(card)) : "var(--fi-viz-none)"}
                fillOpacity={active === null || active === d || !d ? 1 : 0.4}
                stroke="var(--color-paper)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="transition-[fill,fill-opacity] duration-150"
              />
            );
            if (!d || !card) return <g key={st.id}>{path}</g>;
            return (
              <Link
                key={st.id}
                href={`/research/district/${d}`}
                prefetch={false}
                tabIndex={-1}
                onMouseEnter={() => setActive(d)}
                onMouseLeave={() => setActive(null)}
              >
                {path}
              </Link>
            );
          })}
          {districts.map((d) =>
            d.label ? (
              <g key={d.id} className="pointer-events-none">
                <circle
                  cx={d.label.x}
                  cy={d.label.y}
                  r={19}
                  className={active === d.id ? "fill-ink" : "fill-surface-0"}
                  stroke="var(--color-ink)"
                  strokeWidth={1.5}
                />
                <text
                  x={d.label.x}
                  y={d.label.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`text-[18px] font-bold ${active === d.id ? "fill-on-ink" : "fill-ink"}`}
                >
                  {d.id}
                </text>
              </g>
            ) : null,
          )}
        </svg>
        <figcaption className="mt-3 border-t border-surface-200 pt-3">
          <p className="text-[13px] font-semibold text-ink">
            {fee ? `${fee.name} median` : "Median"} against the national median, by Federal Reserve district
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-ink-soft">
            {legend.map((l) => (
              <li key={l.key} className="flex items-center gap-1.5">
                <Swatch fill={l.fill} />
                {l.label}
                <span className="tabular-nums text-ink-muted">({count(l.key === "none" ? "none" : l.key)})</span>
              </li>
            ))}
          </ul>
        </figcaption>
      </figure>

      <div>
        <p id="district-cards-label" className="text-[13px] font-semibold text-ink sm:mx-0 sm:text-left">
          Each district&apos;s largest gap from the national median
        </p>
        <ol
          ref={listRef}
          id="district-cards"
          aria-labelledby="district-cards-label"
          className="mt-3 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3"
        >
          {districts.map((d, i) => (
            <li key={d.id} className={`bg-white ${i >= PHONE_ROWS && !expanded ? "hidden sm:block" : ""}`}>
              <Link
                href={`/research/district/${d.id}`}
                onMouseEnter={() => setActive(d.id)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(d.id)}
                onBlur={() => setActive(null)}
                className={`group flex h-full min-h-11 gap-3 px-4 py-3.5 transition-colors hover:bg-paper ${active === d.id ? "bg-paper" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold tabular-nums text-on-ink"
                >
                  {d.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-snug text-ink group-hover:text-brick">
                    <span className="sr-only">District {d.id}, </span>
                    {d.name}
                    {d.region.replace(/^the /, "") !== d.name && (
                      <span className="font-normal text-ink-muted"> · {d.region.replace(/^the /, "")}</span>
                    )}
                  </span>
                  {d.statement && <span className="mt-1 block text-[13px] leading-snug text-ink-soft">{d.statement}</span>}
                  {fee && fee.key !== d.leadKey && <FeeLine fee={fee} cell={d.fees[fee.key]} />}
                  <span className="mt-1 block text-[11px] tabular-nums text-ink-muted">
                    {NUMBER.format(d.institutions)} institutions with published fees
                  </span>
                </span>
                <span aria-hidden="true" className="self-center text-ink-muted group-hover:text-brick">
                  &rsaquo;
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {districts.length > PHONE_ROWS && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="district-cards"
            onClick={() => {
              const opening = !expanded;
              setExpanded(opening);
              // Move focus to the first row that just appeared.
              if (opening) requestAnimationFrame(() => listRef.current?.querySelectorAll("a")[PHONE_ROWS]?.focus());
            }}
            className="mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink sm:hidden"
          >
            {expanded ? "Show fewer districts" : `Show all ${districts.length} districts`}
          </button>
        )}
      </div>
    </div>
  );
}

/** The selected fee in one district: its median and the national median, when it can be compared. */
function FeeLine({ fee, cell }: { fee: MapFee; cell: DistrictFeeCell | undefined }) {
  if (!cell?.side || cell.median == null || cell.us == null || cell.us <= 0) return null;
  // Phones have no map, so the side is spelled out there.
  const side = cell.side === "same" ? "about the same as U.S." : `${cell.side} U.S.`;
  return (
    <span className="mt-1 block text-[12px] tabular-nums text-ink">
      {fee.name} median {formatFeeAmount(cell.median)}
      <span className="text-ink-muted"> · U.S. {formatFeeAmount(cell.us)}</span>
      <span className="text-ink-muted sm:hidden"> · {side}</span>
    </span>
  );
}
