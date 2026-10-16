"use client";

import { useState, type ReactNode } from "react";
import { formatFeeAmount } from "@/lib/format";

/**
 * The district's states as small multiples: one card per state, each showing the same picked fee
 * on one shared scale against the district median, so the states compare at a glance. A card is
 * also the state picker: picking one opens its panel below. The full table sits behind a
 * disclosure. The server draws each panel and every table cell; this component keeps the picks
 * and the table's sort.
 */

export interface HubTableColumn {
  key: string;
  label: string;
  /** Shown on phones too; the rest appear from the sm breakpoint, and every figure is in the state's panel. */
  phone?: boolean;
}

export interface HubTableRow {
  code: string;
  name: string;
  /** v sorts, t shows; v null sorts last and shows t (usually a dash). */
  cells: Record<string, { v: number | null; t: string }>;
}

export interface HubFeeOption {
  key: string;
  label: string;
  /** The district median for this fee; null when too few institutions report it. */
  district: number | null;
  /** Each state's median for this fee, null when the state has too few institutions. */
  byState: Record<string, number | null>;
}

interface Props {
  states: { code: string; name: string }[];
  /** Each state's outline: a path and the viewBox cropped around it. */
  shapes: Record<string, { d: string; viewBox: string }>;
  fees: HubFeeOption[];
  districtName: string;
  panels: Record<string, ReactNode>;
  columns: HubTableColumn[];
  rows: HubTableRow[];
  initial: string;
}

const money = (n: number) => formatFeeAmount(n) ?? "-";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function HubStates({ states, shapes, fees, districtName, panels, columns, rows, initial }: Props) {
  const [picked, setPicked] = useState(initial);
  const [feeKey, setFeeKey] = useState(fees[0]?.key ?? "");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const fee = fees.find((f) => f.key === feeKey) ?? fees[0] ?? null;

  const values = fee ? states.map((s) => fee.byState[s.code]).filter((v): v is number => v != null) : [];
  const max = Math.max(...values, fee?.district ?? 0, 1) * 1.1;

  const sorted = sort
    ? [...rows].sort((a, b) => {
        const av = a.cells[sort.key]?.v ?? null;
        const bv = b.cells[sort.key]?.v ?? null;
        if (av === null && bv === null) return a.name.localeCompare(b.name);
        if (av === null) return 1;
        if (bv === null) return -1;
        return sort.desc ? bv - av : av - bv;
      })
    : rows;

  const th = "px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted";
  const all = states.length <= 10 ? WORDS[states.length] : String(states.length);

  return (
    <div className="space-y-6">
      {fees.length > 1 && (
        <div role="group" aria-label="Pick a fee" className="flex flex-wrap justify-center gap-2 sm:justify-start">
          {fees.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={f.key === feeKey}
              onClick={() => setFeeKey(f.key)}
              className={`min-h-10 shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                f.key === feeKey ? "bg-ink text-on-ink" : "bg-surface-200 text-ink hover:bg-ink/15"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {fee && fee.district != null && (
        <p className="flex items-center justify-center gap-2 text-[12px] text-ink-muted sm:justify-start">
          <span aria-hidden="true" className="h-3.5 w-0.5 rounded bg-brick" />
          {districtName} median, {money(fee.district)}
        </p>
      )}

      <div role="group" aria-label="Pick a state" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {states.map((s) => {
          const value = fee ? fee.byState[s.code] : null;
          const shape = shapes[s.code];
          const pressed = picked === s.code;
          return (
            <button
              key={s.code}
              type="button"
              aria-pressed={pressed}
              aria-label={`${s.name}${fee ? `: ${fee.label} median ${value != null ? money(value) : "not available yet"}` : ""}`}
              onClick={() => setPicked(s.code)}
              className={`flex flex-col rounded-xl bg-surface-0 p-3 text-left transition-shadow focus-visible:outline-2 focus-visible:outline-ink ${
                pressed ? "ring-2 ring-ink" : "ring-1 ring-border hover:ring-ink/40"
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold leading-tight text-ink">{s.name}</span>
                {shape && (
                  <svg viewBox={shape.viewBox} className="h-9 w-9 shrink-0" aria-hidden="true">
                    <path d={shape.d} className={pressed ? "fill-brick" : "fill-[var(--fi-viz-3)]"} />
                  </svg>
                )}
              </span>
              <span className="mt-3 font-mono text-[28px] font-semibold leading-none tabular-nums text-ink">
                {value != null ? money(value) : <span className="text-[13px] font-normal text-ink-muted">Too few yet</span>}
              </span>
              <span className="relative mt-3 block h-2 w-full rounded-full bg-surface-200" aria-hidden="true">
                {value != null && <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${(value / max) * 100}%` }} />}
                {fee?.district != null && (
                  <span className="absolute -inset-y-1 w-0.5 rounded bg-brick" style={{ left: `${(fee.district / max) * 100}%` }} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="border-t border-border pt-6">
        {panels[picked]}
      </div>

      {rows.length > 1 && (
        <details className="group/disc">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="transition-transform group-open/disc:rotate-90">
              &rsaquo;
            </span>
            {states.length === 2 ? "Compare both states" : `Compare all ${all} states`}
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px] sm:min-w-[560px]">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>
                    State
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`${th} text-right ${c.phone ? "" : "hidden sm:table-cell"}`}
                      aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
                    >
                      <button
                        type="button"
                        className="inline-flex min-h-8 items-center gap-1 uppercase hover:text-ink"
                        onClick={() => setSort((s) => ({ key: c.key, desc: s?.key === c.key ? !s.desc : true }))}
                      >
                        {c.label}
                        <span aria-hidden="true">{sort?.key === c.key ? (sort.desc ? "↓" : "↑") : "↕"}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200">
                {sorted.map((r) => (
                  <tr key={r.code} className={picked === r.code ? "bg-surface-200/50" : ""}>
                    <th scope="row" className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => setPicked(r.code)}
                        className={`text-left underline-offset-4 hover:underline ${picked === r.code ? "text-brick" : "text-ink"}`}
                      >
                        {r.name}
                      </button>
                    </th>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 text-right tabular-nums text-ink-soft ${c.phone ? "" : "hidden sm:table-cell"}`}>
                        {r.cells[c.key]?.t ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
