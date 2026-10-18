"use client";

import { useEffect, useRef, useState } from "react";
import { useRevealOnScroll } from "@/app/landing-motion";
import "@/app/landing-motion.css";
import { renderInlineMarkdown } from "@/lib/article-markdown";
import { TABLE_ROWS_SHOWN, isEmptyCell, plainText, tableFolds, type BarsRow, type Exhibit, type TableData } from "./article-view";

function Inline({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(text) }} />;
}

/** A figure cell ("$30", "45%", "1,204") reads right-aligned in tabular numerals. */
const NUMERIC = /^[\s$€£]*[-−+]?[\d.,]+\s*(%|[kmb]|million|billion)?$/i;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const TOGGLE = `mt-3 inline-flex min-h-11 items-center rounded-sm text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink ${FOCUS}`;

function ShowAll({ all, total, noun, onToggle }: { all: boolean; total: number; noun: string; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={all} onClick={onToggle} className={TOGGLE}>
      {all ? "Show fewer" : `Show all ${total} ${noun}`}
    </button>
  );
}

/**
 * One bar per row, scaled to the largest; on phones the label sits above its bar. A long chart
 * shows five bars first, at the same threshold as tables; folded bars stay in the HTML.
 */
function Bars({ rows, label }: { rows: BarsRow[]; label: string }) {
  const [all, setAll] = useState(false);
  const folds = tableFolds(rows.length);
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div>
      <ul aria-label={label} className="space-y-3 sm:space-y-2">
        {rows.map((row, i) => {
          const width = max > 0 ? Math.max(2, Math.round((row.value / max) * 100)) : 0;
          return (
            <li
              key={`${row.label}-${i}`}
              hidden={folds && !all && i >= TABLE_ROWS_SHOWN}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)_4.5rem]"
            >
              <Inline text={row.label} className="col-span-2 text-[13px] leading-tight text-ink-soft sm:col-span-1" />
              <span aria-hidden="true" className="block h-3.5 rounded-sm bg-surface-200">
                <span className="block h-3.5 rounded-sm bg-brick" style={{ width: `${width}%` }} />
              </span>
              <Inline text={row.shown} className="text-right font-mono text-[13px] font-semibold tabular-nums text-ink" />
            </li>
          );
        })}
      </ul>
      {folds && <ShowAll all={all} total={rows.length} noun="bars" onToggle={() => setAll((v) => !v)} />}
    </div>
  );
}

/**
 * Whether a box scrolls sideways and has more to show to the right. Null until measured, so the
 * first render falls back to the narrow-screen CSS cue.
 */
function useMoreToRight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState<boolean | null>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => setMore(box.scrollWidth - box.clientWidth - box.scrollLeft > 2);
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(box);
    return () => {
      box.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);
  return { ref, more };
}

/** The fade on the box's right edge: shown while more columns sit off screen. */
const FADE = "[mask-image:linear-gradient(to_right,black_85%,transparent)]";
const FADE_NARROW = "max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)]";

/**
 * The table, five rows first when it is long; it scrolls sideways inside its own box on a phone,
 * with a fade on the right edge and a "Scroll for more columns" line while columns sit off screen.
 * Folded rows stay in the HTML (hidden), so search and AI readers see the whole table.
 */
function Table({ table, label }: { table: TableData; label: string }) {
  const [all, setAll] = useState(false);
  const folds = tableFolds(table.rows.length);
  const wide = table.head.length >= 4;
  // A column is numeric when every cell holding a figure is one; dashes and "n/a" do not count.
  const numeric = table.head.map((_, c) => {
    const cells = table.rows.map((r) => r[c] ?? "").filter((cell) => !isEmptyCell(cell));
    return cells.length > 0 && cells.every((cell) => NUMERIC.test(cell));
  });
  const { ref, more } = useMoreToRight<HTMLDivElement>();
  // Before measuring, a wide table cues on narrow screens only; after, only while it overflows.
  const cue = more === null ? (wide ? "sm:hidden" : "hidden") : more ? "" : "hidden";
  const fade = more === null ? (wide ? FADE_NARROW : "") : more ? FADE : "";
  return (
    <div className={wide ? undefined : "lg:max-w-3xl"}>
      <p aria-hidden="true" className={`mb-2 text-[12px] text-ink-muted ${cue}`}>
        Scroll for more columns <span className="font-mono">&rarr;</span>
      </p>
      <div ref={ref} role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto overscroll-x-contain ${fade} ${FOCUS}`}>
        <table aria-label={label} className={`w-full border-collapse text-[14px] ${wide ? "min-w-[30rem]" : ""}`}>
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
      {folds && <ShowAll all={all} total={table.rows.length} noun="rows" onToggle={() => setAll((v) => !v)} />}
    </div>
  );
}

/** One labeled exhibit: a chart with the table of its figures beneath, or a table alone. */
export function ArticleExhibit({ exhibit }: { exhibit: Exhibit }) {
  // Screen readers get the label without its Markdown marks.
  const plain = plainText(exhibit.label) || "Exhibit";
  // The homepage's reveal: the exhibit fades up as it first scrolls into view.
  const ref = useRevealOnScroll<HTMLElement>();
  return (
    <figure ref={ref} className="min-w-0 space-y-5">
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
