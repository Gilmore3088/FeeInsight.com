"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  DashboardCard,
  FeePositionChart,
  FilterChips,
  KpiCard,
  PositionDonut,
  SegmentedControl,
  SortableTable,
  TrendChart,
  countPositions,
  formatFigure,
  furthestAbove,
  signedMoney,
  type DonutPosition,
  type FeePositionFilter,
} from "@/components/hamilton/dashboard";
import type {
  DashboardChanges,
  DashboardFeeGroup,
  DashboardFinancials,
  DashboardScorecard,
} from "@/lib/hamilton/dashboard/command-center-dashboard";

/**
 * The interactive part of the Command center: the KPI cards drive the trend chart; the fee chart
 * switches between the institution's state and its peer group, filters from the donut's legend and
 * shows a competitor chosen in the scorecard beside the subject. Every value arrives as a prop,
 * read on the server.
 */
export function CommandCenterDashboard({
  institutionName,
  financials,
  feeGroups,
  scorecard,
  noFeesText,
  askCard,
}: {
  institutionName: string;
  financials: DashboardFinancials | null;
  feeGroups: DashboardFeeGroup[];
  scorecard: DashboardScorecard | null;
  /** Shown in place of the fee chart when no group could be read. */
  noFeesText: string;
  /** The Ask Hamilton card, rendered on the server, beside the scorecard. */
  askCard: ReactNode;
}) {
  const [metric, setMetric] = useState<string>(financials?.kpis[0]?.key ?? "fees");
  const [groupKey, setGroupKey] = useState<string>(feeGroups[0]?.key ?? "state");
  const [filter, setFilter] = useState<FeePositionFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const group = feeGroups.find((g) => g.key === groupKey) ?? feeGroups[0] ?? null;
  const counts = useMemo(() => countPositions(group?.rows ?? []), [group]);
  const top = useMemo(() => furthestAbove(group?.rows ?? []), [group]);
  const compareRow = compareId ? scorecard?.rows.find((r) => r.id === compareId) : undefined;
  const compare = compareRow && scorecard ? { name: compareRow.label, values: scorecard.compareValues[compareRow.id] ?? {} } : null;

  return (
    <>
      {financials ? (
        <>
          <section className="hd-grid" aria-label="Key figures. Choose one to chart it.">
            {financials.kpis.map((kpi) => (
              <div key={kpi.key} className="hd-span-3">
                <KpiCard {...kpi} selected={metric === kpi.key} onSelect={() => setMetric(kpi.key)} />
              </div>
            ))}
          </section>
          <TrendChart
            series={financials.trend.series}
            quarters={financials.trend.quarters}
            axisLabels={financials.trend.axis}
            value={metric}
            onChange={setMetric}
            footnote={`Hover, tap or tab to a quarter for its value. ${financials.footnote}`}
          />
        </>
      ) : (
        <DashboardCard title="Filed performance" titleId="cc-performance">
          <p className="hd-card-note">No filed quarter is on file for {institutionName} yet, so its performance is not shown.</p>
        </DashboardCard>
      )}

      <div className="hd-grid">
        <div className="hd-span-8" style={{ display: "flex", minWidth: 0 }}>
          <DashboardCard
            title={group ? `Your fees against ${group.label}` : "Your fees against peers"}
            titleId="cc-fees"
            className="hd-grow"
            actions={feeGroups.length > 1 ? (
              <SegmentedControl label="Compare with" options={feeGroups.map((g) => ({ value: g.key, label: g.tab }))} value={group?.key} onChange={(k) => { setGroupKey(k); setExpanded(null); }} />
            ) : null}
            footnote={group?.note}
          >
            {group && group.rows.length > 0 ? (
              <FeePositionChart
                rows={group.rows}
                groupLabel={group.label}
                compare={compare}
                onClearCompare={() => setCompareId(null)}
                filter={filter}
                onFilterChange={setFilter}
                expanded={expanded}
                onExpandedChange={setExpanded}
              />
            ) : (
              <p className="hd-card-note">{noFeesText}</p>
            )}
          </DashboardCard>
        </div>
        <div className="hd-span-4" style={{ display: "flex", minWidth: 0 }}>
          <DashboardCard title="Where you stand" titleId="cc-stand" className="hd-grow">
            {group && group.rows.length > 0 ? (
              <>
                <PositionDonut
                  counts={counts}
                  selected={filter === "all" ? null : (filter as DonutPosition)}
                  onSelect={(next) => setFilter(next ?? "all")}
                />
                {counts.too_few > 0 ? (
                  <p className="hd-card-note">{counts.too_few} more {counts.too_few === 1 ? "fee is" : "fees are"} not placed: too few in this group publish {counts.too_few === 1 ? "it" : "them"} for a median.</p>
                ) : null}
                <div style={{ borderTop: "1px solid var(--fi-border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="hd-label">Furthest above the median</span>
                  {top.length === 0 ? <p className="hd-card-note">None of its placed fees sits above the middle half.</p> : top.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => { setFilter("all"); setExpanded(row.key); }}
                      style={{ display: "flex", justifyContent: "space-between", gap: 8, minHeight: 32, border: 0, background: "transparent", padding: "4px 0", font: "inherit", fontSize: 13, color: "var(--fi-ink)", cursor: "pointer", textAlign: "left" }}
                    >
                      <span>{row.name}</span>
                      <span className="hd-mono hd-tone-above" style={{ fontWeight: 600 }}>{signedMoney(row.yours - (row.median ?? row.yours))} ▲</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="hd-card-note">{noFeesText}</p>
            )}
          </DashboardCard>
        </div>
      </div>

      <div className="hd-grid">
        <div className="hd-span-8" style={{ display: "flex", minWidth: 0 }}>
          <DashboardCard
            title="Peer scorecard"
            titleId="cc-scorecard"
            className="hd-grow"
            actions={scorecard ? <span className="hd-card-note">Sort by a column. Choose an institution to plot it beside you.</span> : null}
            footnote={scorecard?.note}
          >
            {scorecard ? (
              <SortableTable
                caption={`${institutionName} beside its largest local competitors`}
                columns={scorecard.columns}
                rows={scorecard.rows}
                defaultSort={{ key: "assets", direction: "descending" }}
                selectedRowId={compareId}
                onRowSelect={setCompareId}
              />
            ) : (
              <p className="hd-card-note">No local competitors that publish a fee {institutionName} charges are on file yet.</p>
            )}
          </DashboardCard>
        </div>
        <div className="hd-span-4" style={{ display: "flex", minWidth: 0 }}>{askCard}</div>
      </div>
    </>
  );
}

/** The change tape with its increase and decrease filter. */
export function WhatChanged({ changes, own, windowDays, links = [] }: {
  changes: DashboardChanges;
  own: { lines: string[]; source: string | null } | null;
  windowDays: number;
  /** Where to read more: this month's briefing, alerts and watches. */
  links?: { label: string; href: string }[];
}) {
  const [show, setShow] = useState<"all" | "up" | "down">("all");
  const items = changes.items.filter((c) => show === "all" || c.direction === show);
  return (
    <DashboardCard
      title="What changed"
      titleId="cc-change"
      actions={changes.items.length > 0 ? (
        <FilterChips<"all" | "up" | "down">
          label="Show changes"
          value={show}
          onChange={setShow}
          options={[{ value: "all", label: "All" }, { value: "up", label: "▲ Increases" }, { value: "down", label: "▼ Decreases" }]}
        />
      ) : null}
      footnote={`Changes confirmed on each institution's own fee schedule, like for like, in the last ${windowDays} days.`}
    >
      {own ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {own.lines.map((line, i) => <p key={i} style={{ margin: 0, fontSize: 14 }}>{line}</p>)}
          {own.source ? <p className="hd-card-note">Source: {own.source}</p> : null}
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: 13 }} className="hd-muted">{changes.headline}</p>
      {items.length > 0 ? (
        <ul className="hd-tape">
          {items.map((c) => (
            <li key={c.id}>
              <span className="hd-mono hd-muted" style={{ fontSize: 11 }}>{c.date}{c.matches ? " · a fee you publish" : ""}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{c.institution}</span>
              <span className="hd-tape-move">
                <span>{c.fee}</span>
                <span className={`hd-mono hd-tone-${c.direction === "up" ? "above" : "below"}`} style={{ fontWeight: 600 }}>
                  {formatFigure(c.from, "money")} → {formatFigure(c.to, "money")} {c.direction === "up" ? "▲" : "▼"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : changes.items.length > 0 ? <p className="hd-card-note">No change in this direction.</p> : null}
      {links.length > 0 ? (
        <div className="hd-links">
          {links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </div>
      ) : null}
    </DashboardCard>
  );
}
