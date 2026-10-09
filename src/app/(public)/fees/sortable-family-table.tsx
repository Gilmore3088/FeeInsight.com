"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ScrollTable } from "@/components/public/scroll-table";
import { RangeStrip } from "@/components/public/fee-summary-list";
import { formatFeeAmount } from "@/lib/format";

/** One fee category's national benchmark, as the table shows it. */
export interface FamilyTableRow {
  category: string;
  label: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  institutions: number;
}

type SortKey = "label" | "median" | "p25" | "min" | "institutions";
type SortDir = "ascending" | "descending";

const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#5A5347]";
const TD = "whitespace-nowrap px-4 py-3 text-right [font-variant-numeric:tabular-nums]";

/** Sort values for each sortable column; a missing figure always sorts last. */
const SORT_VALUE: Record<SortKey, (row: FamilyTableRow) => string | number | null> = {
  label: (row) => row.label,
  median: (row) => row.median,
  p25: (row) => row.p25,
  min: (row) => row.min,
  institutions: (row) => row.institutions,
};

export function sortFamilyRows(rows: FamilyTableRow[], key: SortKey, dir: SortDir): FamilyTableRow[] {
  const value = SORT_VALUE[key];
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const order = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return dir === "ascending" ? order : -order;
  });
}

/**
 * A fee family's benchmark table, sortable in the browser (skill rule `sortable-table`).
 * Each sortable header is a real button, so Tab reaches it and Enter or Space sorts; the
 * header carries aria-sort, and a polite status line says the new order in words. The
 * table opens in the server's order (most institutions first), which no header claims.
 */
export function SortableFamilyTable({
  familyName,
  rows,
  scaleMax,
  className,
}: {
  familyName: string;
  rows: FamilyTableRow[];
  scaleMax: number;
  className: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const sorted = useMemo(() => (sort ? sortFamilyRows(rows, sort.key, sort.dir) : rows), [rows, sort]);
  const sortable = rows.length > 1;

  function toggle(key: SortKey) {
    setSort((current) => {
      if (current?.key === key) return { key, dir: current.dir === "ascending" ? "descending" : "ascending" };
      // Names read A to Z first; figures read highest first, the usual question.
      return { key, dir: key === "label" ? "ascending" : "descending" };
    });
  }

  function header(key: SortKey, label: React.ReactNode, srLabel: string, align: "left" | "right") {
    const active = sort?.key === key;
    const arrow = !active ? "↕" : sort.dir === "ascending" ? "↑" : "↓";
    return (
      <th
        scope="col"
        aria-sort={active ? sort.dir : undefined}
        className={`px-2 py-1.5 ${align === "right" ? "text-right" : "text-left"}`}
      >
        {sortable ? (
          <button
            type="button"
            onClick={() => toggle(key)}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-2 ${EYEBROW} transition-colors duration-200 hover:bg-[#F3EEE6] hover:text-[#1A1815] ${
              align === "right" ? "flex-row-reverse" : ""
            } ${active ? "text-[#1A1815]" : ""}`}
          >
            <span>{label}</span>
            <span aria-hidden="true" className={active ? "text-[#A93D25]" : "text-[#A09788]"}>
              {arrow}
            </span>
            <span className="sr-only">, sort by {srLabel}</span>
          </button>
        ) : (
          <span className={`inline-flex px-2 ${EYEBROW}`}>{label}</span>
        )}
      </th>
    );
  }

  const order = sort
    ? `Sorted by ${
        { label: "fee name", median: "median", p25: "middle half", min: "lowest fee", institutions: "institutions" }[sort.key]
      }, ${sort.key === "label" ? (sort.dir === "ascending" ? "A to Z" : "Z to A") : sort.dir === "ascending" ? "lowest first" : "highest first"}.`
    : "";

  return (
    <div className={className}>
      <p role="status" aria-live="polite" className="sr-only">
        {order}
      </p>
      <ScrollTable label={`${familyName} fee table`} minWidth="640" className="rounded-2xl! border-[#E8E1D6]! bg-white/75!">
        <caption className="sr-only">
          {familyName} fees: national median, middle half (25th to 75th percentile), lowest to highest, and number of
          institutions. {sortable ? "Column headers sort the table." : ""}
        </caption>
        <thead>
          <tr className="border-b border-[#E8E1D6] bg-[#F3EEE6]/60">
            {header("label", "Fee", "fee name", "left")}
            {header("median", "Median", "median", "right")}
            {header(
              "p25",
              <>
                Middle half <span className="sr-only">(25th to 75th percentile)</span>
              </>,
              "middle half",
              "right",
            )}
            {header("min", "Lowest – highest", "lowest fee", "right")}
            <th scope="col" className={`whitespace-nowrap px-4 py-2.5 ${EYEBROW}`}>
              <span aria-hidden="true">
                Spread {money(0)}–{money(scaleMax)}
              </span>
              <span className="sr-only">Spread chart (same figures as the median and middle half columns)</span>
            </th>
            {header("institutions", "Institutions", "institutions", "right")}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E8E1D6]/70">
          {sorted.map((row) => (
            <tr key={row.category} className="group transition-colors duration-200 hover:bg-[#FAF7F2]">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <Link
                  href={`/fees/${row.category}`}
                  className="font-semibold text-[#1A1815] underline-offset-2 group-hover:text-[#A93D25] hover:underline"
                >
                  {row.label}
                </Link>
              </th>
              <td className={`${TD} text-[15px] font-semibold text-[#1A1815]`}>{money(row.median)}</td>
              <td className={`${TD} text-[#3D3830]`}>
                {row.p25 !== null && row.p75 !== null ? `${money(row.p25)} – ${money(row.p75)}` : "-"}
              </td>
              <td className={`${TD} text-[#3D3830]`}>
                {row.min !== null && row.max !== null ? `${money(row.min)} – ${money(row.max)}` : "-"}
              </td>
              <td className="px-4 py-3">
                <RangeStrip median={row.median} p25={row.p25} p75={row.p75} scaleMax={scaleMax} className="min-w-[96px]" />
              </td>
              <td className={`${TD} text-[#3D3830]`}>{row.institutions.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </div>
  );
}
