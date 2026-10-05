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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="rounded-2xl border border-[#E8DFD1] bg-white p-3 sm:p-5">
        <svg viewBox="0 0 960 600" className="h-auto w-full" role="img" aria-label="Map of the 12 Federal Reserve districts">
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
        <p className="mt-2 text-center text-[11px] text-[#8A8072]">
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
                className={`group block rounded-xl border bg-white px-4 py-3 transition-all hover:shadow-md ${
                  active === d.district ? "border-[#1A1815]/30 shadow-md" : "border-[#E8DFD1]"
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
                  <span className="ml-auto text-[13px] font-semibold tabular-nums text-[#1A1815]">{Math.round(coverage * 100)}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F1EBE1]">
                  <div className="h-full rounded-full" style={{ width: `${coverage * 100}%`, background: color }} />
                </div>
                <p className="mt-1.5 flex justify-between gap-2 whitespace-nowrap text-[11px] tabular-nums text-[#6B6255]">
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
