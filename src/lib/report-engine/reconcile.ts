/**
 * Report reconciliation (#1066): before a report job is complete (and so before it can be
 * published), every fee figure it prints is recomputed from live rows and must tie out.
 *
 * - Dollar figures (medians, quartiles, institution counts, by charter, state, district or
 *   asset size) are recomputed from `published_fee_catalog` with the statistics contract
 *   (`summarizeFees`, fee-stats.ts), the same rows the report assemblers read.
 * - Rate figures are recomputed from `published_fee_rate_catalog` (`summarizeRates`), never
 *   pooled with dollars.
 * - A printed fee change ("now $X") must still be a live fee at that institution.
 *
 * Thresholds are the report-reconciliation skill's: a difference above one cent (one
 * hundredth of a point for a rate) or one institution is a finding, except whole-scope
 * totals, which may drift by the larger of 5 or 0.5% (TOTAL_DRIFT_*). The Pulse's
 * "institutions added this month" is a 30-day window count, not a total, so it keeps the
 * one-institution rule. A figure printed where the live data has none, or none printed where
 * it has one, is also a finding. Any finding blocks
 * the report. Figures that come from other sources (Call Reports, FRED, the Beige Book,
 * agency releases) or are computed from the checked figures are listed as not checked, with
 * the reason, so the record never reads as more than it is.
 *
 * Deterministic: no model or provider calls. The pure parts (printedFiguresFor,
 * reconcileFigures) take their inputs; loadLiveFigures does the reads.
 */
import type { sql as sqlTag } from "@/lib/data-store/connection";
import {
  STATS_METHOD_VERSION,
  statsRowFilter,
  summarizeFees,
  summarizeRates,
  type FeeStatistics,
} from "@/lib/data-store/fee-stats";
import { matchesPeerFilters, type PeerFilterSet } from "@/lib/data-store/fee-index";
import type { NationalQuarterlyPayload, GroupRow } from "@/lib/report-assemblers/national-quarterly";
import { MIN_GROUP_INSTITUTIONS } from "@/lib/report-assemblers/national-quarterly";
import type { MonthlyPulsePayload, PulseChange, PulseCoverage } from "@/lib/report-assemblers/monthly-pulse";
import { PULSE_COVERAGE_SQL } from "@/lib/report-assemblers/monthly-pulse";
import type { StateReportData } from "@/lib/research-report/state-report-data";

type SqlTag = typeof sqlTag;

/** Bump when what is checked, or how, changes; each recorded result carries it. */
export const RECONCILE_VERSION = 1;
export const AMOUNT_TOLERANCE = 0.01;
export const RATE_TOLERANCE = 0.01;
export const COUNT_TOLERANCE = 1;
/**
 * Whole-scope totals (all fees and institutions in the catalog, or in a state's catalog,
 * across every category) may drift by the larger of TOTAL_DRIFT_MIN and TOTAL_DRIFT_SHARE
 * of the printed value. Added for #1066, not part of the skill's original thresholds: the
 * render takes minutes (paid model calls) and Hamilton publishes and takes fees down in that
 * gap, so an exact total that was right when the report was assembled reads as off. Prices,
 * medians, per-category counts and the Pulse's 30-day "institutions added" count keep the
 * one-cent and one-institution rules.
 */
export const TOTAL_DRIFT_MIN = 5;
export const TOTAL_DRIFT_SHARE = 0.005;

export function totalDriftAllowed(printed: number): number {
  return Math.max(TOTAL_DRIFT_MIN, Math.abs(printed) * TOTAL_DRIFT_SHARE);
}
/** Findings kept on the job record; the count is always the full number. */
export const MAX_RECORDED_FINDINGS = 200;

export type Charter = "bank" | "credit_union";

export interface FigureScope {
  state?: string;
  charter?: Charter;
  district?: number;
  assetTier?: string;
}

export type FeeStatistic = "median" | "p25" | "p75" | "institutions" | "bank_institutions" | "cu_institutions";
export type RateStatistic = "median" | "p25" | "p75" | "institutions";
export type CoverageStatistic = "institutions" | "banks" | "credit_unions" | "fee_rows";
export type PulseCoverageStatistic = keyof PulseCoverage;

