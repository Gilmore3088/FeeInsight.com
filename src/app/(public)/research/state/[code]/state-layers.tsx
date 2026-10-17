"use client";

import { useState } from "react";
import { districtDifferences, money, sameLabel, sameMedian, type DistrictRow } from "./market-compare-view";

/**
 * The state page's four geographic layers: local, state, district and U.S. A sticky row of
 * numbered links under the site header, and a numbered heading that opens each layer.
 */

export function LayerNav({ layers }: { layers: { id: string; label: string }[] }) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-[57px] z-30 -mx-4 border-b border-border bg-surface-0/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 print:hidden"
    >
      <ol className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {layers.map((l, i) => (
          <li key={l.id} className="shrink-0">
            <a
              href={`#${l.id}`}
              className="flex min-h-10 items-center gap-2 rounded-md px-3 text-[14px] font-medium text-ink-soft hover:bg-paper hover:text-ink"
            >
              <span className="font-mono text-[12px] text-brick">{String(i + 1).padStart(2, "0")}</span>
              {l.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LayerHead({ n, place, title, line, id }: { n: number; place: string; title: string; line?: string; id: string }) {
  return (
    <div className="max-w-3xl">
      <p className="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-brick">
        <span className="font-mono">{String(n).padStart(2, "0")}</span>
        <span aria-hidden="true" className="h-px w-8 bg-brick" />
        {place}
      </p>
      <h2 id={id} className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[42px]">
        {title}
      </h2>
      {line && <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{line}</p>}
    </div>
  );
}

/**
 * Each fee's state median beside its district median, with the gap drawn from a center line. The
 * fees that differ show first, largest gap first; the rest open behind one control.
 */
export function DistrictCompare({ rows, stateName, districtName }: { rows: DistrictRow[]; stateName: string; districtName: string }) {
  const [all, setAll] = useState(false);
  const differ = districtDifferences(rows);
  const hidden = differ.length > 0 ? rows.length - differ.length : 0;
  const shown = all || hidden === 0 ? [...differ, ...rows.filter((r) => sameMedian(r))] : differ;
  const widest = Math.max(0.01, ...rows.map((r) => Math.abs(r.diff)));
  return (
    <div className="overflow-hidden">
      <table className="w-full text-left">
        <caption className="sr-only">
          {stateName} median against the {districtName} district median, by fee
        </caption>
        <thead>
          <tr className="border-b border-ink text-[12px] uppercase tracking-[0.08em] text-ink-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">Fee</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">{stateName}</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">District</th>
            <th scope="col" className="hidden w-[34%] py-2 text-center font-semibold md:table-cell">
              Lower in {stateName} <span aria-hidden="true">|</span> Higher in {stateName}
            </th>
            <th scope="col" className="w-[7.5rem] py-2 pl-3 text-right font-semibold sm:w-[9rem]">Gap</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const same = sameMedian(r);
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
                <td className="hidden py-3 md:table-cell" aria-hidden="true">
                  <div className="relative h-3">
                    <span className="absolute inset-y-[-4px] left-1/2 w-px bg-ink-muted" />
                    {!same && (
                      <span
                        className={`absolute inset-y-0 rounded-sm ${r.diff > 0 ? "left-1/2 bg-brick" : "right-1/2 bg-ink/60"}`}
                        style={{ width: `${Math.max(1, share)}%` }}
                      />
                    )}
                  </div>
                </td>
                <td
                  className={`py-3 pl-3 text-right tabular-nums ${
                    same ? "font-sans text-[13px] text-ink-muted" : `font-mono text-[14px] ${r.diff > 0 ? "text-brick" : "text-ink"}`
                  }`}
                >
                  {same ? sameLabel(r) : `${r.diff > 0 ? "+" : "−"}${money(Math.abs(r.diff))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {all ? `Show only the ${differ.length} that differ` : `Compare all ${rows.length} fees`}
          <span aria-hidden="true" className={`transition-transform ${all ? "rotate-180" : ""}`}>▾</span>
        </button>
      )}
    </div>
  );
}
