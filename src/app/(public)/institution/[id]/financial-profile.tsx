"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sparkline } from "@/components/sparkline";
import { formatCompactDollars } from "@/lib/format";
import type { FinancialPoint, PeerMedianPoints } from "./financial-history";

/*
 * Gated Financial profile: call-report history as charts.
 * Palette: reference categorical slots 1-4 (validated on white: CVD ΔE 9.1,
 * normal-vision 22.9). Slots 3-4 sit under 3:1 contrast, so the loan mix chart
 * ships a table view. Text always uses ink tokens, never series colors.
 */
const INK = "#1A1815";
const INK_MUTED = "#6B6255";
const AXIS = "#A09788";
const GRID = "#EFE8DC";
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
const PEER = "#8A8174";

const RANGES = [
  { key: "3y", label: "3Y", quarters: 12 },
  { key: "5y", label: "5Y", quarters: 20 },
  { key: "10y", label: "10Y", quarters: 40 },
  { key: "all", label: "All", quarters: Number.POSITIVE_INFINITY },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const SOURCE_LABELS: Record<string, string> = {
  fdic: "FDIC call report",
  ncua: "NCUA 5300 call report",
  ffiec: "FFIEC call report",
};

function pct(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "N/A" : `${value.toFixed(decimals)}%`;
}

function compactAxis(value: number): string {
  return formatCompactDollars(value).replace(".0", "");
}

function values(points: FinancialPoint[], key: keyof FinancialPoint): number[] {
  return points.map((p) => p[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function hasAny(points: FinancialPoint[], keys: Array<keyof FinancialPoint>): boolean {
  return keys.some((key) => values(points, key).length > 1);
}

interface TooltipEntry {
  name?: string;
  value?: number | null;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E8DFD1] bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-[#1A1815]">{label}</p>
      {payload
        .filter((entry) => entry.value !== null && entry.value !== undefined)
        .map((entry) => (
          <p key={String(entry.dataKey)} className="flex items-center gap-2 text-[#5A5347]">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span>{entry.name}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums text-[#1A1815]">{format(Number(entry.value))}</span>
          </p>
        ))}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#5A5347]">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0 w-4 border-t-2"
            style={{ borderColor: item.color, borderStyle: item.dashed ? "dashed" : "solid" }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ChartCard({
  title,
  subtitle,
  caption,
  children,
}: {
  title: string;
  subtitle?: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="rounded-xl border border-[#E0D7C9] bg-white p-4">
      <figcaption>
        <p className="text-sm font-semibold text-[#1A1815]">{title}</p>
        {subtitle && <p className="text-xs text-[#6B6255]">{subtitle}</p>}
      </figcaption>
      <div className="mt-2">{children}</div>
      <p className="mt-2 text-[10px] text-[#8A8174]">{caption}</p>
    </figure>
  );
}

const axisProps = {
  tick: { fontSize: 10, fill: AXIS },
  tickLine: false,
  axisLine: { stroke: GRID },
} as const;

function KpiTile({
  label,
  value,
  peer,
  spark,
}: {
  label: string;
  value: string;
  peer?: string | null;
  spark?: number[];
}) {
  return (
    <div className="rounded-lg border border-[#E0D7C9] bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums text-[#1A1815]">{value}</p>
        {spark && spark.length > 1 && <Sparkline data={spark} width={64} height={22} color={SERIES[0]} />}
      </div>
      {peer && <p className="mt-0.5 text-[11px] text-[#6B6255]">Peer median {peer}</p>}
    </div>
  );
}

export function FinancialProfileCharts({
  points,
  peers,
  charterLabel,
}: {
  points: FinancialPoint[];
  peers: PeerMedianPoints | null;
  charterLabel: string;
}) {
  const [range, setRange] = useState<RangeKey>("10y");
  const [showLoanTable, setShowLoanTable] = useState(false);

  const visible = useMemo(() => {
    const quarters = RANGES.find((r) => r.key === range)?.quarters ?? 40;
    return Number.isFinite(quarters) ? points.slice(-quarters) : points;
  }, [points, range]);

  const latest = points[points.length - 1] ?? null;
  if (!latest) return null;

  const sources = [...new Set(visible.map((p) => SOURCE_LABELS[p.source] ?? p.source))].join(", ");
  const span = visible.length > 0 ? `${visible[0].quarter} to ${visible[visible.length - 1].quarter}` : "";
  const caption = `Source: ${sources}, ${span}. Quarterly figures; ratios annualized.`;
  const recent = points.slice(-12);

  const latestIncome = [...points].reverse().find((p) => p.netIncome !== null) ?? null;
  const latestCharges = [...points].reverse().find((p) => p.serviceCharges !== null) ?? null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label="Total assets" value={formatCompactDollars(latest.assets)} spark={values(recent, "assets")} />
        <KpiTile
          label={`Net income${latestIncome ? ` (${latestIncome.quarter})` : ""}`}
          value={formatCompactDollars(latestIncome?.netIncome ?? null)}
          spark={values(recent, "netIncome")}
        />
        <KpiTile label="Return on assets" value={pct(latest.roaPct)} peer={peers ? pct(peers.roaPct) : null} spark={values(recent, "roaPct")} />
        <KpiTile label="Net interest margin" value={pct(latest.nimPct)} peer={peers ? pct(peers.nimPct) : null} spark={values(recent, "nimPct")} />
        <KpiTile label="Efficiency ratio" value={pct(latest.efficiencyPct, 1)} peer={peers ? pct(peers.efficiencyPct, 1) : null} />
        <KpiTile label="Net charge-off rate" value={pct(latest.ncoRatePct)} peer={peers ? pct(peers.ncoRatePct) : null} spark={values(recent, "ncoRatePct")} />
        <KpiTile label={latest.source === "ncua" ? "Net worth ratio" : "Tier 1 capital ratio"} value={pct(latest.tier1Pct, 1)} peer={peers ? pct(peers.tier1Pct, 1) : null} />
        <KpiTile
          label={`Deposit service charges${latestCharges ? ` (${latestCharges.quarter})` : ""}`}
          value={formatCompactDollars(latestCharges?.serviceCharges ?? null)}
          spark={values(recent, "serviceCharges")}
        />
      </div>
      {peers && (
        <p className="mt-2 text-[11px] text-[#6B6255]">
          Peers: {peers.peerCount.toLocaleString("en-US")} {charterLabel.toLowerCase()} institutions in the same asset tier, {peers.quarter}.
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">History</p>
        <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-[#E0D7C9] bg-white p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                range === r.key ? "bg-[#1A1815] text-white" : "text-[#5A5347] hover:bg-[#FAF7F2]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Balance sheet" subtitle="Total assets, deposits, and loans" caption={caption}>
          <Legend
            items={[
              { label: "Assets", color: SERIES[0] },
              { label: "Deposits", color: SERIES[1] },
              { label: "Loans", color: SERIES[2] },
            ]}
          />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="quarter" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} tickFormatter={compactAxis} width={56} />
              <Tooltip content={<ChartTooltip format={formatCompactDollars} />} />
              <Line type="monotone" dataKey="assets" name="Assets" stroke={SERIES[0]} strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="deposits" name="Deposits" stroke={SERIES[1]} strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="loans" name="Loans" stroke={SERIES[2]} strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {hasAny(visible, ["netIncome"]) && (
          <ChartCard title="Net income" subtitle="By quarter" caption={caption}>
            <ResponsiveContainer width="100%" height={236}>
              <BarChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="quarter" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={compactAxis} width={56} />
                <ReferenceLine y={0} stroke={AXIS} />
                <Tooltip cursor={{ fill: "#FAF7F2" }} content={<ChartTooltip format={formatCompactDollars} />} />
                <Bar dataKey="netIncome" name="Net income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {hasAny(visible, ["roaPct"]) && (
          <ChartCard
            title="Return on assets"
            subtitle={peers?.roaPct != null ? "Annualized, with peer median" : "Annualized"}
            caption={caption}
          >
            {peers?.roaPct != null && (
              <Legend
                items={[
                  { label: "This institution", color: SERIES[0] },
                  { label: `Peer median (${peers.quarter})`, color: PEER, dashed: true },
                ]}
              />
            )}
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="quarter" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={44} />
                <Tooltip content={<ChartTooltip format={(v) => pct(v)} />} />
                {peers?.roaPct != null && <ReferenceLine y={peers.roaPct} stroke={PEER} strokeDasharray="4 4" />}
                <Line type="linear" dataKey="roaPct" name="ROA" stroke={SERIES[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {hasAny(visible, ["loansRealEstate", "loansCommercial", "loansConsumer"]) && (
          <ChartCard
            title="Loan mix"
            subtitle="Outstanding loans by type"
            caption={`${caption} Other = net loans less the three named types.`}
          >
            <div className="flex items-start justify-between gap-2">
              <Legend
                items={[
                  { label: "Real estate", color: SERIES[0] },
                  { label: "Commercial & industrial", color: SERIES[1] },
                  { label: "Consumer", color: SERIES[2] },
                  { label: "Other", color: SERIES[3] },
                ]}
              />
              <button
                type="button"
                onClick={() => setShowLoanTable((v) => !v)}
                className="shrink-0 text-[11px] font-medium text-[#A93D25] hover:underline"
              >
                {showLoanTable ? "Show chart" : "Show table"}
              </button>
            </div>
            {showLoanTable ? (
              <div className="mt-2 max-h-[220px] overflow-auto">
                <table className="w-full text-left text-[11px] tabular-nums">
                  <thead className="sticky top-0 bg-white text-[#6B6255]">
                    <tr>
                      <th className="py-1 font-medium">Quarter</th>
                      <th className="py-1 text-right font-medium">Real estate</th>
                      <th className="py-1 text-right font-medium">C&amp;I</th>
                      <th className="py-1 text-right font-medium">Consumer</th>
                      <th className="py-1 text-right font-medium">Other</th>
                    </tr>
                  </thead>
                  <tbody className="text-[#1A1815]">
                    {[...visible].reverse().map((p) => (
                      <tr key={p.reportDate} className="border-t border-[#F1EBE1]">
                        <td className="py-1">{p.quarter}</td>
                        <td className="py-1 text-right">{formatCompactDollars(p.loansRealEstate)}</td>
                        <td className="py-1 text-right">{formatCompactDollars(p.loansCommercial)}</td>
                        <td className="py-1 text-right">{formatCompactDollars(p.loansConsumer)}</td>
                        <td className="py-1 text-right">{formatCompactDollars(p.loansOther)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="quarter" {...axisProps} minTickGap={24} />
                  <YAxis {...axisProps} tickFormatter={compactAxis} width={56} />
                  <Tooltip content={<ChartTooltip format={formatCompactDollars} />} />
                  {(["loansRealEstate", "loansCommercial", "loansConsumer", "loansOther"] as const).map((key, i) => (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={["Real estate", "Commercial & industrial", "Consumer", "Other"][i]}
                      stackId="loans"
                      stroke="#FFFFFF"
                      strokeWidth={2}
                      fill={SERIES[i]}
                      fillOpacity={0.9}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        )}

        {hasAny(visible, ["ncoRatePct", "noncurrentRatePct"]) && (
          <ChartCard title="Credit quality" subtitle="Net charge-off rate and noncurrent loans, % of loans" caption={caption}>
            <Legend
              items={[
                { label: "Net charge-off rate", color: SERIES[0] },
                { label: "Noncurrent loans", color: SERIES[1] },
              ]}
            />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="quarter" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={(v: number) => `${v.toFixed(1)}%`} width={44} />
                <Tooltip content={<ChartTooltip format={(v) => pct(v)} />} />
                <Line type="linear" dataKey="ncoRatePct" name="Net charge-off rate" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="noncurrentRatePct" name="Noncurrent loans" stroke={SERIES[1]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            {peers && (peers.ncoRatePct !== null || peers.noncurrentRatePct !== null) && (
              <p className="text-[11px] text-[#6B6255]">
                Peer medians {peers.quarter}: charge-offs {pct(peers.ncoRatePct)}, noncurrent {pct(peers.noncurrentRatePct)}.
              </p>
            )}
          </ChartCard>
        )}

        {hasAny(visible, ["serviceCharges"]) && (
          <ChartCard title="Deposit service charges" subtitle="Fee income on deposit accounts, by quarter" caption={caption}>
            <ResponsiveContainer width="100%" height={236}>
              <BarChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="quarter" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} tickFormatter={compactAxis} width={56} />
                <Tooltip cursor={{ fill: "#FAF7F2" }} content={<ChartTooltip format={formatCompactDollars} />} />
                <Bar dataKey="serviceCharges" name="Service charges" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>
      <p className="mt-3 text-[11px]" style={{ color: INK_MUTED }}>
        <span style={{ color: INK }} className="font-medium">How to read this:</span> figures come straight from
        regulator filings and refresh as each quarter is published. Credit unions report income year to date;
        quarterly figures here are the change from the prior quarter of the same year.
      </p>
    </div>
  );
}
