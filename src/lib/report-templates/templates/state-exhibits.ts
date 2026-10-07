/**
 * The State Index report's designed exhibits: the county overdraft map, the fee ladder (every
 * institution as a dot), the largest deposit holders, banks against credit unions, and the
 * state economy. Each takes data already read and returns a report section, or a plain notice
 * when the data is not there. Charts are drawn by base/state-charts.ts.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_TO_FIPS } from "@/lib/geo/state-fips";
import type { StateEconomicContext, IndicatorPoint } from "@/lib/data-store/economic-context";
import { STATE_CHART_FEES, type StateVisualsData } from "@/lib/data-store/state-visuals";
import type { StateReportData } from "@/lib/research-report/state-report-data";
import { emptyNotice, escapeHtml, reportSection } from "../index";
import {
  annotatedLines,
  charterDumbbells,
  charterLegend,
  countyFeeMap,
  depositHolders,
  feeLadder,
  ladderLegend,
  lineLegend,
  mapLegend,
  type LadderRow,
  type LinePoint,
} from "../base/state-charts";

export interface StateReportVisuals {
  /** Fees per institution, county overdraft fees and deposit holders; null when the read failed. */
  data: StateVisualsData | null;
  /** State and national indicator series; null when the read failed. */
  economy: StateEconomicContext | null;
}

/** A fee row on the ladder needs at least this many institutions. */
export const LADDER_MIN_INSTITUTIONS = 3;
const LINE_MONTHS = 60;

const money = (v: number): string => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const pct = (v: number): string => `${Math.round(v)}%`;

function source(asOf: string | null, text: string): string {
  return `<div class="exhibit-source">${escapeHtml(text + (asOf ? ` Data as of ${asOf}.` : ""))}</div>`;
}

function exhibit(chart: string, legend: string, className = "state-exhibit"): string {
  return `<figure class="${className}">${legend}${chart}</figure>`;
}