export type PrintedFigure =
  | {
      kind: "fee_stat";
      id: string;
      label: string;
      category: string;
      scope: FigureScope;
      statistic: FeeStatistic;
      printed: number | null;
      /** The report shows a median only with at least this many institutions (else blank). */
      minInstitutions?: number;
    }
  | { kind: "rate_stat"; id: string; label: string; category: string; statistic: RateStatistic; printed: number | null }
  | { kind: "coverage"; id: string; label: string; scope: FigureScope; statistic: CoverageStatistic; printed: number }
  | { kind: "pulse_coverage"; id: string; label: string; statistic: PulseCoverageStatistic; printed: number }
  | { kind: "live_fee"; id: string; label: string; institutionId: number | null; category: string; amount: number };

export interface UncheckedSection {
  section: string;
  reason: string;
}

export interface PrintedFigures {
  report_type: string;
  figures: PrintedFigure[];
  unchecked: UncheckedSection[];
  /** Window start (ISO timestamp) of a Monthly Pulse's coverage counts. */
  pulse_window_start?: string | null;
}

export type FindingReason = "differs" | "printed_without_live_value" | "live_value_not_printed" | "not_live" | "cannot_check";

export interface ReconciliationFinding {
  id: string;
  label: string;
  printed: number | null;
  live: number | null;
  reason: FindingReason;
}

/** A whole-scope total that moved between assembly and reconciliation, within its allowance. */
export interface ReconciliationDrift {
  id: string;
  label: string;
  printed: number;
  live: number;
  allowed: number;
}

export interface ReconciliationResult {
  version: number;
  stats_method_version: number;
  checked_at: string;
  ties_out: boolean;
  figures_checked: number;
  figures_tied: number;
  finding_count: number;
  /** At most MAX_RECORDED_FINDINGS; finding_count is the full number. */
  findings: ReconciliationFinding[];
  /** Every whole-scope total whose live value differed but stayed within its allowance. */
  drift: ReconciliationDrift[];
  unchecked: UncheckedSection[];
}

/** What report_jobs.data_manifest holds for a job rendered from #1066 on. */
export interface ReportJobManifest extends Record<string, unknown> {
  printed?: PrintedFigures | null;
  reconciliation?: ReconciliationResult | null;
}

export function parseReportManifest(value: unknown): ReportJobManifest | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseReportManifest(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as ReportJobManifest) : null;
}

/** True only for a job whose saved reconciliation tied out: the Publish gate. */
export function reconciliationTiesOut(manifest: unknown): boolean {
  return parseReportManifest(manifest)?.reconciliation?.ties_out === true;
}

// ─── Printed figures ───────────────────────────────────────────────────────────

const STAT_LABEL: Record<FeeStatistic, string> = {
  median: "median",
  p25: "25th percentile",
  p75: "75th percentile",
  institutions: "institutions",
  bank_institutions: "banks",
  cu_institutions: "credit unions",
};

function scopeKey(scope: FigureScope): string {
  return [
    scope.state ? `state:${scope.state}` : "",
    scope.district != null ? `district:${scope.district}` : "",
    scope.assetTier ? `size:${scope.assetTier}` : "",
    scope.charter ? `charter:${scope.charter}` : "",
  ]
    .filter(Boolean)
    .join("/") || "national";
}

