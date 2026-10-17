"use client";

import { useState } from "react";
import Link from "next/link";
import type { StateMarketMap } from "@/lib/geo/state-market-map";
import { CityCoverage, StateCityMap } from "@/components/public/state-city-map";
import { LayerHead } from "./state-layers";
import { money, openingFee, type MarketPanel } from "./market-compare-view";

/**
 * The state page's local layer, inside the page: pick one of the state's largest markets and a
 * fee, and the ladder reads that market's median against the state, the state's Fed district
 * and the U.S., each with who it counts. The city page stays one link away for depth.
 */

const COUNT = new Intl.NumberFormat("en-US");
const SELECT = "mt-1 block min-h-11 w-full rounded-md border border-border bg-surface-0 px-3 text-[15px] text-ink";

/** Each market's median for the picked fee, as rows that also pick the market. */
function MarketRows({
  panels,
  feeKey,
  feeLabel,
  stateMedian,
  stateName,
  selected,
  onSelect,
}: {
  panels: MarketPanel[];
  feeKey: string;
  feeLabel: string;
  stateMedian: number | null;
  stateName: string;
  selected: string;
  onSelect: (city: string) => void;
}) {
  const medians = panels.map((p) => p.fees.find((f) => f.key === feeKey)?.rungs.find((r) => r.level === "city")?.median ?? null);
  const top = Math.max(1, stateMedian ?? 0, ...medians.map((m) => m ?? 0));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12px] text-ink-muted">
        <span className="font-medium text-ink-soft">{feeLabel} median by market</span>
        {stateMedian != null && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3 w-px bg-ink" />
            {stateName} {money(stateMedian)}
          </span>
        )}
      </div>
      <ul className="mt-2 divide-y divide-border border-y border-border" aria-label={`${feeLabel} median in ${stateName}'s largest markets`}>
        {panels.map((p, i) => {
          const m = medians[i];
          const on = p.city === selected;
          return (
            <li key={p.city}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(p.city)}
                className={`grid min-h-11 w-full grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem] items-center gap-3 px-1 text-left text-[14px] ${
                  on ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"
                }`}
              >
                <span className="truncate">{p.name}</span>
                <span className="relative h-2.5 rounded-sm bg-surface-200" aria-hidden="true">
                  {m != null && (
                    <span className={`absolute inset-y-0 left-0 rounded-sm ${on ? "bg-brick" : "bg-ink/45"}`} style={{ width: `${Math.max(2, (m / top) * 100)}%` }} />
                  )}
                  {stateMedian != null && (
                    <span className="absolute -inset-y-1 w-px bg-ink" style={{ left: `${(stateMedian / top) * 100}%` }} />
                  )}
                </span>
                <span className="text-right font-mono tabular-nums text-ink">{m != null ? money(m) : <span className="font-sans text-[12px] text-ink-muted">Too few</span>}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
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
  if (!panel) return null;
  const fee = panel.fees.find((f) => f.key === feeKey) ?? panel.fees[0];
  const top = fee ? Math.max(1, ...fee.rungs.map((r) => r.median ?? 0)) : 1;

  // Report order: title, the one finding for what is picked, then the exhibit.
  return (
    <div className="space-y-6 sm:space-y-8">
    <LayerHead id={headingId} title={title} line={fee?.takeaway} live />
    <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      <div className="space-y-5">
        {/* Phones pick the fee from a menu; wider screens use the row of fee buttons beside the ladder. */}
        {fee && (
          <label className="block min-w-0 sm:hidden">
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
        {map && (
          <div className="mx-auto w-full max-w-[20rem] sm:max-w-none">
            <StateCityMap
              map={map}
              markers={panels.map((p) => ({ key: p.city, name: p.name, institutions: p.institutions, withFees: p.withFees }))}
              selected={panel.city}
              onSelect={setCity}
              label={`${stateName}'s largest markets on a map, sized by institutions with a branch`}
            />
          </div>
        )}
        {fee && (
          <MarketRows
            panels={panels}
            feeKey={fee.key}
            feeLabel={fee.label}
            stateMedian={fee.rungs.find((r) => r.level === "state")?.median ?? null}
            stateName={stateName}
            selected={panel.city}
            onSelect={setCity}
          />
        )}
        <p className="text-[12px] text-ink-muted sm:mx-0">
          {stateName}&apos;s {panels.length} largest markets by institutions with a branch there; marker size follows that count.{" "}
          <Link href={directoryHref} className="font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink">
            Every {stateName} city on the map
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

        <CityCoverage
          marker={{ key: panel.city, name: panel.name, institutions: panel.institutions, withFees: panel.withFees }}
          href={panel.href}
          headingLevel={3}
          onMap={!map || map.points.some((pt) => pt.key === panel.city)}
        />
      </div>
    </div>
    </div>
  );
}
