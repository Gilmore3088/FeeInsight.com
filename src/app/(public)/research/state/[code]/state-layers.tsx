"use client";

import { useState } from "react";
import { districtDifferences, money, sameLabel, sameMedian, type DistrictRow } from "./market-compare-view";

/**
 * The state page's four geographic layers: local, state, district and U.S. A sticky row of
 * links under the site header, short names on phones, and a plain heading that opens each layer.
 */

export function LayerNav({ layers }: { layers: { id: string; label: string; short: string }[] }) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-[57px] z-30 -mx-4 border-b border-border bg-surface-0/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 print:hidden"
    >
      <ol className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {layers.map((l) => (
          <li key={l.id} className="shrink-0">
            <a
              href={`#${l.id}`}
              className="flex min-h-11 items-center rounded-md px-3 text-[14px] font-medium text-ink-soft hover:bg-paper hover:text-ink"
            >
              <span className="sm:hidden">{l.short}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A layer's plain heading and its one supporting line; the sticky row above names the layers. */
export function LayerHead({ title, line, id, live }: { title: string; line?: string; id: string; live?: boolean }) {
  return (
    <div className="max-w-3xl">
      <h2 id={id} className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[38px]">
        {title}
      </h2>
      {line && (
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft sm:mx-0 sm:mt-3" aria-live={live ? "polite" : undefined}>
          {line}
        </p>
      )}
    </div>
  );
}

/** District rows shown before "Show all". */
const DISTRICT_ROWS_SHOWN = 5;

function Gap({ r }: { r: DistrictRow }) {
  if (sameMedian(r)) return <span className="text-[13px] text-ink-muted">{sameLabel(r)}</span>;
  return (
    <span className={`font-mono text-[14px] tabular-nums ${r.diff > 0 ? "text-brick" : "text-ink"}`}>
      {r.diff > 0 ? "+" : "−"}
      {money(Math.abs(r.diff))}
    </span>
  );
}

/**
 * Each fee's state median beside its district median. The fees that differ come first, largest
 * gap first, and five show before "Show all". Phones get a stacked list rather than a squeezed table.
 */
export function DistrictCompare({ rows, stateName, districtName }: { rows: DistrictRow[]; stateName: string; districtName: string }) {
  const [all, setAll] = useState(false);
  const ordered = [...districtDifferences(rows), ...rows.filter((r) => sameMedian(r))];
  const shown = all ? ordered : ordered.slice(0, DISTRICT_ROWS_SHOWN);
  const widest = Math.max(0.01, ...rows.map((r) => Math.abs(r.diff)));
  return (
    <div>
      <ul className="divide-y divide-border border-y border-border md:hidden" aria-label={`${stateName} median against the ${districtName} district median, by fee`}>
        {shown.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium leading-tight text-ink">{r.name}</p>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                {stateName} <span className="font-mono text-ink">{money(r.state)}</span> ({r.stateInstitutions} inst.) · District{" "}
                <span className="font-mono text-ink">{money(r.district)}</span> ({r.districtInstitutions} inst.)
              </p>
            </div>
            <Gap r={r} />
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left md:table">
        <caption className="sr-only">
          {stateName} median against the {districtName} district median, by fee
        </caption>
        <thead>
          <tr className="border-b border-ink text-[12px] uppercase tracking-[0.08em] text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">Fee</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">{stateName}</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">District</th>
            <th scope="col" className="w-[34%] py-2 text-center font-semibold">
              Lower in {stateName} <span aria-hidden="true">|</span> Higher in {stateName}
            </th>
            <th scope="col" className="w-[9rem] py-2 pl-3 text-right font-semibold">Gap</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const share = (Math.abs(r.diff) / widest) * 50;
            return (
              <tr key={r.key} className="border-b border-border">
                <th scope="row" className="py-3 pr-3 text-[14px] font-medium text-ink">
                  {r.name}
                </th>
                <td className="py-3 pr-3 text-right">
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{money(r.state)}</span>
                  <span className="block text-[11px] text-ink-muted">{r.stateInstitutions} inst.</span>
                </td>
                <td className="py-3 pr-3 text-right">
                  <span className="font-mono text-[15px] tabular-nums text-ink-soft">{money(r.district)}</span>
                  <span className="block text-[11px] text-ink-muted">{r.districtInstitutions} inst.</span>
                </td>
                <td className="py-3" aria-hidden="true">
                  <div className="relative h-3">
                    <span className="absolute inset-y-[-4px] left-1/2 w-px bg-ink-muted" />
                    {!sameMedian(r) && (
                      <span
                        className={`absolute inset-y-0 rounded-sm ${r.diff > 0 ? "left-1/2 bg-brick" : "right-1/2 bg-ink/60"}`}
                        style={{ width: `${Math.max(1, share)}%` }}
                      />
                    )}
                  </div>
                </td>
                <td className="py-3 pl-3 text-right">
                  <Gap r={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ordered.length > DISTRICT_ROWS_SHOWN && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 px-1 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {all ? "Show fewer" : `Show all ${ordered.length} fees`}
          <span aria-hidden="true" className={`transition-transform ${all ? "rotate-180" : ""}`}>▾</span>
        </button>
      )}
    </div>
  );
}
