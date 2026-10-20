"use client";

import { useState } from "react";
import { formatCompactDollars } from "@/lib/format";
import type { MetricDef } from "./overview-metrics";
import { Provenance, type ProvenanceRow } from "./provenance";
import { formatValue, QuarterChart } from "./quarter-chart";
import {
  change,
  previousQuarterEnd,
  rangeQuarters,
  RANGES,
  yearEarlier,
  type LedgerMetric,
  type LedgerQuarter,
  type RangeKey,
} from "./quarterly-ledger";

/**
 * Financial performance A: one measure at a time over 4, 8, 10 or every quarter on file, with
 * its change in dollars (points for a ratio) and percent. Income lines are standalone quarters
 * (quarterly-ledger.ts); balances are quarter-end figures.
 */
function signed(def: Pick<MetricDef, "unit">, dollars: number): string {
  const sign = dollars > 0 ? "+" : dollars < 0 ? "−" : "";
  if (def.unit === "percent") return `${sign}${Math.abs(dollars).toFixed(2)} pts`;
  return `${sign}${formatCompactDollars(Math.abs(dollars))}`;
}

function signedPct(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
}

function ChangeCell({ label, def, now, then, thenQuarter }: { label: string; def: MetricDef; now: number | null; then: number | null; thenQuarter: string | null }) {
  const c = change(now, then);
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-ink [font-variant-numeric:tabular-nums]">
        {c ? (
          <>
            {signed(def, c.dollars)}
            {def.unit === "dollars" && signedPct(c.pct) && <span className="ml-1.5 font-normal text-ink-soft">{signedPct(c.pct)}</span>}
          </>
        ) : (
          <span className="font-normal text-ink-muted">Not reported</span>
        )}
      </dd>
      {c && thenQuarter && <dd className="text-[11px] text-ink-muted">from {thenQuarter}</dd>}
    </div>
  );
}

export function FinancialPerformanceChart({
  quarters,
  defs,
  metrics,
  provenance,
}: {
  quarters: LedgerQuarter[];
  defs: Record<LedgerMetric, MetricDef>;
  /** The measures with at least two quarters on file, in selector order. */
  metrics: LedgerMetric[];
  /** Details rows per measure and range, computed on the server. */
  provenance: Partial<Record<LedgerMetric, Record<RangeKey, ProvenanceRow[]>>>;
}) {
  const [metric, setMetric] = useState<LedgerMetric>(metrics.includes("serviceCharges") ? "serviceCharges" : metrics[0]);
  const [range, setRange] = useState<RangeKey>("8");
  const def = defs[metric];
  const shown = rangeQuarters(quarters, metric, range);
  const points = shown.map((q) => ({ reportDate: q.reportDate, quarter: q.quarter, value: q.values[metric]?.value ?? null }));
  const withValue = shown.filter((q) => q.values[metric]);
  const last = withValue[withValue.length - 1] ?? null;
  const first = withValue[0] ?? null;
  const valueOn = (date: string) => quarters.find((q) => q.reportDate === date)?.values[metric]?.value ?? null;
  const quarterOn = (date: string) => quarters.find((q) => q.reportDate === date)?.quarter ?? null;
  const now = last?.values[metric]?.value ?? null;
  const prevDate = last ? previousQuarterEnd(last.reportDate) : null;
  const yearDate = last ? yearEarlier(last.reportDate) : null;
  const totalOnFile = quarters.filter((q) => q.values[metric]).length;

  if (metrics.length === 0) return <p className="text-[14px] text-ink-muted">Not reported.</p>;

  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-0 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Measure
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as LedgerMetric)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-control-border bg-surface-0 px-3 text-[15px] text-ink sm:w-auto"
          >
            {metrics.map((m) => (
              <option key={m} value={m}>
                {defs[m].key === "revenue" ? defs[m].measure : defs[m].label}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Quarters shown" className="inline-flex rounded-lg border border-control-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`min-h-10 min-w-12 rounded-md px-3 text-[14px] font-medium ${
                range === r.key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 text-[15px] font-semibold text-ink">{def.key === "revenue" ? def.measure : def.label}</p>
      <p className="text-[13px] text-ink-muted">
        {first && last ? `${first.quarter} to ${last.quarter}` : "Not reported"}
        {def.flow ? ", standalone quarters" : def.unit === "dollars" ? ", quarter end" : ""}
        {` · ${totalOnFile} ${totalOnFile === 1 ? "quarter" : "quarters"} on file`}
      </p>
      <div className="mt-3">
        <QuarterChart points={points} unit={def.unit} flow={def.flow} label={def.label} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[12px] text-ink-muted">Latest{last ? `, ${last.quarter}` : ""}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold text-ink [font-variant-numeric:tabular-nums]">{formatValue(def.unit, now)}</dd>
        </div>
        <ChangeCell label="vs prior quarter" def={def} now={now} then={prevDate ? valueOn(prevDate) : null} thenQuarter={prevDate ? quarterOn(prevDate) : null} />
        <ChangeCell label="vs a year earlier" def={def} now={now} then={yearDate ? valueOn(yearDate) : null} thenQuarter={yearDate ? quarterOn(yearDate) : null} />
        <ChangeCell
          label="vs start of range"
          def={def}
          now={now}
          then={first && first !== last ? (first.values[metric]?.value ?? null) : null}
          thenQuarter={first && first !== last ? first.quarter : null}
        />
      </dl>

      <div className="mt-2 flex flex-wrap gap-x-6">
        <Provenance rows={provenance[metric]?.[range] ?? []} />
        <details className="group/tbl min-w-0 basis-full">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="text-[9px] transition-transform group-open/tbl:rotate-90">
              &#9654;
            </span>
            Table
          </summary>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full text-[13px] [font-variant-numeric:tabular-nums]">
              <thead className="sticky top-0 bg-paper text-left text-[12px] text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Quarter</th>
                  <th className="px-3 py-2 text-right font-medium">{def.unit === "percent" ? "Value" : "Amount"}</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                  {def.unit === "dollars" && <th className="px-3 py-2 text-right font-medium">%</th>}
                </tr>
              </thead>
              <tbody>
                {[...shown].reverse().map((q) => {
                  const v = q.values[metric]?.value ?? null;
                  const c = change(v, valueOn(previousQuarterEnd(q.reportDate)));
                  return (
                    <tr key={q.reportDate} className="border-t border-border">
                      <td className="px-3 py-1.5 text-ink">{q.quarter}</td>
                      <td className="px-3 py-1.5 text-right text-ink">{formatValue(def.unit, v)}</td>
                      <td className="px-3 py-1.5 text-right text-ink-soft">{c ? signed(def, c.dollars) : ""}</td>
                      {def.unit === "dollars" && <td className="px-3 py-1.5 text-right text-ink-soft">{c ? (signedPct(c.pct) ?? "") : ""}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}
