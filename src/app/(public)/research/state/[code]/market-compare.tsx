"use client";

import { useState } from "react";
import Link from "next/link";
import type { StateMarketMap } from "@/lib/geo/state-market-map";
import { LayerHead } from "./state-layers";
import { money, openingFee, type MarketPanel } from "./market-compare-view";

/**
 * The state page's local layer, inside the page: pick one of the state's largest markets and a
 * fee, and the ladder reads that market's median against the state, the state's Fed district
 * and the U.S., each with who it counts. The city page stays one link away for depth.
 */

const COUNT = new Intl.NumberFormat("en-US");
const SELECT = "mt-1 block min-h-11 w-full rounded-md border border-border bg-surface-0 px-3 text-[15px] text-ink";

function MarketMap({
  map,
  panels,
  selected,
  onSelect,
  stateName,
}: {
  map: StateMarketMap;
  panels: MarketPanel[];
  selected: string;
  onSelect: (city: string) => void;
  stateName: string;
}) {
  const box = map.viewBox.split(" ").map(Number);
  const unit = Math.max(box[2], box[3]) / 100;
  const biggest = Math.max(1, ...panels.map((p) => p.institutions));
  const radius = (n: number) => unit * (0.9 + 2.4 * Math.sqrt(n / biggest));
  const byCity = new Map(panels.map((p) => [p.city, p]));
  const order = [...map.points].sort((a, b) => (a.key === selected ? 1 : b.key === selected ? -1 : 0));
  return (
    <svg viewBox={map.viewBox} className="h-auto w-full" role="group" aria-label={`${stateName} markets on a map`}>
      {map.neighbors.map((d, i) => (
        <path key={i} d={d} className="fill-[var(--fi-viz-none)] stroke-paper" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={map.state} className="fill-[var(--fi-viz-1)] stroke-paper" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {order.map((pt) => {
        const p = byCity.get(pt.key);
        if (!p) return null;
        const on = pt.key === selected;
        // Only the selected market is named; the label sits on the side away from the nearer edge.
        const leftSide = pt.x > box[0] + box[2] * 0.6;
        return (
          <g
            key={pt.key}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`${p.name}: ${p.institutions} institutions with a branch`}
            onClick={() => onSelect(pt.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(pt.key);
              }
            }}
            className="cursor-pointer focus:outline-none [&:focus-visible>circle]:stroke-ink"
          >
            <circle
              cx={pt.x}
              cy={pt.y}
              r={radius(p.institutions)}
              className={on ? "fill-brick stroke-paper" : "fill-ink/35 stroke-paper hover:fill-ink/60"}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            <title>{`${p.name}: ${p.institutions} institutions with a branch`}</title>
            {on && (
              <text
                x={leftSide ? pt.x - radius(p.institutions) - unit * 0.8 : pt.x + radius(p.institutions) + unit * 0.8}
                textAnchor={leftSide ? "end" : "start"}
                y={pt.y + unit * 1.1}
                fontSize={unit * 4}
                fontWeight={700}
                className="pointer-events-none fill-ink stroke-paper"
                strokeWidth={unit * 0.6}
                paintOrder="stroke"
              >
                {p.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MarketCompare({
  panels,
  map,
  stateName,
  directoryHref,
  title,
  headingId,
}: {
  panels: MarketPanel[];
  map: StateMarketMap | null;
  stateName: string;
  directoryHref: string;
  title: string;
  headingId: string;
}) {
  const [city, setCity] = useState(panels[0]?.city ?? "");
  const panel = panels.find((p) => p.city === city) ?? panels[0];
  const [feeKey, setFeeKey] = useState<string | null>(panel ? openingFee(panel) : null);
  const [showMap, setShowMap] = useState(false);
  if (!panel) return null;
  const fee = panel.fees.find((f) => f.key === feeKey) ?? panel.fees[0];
  const top = fee ? Math.max(1, ...fee.rungs.map((r) => r.median ?? 0)) : 1;

  // Report order: title, the one finding for what is picked, then the exhibit.
  return (
    <div className="space-y-6 sm:space-y-8">
    <LayerHead id={headingId} title={title} line={fee?.takeaway} live />
    <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      <div className="space-y-4">
        {/* Phones pick with two dropdowns; the map opens on request. */}
        <div className="grid gap-3 sm:hidden">
          <label className="block min-w-0">
            <span className="text-[12px] font-medium text-ink-muted">Market</span>
            <select value={panel.city} onChange={(e) => setCity(e.target.value)} className={SELECT}>
              {panels.map((p) => (
                <option key={p.city} value={p.city}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {fee && (
            <label className="block min-w-0">
              <span className="text-[12px] font-medium text-ink-muted">Fee</span>
              <select value={fee.key} onChange={(e) => setFeeKey(e.target.value)} className={SELECT}>
                {panel.fees.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {map && (
          <>
            <button
              type="button"
              aria-expanded={showMap}
              onClick={() => setShowMap((v) => !v)}
              className="inline-flex min-h-11 items-center text-[13px] font-semibold text-ink underline decoration-border underline-offset-4 sm:hidden"
            >
              {showMap ? "Hide the map" : `Show the markets on a map of ${stateName}`}
            </button>
            <div className={showMap ? "sm:block" : "hidden sm:block"}>
              <MarketMap map={map} panels={panels} selected={panel.city} onSelect={setCity} stateName={stateName} />
            </div>
          </>
        )}
        <div className="hidden flex-wrap gap-2 sm:flex" role="group" aria-label={`Pick a ${stateName} market`}>
          {panels.map((p) => (
            <button
              key={p.city}
              type="button"
              aria-pressed={p.city === panel.city}
              onClick={() => setCity(p.city)}
              className={`min-h-11 rounded-full px-3.5 text-[13px] font-medium ring-1 transition-colors ${
                p.city === panel.city ? "bg-ink text-on-ink ring-ink" : "bg-surface-0 text-ink ring-border hover:ring-ink"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ink-muted">
          {stateName}&apos;s {panels.length} largest markets by institutions with a branch there.{" "}
          <Link href={directoryHref} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
            Every {stateName} market
          </Link>
        </p>
      </div>

      <div className="min-w-0 space-y-5 sm:space-y-7">

        {fee ? (
          <>
            <div className="hidden flex-wrap gap-1.5 sm:flex" role="group" aria-label="Pick a fee">
              {panel.fees.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={f.key === fee.key}
                  onClick={() => setFeeKey(f.key)}
                  className={`min-h-11 rounded-md px-2.5 text-[13px] ring-1 transition-colors ${
                    f.key === fee.key ? "bg-brick font-semibold text-on-ink ring-brick" : "text-ink-soft ring-border hover:text-ink hover:ring-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div>
              <ol className="divide-y divide-border border-y border-border" aria-label={`${fee.label} median by geography`}>
                {fee.rungs.map((r) => (
                  <li key={r.level} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_5.5rem]">
                    <div className="min-w-0">
                      <p className={`text-[15px] leading-tight text-ink ${r.level === "city" ? "font-semibold" : "font-medium"}`}>{r.place}</p>
                      <p className="text-[12px] text-ink-muted">
                        {r.median != null ? `${COUNT.format(r.institutions)} institutions` : `${r.institutions} publish it`}
                      </p>
                    </div>
                    <div className="order-last col-span-2 h-2.5 rounded-sm bg-surface-200 sm:order-none sm:col-span-1" aria-hidden="true">
                      {r.median != null && (
                        <div
                          className={`h-2.5 rounded-sm ${r.level === "city" ? "bg-brick" : "bg-ink/45"}`}
                          style={{ width: `${Math.max(2, (r.median / top) * 100)}%` }}
                        />
                      )}
                    </div>
                    <p className="text-right font-mono text-[20px] font-semibold leading-none tabular-nums text-ink">
                      {r.median != null ? money(r.median) : "n/a"}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <p className="text-[12px] text-ink-muted sm:mx-0">
              Coverage: {COUNT.format(panel.institutions)} institutions have a branch in {panel.name}; {COUNT.format(panel.withFees)} publish fees.
            </p>
            <details className="group/how">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="transition-transform group-open/how:rotate-90">
                  &rsaquo;
                </span>
                Who each median counts
              </summary>
              <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-[12px] leading-snug text-ink-muted sm:grid-cols-[auto_minmax(0,1fr)]">
                {fee.rungs.map((r) => (
                  <div key={r.level} className="contents">
                    <dt className="font-medium text-ink-soft">{r.place}</dt>
                    <dd className="mb-1 sm:mb-0">{r.population}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        ) : (
          <p className="text-[14px] text-ink-muted">No fee has a {stateName} median to compare yet.</p>
        )}

        <Link
          href={panel.href}
          className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          Open the full {panel.name} report
        </Link>
      </div>
    </div>
    </div>
  );
}
