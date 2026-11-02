"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import "./dashboard.css";
import { DASH, formatFigure, POSITION_LABEL, POSITION_MARK } from "./format";
import { columnExtremes, LABEL_SORT_KEY, pageOf, sortRows, type SortableColumn, type SortableRow, type SortDirection } from "./kit-math";

export type { SortableColumn, SortableRow, SortDirection } from "./kit-math";

/**
 * A table sorted by any column (a header button; aria-sort on the header cell), with the subject's
 * row highlighted and each marked column's highest ▲ and lowest ▼. With `onRowSelect` each other
 * row's name is a toggle button (aria-pressed), e.g. to plot that institution beside the subject.
 * With `pageSize` it pages (Prev / Next) and offers a button to the highlighted row's page; with
 * `labelSortable` the name column sorts too. A row may carry a cell's position mark (▲ ● ▼), its
 * own display text, a link on its name and source links in a last column.
 */
export function SortableTable({
  caption,
  rowHeader = "Institution",
  columns,
  rows,
  defaultSort,
  selectedRowId = null,
  onRowSelect,
  pageSize,
  findLabel,
  labelSortable = false,
  linksHeader,
}: {
  /** Read by screen readers; the card title usually says it visibly. */
  caption: string;
  rowHeader?: string;
  columns: SortableColumn[];
  rows: SortableRow[];
  defaultSort?: { key: string; direction: SortDirection };
  selectedRowId?: string | null;
  onRowSelect?: (id: string | null) => void;
  /** Rows per page; omitted, every row shows. */
  pageSize?: number;
  /** The text of the button that pages to the highlighted row ("Find Capital City Bank"). */
  findLabel?: string;
  /** Let the row header (the name) sort, A to Z first. */
  labelSortable?: boolean;
  /** With a header, each row's `links` show in a last column. */
  linksHeader?: string;
}) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => (sort ? sortRows(rows, sort.key, sort.direction) : rows), [rows, sort]);
  const extremes = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.mark ? columnExtremes(rows, c.key) : null])), [columns, rows]);
  const paging = pageSize ? pageOf(sorted.length, pageSize, page) : null;
  const shown = paging ? sorted.slice(paging.page * pageSize!, paging.page * pageSize! + pageSize!) : sorted;
  const subjectIndex = sorted.findIndex((r) => r.highlight);
  const sortBy = (key: string, first: SortDirection) => {
    const on = sort?.key === key;
    setSort({ key, direction: on ? (sort!.direction === "descending" ? "ascending" : "descending") : first });
    setPage(0);
  };
  const labelOn = sort?.key === LABEL_SORT_KEY;
  return (
    <div className="hd-table-block">
      <div className="hd-table-wrap">
        <table className="hd-table">
          <caption className="hd-sr">{caption}</caption>
          <thead>
            <tr>
              {labelSortable ? (
                <th scope="col" className="hd-left" aria-sort={labelOn ? sort!.direction : "none"}>
                  <button type="button" onClick={() => sortBy(LABEL_SORT_KEY, "ascending")}>
                    {rowHeader}
                    <span aria-hidden="true">{labelOn ? (sort!.direction === "descending" ? " ↓" : " ↑") : ""}</span>
                  </button>
                </th>
              ) : (
                <th scope="col" className="hd-left"><span>{rowHeader}</span></th>
              )}
              {columns.map((column) => {
                const on = sort?.key === column.key;
                return (
                  <th key={column.key} scope="col" aria-sort={on ? sort!.direction : "none"} style={{ textAlign: "right" }}>
                    <button type="button" onClick={() => sortBy(column.key, "descending")}>
                      {column.label}
                      <span aria-hidden="true">{on ? (sort!.direction === "descending" ? " ↓" : " ↑") : ""}</span>
                    </button>
                  </th>
                );
              })}
              {linksHeader ? <th scope="col" className="hd-left"><span>{linksHeader}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const pressed = selectedRowId === row.id;
              return (
                <tr key={row.id} className={row.highlight ? "hd-subject" : undefined}>
                  <th scope="row">
                    {onRowSelect && !row.highlight ? (
                      <button type="button" aria-pressed={pressed} onClick={() => onRowSelect(pressed ? null : row.id)}>
                        {row.label}
                      </button>
                    ) : row.href ? (
                      <Link href={row.href} className="hd-row-link">{row.label}</Link>
                    ) : (
                      <span>{row.label}</span>
                    )}
                    {row.sublabel ? <span className="hd-muted" style={{ fontWeight: 400, fontSize: 12 }}> {row.sublabel}</span> : null}
                  </th>
                  {columns.map((column) => {
                    const v = row.values[column.key];
                    const sortedCol = sort?.key === column.key ? " hd-sorted" : "";
                    const text = row.display?.[column.key];
                    if ((v === null || v === undefined) && text === undefined) {
                      return <td key={column.key} className={`hd-empty${sortedCol}`}><span aria-hidden="true">{DASH}</span><span className="hd-sr">Not on file</span></td>;
                    }
                    const position = row.positions?.[column.key];
                    if (position) {
                      return (
                        <td key={column.key} className={`hd-tone-${position}${sortedCol}`}>
                          {text ?? formatFigure(v, column.format)}
                          {position !== "too_few" ? <><span aria-hidden="true"> {POSITION_MARK[position]}</span><span className="hd-sr"> ({POSITION_LABEL[position].toLowerCase()})</span></> : null}
                        </td>
                      );
                    }
                    const e = extremes[column.key];
                    const mark = e && v !== null && v !== undefined ? (v === e.hi ? "high" : v === e.lo ? "low" : null) : null;
                    return (
                      <td key={column.key} className={`${mark === "high" ? "hd-tone-above" : mark === "low" ? "hd-tone-below" : ""}${sortedCol}`}>
                        {text ?? formatFigure(v, column.format)}
                        {mark ? <><span aria-hidden="true">{mark === "high" ? " ▲" : " ▼"}</span><span className="hd-sr">{mark === "high" ? " (highest)" : " (lowest)"}</span></> : null}
                      </td>
                    );
                  })}
                  {linksHeader ? (
                    <td className="hd-left hd-links-cell">
                      {row.links?.length ? row.links.map((link) => (
                        <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
                      )) : <span className="hd-muted">{DASH}</span>}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paging && (paging.pages > 1 || (findLabel && subjectIndex >= 0)) ? (
        <div className="hd-pager">
          {findLabel && subjectIndex >= 0 ? (
            <button type="button" className="hd-pager-find" onClick={() => setPage(Math.floor(subjectIndex / pageSize!))}>{findLabel}</button>
          ) : <span />}
          {paging.pages > 1 ? <div className="hd-pager-steps">
            <button type="button" aria-label="Previous page" disabled={paging.page === 0} onClick={() => setPage(paging.page - 1)}>‹ Prev</button>
            <span className="hd-mono" aria-live="polite">Page {paging.page + 1} of {paging.pages}</span>
            <button type="button" aria-label="Next page" disabled={paging.page >= paging.pages - 1} onClick={() => setPage(paging.page + 1)}>Next ›</button>
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}
