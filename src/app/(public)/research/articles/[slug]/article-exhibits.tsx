"use client";

import { useState } from "react";
import { renderInlineMarkdown } from "@/lib/article-markdown";
import { TABLE_ROWS_SHOWN, tableFolds, type BarsRow, type Exhibit, type TableData } from "./article-view";

function Inline({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(text) }} />;
}

/** A figure cell ("$30", "45%", "1,204") reads right-aligned in tabular numerals. */
const NUMERIC = /^[\s$€£]*[-−+]?[\d.,]+\s*(%|[kmb]|million|billion)?$/i;

/** One bar per row, scaled to the largest; on phones the label sits above its bar. */
function Bars({ rows, label }: { rows: BarsRow[]; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul aria-label={label} className="space-y-3 sm:space-y-2">
      {rows.map((row) => {
        const width = max > 0 ? Math.max(2, Math.round((row.value / max) * 100)) : 0;
        return (
          <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)_4.5rem]">
            <Inline text={row.label} className="col-span-2 text-[13px] leading-tight text-ink-soft sm:col-span-1" />
            <span aria-hidden="true" className="block h-3.5 rounded-sm bg-surface-200">
              <span className="block h-3.5 rounded-sm bg-brick" style={{ width: `${width}%` }} />
            </span>
            <Inline text={row.shown} className="text-right font-mono text-[13px] font-semibold tabular-nums text-ink" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The table, five rows first when it is long; it scrolls sideways inside its own box on a phone.
 * Folded rows stay in the HTML (hidden), so search and AI readers see the whole table.
 */
function Table({ table, label }: { table: TableData; label: string }) {
  const [all, setAll] = useState(false);
  const folds = tableFolds(table.rows.length);
  // A column is numeric when every filled cell in it is a figure.
  const numeric = table.head.map((_, c) => {
    const cells = table.rows.map((r) => r[c] ?? "").filter((cell) => cell !== "");
    return cells.length > 0 && cells.every((cell) => NUMERIC.test(cell));
  });
  return (
    <div>
      <div className="overflow-x-auto">
        <table aria-label={label} className="w-full min-w-[30rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-ink/70">
              {table.head.map((cell, c) => (
                <th
                  key={c}
                  scope="col"
                  className={`px-3 py-2 align-bottom text-[12px] font-semibold leading-tight text-ink-soft first:pl-0 last:pr-0 ${numeric[c] ? "text-right" : "text-left"}`}
                >
                  <Inline text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} hidden={folds && !all && r >= TABLE_ROWS_SHOWN} className="border-b border-border">
                {table.head.map((_, c) => (
                  <td
                    key={c}
                    className={`px-3 py-2 first:pl-0 last:pr-0 [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 hover:[&_a]:decoration-ink ${
                      numeric[c] ? "text-right font-mono tabular-nums text-ink" : "text-ink"
                    }`}
                  >
                    <Inline text={row[c] ?? ""} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {folds && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          {all ? "Show fewer" : `Show all ${table.rows.length} rows`}
        </button>
      )}
    </div>
  );
}

/** One labeled exhibit: a chart with the table of its figures beneath, or a table alone. */
export function ArticleExhibit({ exhibit }: { exhibit: Exhibit }) {
  // Screen readers get the label without its Markdown marks.
  const plain = exhibit.label.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "");
  return (
    <figure className="min-w-0 space-y-5">
      <figcaption className="text-[14px] font-semibold text-ink">
        <Inline text={exhibit.label} />
      </figcaption>
      {exhibit.kind === "bars" ? (
        <>
          <Bars rows={exhibit.rows} label={plain} />
          {exhibit.table && <Table table={exhibit.table} label={`${plain}, figures`} />}
        </>
      ) : (
        <Table table={exhibit.table} label={plain} />
      )}
    </figure>
  );
}
