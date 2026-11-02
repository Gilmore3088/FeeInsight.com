"use client";
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import "./dashboard.css";
import { FilterChips } from "./FilterChips";
import { DASH, feePosition, formatFigure, POSITION_LABEL, POSITION_MARK, signedMoney } from "./format";
import { countPositions, sortFeeRows, type FeePositionDatum, type FeePositionFilter, type FeePositionSort } from "./kit-math";

export type { FeePositionCounts, FeePositionDatum, FeePositionFilter, FeePositionSort } from "./kit-math";
import { useControllable } from "./use-controllable";

function scale(row: FeePositionDatum, compare: number | null) {
  const values = [row.yours, row.min, row.max, compare].filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  return (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
}

/**
 * Each fee as a row: the subject's price, the group's middle half as a box, the median as a tick,
 * the subject as a dot coloured by its position, and an optional compare peer as a diamond. A row
 * opens to its range and links. Fees too few institutions publish show the spread, never a median.
 */
export function FeePositionChart({
  rows,
  groupLabel,
  compare = null,
  onClearCompare,
  filter,
  onFilterChange,
  expanded,
  onExpandedChange,
  defaultSort = "gap",
}: {
  rows: FeePositionDatum[];
  /** The group the rows compare with, e.g. "institutions in Florida". */
  groupLabel: string;
  compare?: { name: string; values: Record<string, number> } | null;
  onClearCompare?: () => void;
  filter?: FeePositionFilter;
  onFilterChange?: (next: FeePositionFilter) => void;
  expanded?: string | null;
  onExpandedChange?: (next: string | null) => void;
  defaultSort?: FeePositionSort;
}) {
  const id = useId();
  const [currentFilter, setFilter] = useControllable<FeePositionFilter>(filter, onFilterChange, "all");
  const [open, setOpen] = useControllable<string | null>(expanded, onExpandedChange, null);
  const [sort, setSort] = useState<FeePositionSort>(defaultSort);
  const counts = useMemo(() => countPositions(rows), [rows]);
  const shown = useMemo(
    () => sortFeeRows(rows.filter((r) => currentFilter === "all" || feePosition(r.yours, r) === currentFilter), sort),
    [rows, currentFilter, sort],
  );
  return (
    <div className="hd-fees" style={{ gap: 12 }}>
      <div className="hd-toolbar">
        <FilterChips<FeePositionFilter>
          label="Show fees"
          value={currentFilter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: rows.length },
            { value: "above", label: `${POSITION_MARK.above} Above`, count: counts.above },
            { value: "in_range", label: `${POSITION_MARK.in_range} In range`, count: counts.in_range },
            { value: "below", label: `${POSITION_MARK.below} Below`, count: counts.below },
          ]}
        />
        <label className="hd-select">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as FeePositionSort)}>
            <option value="gap">Furthest above the median</option>
            <option value="name">Fee name</option>
            <option value="amount">Your price</option>
          </select>
        </label>
      </div>
      {compare ? (
        <div className="hd-compare">
          <span className="hd-compare-mark" aria-hidden="true" />
          <span>Showing <b>{compare.name}</b> beside you as a diamond</span>
          {onClearCompare ? <button type="button" onClick={onClearCompare}>Clear</button> : null}
        </div>
      ) : null}
      <div className="hd-fees" role="list" aria-label={`Your fees against ${groupLabel}`}>
        {shown.map((row) => {
          const position = feePosition(row.yours, row);
          const cmp = compare ? compare.values[row.key] ?? null : null;
          const x = scale(row, cmp);
          const isOpen = open === row.key;
          const detailId = `${id}-${row.key}`;
          const banded = row.p25 !== null && row.p75 !== null && row.median !== null;
          const delta = row.median === null ? null : row.yours - row.median;
          return (
            <div key={row.key} role="listitem">
              <button type="button" className="hd-fee-row" aria-expanded={isOpen} aria-controls={detailId} onClick={() => setOpen(isOpen ? null : row.key)}>
                <span className="hd-fee-name">{row.name}</span>
                <span className="hd-fee-yours">{formatFigure(row.yours, "money")}</span>
                <span className="hd-plot" aria-hidden="true">
                  <span className="hd-plot-axis" />
                  {banded ? <span className="hd-plot-box" style={{ left: `${x(row.p25!)}%`, width: `${Math.max(1.5, x(row.p75!) - x(row.p25!))}%` }} /> : null}
                  {banded ? <span className="hd-plot-med" style={{ left: `${x(row.median!)}%` }} /> : null}
                  {cmp !== null ? <span className="hd-plot-cmp" style={{ left: `${x(cmp)}%` }} /> : null}
                  <span className={`hd-plot-dot hd-pos-${position}`} style={{ left: `${x(row.yours)}%` }} />
                </span>
                <span className="hd-fee-med">{row.median === null ? `${row.n} publish` : `med ${formatFigure(row.median, "money")}`}</span>
                <span className={`hd-pill hd-pos-${position}`}>{POSITION_MARK[position]} {POSITION_LABEL[position]}</span>
              </button>
              {isOpen ? (
                <div id={detailId} className="hd-fee-detail">
                  <dl>
                    <div><dt>Range</dt><dd>{row.min === null ? DASH : `${formatFigure(row.min, "money")} to ${formatFigure(row.max, "money")}`}</dd></div>
                    <div><dt>Middle half</dt><dd>{banded ? `${formatFigure(row.p25, "money")} to ${formatFigure(row.p75, "money")}` : "Too few to say"}</dd></div>
                    <div><dt>Institutions compared</dt><dd>{row.n.toLocaleString("en-US")}</dd></div>
                    <div><dt>You against the median</dt><dd className={delta === null ? "hd-muted" : `hd-tone-${delta > 0.005 ? "above" : delta < -0.005 ? "below" : "in_range"}`}>{delta === null ? "No median: too few publish it" : signedMoney(delta)}</dd></div>
                  </dl>
                  {cmp !== null && compare ? <p className="hd-card-note" style={{ margin: 0 }}>{compare.name}: <span className="hd-mono">{formatFigure(cmp, "money")}</span></p> : null}
                  {row.links?.length ? (
                    <div className="hd-links">
                      {row.links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {shown.length === 0 ? <p className="hd-card-note" style={{ padding: "12px 0" }}>No fees match this filter.</p> : null}
      </div>
    </div>
  );
}
