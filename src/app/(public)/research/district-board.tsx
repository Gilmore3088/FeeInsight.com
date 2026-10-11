"use client";

import { useState } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { DISTRICT_NAMES, STATE_TO_DISTRICT } from "@/lib/fed-districts";
import type { DistrictCoverage } from "@/lib/data-store/geographic";

/** One warm accent per district (taxonomy family palette), no rainbow. */
export const DISTRICT_COLORS: Record<number, string> = {
  1: "#C44B2E",
  2: "#8C3A52",
  3: "#B8862B",
  4: "#6B4A6E",
  5: "#6E5B4E",
  6: "#5B7A78",
  7: "#7A7F3F",
  8: "#C4A46A",
  9: "#A0522D",
  10: "#A93D25",
  11: "#8E2A17",
  12: "#7A7062",
};

const NUMBER = new Intl.NumberFormat("en-US");

export function DistrictBoard({ districts }: { districts: DistrictCoverage[] }) {
  const [active, setActive] = useState<number | null>(null);
  const activeRow = active === null ? null : districts.find((d) => d.district === active) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="relative rounded-2xl bg-white/70 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl p-3 sm:p-5">
        <svg viewBox="0 0 960 600" className="h-auto w-full" role="img" aria-label="Map of the 12 Federal Reserve districts. The list beside it gives each district's coverage.">
          {US_STATES.map((st) => {
            const d = STATE_TO_DISTRICT[st.id];
            const color = d ? DISTRICT_COLORS[d] : "#ECE6DC";
            const dim = active !== null && d !== active;
            return (
              <path
                key={st.id}
                d={st.d}
                fill={color}
                fillOpacity={dim ? 0.12 : active === d ? 0.95 : 0.55}
                stroke="#FFFFFF"
                strokeWidth={1.2}
                className="transition-[fill-opacity] duration-200"
                onMouseEnter={() => d && setActive(d)}
                onMouseLeave={() => setActive(null)}
              />
            );
          })}
        </svg>
        {/* Tooltip for the hovered district (or the focused list link). Hidden from screen
            readers: the list link it mirrors already reads the same figures. */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute left-4 top-4 w-60 rounded-xl bg-white/95 p-4 shadow-lg ring-1 ring-[#E8E1D6] backdrop-blur transition-opacity duration-200 motion-reduce:transition-none sm:left-6 sm:top-6 ${
            activeRow ? "opacity-100" : "opacity-0"
          }`}
        >
          {activeRow && (
            <>
              <p className="text-[15px] font-semibold text-[#1A1815]">
                {DISTRICT_NAMES[activeRow.district] ?? `District ${activeRow.district}`} district
              </p>
              <dl className="mt-2 space-y-1 text-[12px] text-[#3D3830]">
                <div className="flex justify-between gap-3">
                  <dt>Institutions with fees</dt>
                  <dd className="font-semibold text-[#1A1815] [font-variant-numeric:tabular-nums]">
                    {NUMBER.format(activeRow.verified_institutions)} of {NUMBER.format(activeRow.monitored)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Published fees</dt>
                  <dd className="font-semibold text-[#1A1815] [font-variant-numeric:tabular-nums]">{NUMBER.format(activeRow.verified_fees)}</dd>
                </div>
              </dl>
            </>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-[#5A5347]">
          States are shaded by their main district. Some states are split between two districts; the counts beside the
          map use each institution&apos;s own district.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {districts.map((d) => {
          const coverage = d.monitored > 0 ? d.verified_institutions / d.monitored : 0;
          const color = DISTRICT_COLORS[d.district] ?? "#7A7062";
          return (
            <li key={d.district}>
              <Link
                href={`/research/district/${d.district}`}
                onMouseEnter={() => setActive(d.district)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(d.district)}
                onBlur={() => setActive(null)}
                className={`group block h-full rounded-xl bg-white/75 px-4 py-3 ring-1 backdrop-blur transition-[box-shadow,background-color] duration-200 hover:bg-white hover:shadow-md ${
                  active === d.district ? "shadow-md ring-[#1A1815]/30" : "ring-[#E8E1D6]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: color }}
                  >
                    {d.district}
                  </span>
                  <span className="truncate text-[13px] font-semibold text-[#1A1815] group-hover:text-[#A93D25]">
                    {DISTRICT_NAMES[d.district] ?? `District ${d.district}`}
                  </span>
                  <span className="ml-auto text-[13px] font-semibold text-[#1A1815] [font-variant-numeric:tabular-nums]">{Math.round(coverage * 100)}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F1EBE1]">
                  <div className="h-full rounded-full" style={{ width: `${coverage * 100}%`, background: color }} />
                </div>
                <p className="mt-1.5 flex justify-between gap-2 whitespace-nowrap text-[11px] text-[#5A5347] [font-variant-numeric:tabular-nums]">
                  <span>{NUMBER.format(d.verified_institutions)} of {NUMBER.format(d.monitored)} institutions</span>
                  <span>{NUMBER.format(d.verified_fees)} fees</span>
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