function monthYear(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ─── County map ───────────────────────────────────────────────────────────────

export function countyMapSection(data: StateReportData, visuals: StateReportVisuals, label: string): string {
  const v = visuals.data;
  const fips = STATE_TO_FIPS[data.stateCode];
  const header = { label, title: `The overdraft fee where ${data.stateName} deposits sit` };
  if (!v || v.counties.length === 0 || !fips) {
    return reportSection(
      header,
      emptyNotice(`Branch deposit figures for ${data.stateName} are not loaded yet, so there is no county map.`),
      "county-map",
    );
  }
  const map = countyFeeMap(
    fips,
    v.counties.map((c) => ({ fips: c.fips, value: c.overdraft, deposits: c.deposits, covered_deposits: c.covered_deposits })),
  );
  if (!map) {
    return reportSection(header, emptyNotice(`No county outlines are on file for ${data.stateName}.`), "county-map");
  }
  const deposits = v.counties.reduce((s, c) => s + c.deposits, 0);
  const covered = v.counties.reduce((s, c) => s + c.covered_deposits, 0);
  const weighted = v.counties.reduce((s, c) => s + (c.overdraft ?? 0) * c.covered_deposits, 0);
  const average = covered > 0 ? Math.round((weighted / covered) * 100) / 100 : null;
  const share = deposits > 0 ? (covered / deposits) * 100 : 0;
  const subheading =
    average !== null
      ? `Institutions with a verified overdraft fee hold ${pct(share)} of the deposits at ${data.stateName} branches. Weighted by those deposits, their overdraft fee averages ${money(average)}.`
      : `No institution with branches in ${data.stateName} has a verified overdraft fee above $0 yet.`;
  return reportSection(
    { ...header, subheading },
    exhibit(map, mapLegend()) +
      source(
        data.asOf,
        `Each county shows the overdraft fee of the institutions with branches there, weighted by their deposits in that county (FDIC Summary of Deposits, ${v.sod_year}). An institution counts with its own published fee wherever it is based. Fees of $0 are left out. Hatched counties have no branch of an institution with a verified fee yet.`,
      ),
    "county-map",
  );
}

// ─── Fee ladder ───────────────────────────────────────────────────────────────

export function ladderRows(data: StateReportData, v: StateVisualsData): LadderRow[] {
  return STATE_CHART_FEES.map((category) => {
    const national = data.comparisons.find((c) => c.fee_category === category);
    return {
      label: getDisplayName(category),
      points: v.institutions
        .filter((i) => i.fees[category] !== undefined)
        .map((i) => ({ value: i.fees[category], charter: i.charter, name: i.name })),
      national:
        national && national.national_p25 != null && national.national_median != null && national.national_p75 != null
          ? { p25: national.national_p25, median: national.national_median, p75: national.national_p75 }
          : null,
    };
  }).filter((r) => r.points.length >= LADDER_MIN_INSTITUTIONS);
}

export function feeLadderSection(data: StateReportData, visuals: StateReportVisuals, label: string): string {
  const rows = visuals.data ? ladderRows(data, visuals.data) : [];
  const chart = rows.length > 0 ? feeLadder(rows, data.stateCode) : null;
  const count = new Set(rows.flatMap((r) => r.points.map((p) => p.name))).size;
  return reportSection(
    {
      label,
      title: `Every ${data.stateName} institution's fee, one dot each`,
      subheading: chart
        ? `${count.toLocaleString("en-US")} ${data.stateName} institutions on one dollar scale. The band is the middle half of prices nationwide and the dark tick the national median.`
        : undefined,
    },
    chart
      ? exhibit(chart, ladderLegend(), "state-exhibit state-exhibit-flow") +
          source(data.asOf, `Each dot is one institution's published fee (its median when it lists more than one). A row needs at least ${LADDER_MIN_INSTITUTIONS} institutions; the figure after the state median is how many.`)
      : emptyNotice(`Too few ${data.stateName} institutions publish these fees yet to place them on a ladder.`),
    "ladder",
  );
}

// ─── Deposit holders ──────────────────────────────────────────────────────────

export function holdersSection(data: StateReportData, visuals: StateReportVisuals, label: string): string {
  const v = visuals.data;
  const rows = (v?.holders ?? []).map((h) => ({
    name: h.name,
    deposits: h.deposits,
    homeState: h.hq_state === data.stateCode,
    hqState: h.hq_state,
    overdraft: h.overdraft,
  }));
  const chart = depositHolders(rows, data.stateName);
  if (!chart || !v) {
    return reportSection(
      { label, title: `Who holds ${data.stateName} deposits` },
      emptyNotice(`Branch deposit figures for ${data.stateName} are not loaded yet.`),
      "holders",
    );
  }
  const outside = rows.filter((r) => !r.homeState).length;
  const missing = rows.filter((r) => r.overdraft === null).length;
  return reportSection(
    {
      label,
      title: `The ${rows.length} largest holders of ${data.stateName} deposits`,
      subheading: `${outside === 0 ? "All" : `${outside} of them`} ${outside === 1 ? "is" : outside === 0 ? "are based in" : "are"}${outside === 0 ? ` ${data.stateName}` : ` based outside ${data.stateName}`}. ${
        missing === 0 ? "Each has a verified overdraft fee on file." : `${missing} ${missing === 1 ? "has" : "have"} no verified overdraft fee on file yet ("not yet").`
      }`,
    },
    exhibit(
      chart,
      `<div class="state-chart-legend"><span><svg width="16" height="10" aria-hidden="true"><rect width="16" height="10" fill="#1A1815"/></svg>Based in ${escapeHtml(data.stateName)}</span><span><svg width="16" height="10" aria-hidden="true"><rect width="16" height="10" fill="#A09788"/></svg>Based in another state</span></div>`,
    ) + source(data.asOf, `Deposits at branches in ${data.stateName}, FDIC Summary of Deposits ${v.sod_year}. Overdraft fee: the institution's median published overdraft fee.`),
    "holders",
  );
}

// ─── Banks against credit unions ──────────────────────────────────────────────

export function charterExhibit(data: StateReportData): string | null {
  const chart = charterDumbbells(
    data.charterPairs
      .filter((p) => p.bank_median_amount != null && p.cu_median_amount != null)
      .map((p) => ({ label: getDisplayName(p.fee_category), bank: p.bank_median_amount!, creditUnion: p.cu_median_amount! })),
  );
  return chart ? exhibit(chart, charterLegend()) : null;
}

// ─── Economy ──────────────────────────────────────────────────────────────────

function lastMonths(points: IndicatorPoint[], months: number): LinePoint[] {
  return points.slice(-months).map((p) => ({ date: p.date, value: p.value }));
}

function monthKey(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
}

/** Percent change from the same month a year earlier, for months that have one. */
export function yearOverYear(points: IndicatorPoint[]): LinePoint[] {
  const byMonth = new Map(points.map((p) => [monthKey(p.date), p.value]));
  return points.flatMap((p) => {
    const before = byMonth.get(monthKey(p.date) - 12);
    return before ? [{ date: p.date, value: ((p.value - before) / before) * 100 }] : [];
  });
}

/** Round tick values covering [min, max], four to six of them. */
export function niceTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min);
  const step = [0.5, 1, 2, 4, 5, 10, 20].find((s) => span / s <= 5) ?? 50;
  const lo = Math.floor(Math.min(0, min) / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 10) / 10);
  return ticks;
}

