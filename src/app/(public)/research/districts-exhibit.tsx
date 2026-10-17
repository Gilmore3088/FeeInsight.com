"use client";

import { useState } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";

/** One Fed district as the hub's districts exhibit draws it. */
export interface DistrictCard {
  id: number;
  /** The Fed's own name for the district, e.g. "Atlanta". */
  name: string;
  /** The region in a reader's words, e.g. "the Southeast". */
  region: string;
  /** The district page's opening sentence, word for word; null when nothing clears the minimum. */
  statement: string | null;
  institutions: number;
  /** Where the district number sits on the map (mainland states only). */
  label: { x: number; y: number } | null;
}

/**
 * Four warm tones from the map ramp, assigned so no two neighboring districts share one.
 * The active district takes the darkest step.
 */
const TONE: Record<number, string> = {
  1: "var(--fi-viz-2)",
  2: "var(--fi-viz-3)",
  3: "var(--fi-viz-2)",
  4: "var(--fi-viz-1)",
  5: "var(--fi-viz-4)",
  6: "var(--fi-viz-2)",
  7: "var(--fi-viz-4)",
  8: "var(--fi-viz-3)",
  9: "var(--fi-viz-2)",
  10: "var(--fi-viz-1)",
  11: "var(--fi-viz-4)",
  12: "var(--fi-viz-3)",
};
const ACTIVE = "var(--fi-viz-5)";
const NUMBER = new Intl.NumberFormat("en-US");
/** Rows a phone shows before "Show all". */
const PHONE_ROWS = 5;

/**
 * All 12 Federal Reserve districts on one map, each with the opening finding its own page
 * leads with. On phones the map is left out and the list carries the same links.
 */
export function DistrictsExhibit({ districts }: { districts: DistrictCard[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const byId = new Map(districts.map((d) => [d.id, d]));

  return (
    <div className="space-y-6">
      <figure className="hidden rounded-2xl border border-border bg-white p-4 sm:block lg:p-6">
        <svg viewBox="0 0 960 600" className="mx-auto h-auto max-h-[30rem] w-full" role="img" aria-labelledby="districts-map-title">
          <title id="districts-map-title">Map of the 12 Federal Reserve districts</title>
          {US_STATES.map((st) => {
            const d = STATE_TO_DISTRICT[st.id];
            const card = d ? byId.get(d) : undefined;
            const fill = !d ? "var(--fi-viz-none)" : active === d ? ACTIVE : (TONE[d] ?? "var(--fi-viz-2)");
            const path = (
              <path
                d={st.d}
                fill={fill}
                fillOpacity={active === null || active === d || !d ? 1 : 0.45}
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
                aria-label={`${st.name}: District ${d}, ${card.name}`}
                onMouseEnter={() => setActive(d)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(d)}
                onBlur={() => setActive(null)}
              >
                {path}
              </Link>
            );
          })}
          {districts.map((d) =>
            d.label ? (
              <g key={d.id} aria-hidden="true" className="pointer-events-none">
                <circle cx={d.label.x} cy={d.label.y} r={15} className={active === d.id ? "fill-ink" : "fill-paper"} stroke="var(--color-ink)" strokeWidth={1.5} />
                <text
                  x={d.label.x}
                  y={d.label.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`text-[14px] font-bold ${active === d.id ? "fill-paper" : "fill-ink"}`}
                >
                  {d.id}
                </text>
              </g>
            ) : null,
          )}
        </svg>
        <figcaption className="sr-only">Each state is shaded by the Federal Reserve district that covers most of it.</figcaption>
      </figure>

      <ol aria-label="Federal Reserve districts" className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
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
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink/70 text-[11px] font-bold tabular-nums text-ink"
                style={{ background: TONE[d.id] }}
              >
                {d.id}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-snug text-ink group-hover:text-brick">
                  {d.name} <span className="font-normal text-ink-muted">· {d.region.replace(/^the /, "")}</span>
                </span>
                {d.statement && <span className="mt-1 block text-[13px] leading-snug text-ink-soft">{d.statement}</span>}
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
      {!expanded && districts.length > PHONE_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="-mt-2 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink sm:hidden"
        >
          Show all {districts.length} districts
        </button>
      )}
    </div>
  );
}
