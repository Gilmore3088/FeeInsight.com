"use client";

import { useState } from "react";
import Link from "next/link";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { formatAmount } from "@/lib/format";

interface StateData {
  state_code: string;
  institution_count: number;
  fee_count: number;
  median_overdraft?: number | null;
}

interface UsStateMapProps {
  statesData: StateData[];
}

export function UsStateMap({ statesData }: UsStateMapProps) {
  const [hovered, setHovered] = useState<StateData | null>(null);

  const dataMap = new Map(statesData.map((s) => [s.state_code, s]));
  const maxInst = Math.max(...statesData.map((s) => s.institution_count), 1);

  function getFill(code: string): string {
    const data = dataMap.get(code);
    if (!data) return "#f1f5f9";
    const intensity = data.institution_count / maxInst;
    if (intensity > 0.6) return "#b23a32";
    if (intensity > 0.4) return "#b23a32";
    if (intensity > 0.2) return "#DE8A72";
    if (intensity > 0.1) return "#F0C9BE";
    return "#f1d5d0";
  }

  return (
    <div className="relative">
      <svg
        viewBox="0 0 960 600"
        className="w-full h-auto"
        role="img"
        aria-label="Map of US states with fee data coverage"
      >
        {US_STATES.map((state) => {
          const data = dataMap.get(state.id);
          return (
            <Link
              key={state.id}
              href={`/research/state/${state.id}`}
              aria-label={`${state.name}: ${data ? data.institution_count + " institutions" : "no data"}`}
            >
              <path
                d={state.d}
                fill={getFill(state.id)}
                stroke="#ffffff"
                strokeWidth="1.5"
                className="transition-all duration-150 cursor-pointer hover:brightness-90 hover:stroke-slate-400 hover:stroke-[2]"
                onMouseEnter={() => setHovered(data || null)}
                onMouseLeave={() => setHovered(null)}
              />
            </Link>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div className="absolute top-3 right-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-md pointer-events-none">
          <p className="text-sm font-bold text-slate-900">
            {STATE_NAMES[hovered.state_code] ?? hovered.state_code}
          </p>
          <div className="mt-1.5 space-y-0.5 text-[12px] text-slate-500">
            <p>
              <span className="font-semibold text-slate-700 tabular-nums">
                {hovered.institution_count.toLocaleString()}
              </span>{" "}
              institutions
            </p>
            <p>
              <span className="font-semibold text-slate-700 tabular-nums">
                {hovered.fee_count.toLocaleString()}
              </span>{" "}
              fees extracted
            </p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-slate-400">
        <div className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brick-tint" />
          <span>Fewer institutions</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brick" />
          <span>More institutions</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f1f5f9]" />
          <span>No data</span>
        </div>
      </div>
    </div>
  );
}
