import type { CSSProperties } from "react";
import Link from "next/link";
import { PRODUCT_NAME, REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatCount } from "@/lib/public-stats";
import { REPORT_REQUEST_HREF, SAMPLE_REPORT_HREF, TEXT_LINK, axisMax, money, type DistrictPoint, type HomeData, type SampleRow } from "./landing-shared";

/**
 * The demo's still exhibits (server rendered, used by the plans page): the report page preview
 * and the national fee bars. Each one's default
 * style is its finished state; classes starting fi-a- only play in an opening demo view.
 */

const at = (ms: number) => ({ "--fi-d": `${ms}ms` }) as CSSProperties;
const pct = (v: number, hi: number) => `${Math.max(0, Math.min(100, (v / hi) * 100))}%`;

const POSITION_FILL: Record<SampleRow["position"], string> = {
  above_market: "var(--fi-viz-above)",
  in_market: "var(--fi-viz-inside)",
  below_market: "var(--fi-viz-below)",
  free: "var(--fi-viz-below)",
};

/** Without a live sample, My fees shows the nation: each fee's median as a bar, its middle half as a whisker. */
export function NationalFeesExhibit({ data }: { data: HomeData }) {
  const { lines, summary } = data;
  if (lines.length === 0) return null;
  const hi = axisMax(Math.max(...lines.map((line) => line.row.p75_amount)) * 1.1);
  return (
    <div className="p-4 sm:p-6">
      <p className="text-[13px] font-semibold text-ink">National medians, with the middle half of the market</p>
      <ul className="mt-3 space-y-2" aria-label="National fee medians">
        {lines.map((line, i) => (
          <li key={line.key} className="grid grid-cols-[10rem_minmax(0,1fr)_4.5rem] items-center text-[13px]">
            <span className="truncate pr-2 text-ink-soft">{line.label}</span>
            <span className="relative h-4" aria-hidden="true">
              <span className="fi-a-bar absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: pct(line.row.median_amount, hi), background: "var(--fi-viz-inside)", ...at(100 + i * 80) }} />
              <span
                className="absolute top-1/2 h-px bg-ink"
                style={{ left: pct(line.row.p25_amount, hi), width: `calc(${pct(line.row.p75_amount, hi)} - ${pct(line.row.p25_amount, hi)})` }}
              />
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-ink">{money(line.row.median_amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-ink-muted">{summary.freshnessLabel}</p>
    </div>
  );
}

/** One report row: the bank's fee as a dot on its local middle half (band) and median (line). */
function ReportStrip({ row, hi }: { row: SampleRow; hi: number }) {
  return (
    <span className="relative block h-3" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-px bg-[#ddd5c6]" />
      <span className="absolute inset-y-0 rounded-[2px] bg-[#132338]/12" style={{ left: pct(row.p25, hi), width: `calc(${pct(row.p75, hi)} - ${pct(row.p25, hi)})` }} />
      <span className="absolute inset-y-[-2px] w-[1.5px] bg-[#132338]" style={{ left: pct(row.median, hi) }} />
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
        style={{ left: pct(row.amount, hi), background: POSITION_FILL[row.position] }}
      />
    </span>
  );
}

/** The back page of the preview: each Fed district's overdraft median as a column. */
function DistrictColumns({ districts, national }: { districts: DistrictPoint[]; national: number }) {
  const drawn = districts.filter((d): d is DistrictPoint & { median: number } => d.median !== null);
  if (drawn.length < 2) return null;
  const hi = axisMax(Math.max(national, ...drawn.map((d) => d.median)));
  return (
    <div className="relative mt-3 flex h-24 items-end gap-1" aria-hidden="true">
      <span className="absolute inset-x-0 h-px bg-ink/50" style={{ bottom: pct(national, hi) }} />
      {drawn.map((d) => (
        <span key={d.district} className="flex-1 rounded-t-[3px]" style={{ height: pct(d.median, hi), background: "var(--fi-viz-3)" }} />
      ))}
    </div>
  );
}

const SHEET = "rounded-md border border-border bg-white text-[#132338] shadow-fi-2";

/**
 * Reports: a page of the Competitive Fee Position Report, drawn from the live sample. The
 * front page is the report's own exhibits (where its fees sit, and each fee on its local
 * range); the page behind it is the Fed district view. Without a sample, a national brief.
 */
export function ReportExhibit({ data }: { data: HomeData }) {
  const { sample, overdraft, districts, summary } = data;
  const rows = sample ? sample.rows : [];
  const live = sample && rows.length >= 3;
  const counts = (["above_market", "in_market", "below_market"] as const).map((p) => ({
    p,
    n: rows.filter((r) => r.position === p || (p === "below_market" && r.position === "free")).length,
  }));
  const shown = [...rows].sort((a, b) => Math.abs(b.amount - b.median) - Math.abs(a.amount - a.median)).slice(0, 5);
  const hi = axisMax(Math.max(1, ...shown.map((r) => Math.max(r.amount, r.p75))) * 1.1);
  const title = live ? `${sample.institutionName} against its local market` : "Overdraft: where the market stands";
  return (
    <div className="grid items-center gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-10">
      <div className="relative min-w-0 lg:pr-10">
        {live ? (
          <div className={`${SHEET} absolute right-0 top-6 hidden w-[46%] rotate-[3deg] p-4 lg:block`} aria-hidden="true">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#55606f]">Your fees against local competitors</p>
            <div className="mt-2 space-y-1.5">
              {rows.slice(0, 7).map((row) => (
                <p key={row.key} className="flex items-center justify-between gap-2 border-b border-[#ddd5c6] pb-1 text-[10px]">
                  <span className="truncate">{row.label}</span>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: POSITION_FILL[row.position] }} />
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <article className={`${SHEET} fi-a-rise relative w-full p-5 sm:w-[78%] sm:p-6`} aria-label="Report preview" data-report-page="">
          <div className="flex items-center justify-between border-b border-[#ddd5c6] pb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#55606f]">
            <span>{live ? "Competitive Fee Position Report" : "Committee brief"}</span>
            <span>{PRODUCT_NAME}</span>
          </div>
          <h3 className="mt-3 text-[18px] font-semibold leading-tight tracking-[-0.02em] sm:text-[20px]">{title}</h3>
          <p className="mt-1 text-[11px] text-[#55606f]">
            {live ? `${formatCount(sample.competitors)} local competitors · ` : ""}
            {summary.freshnessLabel}
          </p>
          {live ? (
            <>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55606f]">At a glance</p>
              <div className="mt-1.5 flex h-5 gap-[2px] overflow-hidden rounded-[4px]" aria-hidden="true">
                {counts
                  .filter((c) => c.n > 0)
                  .map((c, i) => (
                    <span key={c.p} className="fi-a-bar h-full" style={{ flexGrow: c.n, background: POSITION_FILL[c.p], ...at(250 + i * 150) }} />
                  ))}
              </div>
              <p className="mt-1.5 flex gap-3 text-[11px] text-[#55606f]">
                {counts.map((c) => (
                  <span key={c.p} className="flex items-center gap-1">
                    <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: POSITION_FILL[c.p] }} />
                    {c.n} {c.p === "above_market" ? "above" : c.p === "in_market" ? "inside" : "below"}
                  </span>
                ))}
              </p>
              <ul className="mt-4 space-y-2">
                {shown.map((row, i) => (
                  <li key={row.key} className="fi-a-rise grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-[11px]" style={at(500 + i * 90)}>
                    <span className="truncate">{row.label}</span>
                    <ReportStrip row={row} hi={hi} />
                    <span className="text-right font-mono tabular-nums">{money(row.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : overdraft ? (
            <>
              <p className="mt-4 text-[34px] font-semibold leading-none tracking-[-0.03em]">{money(overdraft.median_amount)}</p>
              <p className="mt-1 text-[11px] text-[#55606f]">National median, {formatCount(overdraft.institution_count)} institutions</p>
              <DistrictColumns districts={districts} national={overdraft.median_amount} />
            </>
          ) : null}
          <p className="mt-4 border-t border-[#ddd5c6] pt-2 text-[9px] text-[#55606f]">Source: each institution&apos;s published fee schedule</p>
        </article>
      </div>
      <div className="min-w-0">
        <p className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">A report, ready for committee</p>
        <p className="mt-2 text-[14px] text-ink-soft">Every fee placed in its market, each with its source.</p>
        <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
          <Link href={SAMPLE_REPORT_HREF} className="fi-btn fi-btn-secondary min-h-11">
            Open the sample report
          </Link>
          <Link href={REPORT_REQUEST_HREF} className={TEXT_LINK}>
            Request yours, {REPORT_PRICE_INLINE}
          </Link>
        </p>
      </div>
    </div>
  );
}