function pairPanel(title: string, chart: string | null, legend: string): string {
  return chart ? `<div class="state-chart-panel"><div class="state-chart-title">${escapeHtml(title)}</div>${legend}${chart}</div>` : "";
}

export function economySection(data: StateReportData, visuals: StateReportVisuals, label: string): string {
  const e = visuals.economy;
  const stateUr = e?.state_unemployment ? lastMonths(e.state_unemployment.history, LINE_MONTHS) : [];
  const usUr = e?.national_unemployment ? lastMonths(e.national_unemployment.history, LINE_MONTHS) : [];
  const prices = e?.cpi_all_items ? yearOverYear(e.cpi_all_items.history).slice(-LINE_MONTHS) : [];
  const funds = e?.fed_funds ? lastMonths(e.fed_funds.history, LINE_MONTHS) : [];

  const urValues = [...stateUr, ...usUr].map((p) => p.value);
  const urChart =
    urValues.length > 0
      ? annotatedLines(
          [
            { label: data.stateName, points: stateUr, primary: true },
            { label: "United States", points: usUr, primary: false },
          ],
          { format: (v, end) => `${end ? v.toFixed(1) : v}%`, ticks: niceTicks(0, Math.max(...urValues)), label: "Unemployment rate" },
        )
      : null;
  const cpiValues = [...prices, ...funds].map((p) => p.value);
  const cpiChart =
    cpiValues.length > 0
      ? annotatedLines(
          [
            { label: "Consumer prices", points: prices, primary: true },
            { label: "Fed funds rate", points: funds, primary: false },
          ],
          {
            format: (v, end) => `${v < 0 ? "−" : ""}${end ? Math.abs(v).toFixed(1) : Math.abs(v)}%`,
            ticks: niceTicks(Math.min(...cpiValues), Math.max(...cpiValues)),
            label: "Inflation and the Fed funds rate",
          },
        )
      : null;

  const panels =
    pairPanel("Unemployment rate", urChart, lineLegend(data.stateName, "United States")) +
    pairPanel("Inflation and the Fed funds rate (U.S.)", cpiChart, lineLegend("Consumer prices, change from a year earlier", "Fed funds rate"));
  // Compare the two rates in the same month: the national figure is often a month ahead.
  const s = e?.state_unemployment?.latest;
  const u = s ? e?.national_unemployment?.history.find((p) => p.date.slice(0, 7) === s.date.slice(0, 7)) : undefined;
  const title =
    s && u
      ? `${data.stateName} unemployment was ${s.value.toFixed(1)}% in ${monthYear(s.date)}, against ${u.value.toFixed(1)}% nationally`
      : `The ${data.stateName} economy`;
  return reportSection(
    { label, title },
    panels
      ? `<figure class="state-exhibit state-chart-pair">${panels}</figure>` +
          source(null, "Unemployment: BLS Local Area Unemployment Statistics and the national rate (UNRATE). Inflation: BLS consumer price index, all items, change from the same month a year earlier. Fed funds: effective rate (FEDFUNDS). Read from FRED.")
      : emptyNotice(`Economic series for ${data.stateName} are not loaded yet.`),
    "economy",
  );
}
