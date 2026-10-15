"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { CoverageBar } from "./coverage-bar";
import {
  SHARE_BANDS,
  bandsInUse,
  directoryHref,
  percentLabel,
  publishedShare,
  shareBand,
  totalSummary,
} from "./directory-view";

interface StateExplorerProps {
  /** One row per state, already limited to the states the map can name. */
  summaries: InstitutionStateDirectorySummary[];
  /** Filters the "See institutions" link keeps. */
  query?: string;
  charter?: string;
  fee?: string;
}

const COUNT = new Intl.NumberFormat("en-US");
const PICKED_FILL = "#132338";

/**
 * The directory's exhibit: every state shaded by the share of its institutions with published
 * fees. Tapping a state (or choosing it in the list) shows its split in the panel, and the
 * panel's button opens that state's institutions. Only 50-odd state rows reach the client.
 */
export function StateExplorer({ summaries, query = "", charter = "", fee = "" }: StateExplorerProps) {
  const [picked, setPicked] = useState("");
  const [hovered, setHovered] = useState("");
  const byState = useMemo(() => new Map(summaries.map((s) => [s.state_code, s])), [summaries]);
  const total = useMemo(() => totalSummary(summaries), [summaries]);
  const bands = useMemo(() => bandsInUse(summaries), [summaries]);
  const stateOptions = useMemo(
    () => summaries.map((s) => s.state_code).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b])),
    [summaries],
  );

  // Hover only outlines a state (its name shows in the tooltip); the panel follows the pick, so
  // its numbers and its button always name the same state.
  const shown = (picked && byState.get(picked)) || null;
  const summary = shown ?? total;
  const name = shown ? STATE_NAMES[shown.state_code] : "All states";

  function onStateKey(event: KeyboardEvent<SVGPathElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setPicked(code);
    }
  }

  return (
    <section aria-labelledby="state-explorer-heading" className="fi-reveal fi-reveal-delay-1 py-6 sm:py-8">
      <h2 id="state-explorer-heading" className="text-[20px] font-semibold tracking-[-0.02em] text-ink sm:text-[24px]">
        Browse by state
      </h2>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0">
          <svg
            viewBox="0 0 960 600"
            className="h-auto w-full touch-manipulation"
            role="group"
            aria-label="Map of U.S. states, shaded by share of institutions with published fees"
          >
            {US_STATES.map((state) => {
              const row = byState.get(state.id);
              if (!row) {
                return <path key={state.id} d={state.d} fill={SHARE_BANDS[0].fill} stroke="#fbf9f4" strokeWidth={1.2} aria-hidden="true" />;
              }
              const isPicked = picked === state.id;
              const isHovered = hovered === state.id;
              const label = `${state.name}: ${COUNT.format(row.verified_institution_count)} of ${COUNT.format(row.institution_count)} with published fees`;
              return (
                <path
                  key={state.id}
                  d={state.d}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={isPicked}
                  fill={isPicked ? PICKED_FILL : SHARE_BANDS[shareBand(publishedShare(row))].fill}
                  stroke={isPicked || isHovered ? PICKED_FILL : "#fbf9f4"}
                  strokeWidth={isPicked || isHovered ? 2.4 : 1.2}
                  className="cursor-pointer outline-none transition-[fill,stroke] duration-150 focus-visible:stroke-brick"
                  onClick={() => setPicked(state.id)}
                  onKeyDown={(event) => onStateKey(event, state.id)}
                  onMouseEnter={() => setHovered(state.id)}
                  onMouseLeave={() => setHovered("")}
                >
                  <title>{label}</title>
                </path>
              );
            })}
          </svg>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-muted">
            <span>With published fees:</span>
            {bands.map((i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-border" style={{ background: SHARE_BANDS[i].fill }} aria-hidden="true" />
                {SHARE_BANDS[i].label}
              </span>
            ))}
          </div>

          <label htmlFor="state-explorer-select" className="mt-4 block text-[13px] font-medium text-ink">
            Or choose a state
          </label>
          <select
            id="state-explorer-select"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-md border border-border bg-surface-0 px-3 text-[15px] text-ink outline-none focus:border-brick sm:max-w-xs"
          >
            <option value="">All states</option>
            {stateOptions.map((code) => (
              <option key={code} value={code}>
                {STATE_NAMES[code]}
              </option>
            ))}
          </select>
        </div>

        <aside
          aria-live="polite"
          aria-label="State detail"
          className="rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-5"
        >
          <p className="text-[13px] font-semibold text-ink-muted">{name}</p>
          <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
            {COUNT.format(summary.verified_institution_count)}
            <span className="ml-1.5 text-[15px] font-normal tracking-normal text-ink-muted">
              of {COUNT.format(summary.institution_count)}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {summary.institution_count > 0
              ? `${percentLabel(publishedShare(summary))} have published fees`
              : "No institutions monitored"}
          </p>
          <div className="mt-4">
            <CoverageBar summary={summary} />
          </div>
          {picked && byState.has(picked) ? (
            <Link
              href={directoryHref({ q: query, state: picked, charter, fee })}
              prefetch={false}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink transition-opacity hover:opacity-90"
            >
              See {STATE_NAMES[picked]} institutions
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <p className="mt-5 text-[13px] text-ink-muted">Pick a state on the map or in the list.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
