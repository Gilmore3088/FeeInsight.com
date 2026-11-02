"use client";
import { useMemo, useState } from "react";
import "./dashboard.css";
import { DASH, formatFigure, type FigureFormat } from "./format";

export interface SortableColumn {
  key: string;
  label: string;
  format: FigureFormat;
  /** Mark the column's highest value ▲ (brick) and lowest ▼ (sage) when they differ. */
  mark?: boolean;
}

export interface SortableRow {
  id: string;
  /** The row header: the institution's name. */
  label: string;
  /** A short note after the name, e.g. the city. */
  sublabel?: string | null;
  values: Record<string, number | null>;
  /** The subject institution: highlighted, and never a compare choice. */
  highlight?: boolean;
}

export type SortDirection = "ascending" | "descending";

/** Rows sorted by one column; empty values always last. */
export function sortRows(rows: SortableRow[], key: string, direction: SortDirection): SortableRow[] {
  return [...rows].sort((a, b) => {
    const va = a.values[key];
    const vb = b.values[key];
    if (va === null || va === undefined) return vb === null || vb === undefined ? a.label.localeCompare(b.label) : 1;
    if (vb === null || vb === undefined) return -1;
    return (direction === "ascending" ? va - vb : vb - va) || a.label.localeCompare(b.label);
  });
}

/** The column's high and low marks: null when fewer than two values differ. */
export function columnExtremes(rows: SortableRow[], key: string): { hi: number; lo: number } | null {
  const values = rows.map((r) => r.values[key]).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (values.length < 2) return null;
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  return hi === lo ? null : { hi, lo };
}

/**
 * A table sorted by any column (a header button; aria-sort on the header cell), with the subject's
 * row highlighted and each marked column's highest ▲ and lowest ▼. With `onRowSelect` each other
 * row's name is a toggle button (aria-pressed), e.g. to plot that institution beside the subject.
 */
export function SortableTable({
  caption,
  rowHeader = "Institution",
  columns,
  rows,
  defaultSort,
  selectedRowId = null,
  onRowSelect,
}: {
  /** Read by screen readers; the card title usually says it visibly. */
  caption: string;
  rowHeader?: string;
  columns: SortableColumn[];
  rows: SortableRow[];
  defaultSort?: { key: string; direction: SortDirection };
  selectedRowId?: string | null;
  onRowSelect?: (id: string | null) => void;
}) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(defaultSort ?? null);
  const sorted = useMemo(() => (sort ? sortRows(rows, sort.key, sort.direction) : rows), [rows, sort]);
  const extremes = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.mark ? columnExtremes(rows, c.key) : null])), [columns, rows]);
  return (
    <div className="hd-table-wrap">
      <table className="hd-table">
        <caption className="hd-sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="hd-left"><span>{rowHeader}</span></th>
            {columns.map((column) => {
              const on = sort?.key === column.key;
              return (
                <th key={column.key} scope="col" aria-sort={on ? sort!.direction : "none"} style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => setSort({ key: column.key, direction: on && sort!.direction === "descending" ? "ascending" : "descending" })}
                  >
                    {column.label}
                    <span aria-hidden="true">{on ? (sort!.direction === "descending" ? " ↓" : " ↑") : ""}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const pressed = selectedRowId === row.id;
            return (
              <tr key={row.id} className={row.highlight ? "hd-subject" : undefined}>
                <th scope="row">
                  {onRowSelect && !row.highlight ? (
                    <button type="button" aria-pressed={pressed} onClick={() => onRowSelect(pressed ? null : row.id)}>
                      {row.label}
                    </button>
                  ) : (
                    <span>{row.label}</span>
                  )}
                  {row.sublabel ? <span className="hd-muted" style={{ fontWeight: 400, fontSize: 12 }}> {row.sublabel}</span> : null}
                </th>
                {columns.map((column) => {
                  const v = row.values[column.key];
                  const sortedCol = sort?.key === column.key ? " hd-sorted" : "";
                  if (v === null || v === undefined) {
                    return <td key={column.key} className={`hd-empty${sortedCol}`}><span aria-hidden="true">{DASH}</span><span className="hd-sr">Not on file</span></td>;
                  }
                  const e = extremes[column.key];
                  const mark = e ? (v === e.hi ? "high" : v === e.lo ? "low" : null) : null;
                  return (
                    <td key={column.key} className={`${mark === "high" ? "hd-tone-above" : mark === "low" ? "hd-tone-below" : ""}${sortedCol}`}>
                      {formatFigure(v, column.format)}
                      {mark ? <><span aria-hidden="true">{mark === "high" ? " ▲" : " ▼"}</span><span className="hd-sr">{mark === "high" ? " (highest)" : " (lowest)"}</span></> : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
