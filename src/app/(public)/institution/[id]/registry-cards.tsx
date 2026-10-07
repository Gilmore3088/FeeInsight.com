"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { US_STATES } from "@/lib/us-map-paths";
import { STATE_NAMES } from "@/lib/us-states";
import { formatCompactDollars } from "@/lib/format";
import type { BranchFootprint, ComplaintTrend, HoldingCompanyProfile } from "@/lib/data-store/registry-profile";

/*
 * Registry cards for the gated Financial profile. Colors reuse the validated
 * categorical slots from financial-profile.tsx; the map uses one blue hue,
 * light to dark (sequential), and every chart has a text/table equivalent.
 */
const AXIS = "#A09788";
const GRID = "#EFE8DC";
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
const OTHER = "#B8AFA2";
const RAMP = ["#E3EEFA", "#B5D0F1", "#7DAEE6", "#4189DB", "#1F5FAE"] as const;

const axisProps = { tick: { fontSize: 10, fill: AXIS }, tickLine: false, axisLine: { stroke: GRID } } as const;

function Card({ title, subtitle, caption, children }: { title: string; subtitle?: string; caption: string; children: React.ReactNode }) {
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

function thousandsToDollars(value: number): number {
  return value * 1_000;
}

interface TooltipEntry {
  name?: string;
  value?: number | null;
  color?: string;
  dataKey?: string | number;
}

function SimpleTooltip({ active, payload, label, format }: { active?: boolean; payload?: TooltipEntry[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E8DFD1] bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-[#1A1815]">{label}</p>
      {payload
        .filter((entry) => entry.value)
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

/** "2026-06-30" -> "June 30, 2026". */
function formatQuarterEnd(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function BranchFootprintCard({ footprint }: { footprint: BranchFootprint }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const byState = useMemo(() => new Map(footprint.byState.map((s) => [s.state, s])), [footprint]);
  const max = Math.max(1, ...footprint.byState.map((s) => s.branches));
  const latest = footprint.byYear[footprint.byYear.length - 1];
  const fill = (code: string) => {
    const data = byState.get(code);
    if (!data) return "#F4F1EC";
    const step = Math.min(RAMP.length - 1, Math.floor((data.branches / max) * RAMP.length));
    return RAMP[step];
  };
  const hoveredState = hovered ? byState.get(hovered) : null;
  const trend = footprint.byYear.map((y) => ({ year: String(y.year), branches: y.branches }));
  const isCu = footprint.source === "ncua";
  const localMap = footprint.localMap ?? null;
  const mapped = footprint.mappedOffices ?? 0;
  const nearby = footprint.nearby ?? [];
  const nearbyCount = footprint.nearbyCount ?? nearby.length;
  const stateCount = `${footprint.byState.length} ${footprint.byState.length === 1 ? "state" : "states"}`;
  const subtitle = isCu
    ? `${latest.branches.toLocaleString("en-US")} ${latest.branches === 1 ? "office" : "offices"} in ${stateCount}${footprint.reportDate ? ` (${formatQuarterEnd(footprint.reportDate)})` : ""}`
    : `${latest.branches.toLocaleString("en-US")} offices in ${stateCount}, ${formatCompactDollars(thousandsToDollars(latest.deposits))} in branch deposits (June ${footprint.latestYear})`;
  const caption = isCu
    ? `Source: NCUA credit union branch file${footprint.reportDate ? `, quarter ending ${formatQuarterEnd(footprint.reportDate)}` : ""}. NCUA does not report deposits by office.`
    : `Source: FDIC Summary of Deposits, ${footprint.byYear[0].year} to ${footprint.latestYear}. Deposits are booked at the branch as of June 30.`;

  return (
    <Card
      title="Branch footprint"
      subtitle={subtitle}
      caption={caption}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {localMap ? (
          <div className="relative">
            <svg viewBox={localMap.viewBox} className="h-auto w-full" role="img" aria-label={`${isCu ? "Offices" : "Branches"} on a map of ${stateCount}`}>
              {localMap.states.map((state) => (
                <path
                  key={state.id}
                  d={state.d}
                  fill={state.own ? RAMP[0] : "#F4F1EC"}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                  onMouseEnter={() => setHovered(state.id)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
              {localMap.othersPath && (
                <path d={localMap.othersPath} stroke="#8A8174" strokeOpacity={0.45} strokeWidth={8} strokeLinecap="round" fill="none" pointerEvents="none" />
              )}
              {localMap.dots.map((dot, i) => (
                <circle key={i} cx={dot.x} cy={dot.y} r={localMap.dotRadius} fill={RAMP[RAMP.length - 1]} fillOpacity={0.75} stroke="#FFFFFF" strokeWidth={1} />
              ))}
              {localMap.labels.map((label) => (
                <text
                  key={label.text}
                  x={label.x}
                  y={label.y - localMap.dotRadius - 6}
                  textAnchor="middle"
                  fontSize={22}
                  fontWeight={600}
                  fill="#1A1815"
                  stroke="#FFFFFF"
                  strokeWidth={5}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {label.text}
                </text>
              ))}
            </svg>
            <p className="min-h-[1.25rem] text-[11px] text-[#5A5347]" aria-live="polite">
              {hoveredState
                ? `${STATE_NAMES[hoveredState.state] ?? hoveredState.state}: ${hoveredState.branches.toLocaleString("en-US")} ${isCu ? "offices" : `branches, ${formatCompactDollars(thousandsToDollars(hoveredState.deposits))}`}`
                : hovered
                  ? `${STATE_NAMES[hovered] ?? hovered}: no ${isCu ? "offices" : "branches"}`
                  : `Each dot is one office.`}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#6B6255]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: RAMP[RAMP.length - 1] }} />
                {isCu ? "This credit union" : "This bank"}
              </span>
              {localMap.othersCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#8A8174] opacity-60" />
                  Other banks and credit unions
                </span>
              )}
            </div>
            {(mapped < latest.branches || (footprint.approxOffices ?? 0) > 0) && (
              <p className="text-[10px] text-[#6B6255]">
                {mapped < latest.branches &&
                  `${mapped.toLocaleString("en-US")} of ${latest.branches.toLocaleString("en-US")} ${isCu ? "offices" : "branches"} on the map. `}
                {(footprint.approxOffices ?? 0) > 0 &&
                  `${(footprint.approxOffices ?? 0).toLocaleString("en-US")} ${footprint.approxOffices === 1 ? "is" : "are"} shown at the middle of ${footprint.approxOffices === 1 ? "its" : "their"} town until the exact address is found.`}
              </p>
            )}
          </div>
        ) : footprint.mapPending ? (
          <div className="flex min-h-[10rem] flex-col justify-center rounded-lg border border-dashed border-[#E0D7C9] bg-[#FAF7F2] px-4 py-6 text-center">
            <p className="text-[12px] font-medium text-[#1A1815]">Map coming soon</p>
            <p className="mt-1 text-[11px] text-[#6B6255]">
              We are placing each {isCu ? "office" : "branch"} on the map from its address. {mapped.toLocaleString("en-US")} of{" "}
              {latest.branches.toLocaleString("en-US")} are placed so far; the map appears once most are.
            </p>
          </div>
        ) : (
          <div className="relative">
            <svg viewBox="0 0 960 600" className="h-auto w-full" role="img" aria-label="Branches by state">
              {US_STATES.map((state) => (
                <path
                  key={state.id}
                  d={state.d}
                  fill={fill(state.id)}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                  onMouseEnter={() => setHovered(state.id)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            </svg>
            <p className="min-h-[1.25rem] text-[11px] text-[#5A5347]" aria-live="polite">
              {hoveredState
                ? `${STATE_NAMES[hoveredState.state] ?? hoveredState.state}: ${hoveredState.branches.toLocaleString("en-US")} ${isCu ? "offices" : `branches, ${formatCompactDollars(thousandsToDollars(hoveredState.deposits))}`}`
                : hovered
                  ? `${STATE_NAMES[hovered] ?? hovered}: no ${isCu ? "offices" : "branches"}`
                  : `Hover a state for its ${isCu ? "office" : "branch"} count.`}
            </p>
            <div className="mt-1 flex items-center gap-1 text-[10px] text-[#6B6255]">
              <span>Fewer</span>
              {RAMP.map((color) => (
                <span key={color} className="inline-block h-2 w-5 rounded-sm" style={{ background: color }} />
              ))}
              <span>{isCu ? "More offices" : "More branches"}</span>
            </div>
          </div>
        )}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">
            {isCu ? "Cities with the most offices" : "Largest markets by deposits"}
          </p>
          <table className="mt-1 w-full text-left text-[11px] tabular-nums">
            <tbody className="text-[#1A1815]">
              {footprint.topMarkets.map((m) => (
                <tr key={m.msa_name} className="border-t border-[#F1EBE1]">
                  <td className="py-1 pr-2">{m.msa_name}</td>
                  <td className="py-1 text-right text-[#5A5347]">{m.branches}</td>
                  {!isCu && <td className="py-1 pl-2 text-right">{formatCompactDollars(thousandsToDollars(m.deposits))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {nearby.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Largest competitors nearby</p>
              <table className="mt-1 w-full text-left text-[11px] tabular-nums">
                <thead className="text-[10px] text-[#6B6255]">
                  <tr>
                    <th className="py-1 pr-2 font-normal">{nearbyCount.toLocaleString("en-US")} in its local market</th>
                    <th className="py-1 pl-2 text-right font-normal">Deposit share</th>
                  </tr>
                </thead>
                <tbody className="text-[#1A1815]">
                  {nearby.map((n) => (
                    <tr key={n.name} className="border-t border-[#F1EBE1]">
                      <td className="py-1 pr-2">{n.name}</td>
                      <td className="py-1 pl-2 text-right">{n.depositSharePct === null ? "Credit union" : `${n.depositSharePct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {footprint.ownDepositSharePct != null && (
                <p className="mt-1 text-[11px] text-[#5A5347]">
                  This bank holds {footprint.ownDepositSharePct}% of the deposits in its local market.
                </p>
              )}
            </>
          )}
          {trend.length > 1 && (
            <>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Branch count by year</p>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={trend} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="year" {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} width={36} allowDecimals={false} />
                  <Tooltip content={<SimpleTooltip format={(v) => v.toLocaleString("en-US")} />} />
                  <Line type="linear" dataKey="branches" name="Branches" stroke={SERIES[0]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function ComplaintsCard({ trend }: { trend: ComplaintTrend }) {
  const { rows, keys } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of trend.byYearProduct) totals.set(r.product, (totals.get(r.product) ?? 0) + r.count);
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, SERIES.length).map(([p]) => p);
    const byYear = new Map<string, Record<string, number | string>>();
    for (const r of trend.byYearProduct) {
      const row = byYear.get(r.year) ?? { year: r.year };
      const key = top.includes(r.product) ? r.product : "Other";
      row[key] = Number(row[key] ?? 0) + r.count;
      byYear.set(r.year, row);
    }
    const hasOther = trend.byYearProduct.some((r) => !top.includes(r.product));
    return { rows: [...byYear.values()], keys: hasOther ? [...top, "Other"] : top };
  }, [trend]);
  const color = (key: string, i: number) => (key === "Other" ? OTHER : SERIES[i]);
  const latestTotal = trend.byYearProduct.filter((r) => r.year === trend.latestYear).reduce((sum, r) => sum + r.count, 0);

  return (
    <Card
      title="Consumer complaints"
      subtitle={`${latestTotal.toLocaleString("en-US")} complaints to the CFPB in ${trend.latestYear}`}
      caption="Source: CFPB Consumer Complaint Database, by year received. Complaints are filed against the parent company and are not verified findings."
    >
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#5A5347]">
        {keys.map((key, i) => (
          <li key={key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: color(key, i) }} />
            {key}
          </li>
        ))}
      </ul>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" {...axisProps} />
          <YAxis {...axisProps} width={48} allowDecimals={false} />
          <Tooltip cursor={{ fill: "#FAF7F2" }} content={<SimpleTooltip format={(v) => v.toLocaleString("en-US")} />} />
          {keys.map((key, i) => (
            <Bar key={key} dataKey={key} name={key} stackId="complaints" fill={color(key, i)} stroke="#FFFFFF" strokeWidth={1} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {trend.topIssues.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Top issues, {trend.latestYear}</p>
          <table className="mt-1 w-full text-left text-[11px] tabular-nums">
            <tbody className="text-[#1A1815]">
              {trend.topIssues.map((issue) => (
                <tr key={issue.issue} className="border-t border-[#F1EBE1]">
                  <td className="py-1 pr-2">{issue.issue}</td>
                  <td className="py-1 text-right">{issue.count.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function HoldingCompanyCard({ profile }: { profile: HoldingCompanyProfile }) {
  const quarters = profile.quarters.filter((q) => q.net_income !== null || q.total_assets !== null);
  const latest = [...quarters].reverse().find((q) => q.total_assets !== null) ?? null;
  const listing = [profile.exchange, profile.ticker].filter(Boolean).join(": ");
  return (
    <Card
      title="Holding company"
      subtitle={`${profile.name ?? `CIK ${profile.cik}`}${listing ? ` (${listing})` : ""}`}
      caption={`Source: SEC EDGAR filings and XBRL financial data, CIK ${profile.cik}. Holding-company figures include every subsidiary and are not comparable to the bank-level call reports above.`}
    >
      {latest && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[#E0D7C9] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Consolidated assets</p>
            <p className="text-base font-semibold tabular-nums text-[#1A1815]">{formatCompactDollars(latest.total_assets)}</p>
          </div>
          <div className="rounded-lg border border-[#E0D7C9] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Shareholders&apos; equity</p>
            <p className="text-base font-semibold tabular-nums text-[#1A1815]">{formatCompactDollars(latest.stockholders_equity)}</p>
          </div>
          <div className="rounded-lg border border-[#E0D7C9] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">As of</p>
            <p className="text-base font-semibold tabular-nums text-[#1A1815]">{latest.fiscal_period ?? latest.period_end}</p>
          </div>
        </div>
      )}
      {quarters.some((q) => q.net_income !== null) && (
        <>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Net income by quarter</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={quarters} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="fiscal_period" {...axisProps} minTickGap={20} />
              <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatCompactDollars(v)} />
              <Tooltip cursor={{ fill: "#FAF7F2" }} content={<SimpleTooltip format={formatCompactDollars} />} />
              <Bar dataKey="net_income" name="Net income" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
      {profile.filings.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B6255]">Recent SEC filings</p>
          <ul className="mt-1 divide-y divide-[#F1EBE1] text-[12px]">
            {profile.filings.map((filing) => (
              <li key={`${filing.form}-${filing.filed_at}-${filing.primary_doc_url}`} className="flex items-center justify-between gap-3 py-1.5">
                <span className="font-medium text-[#1A1815]">{filing.form}</span>
                <span className="flex-1 truncate text-[#5A5347]">{filing.description ?? (filing.period_of_report ? `Period ${filing.period_of_report}` : "")}</span>
                <span className="tabular-nums text-[#6B6255]">{filing.filed_at}</span>
                {filing.primary_doc_url && (
                  <a href={filing.primary_doc_url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#A93D25] hover:underline">
                    View
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
