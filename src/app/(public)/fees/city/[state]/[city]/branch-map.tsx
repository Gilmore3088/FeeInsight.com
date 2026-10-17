"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { BranchPoint } from "@/lib/data-store";
import { BranchList } from "./branch-list";
import { trimmedBounds } from "./market-exhibits";

/** MapLibre is loaded in the browser only, after the page; the server never renders it. */
const BranchMapGL = dynamic(() => import("./branch-map-gl"), { ssr: false });

/**
 * The live branch map, with a compact branch list in its place when WebGL or the street tiles are
 * unavailable. Shows a quiet placeholder while the map loads.
 */
export function BranchMapLive({
  points,
  unplaced,
  label,
  branchesById,
}: {
  points: BranchPoint[];
  unplaced: Omit<BranchPoint, "lat" | "lon">[];
  label: string;
  branchesById: Record<number, number>;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [boundary, setBoundary] = useState(false);
  const bounds = useMemo(() => {
    const b = trimmedBounds(points);
    return [
      [b.lon0, b.lat0],
      [b.lon1, b.lat1],
    ] as [[number, number], [number, number]];
  }, [points]);
  if (points.length < 2) return null;
  if (state === "failed") return <BranchList points={points} unplaced={unplaced} label={label} />;
  const banks = points.filter((p) => p.charter === "bank").length;

  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-surface-0">
      <div className="relative">
        <BranchMapGL
          points={points}
          bounds={bounds}
          branchesById={branchesById}
          label={label}
          onReady={() => setState("ready")}
          onFail={() => setState("failed")}
          onBoundary={setBoundary}
        />
        {state === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper text-[13px] text-ink-muted" aria-hidden="true">
            Loading map
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" aria-hidden="true" /> {banks} bank branches mapped
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brick" aria-hidden="true" /> {points.length - banks} credit union branches mapped
        </span>
        {boundary && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t border-dashed border-ink/60" aria-hidden="true" /> City and town limits
          </span>
        )}
        <span>Select a branch to see its institution.</span>
        {unplaced.length > 0 && (
          <span>
            {unplaced.length} {unplaced.length === 1 ? "branch has" : "branches have"} no coordinates in the FDIC or NCUA records, so{" "}
            {unplaced.length === 1 ? "it is" : "they are"} counted but not on the map.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
