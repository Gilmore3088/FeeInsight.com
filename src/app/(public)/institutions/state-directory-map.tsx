"use client";

import { useMemo, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { ArrowRight } from "lucide-react";
import type { InstitutionStateDirectorySummary } from "@/lib/data-store/search";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";

interface StateDirectoryMapProps {
  summaries: InstitutionStateDirectorySummary[];
  selectedStateCode?: string;
  query?: string;
  charterType?: string;
  /** Fee focus (`?fee=`) arriving from a consumer guide; every link keeps it. */
  feeCategory?: string;
}

function buildHref({
  stateCode,
  query,
  charterType,
  feeCategory,
}: {
  stateCode: string;
  query?: string;
  charterType?: string;
  feeCategory?: string;
}): string {
  const params = new URLSearchParams({ state: stateCode });
  if (query) params.set("q", query);
  if (charterType) params.set("charter", charterType);
  if (feeCategory) params.set("fee", feeCategory);
  return `/institutions?${params.toString()}`;
}

/** The "all states" link: drops the state but keeps the other filters. */
function clearStateHref({ charterType, feeCategory }: { charterType?: string; feeCategory?: string }): string {
  const params = new URLSearchParams();
  if (charterType) params.set("charter", charterType);
  if (feeCategory) params.set("fee", feeCategory);
  const search = params.toString();
  return search ? `/institutions?${search}` : "/institutions";
}

function getFill({
  value,
  max,
  active,
  hovered,
}: {
  value: number;
  max: number;
  active: boolean;
  hovered: boolean;
}): string {
  if (active) return "#132338";
  if (hovered) return "#b23a32";
  if (value <= 0) return "#ebe5d9";

  const intensity = value / max;
  if (intensity > 0.72) return "#b23a32";
  if (intensity > 0.5) return "#D46F54";
  if (intensity > 0.28) return "#E8A08E";
  if (intensity > 0.12) return "#f1d5d0";
  return "#f1d5d0";
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** "12 with fees · 740 monitored" */
function formatStateCounts(summary: InstitutionStateDirectorySummary | undefined): string {
  const verified = summary?.verified_institution_count ?? 0;
  const monitored = summary?.institution_count ?? 0;
  return `${formatCount(verified)} with fees · ${formatCount(monitored)} monitored`;
}

/**
 * One state on the map. While its link is loading the state turns navy at once (#1953: a click
 * looked like a hover while the directory took seconds to answer).
 */
function StatePath({
  d,
  value,
  max,
  active,
  hovered,
  title,
  onEnter,
  onLeave,
}: {
  d: string;
  value: number;
  max: number;
  active: boolean;
  hovered: boolean;
  title: string;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { pending } = useLinkStatus();
  const selected = active || pending;
  return (
    <path
      d={d}
      fill={getFill({ value, max, active: selected, hovered })}
      stroke={selected ? "#132338" : "#fbf9f4"}
      strokeWidth={selected ? 2.2 : 1.2}
      aria-busy={pending || undefined}
      className={`cursor-pointer transition-[fill,stroke,filter] duration-150 hover:brightness-95 focus:outline-none ${pending ? "animate-pulse" : ""}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <title>{title}</title>
    </path>
  );
}

export function StateDirectoryMap({
  summaries,
  selectedStateCode = "",
  query = "",
  charterType = "",
  feeCategory = "",
}: StateDirectoryMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const summariesByState = useMemo(
    () => new Map(summaries.map((summary) => [summary.state_code, summary])),
    [summaries],
  );
  const maxVerified = Math.max(
    ...summaries.map((summary) => summary.verified_institution_count),
    1,
  );
  const selectedSummary = selectedStateCode
    ? summariesByState.get(selectedStateCode) ?? null
    : null;
  const hoveredSummary = hoveredState ? summariesByState.get(hoveredState) ?? null : null;
  const focusSummary = hoveredSummary ?? selectedSummary;
  const topStates = [...summaries]
    .filter((summary) => STATE_NAMES[summary.state_code])
    .sort(
      (a, b) =>
        b.verified_institution_count - a.verified_institution_count ||
        b.institution_count - a.institution_count,
    )
    .slice(0, 10);

  // Once a state is picked, the results are what the reader came for: a one-line
  // "Vermont · Change state" bar replaces the large map so the list starts right below.
  if (selectedStateCode) {
    const stateName = STATE_NAMES[selectedStateCode] ?? selectedStateCode;
    return (
      <section
        aria-label="Selected state"
        className="fi-reveal fi-reveal-delay-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-4"
      >
        <p className="text-sm text-ink">
          <span className="text-lg font-semibold tracking-tight">{stateName}</span>
          <span className="ml-2 text-xs tabular-nums text-ink-muted">{formatStateCounts(selectedSummary ?? undefined)}</span>
        </p>
        <Link
          href={clearStateHref({ charterType, feeCategory })}
          prefetch={false}
          className="text-sm font-semibold text-brick underline-offset-2 hover:underline"
        >
          Change state
        </Link>
      </section>
    );
  }

  return (
    <section className="fi-reveal fi-reveal-delay-1 border-b border-border py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                Browse by state
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
                Choose a state to see its banks and credit unions.
              </h2>
            </div>
          </div>

          <div className="hidden border border-border bg-surface-0 p-3 sm:block">
            <svg
              viewBox="0 0 960 600"
              className="h-auto w-full"
              role="group"
              aria-label="Map of United States institutions by state"
            >
              {US_STATES.map((state) => {
                const summary = summariesByState.get(state.id);
                const active = selectedStateCode === state.id;
                const hovered = hoveredState === state.id;
                return (
                  <Link
                    key={state.id}
                    href={buildHref({ stateCode: state.id, query, charterType, feeCategory })}
                    aria-label={`${state.name}: ${formatStateCounts(summary)}`}
                    prefetch={false}
                  >
                    <StatePath
                      d={state.d}
                      value={summary?.verified_institution_count ?? 0}
                      max={maxVerified}
                      active={active}
                      hovered={hovered}
                      title={`${state.name}: ${formatStateCounts(summary)}`}
                      onEnter={() => setHoveredState(state.id)}
                      onLeave={() => setHoveredState(null)}
                    />
                  </Link>
                );
              })}
            </svg>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-brick-tint" />
                Fewer with fees
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-brick" />
                More with fees
              </span>
            </div>
          </div>

          <div className="sm:hidden">
            <div className="grid gap-2">
              {topStates.map((summary) => (
                <Link
                  key={summary.state_code}
                  href={buildHref({ stateCode: summary.state_code, query, charterType, feeCategory })}
                  prefetch={false}
                  className="flex min-h-12 items-center justify-between border border-border bg-surface-0 px-3 text-sm text-ink transition-colors hover:border-brick"
                >
                  <span className="font-semibold">
                    {STATE_NAMES[summary.state_code] ?? summary.state_code}
                  </span>
                  <span className="flex items-center gap-2 text-xs tabular-nums text-ink-soft">
                    {formatStateCounts(summary)}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <aside className="hidden border-y border-border py-4 lg:block lg:border-l lg:border-y-0 lg:py-1 lg:pl-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted">
            {focusSummary ? "Selected state" : "Most with fees"}
          </p>
          {focusSummary ? (
            <>
              <h3 className="mt-2 break-words text-xl font-semibold tracking-tight text-ink">
                {STATE_NAMES[focusSummary.state_code] ?? focusSummary.state_code}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {formatStateCounts(focusSummary)}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <SnapshotMetric label="With fees" value={formatCount(focusSummary.verified_institution_count)} />
                <SnapshotMetric label="Under review" value={formatCount(focusSummary.provisional_institution_count + focusSummary.under_review_institution_count)} />
                <SnapshotMetric label="No schedule found" value={formatCount(focusSummary.source_needed_institution_count)} />
                <SnapshotMetric label="Monitored" value={formatCount(focusSummary.institution_count)} />
              </div>
              {focusSummary.state_code !== selectedStateCode && (
                <Link
                  href={buildHref({ stateCode: focusSummary.state_code, query, charterType, feeCategory })}
                  prefetch={false}
                  className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-md bg-brick px-3 text-xs font-semibold text-white transition-colors hover:bg-brick-ink"
                >
                  View {STATE_NAMES[focusSummary.state_code] ?? focusSummary.state_code}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </>
          ) : (
            <div className="mt-3 space-y-2">
              {topStates.slice(0, 5).map((summary) => (
                <Link
                  key={summary.state_code}
                  href={buildHref({ stateCode: summary.state_code, query, charterType, feeCategory })}
                  prefetch={false}
                  className="group flex items-center justify-between gap-3 border-b border-border py-2 text-sm"
                >
                  <span className="font-medium text-ink group-hover:text-brick">
                    {STATE_NAMES[summary.state_code] ?? summary.state_code}
                  </span>
                  <span className="text-right text-xs tabular-nums text-ink-muted">
                    {formatStateCounts(summary)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
