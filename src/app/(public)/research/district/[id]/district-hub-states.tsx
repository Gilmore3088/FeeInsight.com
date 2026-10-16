"use client";

import { useState, type MouseEvent, type ReactNode } from "react";

/**
 * The district's states, one picked at a time. The server draws the map, each state's panel
 * and every table cell; this component only keeps the pick (a state chip, a tap on the map or
 * a table row) and the table's sort.
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

interface Props {
  states: { code: string; name: string }[];
  map: ReactNode;
  panels: Record<string, ReactNode>;
  columns: HubTableColumn[];
  rows: HubTableRow[];
  initial: string;
}

const CODE = /^[A-Z]{2}$/;

export function HubStates({ states, map, panels, columns, rows, initial }: Props) {
  const [picked, setPicked] = useState(initial);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);

  const onMap = (e: MouseEvent<HTMLDivElement>) => {
    const code = (e.target as Element).closest?.("[data-state]")?.getAttribute("data-state");
    if (code && panels[code]) setPicked(code);
  };

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

  return (
    <div className="space-y-4">
      {/* Phones pick from one menu instead of a row of chips that runs off the screen. */}
      <label className="block sm:hidden">
        <span className="sr-only">Pick a state</span>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="min-h-11 w-full rounded-full border border-ink bg-surface-0 px-4 text-[14px] font-semibold text-ink"
        >
          {states.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div role="group" aria-label="Pick a state" className="hidden flex-wrap gap-2 sm:flex">
        {states.map((s) => (
          <button
            key={s.code}
            type="button"
            aria-pressed={picked === s.code}
            onClick={() => setPicked(s.code)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-[13px] font-semibold transition-colors ${
              picked === s.code ? "border-ink bg-ink text-on-ink" : "border-border bg-surface-0 text-ink hover:border-ink/40"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 rounded-2xl border border-border bg-surface-0 p-4 shadow-fi-1 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        {/* The map is a shortcut for pointer users; the chips above are the same choice for everyone. */}
        <div data-hub-map="" onClick={onMap} className="cursor-pointer" aria-hidden="true">
          {CODE.test(picked) && <style>{`[data-hub-map] [data-state="${picked}"] path { fill: #b23a32; }`}</style>}
          {map}
        </div>
        <div aria-live="polite">{panels[picked]}</div>
      </div>

      {rows.length > 1 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-0 shadow-fi-1">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] sm:min-w-[560px]">
              <thead>
                <tr className="border-b border-border bg-paper">
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
                  <tr key={r.code} className={picked === r.code ? "bg-paper" : "hover:bg-paper/60"}>
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
        </div>
      )}
    </div>
  );
}
