"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import {
  amountText,
  excludedNote,
  isRange,
  missingShort,
  money,
  type CompareRow,
  type Median,
} from "./profile-view";

/** Rows shown before "Show all compared fees" (James's design file shows three). */
const ROWS_SHOWN = 3;

const GRID = "md:grid-cols-[minmax(0,1.7fr)_minmax(7rem,1fr)_repeat(var(--cols),minmax(0,1fr))]";

function Amount({ row }: { row: CompareRow }) {
  if (row.amount == null) {
    return <span className="text-[12px] text-ink-muted">{missingShort(row.missing)}</span>;
  }
  // A range may wrap after "to" on a phone; each amount stays whole.
  const text = isRange(row) ? (
    <>
      <span className="whitespace-nowrap">{money(row.low as number)}</span> to{" "}
      <span className="whitespace-nowrap">{money(row.high as number)}</span>
    </>
  ) : (
    <span className="whitespace-nowrap">{amountText(row)}</span>
  );
  return row.sourceUrl ? (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the fee schedule it was read from"
      className="-my-3 inline-block py-3 text-[17px] font-semibold [font-variant-numeric:tabular-nums] text-ink underline decoration-transparent underline-offset-4 hover:decoration-brick"
    >
      {text}
    </a>
  ) : (
    <span className="text-[17px] font-semibold [font-variant-numeric:tabular-nums] text-ink">{text}</span>
  );
}

/** The median and, beneath it, how many institutions publish the fee; blank under the floor. */
function MedianCell({ m, label }: { m: Median | null; label: string }) {
  if (!m) return <span className="sr-only">{label}: no median</span>;
  return (
    <>
      <span className="sr-only">{label}: </span>
      <span className="block text-[16px] [font-variant-numeric:tabular-nums] text-ink">{money(m.median)}</span>
      <span className="block text-[12px] [font-variant-numeric:tabular-nums] text-ink-muted">{m.institutions.toLocaleString("en-US")} publish</span>
    </>
  );
}

/**
 * Under the fee: its named account prices and the value it is compared at when it lists several
 * prices (the shared rule), else the one account the schedule names. Nothing when none is known.
 */
function Detail({ row }: { row: CompareRow }) {
  if (row.amount == null) return null;
  if (row.comparedAt) {
    return (
      <>
        {row.accountPrices && <p className="text-[12px] text-ink-soft">{row.accountPrices}</p>}
        <p className="text-[12px] text-ink-muted">
          {row.comparedAt}
          {excludedNote(row) ? `. ${excludedNote(row)}.` : ""}
        </p>
      </>
    );
  }
  const note = excludedNote(row);
  return (
    <>
      {row.account && <p className="text-[12px] text-ink-soft">{row.account}</p>}
      {row.waiver && <p className="text-[12px] text-ink-muted">{`${row.waiver.charAt(0).toUpperCase()}${row.waiver.slice(1)}.`}</p>}
      {note && <p className="text-[12px] text-ink-muted">{note}.</p>}
    </>
  );
}

/**
 * Each published fee beside the state, district and U.S. medians, in the order orderRows sets
 * (the lead fee first), laid out as James's design file: three rows, then "Show all compared
 * fees". Phones get one card per fee with the medians in a row, so nothing scrolls sideways.
 */
export function CompareTable({
  rows,
  institutionName,
  stateName,
  districtName,
}: {
  rows: CompareRow[];
  /** The price column's header, as in James's design file. */
  institutionName: string;
  stateName: string | null;
  districtName: string | null;
}) {
  const [all, setAll] = useState(false);
  const hasState = rows.some((r) => r.state);
  const hasDistrict = Boolean(districtName) && rows.some((r) => r.district);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  const cols = 1 + (hasState ? 1 : 0) + (hasDistrict ? 1 : 0);
  const priceHeader = institutionName;
  // Notes explain only the rows on screen.
  const notes = [...new Set(shown.filter((r) => r.amount == null && r.missing).map((r) => r.missing as string))];
  const blank = shown.some((r) => (hasState && !r.state) || (hasDistrict && !r.district) || !r.us);
  const medians = [
    ...(hasState ? [{ key: "state" as const, head: `${stateName} median`, short: `${stateName} median` }] : []),
    ...(hasDistrict ? [{ key: "district" as const, head: `${districtName} district median`, short: `${districtName} district` }] : []),
    { key: "us" as const, head: "U.S. median", short: "U.S. median" },
  ];

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-0" style={{ ["--cols" as string]: cols }}>
        <div aria-hidden="true" className={`hidden items-center border-b border-border bg-paper px-6 py-3 text-[13px] font-medium text-ink md:grid md:gap-4 ${GRID}`}>
          <span>Fee</span>
          <span className="text-center">{priceHeader}</span>
          {medians.map((m) => (
            <span key={m.key} className="text-center leading-tight">
              {m.head}
              <span className="block text-[12px] font-normal text-ink-muted"># publishing</span>
            </span>
          ))}
        </div>
        <ul className="divide-y divide-border">
          {shown.map((row) => (
            <li key={row.key} className={`px-4 py-4 md:grid md:items-center md:gap-4 md:px-6 md:py-5 ${GRID}`}>
              <div className="flex items-start justify-between gap-4 md:block">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold leading-tight text-ink">{row.label}</p>
                  <Detail row={row} />
                </div>
                <span className="shrink-0 text-right md:hidden">
                  <span className="sr-only">{priceHeader}: </span>
                  <Amount row={row} />
                </span>
              </div>
              <span className="hidden text-center md:block">
                <span className="sr-only">{priceHeader}: </span>
                <Amount row={row} />
              </span>
              {/* Phones: the medians side by side under the fee; wide screens: one column each. */}
              <div className="mt-3 grid grid-cols-3 gap-3 md:contents">
                {medians.map((m) => (
                  <span key={m.key} className="min-w-0 md:text-center">
                    <span aria-hidden="true" className="block text-[11px] text-ink-muted md:hidden">
                      {m.short}
                    </span>
                    <MedianCell m={row[m.key]} label={m.head} />
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {(notes.length > 0 || blank) && (
        <p className="mt-2 text-[12px] text-ink-muted">
          {[...notes.map((note) => (note.endsWith(".") ? note : `${note}.`)), ...(blank ? [`A blank median means fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN} publish the fee.`] : [])].join(" ")}
        </p>
      )}
      {shown.length < rows.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full border border-ink px-6 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all compared fees
          <ChevronDown aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
