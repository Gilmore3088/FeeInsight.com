"use client";

import { useState } from "react";
import { aboutSame, amountText, money, reference, type CompareRow, type Median } from "./profile-view";

/** Rows shown before "Show all". */
const ROWS_SHOWN = 5;

const GRID = "md:grid-cols-[minmax(0,1.6fr)_minmax(6.5rem,auto)_repeat(var(--cols),minmax(0,6.5rem))_minmax(0,7.5rem)]";

function Amount({ row }: { row: CompareRow }) {
  if (row.amount == null) {
    return <span className="inline-block max-w-[9rem] text-[12px] leading-snug text-ink-muted md:max-w-none">{row.missing}</span>;
  }
  const text = amountText(row);
  return row.sourceUrl ? (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the fee schedule it was read from"
      className="-my-3 inline-block whitespace-nowrap py-3 font-mono text-[15px] font-semibold tabular-nums text-ink underline decoration-border underline-offset-2 hover:decoration-brick"
    >
      {text}
    </a>
  ) : (
    <span className="whitespace-nowrap font-mono text-[15px] font-semibold tabular-nums text-ink">{text}</span>
  );
}

function MedianCell({ m, label }: { m: Median | null; label: string }) {
  return (
    <>
      <span className="sr-only">{label}: </span>
      {m ? (
        <span className="font-mono text-[14px] tabular-nums text-ink-soft">{money(m.median)}</span>
      ) : (
        <span className="text-[12px] text-ink-muted">No median</span>
      )}
    </>
  );
}

/**
 * Its amount (the highest, when it lists several) against the first reference median: "+$4",
 * "−$2", "About the same" within 1%, or "None charged" for a published $0.
 */
function Gap({ row }: { row: CompareRow }) {
  const ref = reference(row);
  if (row.amount == null || !ref) return <span className="text-[12px] text-ink-muted">&nbsp;</span>;
  if (row.amount === 0) return <span className="text-[13px] text-ink-muted">None charged</span>;
  const m = ref.median.median;
  if (aboutSame(row.amount, m)) return <span className="text-[13px] text-ink-muted">{row.amount === m ? "Same" : "About the same"}</span>;
  const diff = row.amount - m;
  return (
    <span className={`font-mono text-[14px] tabular-nums ${diff > 0 ? "text-brick" : "text-ink"}`}>
      {diff > 0 ? "+" : "−"}
      {money(Math.abs(diff))}
    </span>
  );
}

/** The account the schedule names for the fee; nothing when it names none. */
function Detail({ row }: { row: CompareRow }) {
  if (row.amount == null || !row.account) return null;
  return <p className="text-[12px] text-ink-soft">{row.account}</p>;
}

/**
 * Each published fee beside the state, district and U.S. medians, in the order orderRows sets
 * (the hero's fee first). Five show before "Show all"; phones get stacked rows so nothing
 * scrolls sideways.
 */
export function CompareTable({
  rows,
  stateName,
  stateCode,
  districtName,
}: {
  rows: CompareRow[];
  stateName: string | null;
  stateCode: string | null;
  districtName: string | null;
}) {
  const [all, setAll] = useState(false);
  const hasState = rows.some((r) => r.state);
  const hasDistrict = Boolean(districtName) && rows.some((r) => r.district);
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  const vs = hasState && stateName ? `vs ${stateName}` : "vs U.S.";
  const cols = 1 + (hasState ? 1 : 0) + (hasDistrict ? 1 : 0);
  const shortState = stateCode ?? stateName ?? "State";

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-0" style={{ ["--cols" as string]: cols }}>
        <div
          aria-hidden="true"
          className={`hidden border-b border-border bg-paper px-5 py-2 text-[12px] font-medium text-ink-muted md:grid md:gap-4 ${GRID}`}
        >
          <span>Fee</span>
          <span className="text-right">Its fee</span>
          {hasState && <span className="text-right">{stateName} median</span>}
          {hasDistrict && <span className="text-right">{districtName} district</span>}
          <span className="text-right">U.S. median</span>
          <span className="text-right">{vs}</span>
        </div>
        <ul className="divide-y divide-border">
          {shown.map((row) => (
            <li
              key={row.key}
              className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 md:items-baseline md:px-5 ${GRID}`}
            >
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-tight text-ink">{row.label}</p>
                <Detail row={row} />
              </div>
              <span className="text-right">
                <span className="sr-only">Its fee: </span>
                <Amount row={row} />
              </span>
              {hasState && (
                <span className="hidden text-right md:block">
                  <MedianCell m={row.state} label={`${stateName} median`} />
                </span>
              )}
              {hasDistrict && (
                <span className="hidden text-right md:block">
                  <MedianCell m={row.district} label={`${districtName} district median`} />
                </span>
              )}
              <span className="hidden text-right md:block">
                <MedianCell m={row.us} label="U.S. median" />
              </span>
              <span className="hidden text-right md:block">
                {row.amount != null && reference(row) && <span className="sr-only">{vs}: </span>}
                <Gap row={row} />
              </span>
              {/* Phones: the medians and the gap on one line under the fee. */}
              <p className="col-span-2 flex flex-wrap items-baseline gap-x-3 text-[12px] text-ink-muted md:hidden">
                {hasState && (
                  <span>
                    {shortState} <span className="font-mono tabular-nums text-ink-soft">{row.state ? money(row.state.median) : "n/a"}</span>
                  </span>
                )}
                {hasDistrict && (
                  <span>
                    District <span className="font-mono tabular-nums text-ink-soft">{row.district ? money(row.district.median) : "n/a"}</span>
                  </span>
                )}
                <span>
                  U.S. <span className="font-mono tabular-nums text-ink-soft">{row.us ? money(row.us.median) : "n/a"}</span>
                </span>
                {row.amount != null && reference(row) && (
                  <span className="ml-auto">
                    {row.amount !== 0 && <span className="mr-1">vs {hasState ? shortState : "U.S."}</span>}
                    <Gap row={row} />
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
      {shown.length < rows.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-full border border-ink px-5 text-[14px] font-semibold text-ink hover:bg-surface-0"
        >
          Show all {rows.length} fees
        </button>
      )}
    </div>
  );
}
