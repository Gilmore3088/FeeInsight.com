"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import type { DistrictCoverage, StateCoverage } from "@/lib/data-store/geographic";

type View = "states" | "districts";

/** One warm accent per district, no rainbow. */
const DISTRICT_COLORS: Record<number, string> = {
  1: "#b23a32",
  2: "#8C3A52",
  3: "#B8862B",
  4: "#6B4A6E",
  5: "#6E5B4E",
  6: "#5B7A78",
  7: "#3b6350",
  8: "#C4A46A",
  9: "#A0522D",
  10: "#b23a32",
  11: "#7f2620",
  12: "#55606f",
};
const HAS_REPORT = "#E39579";
const NO_DATA = "#ECE6DC";
const NUMBER = new Intl.NumberFormat("en-US");

interface Entry {
  key: string;
  href: string;
  name: string;
  institutions: number;
  /** District number, shown as a badge in the districts view. */
  badge?: number;
}

/**
 * The one geographic section on the research hub: a map and a searchable directory of the state
 * and Federal Reserve district reports. Coverage rankings live in the reports and the methodology.
 */
export function GeoReports({ states, districts }: { states: StateCoverage[]; districts: DistrictCoverage[] }) {
  const [view, setView] = useState<View>("states");
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  // On phones the picker leads and the map is opt-in.
  const [showMap, setShowMap] = useState(false);
  const router = useRouter();

  const stateByCode = useMemo(() => new Map(states.map((s) => [s.state_code, s])), [states]);

  const entries = useMemo<Entry[]>(() => {
    if (view === "districts") {
      return [...districts]
        .sort((a, b) => a.district - b.district)
        .map((d) => ({
          key: String(d.district),
          href: `/research/district/${d.district}`,
          name: DISTRICT_NAMES[d.district] ?? `District ${d.district}`,
          institutions: d.verified_institutions,
          badge: d.district,
        }));
    }
    return states
      .filter((s) => s.verified_institutions > 0)
      .map((s) => ({
        key: s.state_code,
        href: `/research/state/${s.state_code}`,
        name: STATE_NAMES[s.state_code] ?? s.state_code,
        institutions: s.verified_institutions,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [view, states, districts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q) || e.key.toLowerCase() === q);
  }, [entries, query]);

  // The hovered map shape or directory row, as a state code or a district number.
  const activeDistrict = view === "districts" && hovered ? Number(hovered) : null;

  function fillFor(code: string): { fill: string; opacity: number } {
    if (view === "districts") {
      const d = STATE_TO_DISTRICT[code];
      if (!d) return { fill: NO_DATA, opacity: 1 };
      return { fill: DISTRICT_COLORS[d] ?? "#55606f", opacity: activeDistrict === null ? 0.55 : activeDistrict === d ? 0.95 : 0.12 };
    }
    const s = stateByCode.get(code);
    return { fill: s && s.verified_institutions > 0 ? HAS_REPORT : NO_DATA, opacity: 1 };
  }

  const hoverLabel =
    hovered === null
      ? null
      : view === "districts"
        ? entries.find((e) => e.key === hovered)
        : entries.find((e) => e.key === hovered) ?? { name: STATE_NAMES[hovered] ?? hovered, institutions: 0 };

  return (
    <div>
      <div role="radiogroup" aria-label="Show reports for" className="inline-flex gap-1 rounded-full border border-border bg-white p-1">
        {(
          [
            ["states", "States"],
            ["districts", "Fed districts"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={view === key}
            onClick={() => {
              setView(key);
              setQuery("");
              setHovered(null);
            }}
            className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors ${
              view === key ? "bg-ink text-white" : "text-ink-soft hover:bg-surface-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 sm:hidden">
        <label className="sr-only" htmlFor="geo-pick">
          {view === "districts" ? "Choose a district report" : "Choose a state report"}
        </label>
        <select
          id="geo-pick"
          defaultValue=""
          key={view}
          onChange={(e) => {
            if (e.target.value) router.push(e.target.value);
          }}
          className="min-h-11 w-full rounded-full border border-border bg-white px-4 text-[14px] font-semibold text-ink"
        >
          <option value="" disabled>
            {view === "districts" ? "Choose a district" : "Choose a state"}
          </option>
          {entries.map((e) => (
            <option key={e.key} value={e.href}>
              {e.badge !== undefined ? `${e.badge}. ` : ""}
              {e.name} ({NUMBER.format(e.institutions)} institutions)
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-expanded={showMap}
          onClick={() => setShowMap((v) => !v)}
          className="mt-2 min-h-10 text-[13px] font-semibold text-brick"
        >
          {showMap ? "Hide the map" : "Show the map"}
        </button>
      </div>

      <div className="mt-3 grid gap-6 sm:mt-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={`relative rounded-2xl border border-border bg-white p-3 sm:block sm:p-5 ${showMap ? "" : "hidden"}`}>
          <svg
            viewBox="0 0 960 600"
            className="h-auto w-full"
            role="img"
            aria-label={view === "districts" ? "Map of the 12 Federal Reserve districts" : "Map of states with a report"}
          >
            {US_STATES.map((st) => {
              const { fill, opacity } = fillFor(st.id);
              const district = STATE_TO_DISTRICT[st.id];
              const href = view === "districts" ? (district ? `/research/district/${district}` : null) : `/research/state/${st.id}`;
              const key = view === "districts" ? (district ? String(district) : null) : st.id;
              const path = (
                <path
                  d={st.d}
                  fill={fill}
                  fillOpacity={opacity}
                  stroke={view === "states" && hovered === st.id ? "#132338" : "#FFFFFF"}
                  strokeWidth={view === "states" && hovered === st.id ? 2.5 : 1.2}
                  className="cursor-pointer transition-[fill-opacity] duration-200"
                />
              );
              return href && key ? (
                <Link
                  key={st.id}
                  href={href}
                  aria-label={view === "districts" ? `${st.name}: ${DISTRICT_NAMES[district!] ?? `District ${district}`} district report` : `${st.name} report`}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(key)}
                  onBlur={() => setHovered(null)}
                >
                  {path}
                </Link>
              ) : (
                <g key={st.id}>{path}</g>
              );
            })}
          </svg>
          {hoverLabel && (
            <p aria-live="polite" className="pointer-events-none absolute left-4 top-4 rounded-xl border border-border bg-white/95 px-3.5 py-2.5 text-[12px] shadow-lg sm:left-6 sm:top-6">
              <span className="block text-[14px] font-semibold text-ink">{hoverLabel.name}</span>
              <span className="text-ink-muted">
                {hoverLabel.institutions > 0 ? `${NUMBER.format(hoverLabel.institutions)} institutions with published fees` : "No published fees yet"}
              </span>
            </p>
          )}
          <p className="mt-2 text-center text-[11px] text-ink-muted">
            {view === "districts"
              ? "States are shaded by their main district; a report counts each institution in its own district."
              : "Shaded states have a report. Select one to open it."}
          </p>
        </div>

        <div className="hidden min-h-0 flex-col rounded-2xl border border-border bg-white sm:flex">
          <div className="border-b border-surface-200 px-4 py-3">
            <label className="sr-only" htmlFor="geo-filter">
              {view === "districts" ? "Find a district" : "Find a state"}
            </label>
            <input
              id="geo-filter"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={view === "districts" ? "Find a district" : "Find a state"}
              className="w-full rounded-full border border-border bg-paper px-3.5 py-2 text-[13px] text-ink placeholder:text-[#A39A8C] focus:border-brick focus:outline-none"
            />
          </div>
          <ul className="max-h-[26rem] divide-y divide-surface-200 overflow-y-auto">
            {shown.map((e) => (
              <li key={e.key}>
                <Link
                  href={e.href}
                  onMouseEnter={() => setHovered(e.key)}
                  onMouseLeave={() => setHovered(null)}
                  className="group flex items-baseline gap-2 px-4 py-2.5 hover:bg-paper"
                >
                  {e.badge !== undefined && (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: DISTRICT_COLORS[e.badge] ?? "#55606f" }}
                    >
                      {e.badge}
                    </span>
                  )}
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
