"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import type { StateCoverage } from "@/lib/data-store/geographic";

const HAS_REPORT = "var(--fi-viz-3)";
const ACTIVE = "var(--fi-viz-5)";
const NO_DATA = "var(--fi-viz-none)";
const NUMBER = new Intl.NumberFormat("en-US");

interface Entry {
  code: string;
  href: string;
  name: string;
  institutions: number;
}

/**
 * The state reports: a map and a searchable directory on wider screens, one dropdown on phones.
 * A state is listed once it has institutions with published fees.
 */
export function GeoReports({ states }: { states: StateCoverage[] }) {
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const router = useRouter();

  const entries = useMemo<Entry[]>(
    () =>
      states
        .filter((s) => s.verified_institutions > 0)
        .map((s) => ({
          code: s.state_code,
          href: `/research/state/${s.state_code}`,
          name: STATE_NAMES[s.state_code] ?? s.state_code,
          institutions: s.verified_institutions,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [states],
  );
  const byCode = useMemo(() => new Map(entries.map((e) => [e.code, e])), [entries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase() === q);
  }, [entries, query]);

  const hoverEntry = hovered ? byCode.get(hovered) : undefined;

  return (
    <div>
      <div className="sm:hidden">
        <label className="sr-only" htmlFor="geo-pick">
          State report
        </label>
        <select
          id="geo-pick"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) router.push(e.target.value);
          }}
          className="min-h-11 w-full rounded-full border border-border bg-white px-4 text-[14px] font-semibold text-ink"
        >
          <option value="" disabled>
            Choose a state
          </option>
          {entries.map((e) => (
            <option key={e.code} value={e.href}>
              {e.name} ({NUMBER.format(e.institutions)} institutions)
            </option>
          ))}
        </select>
      </div>

      <div className="hidden gap-6 sm:grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <figure className="relative rounded-2xl border border-border bg-white p-4 lg:p-6">
          <svg viewBox="0 0 960 600" className="mx-auto h-auto max-h-[24rem] w-full" role="img" aria-label="Map of states with a report">
            {US_STATES.map((st) => {
              const entry = byCode.get(st.id);
              const path = (
                <path
                  d={st.d}
                  fill={!entry ? NO_DATA : hovered === st.id ? ACTIVE : HAS_REPORT}
                  stroke="var(--color-paper)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="transition-[fill] duration-150"
                />
              );
              return entry ? (
                <Link
                  key={st.id}
                  href={entry.href}
                  prefetch={false}
                  aria-label={`${st.name} report`}
                  onMouseEnter={() => setHovered(st.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(st.id)}
                  onBlur={() => setHovered(null)}
                >
                  {path}
                </Link>
              ) : (
                <g key={st.id}>{path}</g>
              );
            })}
          </svg>
          {hoverEntry && (
            <p aria-live="polite" className="pointer-events-none absolute left-6 top-6 rounded-xl border border-border bg-white/95 px-3.5 py-2.5 text-[12px] shadow-lg">
              <span className="block text-[14px] font-semibold text-ink">{hoverEntry.name}</span>
              <span className="text-ink-muted">{NUMBER.format(hoverEntry.institutions)} institutions with published fees</span>
            </p>
          )}
          <figcaption className="mt-2 text-center text-[11px] text-ink-muted">Shaded states have a report.</figcaption>
        </figure>

        <div className="flex min-h-0 flex-col rounded-2xl border border-border bg-white">
          <div className="border-b border-surface-200 px-4 py-3">
            <label className="sr-only" htmlFor="geo-filter">
              Find a state
            </label>
            <input
              id="geo-filter"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a state"
              className="min-h-10 w-full rounded-full border border-border bg-paper px-3.5 text-[13px] text-ink placeholder:text-ink-muted focus:border-brick focus:outline-none"
            />
          </div>
          <ul className="max-h-[22rem] divide-y divide-surface-200 overflow-y-auto">
            {shown.map((e) => (
              <li key={e.code}>
                <Link
                  href={e.href}
                  onMouseEnter={() => setHovered(e.code)}
                  onMouseLeave={() => setHovered(null)}
                  className="group flex items-baseline gap-2 px-4 py-2.5 hover:bg-paper"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink group-hover:text-brick">{e.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{NUMBER.format(e.institutions)} institutions</span>
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="px-4 py-5 text-[13px] text-ink-muted">Nothing matches &ldquo;{query}&rdquo;.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
