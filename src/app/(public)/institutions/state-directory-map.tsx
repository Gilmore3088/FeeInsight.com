"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  if (active) return "#1A1815";
  if (hovered) return "#A93D25";
  if (value <= 0) return "#EDE5D8";

  const intensity = value / max;
  if (intensity > 0.72) return "#C44B2E";
  if (intensity > 0.5) return "#D46F54";
  if (intensity > 0.28) return "#E8A08E";
  if (intensity > 0.12) return "#F4C9BF";
  return "#F8DDD6";
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

  return (
    <section className="fi-reveal fi-reveal-delay-1 border-b border-[#D8CBB8] py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B6255]">
                Browse by state
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#1A1815]">
                Choose a state to see its banks and credit unions.
              </h2>
            </div>
            {selectedStateCode && (
              <Link
                href={clearStateHref({ charterType, feeCategory })}
                className="text-xs font-semibold text-[#A93D25] transition-colors hover:text-[#A93D25]"
              >
                Clear state
              </Link>
            )}
          </div>

          <div className="hidden border border-[#E0D7C9] bg-[#FFFDF9] p-3 sm:block">
            <svg
              viewBox="0 0 960 600"
              className="h-auto w-full"
              role="img"
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
                    <path
                      d={state.d}
                      fill={getFill({
                        value: summary?.verified_institution_count ?? 0,
                        max: maxVerified,
                        active,
                        hovered,
                      })}
                      stroke={active ? "#1A1815" : "#FFFDF9"}
                      strokeWidth={active ? 2.2 : 1.2}
                      className="cursor-pointer transition-[fill,stroke,filter] duration-150 hover:brightness-95 focus:outline-none"
                      onMouseEnter={() => setHoveredState(state.id)}
                      onMouseLeave={() => setHoveredState(null)}
                    >
                      <title>{`${state.name}: ${formatStateCounts(summary)}`}</title>
                    </path>
                  </Link>
                );
              })}
            </svg>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#E0D7C9] pt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[#6B6255]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-[#F8DDD6]" />
                Fewer with fees
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-[#C44B2E]" />
                More with fees
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-[#1A1815]" />
                Selected
              </span>
            </div>
          </div>

          <div className="sm:hidden">
            {selectedSummary ? (
              <div className="flex min-h-12 items-center justify-between border border-[#1A1815] bg-[#1A1815] px-3 text-sm text-white">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] opacity-60">
                    Selected
                  </p>
                  <p className="font-semibold">
                    {STATE_NAMES[selectedSummary.state_code] ?? selectedSummary.state_code}
                  </p>
                </div>
                <Link
                  href={clearStateHref({ charterType, feeCategory })}
                  prefetch={false}
                  className="text-xs font-semibold opacity-80 transition-opacity hover:opacity-100"
                >
                  Change
                </Link>
              </div>
            ) : (
              <div className="grid gap-2">
                {topStates.map((summary) => (
                  <Link
                    key={summary.state_code}
                    href={buildHref({ stateCode: summary.state_code, query, charterType, feeCategory })}
                    prefetch={false}
                    className="flex min-h-12 items-center justify-between border border-[#E0D7C9] bg-[#FFFDF9] px-3 text-sm text-[#1A1815] transition-colors hover:border-[#C44B2E]"
                  >
                    <span className="font-semibold">
                      {STATE_NAMES[summary.state_code] ?? summary.state_code}
                    </span>
                    <span className="flex items-center gap-2 text-xs tabular-nums text-[#5A5347]">
                      {formatStateCounts(summary)}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="hidden border-y border-[#E0D7C9] py-4 lg:block lg:border-l lg:border-y-0 lg:py-1 lg:pl-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6B6255]">
            {focusSummary ? "Selected state" : "Most with fees"}
          </p>
          {focusSummary ? (
            <>
              <h3 className="mt-2 break-words text-xl font-semibold tracking-tight text-[#1A1815]">
                {STATE_NAMES[focusSummary.state_code] ?? focusSummary.state_code}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">
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
                  className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-md bg-[#C44B2E] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#A93D25]"
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
                  className="group flex items-center justify-between gap-3 border-b border-[#E0D7C9] py-2 text-sm"
                >
                  <span className="font-medium text-[#1A1815] group-hover:text-[#C44B2E]">
                    {STATE_NAMES[summary.state_code] ?? summary.state_code}
                  </span>
                  <span className="text-right text-xs tabular-nums text-[#6B6255]">
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
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[#1A1815]">
        {value}
      </p>
    </div>
  );
}