function scopeLabel(scope: FigureScope): string {
  const parts = [
    scope.state ?? "",
    scope.district != null ? `District ${scope.district}` : "",
    scope.assetTier ? `size ${scope.assetTier}` : "",
    scope.charter === "bank" ? "banks" : scope.charter === "credit_union" ? "credit unions" : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "National";
}

function feeStat(
  category: string,
  scope: FigureScope,
  statistic: FeeStatistic,
  printed: number | null | undefined,
  minInstitutions?: number,
): PrintedFigure {
  return {
    kind: "fee_stat",
    id: `${scopeKey(scope)}.${category}.${statistic}`,
    label: `${scopeLabel(scope)} ${category} ${STAT_LABEL[statistic]}`,
    category,
    scope,
    statistic,
    printed: printed ?? null,
    ...(minInstitutions ? { minInstitutions } : {}),
  };
}

function changeFigures(changes: PulseChange[], prefix: string): PrintedFigure[] {
  return changes.map((change, index) => ({
    kind: "live_fee" as const,
    id: `${prefix}.${index}.${change.institution_id ?? "unknown"}.${change.fee_category}`,
    label: `${change.institution_name} ${change.fee_category} now $${change.new_amount.toFixed(2)}`,
    institutionId: change.institution_id ?? null,
    category: change.fee_category,
    amount: change.new_amount,
  }));
}

function groupFigures(rows: GroupRow[], scopeOf: (key: string) => FigureScope): PrintedFigure[] {
  return rows.flatMap((row) =>
    Object.entries(row.fees).flatMap(([category, fee]) => [
      feeStat(category, scopeOf(row.key), "median", fee.median, MIN_GROUP_INSTITUTIONS),
      feeStat(category, scopeOf(row.key), "institutions", fee.institutions),
    ]),
  );
}

export function nationalPrintedFigures(payload: NationalQuarterlyPayload): PrintedFigures {
  const figures: PrintedFigure[] = [];
  for (const c of payload.categories) {
    const cat = c.fee_category;
    figures.push(
      feeStat(cat, {}, "median", c.median_amount),
      feeStat(cat, {}, "p25", c.p25_amount),
      feeStat(cat, {}, "p75", c.p75_amount),
      feeStat(cat, {}, "institutions", c.institution_count),
      feeStat(cat, { charter: "bank" }, "median", c.bank_median),
      feeStat(cat, { charter: "bank" }, "institutions", c.bank_count),
      feeStat(cat, { charter: "credit_union" }, "median", c.cu_median),
      feeStat(cat, { charter: "credit_union" }, "institutions", c.cu_count),
    );
  }
  for (const r of payload.rate_categories ?? []) {
    const rate = (statistic: RateStatistic, printed: number | null): PrintedFigure => ({
      kind: "rate_stat",
      id: `rate.${r.fee_category}.${statistic}`,
      label: `National ${r.fee_category} rate ${statistic}`,
      category: r.fee_category,
      statistic,
      printed,
    });
    figures.push(rate("median", r.median_rate), rate("p25", r.p25_rate), rate("p75", r.p75_rate), rate("institutions", r.institution_count));
  }
  figures.push(
    ...groupFigures(payload.regional.districts, (key) => ({ district: Number(key) })),
    ...groupFigures(payload.regional.sizes, (key) => ({ assetTier: key })),
    ...groupFigures(payload.regional.states, (key) => ({ state: key })),
  );
  if (payload.fee_changes) figures.push(...changeFigures(payload.fee_changes.changes, "fee_change"));

  const unchecked: UncheckedSection[] = [
    { section: "Derived analytics (spreads, bank vs credit union counts, premiums, maturity counts)", reason: "Computed from the category figures checked here." },
    { section: "Institutions covered (headline count)", reason: "Read from the public stats snapshot, not recomputed here." },
    { section: "Overdraft price bands", reason: "Not recomputed yet." },
    { section: "Service-charge income", reason: "From FDIC Call Reports and NCUA 5300 filings, not the fee catalog." },
    { section: "Economic indicators and Beige Book", reason: "From FRED and the Federal Reserve, not the fee catalog." },
    { section: "Agency releases", reason: "From reg_articles, not the fee catalog." },
    { section: "Written sections", reason: "Model-written; their numbers are checked against the data block by validateNumerics." },
  ];
  return { report_type: "national_index", figures, unchecked };
}

export function statePrintedFigures(data: StateReportData): PrintedFigures {
  const state = data.stateCode;
  const figures: PrintedFigure[] = [];
  for (const c of data.comparisons) {
    const cat = c.fee_category;
    figures.push(
      feeStat(cat, { state }, "median", c.median_amount),
      feeStat(cat, { state }, "p25", c.p25_amount),
      feeStat(cat, { state }, "p75", c.p75_amount),
      feeStat(cat, { state }, "institutions", c.institution_count),
      feeStat(cat, { state }, "bank_institutions", c.bank_count),
      feeStat(cat, { state }, "cu_institutions", c.cu_count),
    );
    // A blank national figure is not checked: the snapshot leaves out non-canonical categories.
    if (c.national_median !== null) figures.push(feeStat(cat, {}, "median", c.national_median));
    if (c.national_p25 !== null) figures.push(feeStat(cat, {}, "p25", c.national_p25));
    if (c.national_p75 !== null) figures.push(feeStat(cat, {}, "p75", c.national_p75));
  }
  for (const pair of data.charterPairs) {
    figures.push(
      feeStat(pair.fee_category, { state, charter: "bank" }, "median", pair.bank_median_amount),
      feeStat(pair.fee_category, { state, charter: "credit_union" }, "median", pair.cu_median_amount),
    );
  }
  const coverage = (statistic: CoverageStatistic, printed: number, label: string): PrintedFigure => ({
    kind: "coverage",
    id: `state:${state}.coverage.${statistic}`,
    label: `${state} ${label} with live fees`,
    scope: { state },
    statistic,
    printed,
  });
  figures.push(
    coverage("institutions", data.verified.institutions, "institutions"),
    coverage("banks", data.verified.banks, "banks"),
    coverage("credit_unions", data.verified.credit_unions, "credit unions"),
    coverage("fee_rows", data.verified.fees, "fee rows"),
  );
  const unchecked: UncheckedSection[] = [
    { section: "Findings and differences from national", reason: "Computed from the figures checked here." },
    { section: "Institutions monitored", reason: "Counted from institution_sources, not the fee catalog." },
    { section: "Charts, economy and regulatory context", reason: "Read separately for the charts and context blocks; not recomputed yet." },
  ];
  return { report_type: "state_index", figures, unchecked };
}

export function pulsePrintedFigures(payload: MonthlyPulsePayload): PrintedFigures {
  const figures = changeFigures(payload.changes, "pulse_change");
  const coverage = (statistic: PulseCoverageStatistic, label: string): PrintedFigure => ({
    kind: "pulse_coverage",
    id: `pulse.coverage.${statistic}`,
    label,
    statistic,
    printed: payload.coverage[statistic],
  });
  figures.push(
    coverage("institutions_live", "Institutions with live fees"),
    coverage("institutions_added_in_window", "Institutions added this month"),
    coverage("live_fees", "Live fees"),
  );
  return {
    report_type: "monthly_pulse",
    figures,
    unchecked: [
      { section: "Recorded changes not confirmed", reason: "A count of changes left out; not a printed fee." },
      { section: "Written overview", reason: "Model-written; its numbers are checked against the data block by validateNumerics." },
    ],
    pulse_window_start: payload.window_started_at ?? null,
  };
}

// ─── Live data ─────────────────────────────────────────────────────────────────

export interface LiveFeeRow {
  institution_id: number | string;
  fee_category: string;
  amount: number | string | null;
  charter_type: string | null;
  state_code: string | null;
  fed_district: number | null;
  asset_size_tier: string | null;
}

export interface LiveRateRow {
  fee_category: string;
  institution_id: number | string;
  rate_percent: number | string | null;
  amount_kind: string | null;
}

export interface LiveData {
  /** Approved, sourced rows under the statistics contract (statsRowFilter). */
  feeRows: LiveFeeRow[];
  rateRows: LiveRateRow[];
  /** Every approved live fee at the institutions a printed change names. */
  changeRows: Array<{ institution_id: number | string; fee_category: string; amount: number | string | null }>;
  pulseCoverage: PulseCoverage | null;
}

function scopeFilters(scope: FigureScope): PeerFilterSet {
  return {
    ...(scope.charter ? { charter_type: scope.charter } : {}),
    ...(scope.state ? { state_code: scope.state } : {}),
    ...(scope.district != null ? { fed_districts: [scope.district] } : {}),
    ...(scope.assetTier ? { asset_tiers: [scope.assetTier] } : {}),
  };
}

function inScope(row: LiveFeeRow, scope: FigureScope): boolean {
  return matchesPeerFilters({ ...row, charter_type: row.charter_type ?? "" }, scopeFilters(scope));
}

/** One read per kind of figure the report prints; never a write. */
export async function loadLiveFigures(db: SqlTag, printed: PrintedFigures): Promise<LiveData> {
  const categories = new Set<string>();
  const coverageStates = new Set<string>();
  const rateCategories = new Set<string>();
  const changeInstitutions = new Set<number>();
  let pulse = false;
  for (const f of printed.figures) {
    if (f.kind === "fee_stat") categories.add(f.category);
    else if (f.kind === "coverage" && f.scope.state) coverageStates.add(f.scope.state);
    else if (f.kind === "rate_stat") rateCategories.add(f.category);
    else if (f.kind === "live_fee" && f.institutionId !== null) changeInstitutions.add(f.institutionId);
    else if (f.kind === "pulse_coverage") pulse = true;
  }

  const feeRows =
    categories.size || coverageStates.size
      ? ((await db.unsafe(
          `SELECT ef.institution_id, ef.fee_category, ef.amount,
                  ct.charter_type, ct.state_code, ct.fed_district, ct.asset_size_tier
             FROM published_fee_catalog ef
             JOIN institution_sources ct ON ef.institution_id = ct.id
            WHERE ef.fee_category IS NOT NULL
              AND ef.review_status = 'approved'
              AND ${statsRowFilter("ef")}
              AND (ef.fee_category = ANY($1::text[]) OR ct.state_code = ANY($2::text[]))`,
          [[...categories], [...coverageStates]] as never[],
        )) as unknown as LiveFeeRow[])
      : [];
  const rateRows = rateCategories.size
    ? ((await db.unsafe(
        `SELECT ef.fee_category, ef.institution_id, ef.rate_percent, ef.amount_kind
           FROM published_fee_rate_catalog ef
          WHERE ef.fee_category = ANY($1::text[])
            AND ${statsRowFilter("ef")}`,
        [[...rateCategories]] as never[],
      )) as unknown as LiveRateRow[])
    : [];
  const changeRows = changeInstitutions.size
    ? ((await db.unsafe(
        `SELECT ef.institution_id, ef.fee_category, ef.amount
           FROM published_fee_catalog ef
          WHERE ef.review_status = 'approved'
            AND ef.institution_id = ANY($1::int[])`,
        [[...changeInstitutions]] as never[],
      )) as unknown as LiveData["changeRows"])
    : [];
  let pulseCoverage: PulseCoverage | null = null;
  if (pulse && printed.pulse_window_start) {
    const rows = (await db.unsafe(PULSE_COVERAGE_SQL, [printed.pulse_window_start] as never[])) as unknown as PulseCoverage[];
    pulseCoverage = {
      institutions_live: Number(rows[0]?.institutions_live ?? 0),
      institutions_added_in_window: Number(rows[0]?.institutions_added_in_window ?? 0),
      live_fees: Number(rows[0]?.live_fees ?? 0),
    };
  }
  return { feeRows, rateRows, changeRows, pulseCoverage };
}

// ─── Reconcile ─────────────────────────────────────────────────────────────────

function compare(
  figure: { id: string; label: string },
  printed: number | null,
  live: number | null,
  tolerance: number,
): ReconciliationFinding | null {
  if (printed === null && live === null) return null;
  if (printed === null) return { id: figure.id, label: figure.label, printed, live, reason: "live_value_not_printed" };
  if (live === null) return { id: figure.id, label: figure.label, printed, live, reason: "printed_without_live_value" };
  // A small epsilon so a difference of exactly one cent or one institution is not a finding.
  return Math.abs(printed - live) > tolerance + 1e-9 ? { id: figure.id, label: figure.label, printed, live, reason: "differs" } : null;
}

function feeValue(stats: FeeStatistics, statistic: FeeStatistic, minInstitutions?: number): number | null {
  switch (statistic) {
    case "median":
      return minInstitutions && stats.institution_count < minInstitutions ? null : stats.median_amount;
    case "p25":
      return stats.p25_amount;
    case "p75":
      return stats.p75_amount;
    case "institutions":
      return stats.institution_count;
    case "bank_institutions":
      return stats.bank_count;
    case "cu_institutions":
      return stats.cu_count;
  }
}

function coverageValue(rows: LiveFeeRow[], statistic: CoverageStatistic): number {
  const distinct = (list: LiveFeeRow[]) => new Set(list.map((row) => Number(row.institution_id))).size;
  switch (statistic) {
    case "institutions":
      return distinct(rows);
    case "banks":
      return distinct(rows.filter((row) => row.charter_type === "bank"));
    case "credit_unions":
      return distinct(rows.filter((row) => row.charter_type === "credit_union"));
    case "fee_rows":
      return rows.length;
  }
}

/** Compare each printed figure with its live value. Pure. */
export function reconcileFigures(printed: PrintedFigures, live: LiveData, now: Date = new Date()): ReconciliationResult {
  // Rows bucketed by category once, so each (scope, category) filters only its category (#1249).
  const rowsByCategory = new Map<string, LiveFeeRow[]>();
  for (const row of live.feeRows) {
    const bucket = rowsByCategory.get(row.fee_category);
    if (bucket) bucket.push(row);
    else rowsByCategory.set(row.fee_category, [row]);
  }
  const feeStats = new Map<string, FeeStatistics>();
  const statsFor = (category: string, scope: FigureScope): FeeStatistics => {
    const key = `${scopeKey(scope)}|${category}`;
    let stats = feeStats.get(key);
    if (!stats) {
      stats = summarizeFees((rowsByCategory.get(category) ?? []).filter((row) => inScope(row, scope)));
      feeStats.set(key, stats);
    }
    return stats;
  };
  const rateStats = new Map<string, ReturnType<typeof summarizeRates>>();
  const ratesFor = (category: string) => {
    let stats = rateStats.get(category);
    if (!stats) {
      stats = summarizeRates(live.rateRows.filter((row) => row.fee_category === category));
      rateStats.set(category, stats);
    }
    return stats;
  };
  const liveFees = new Set(
    live.changeRows
      .filter((row) => row.amount !== null && Number.isFinite(Number(row.amount)))
      .map((row) => `${Number(row.institution_id)}|${row.fee_category}|${Math.round(Number(row.amount) * 100)}`),
  );

  const findings: ReconciliationFinding[] = [];
  const drift: ReconciliationDrift[] = [];
  const compareTotal = (figure: { id: string; label: string; printed: number }, live: number): ReconciliationFinding | null => {
    const allowed = totalDriftAllowed(figure.printed);
    const finding = compare(figure, figure.printed, live, allowed);
    if (!finding && live !== figure.printed) drift.push({ id: figure.id, label: figure.label, printed: figure.printed, live, allowed });
    return finding;
  };
  for (const f of printed.figures) {
    let finding: ReconciliationFinding | null = null;
    switch (f.kind) {
      case "fee_stat": {
        const tolerance = f.statistic === "median" || f.statistic === "p25" || f.statistic === "p75" ? AMOUNT_TOLERANCE : COUNT_TOLERANCE;
        finding = compare(f, f.printed, feeValue(statsFor(f.category, f.scope), f.statistic, f.minInstitutions), tolerance);
        break;
      }
      case "rate_stat": {
        const stats = ratesFor(f.category);
        const value =
          f.statistic === "institutions" ? stats.institution_count : f.statistic === "median" ? stats.median_rate : f.statistic === "p25" ? stats.p25_rate : stats.p75_rate;
        finding = compare(f, f.printed, value, f.statistic === "institutions" ? COUNT_TOLERANCE : RATE_TOLERANCE);
        break;
      }
      case "coverage": {
        const rows = live.feeRows.filter((row) => inScope(row, f.scope));
        finding = compareTotal(f, coverageValue(rows, f.statistic));
        break;
      }
      case "pulse_coverage":
        if (!live.pulseCoverage) {
          finding = { id: f.id, label: f.label, printed: f.printed, live: null, reason: "cannot_check" };
        } else if (f.statistic === "institutions_added_in_window") {
          // A 30-day window count, not a whole-scope total (#1249): the one-institution rule.
          finding = compare(f, f.printed, live.pulseCoverage[f.statistic], COUNT_TOLERANCE);
        } else {
          finding = compareTotal(f, live.pulseCoverage[f.statistic]);
        }
        break;
      case "live_fee":
        if (f.institutionId === null) {
          finding = { id: f.id, label: f.label, printed: f.amount, live: null, reason: "cannot_check" };
        } else if (!liveFees.has(`${f.institutionId}|${f.category}|${Math.round(f.amount * 100)}`)) {
          finding = { id: f.id, label: f.label, printed: f.amount, live: null, reason: "not_live" };
        }
        break;
    }
    if (finding) findings.push(finding);
  }

  return {
    version: RECONCILE_VERSION,
    stats_method_version: STATS_METHOD_VERSION,
    checked_at: now.toISOString(),
    ties_out: findings.length === 0,
    figures_checked: printed.figures.length,
    figures_tied: printed.figures.length - findings.length,
    finding_count: findings.length,
    findings: findings.slice(0, MAX_RECORDED_FINDINGS),
    drift,
    unchecked: printed.unchecked,
  };
}

const REASON_TEXT: Record<FindingReason, string> = {
  differs: "differs from live",
  printed_without_live_value: "printed, but live has no value",
  live_value_not_printed: "live has a value the report leaves blank",
  not_live: "no longer a live fee",
  cannot_check: "cannot be checked",
};

function show(value: number | null): string {
  return value === null ? "blank" : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** One line for the job error and the step summary, naming the first few figures that failed. */
export function describeReconciliation(result: ReconciliationResult, shown = 3): string {
  if (result.ties_out) {
    return `Reconciled: all ${result.figures_checked.toLocaleString("en-US")} printed fee figures tie out to live data.`;
  }
  const first = result.findings
    .slice(0, shown)
    .map((f) => `${f.label}: printed ${show(f.printed)}, live ${show(f.live)} (${REASON_TEXT[f.reason]})`)
    .join("; ");
  const more = result.finding_count > shown ? `; and ${(result.finding_count - shown).toLocaleString("en-US")} more` : "";
  return `Reconciliation blocked the report: ${result.finding_count.toLocaleString("en-US")} of ${result.figures_checked.toLocaleString("en-US")} printed fee figures do not tie out. ${first}${more}.`;
}
