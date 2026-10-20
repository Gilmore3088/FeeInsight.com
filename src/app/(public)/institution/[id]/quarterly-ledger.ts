import type { InstitutionFinancialHistoryRow } from "@/lib/data-store/financial";
import type { CallItemHistoryRow } from "@/lib/data-store/institution-quarterly";
import { formatReportQuarter } from "./financial-units";

/**
 * One row per quarter for the overview and financial performance sections, oldest first, in whole
 * dollars and percent, each value tagged with the filing it came from.
 *
 * Call reports state income year to date: a quarter's own figure is its year-to-date value less
 * the prior quarter's in the same year, and Q1 stands as filed (toStandaloneQuarters). Balances
 * (assets, deposits) are point-in-time and are never differenced.
 *
 * Where each value comes from, per quarter:
 * - A bank's FFIEC call report lines (institution_call_report_items) first: RIAD4080, RIAD4074,
 *   RIAD4079 year to date, made standalone here; RCFD/RCON2170 and RCON2200 at quarter end.
 * - Otherwise its FDIC BankFind row (institution_financial_records, source fdic), whose income
 *   fields are already one quarter (ISERCHGQ, NIMQ, NONIIQ, NETINCQ). Net income and ROA always
 *   come from here, as the FFIEC lines read for the page carry neither.
 * - A credit union's NCUA 5300 row (source ncua), year to date, made standalone here.
 * Rows written before the registry's corrected income mapping carry no net income; their income
 * lines are left empty rather than drawn wrong (the same rule as financial-history.ts).
 */

export type LedgerSource = "ffiec" | "fdic" | "ncua";

export const LEDGER_METRICS = [
  "assets",
  "deposits",
  "revenue",
  "serviceCharges",
  "netIncome",
  "roaPct",
  "sharePct",
] as const;
export type LedgerMetric = (typeof LEDGER_METRICS)[number];

export interface LedgerValue {
  value: number;
  source: LedgerSource;
}

export interface LedgerQuarter {
  reportDate: string;
  quarter: string;
  values: Partial<Record<LedgerMetric, LedgerValue>>;
}

export interface Ledger {
  quarters: LedgerQuarter[];
  /** "bank" when every row is an FDIC or FFIEC filing, "credit_union" for NCUA. */
  filer: "bank" | "credit_union" | null;
  /** Field codes as stored on the FFIEC lines read (item_code), by metric. */
  ffiecCodes: Partial<Record<LedgerMetric, string[]>>;
  /** Newest retrieval time among the rows the latest quarter draws on. */
  retrievedAt: string | null;
}

const THOUSANDS = 1_000;

/** Quarter number 1-4 of a quarter-end date (YYYY-03-31 is 1). */
export function quarterOf(reportDate: string): number {
  return Math.ceil(Number(reportDate.slice(5, 7)) / 3);
}

/** The quarter-end date one quarter earlier. */
export function previousQuarterEnd(reportDate: string): string {
  const year = Number(reportDate.slice(0, 4));
  const q = quarterOf(reportDate);
  if (q === 1) return `${year - 1}-12-31`;
  const month = (q - 1) * 3;
  const day = month === 6 ? 30 : month === 9 ? 30 : 31;
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}

/**
 * Year-to-date values to standalone quarters. Q1 is its own quarter; Qn is YTD(n) less
 * YTD(n-1) of the same year, and is null when that prior quarter is missing, so a year's total is
 * never shown as one quarter.
 */
export function toStandaloneQuarters(ytd: Map<string, number>): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const [date, value] of ytd) {
    if (quarterOf(date) === 1) {
      out.set(date, value);
      continue;
    }
    const prior = ytd.get(previousQuarterEnd(date));
    out.set(date, prior === undefined ? null : value - prior);
  }
  return out;
}

function finite(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

const FFIEC_METRIC_BY_KEY: Record<string, LedgerMetric | "nii" | "nonii"> = {
  service_charges_deposits_ytd: "serviceCharges",
  net_interest_income_ytd: "nii",
  noninterest_income_total_ytd: "nonii",
  total_assets: "assets",
  total_deposits: "deposits",
};

interface RecordValues {
  source: "fdic" | "ncua";
  assets: number | null;
  deposits: number | null;
  revenue: number | null;
  serviceCharges: number | null;
  netIncome: number | null;
  roaPct: number | null;
  fetchedAt: string | null;
}

/** One record per quarter (fdic before ncua), flows made standalone where the filing is YTD. */
function recordQuarters(rows: InstitutionFinancialHistoryRow[]): Map<string, RecordValues> {
  const byDate = new Map<string, InstitutionFinancialHistoryRow>();
  for (const row of rows) {
    const source = row.source.toLowerCase();
    if (source !== "fdic" && source !== "ncua") continue;
    const current = byDate.get(row.report_date);
    if (!current || (current.source.toLowerCase() === "ncua" && source === "fdic")) byDate.set(row.report_date, row);
  }
  const ncuaYtd = { revenue: new Map<string, number>(), serviceCharges: new Map<string, number>(), netIncome: new Map<string, number>() };
  for (const [date, row] of byDate) {
    if (row.source.toLowerCase() !== "ncua" || row.net_income === null) continue;
    if (finite(row.total_revenue)) ncuaYtd.revenue.set(date, row.total_revenue);
    if (finite(row.service_charge_income)) ncuaYtd.serviceCharges.set(date, row.service_charge_income);
    if (finite(row.net_income)) ncuaYtd.netIncome.set(date, row.net_income);
  }
  const ncua = {
    revenue: toStandaloneQuarters(ncuaYtd.revenue),
    serviceCharges: toStandaloneQuarters(ncuaYtd.serviceCharges),
    netIncome: toStandaloneQuarters(ncuaYtd.netIncome),
  };
  const out = new Map<string, RecordValues>();
  for (const [date, row] of byDate) {
    const source = row.source.toLowerCase() as "fdic" | "ncua";
    const registryIncome = row.net_income !== null;
    const dollars = (v: number | null | undefined) => (finite(v) ? v * THOUSANDS : null);
    const flow = (key: "revenue" | "serviceCharges" | "netIncome", quarterly: number | null) => {
      if (!registryIncome) return null;
      return source === "fdic" ? dollars(quarterly) : dollars(ncua[key].get(date) ?? null);
    };
    out.set(date, {
      source,
      assets: dollars(row.total_assets),
      deposits: dollars(row.total_deposits),
      revenue: flow("revenue", row.total_revenue),
      serviceCharges: flow("serviceCharges", row.service_charge_income),
      netIncome: flow("netIncome", row.net_income),
      // Zero is a placeholder in NCUA rows, not a 0% return.
      roaPct: finite(row.roa) && row.roa !== 0 ? row.roa : null,
      fetchedAt: row.fetched_at ?? null,
    });
  }
  return out;
}

interface FfiecValues {
  assets: number | null;
  deposits: number | null;
  serviceCharges: number | null;
  revenue: number | null;
  fetchedAt: string | null;
}

function ffiecQuarters(items: CallItemHistoryRow[]): { byDate: Map<string, FfiecValues>; codes: Partial<Record<LedgerMetric, string[]>> } {
  const ytd = { serviceCharges: new Map<string, number>(), nii: new Map<string, number>(), nonii: new Map<string, number>() };
  const stock = { assets: new Map<string, number>(), deposits: new Map<string, number>() };
  const fetched = new Map<string, string>();
  const codeSets: Partial<Record<LedgerMetric, Set<string>>> = {};
  const addCode = (metric: LedgerMetric, code: string) => (codeSets[metric] ??= new Set()).add(code);
  for (const item of items) {
    const metric = FFIEC_METRIC_BY_KEY[item.item_key];
    if (!metric || !finite(item.value)) continue;
    if (item.fetched_at && (fetched.get(item.report_date) ?? "") < item.fetched_at) fetched.set(item.report_date, item.fetched_at);
    if (metric === "assets" || metric === "deposits") {
      if (item.period_basis !== "point_in_time") continue;
      stock[metric].set(item.report_date, item.value);
      addCode(metric, item.item_code);
    } else if (metric === "serviceCharges" || metric === "nii" || metric === "nonii") {
      if (item.period_basis !== "ytd") continue;
      ytd[metric].set(item.report_date, item.value);
      if (metric === "serviceCharges") addCode("serviceCharges", item.item_code);
      else addCode("revenue", item.item_code);
    }
  }
  const sc = toStandaloneQuarters(ytd.serviceCharges);
  const nii = toStandaloneQuarters(ytd.nii);
  const nonii = toStandaloneQuarters(ytd.nonii);
  const dates = new Set([...stock.assets.keys(), ...stock.deposits.keys(), ...sc.keys(), ...nii.keys(), ...nonii.keys()]);
  const byDate = new Map<string, FfiecValues>();
  const dollars = (v: number | null | undefined) => (finite(v) ? v * THOUSANDS : null);
  for (const date of dates) {
    const a = nii.get(date);
    const b = nonii.get(date);
    byDate.set(date, {
      assets: dollars(stock.assets.get(date)),
      deposits: dollars(stock.deposits.get(date)),
      serviceCharges: dollars(sc.get(date)),
      revenue: finite(a) && finite(b) ? (a + b) * THOUSANDS : null,
      fetchedAt: fetched.get(date) ?? null,
    });
  }
  const codes = Object.fromEntries(Object.entries(codeSets).map(([k, set]) => [k, [...(set as Set<string>)].sort()]));
  return { byDate, codes };
}

export function buildLedger(records: InstitutionFinancialHistoryRow[], items: CallItemHistoryRow[]): Ledger {
  const fromRecords = recordQuarters(records);
  const ffiec = ffiecQuarters(items);
  const dates = [...new Set([...fromRecords.keys(), ...ffiec.byDate.keys()])].sort();
  const sources = new Set<string>();
  const quarters: LedgerQuarter[] = [];
  let retrievedAt: string | null = null;
  for (const date of dates) {
    const rec = fromRecords.get(date);
    const f = ffiec.byDate.get(date);
    const values: Partial<Record<LedgerMetric, LedgerValue>> = {};
    const pick = (metric: "assets" | "deposits" | "revenue" | "serviceCharges") => {
      const fv = f?.[metric];
      if (finite(fv)) values[metric] = { value: fv, source: "ffiec" };
      else if (rec && finite(rec[metric])) values[metric] = { value: rec[metric] as number, source: rec.source };
    };
    pick("assets");
    pick("deposits");
    pick("revenue");
    pick("serviceCharges");
    if (rec && finite(rec.netIncome)) values.netIncome = { value: rec.netIncome, source: rec.source };
    if (rec && finite(rec.roaPct)) values.roaPct = { value: rec.roaPct, source: rec.source };
    const sc = values.serviceCharges;
    const rev = values.revenue;
    // The share takes both figures from one filing, so a quarter never divides across sources.
    if (sc && rev && sc.source === rev.source && rev.value > 0) {
      values.sharePct = { value: (sc.value / rev.value) * 100, source: sc.source };
    }
    if (Object.keys(values).length === 0) continue;
    for (const v of Object.values(values)) if (v) sources.add(v.source);
    quarters.push({ reportDate: date, quarter: formatReportQuarter(date) ?? date, values });
  }
  const latest = quarters[quarters.length - 1];
  if (latest) {
    const stamps = [fromRecords.get(latest.reportDate)?.fetchedAt, ffiec.byDate.get(latest.reportDate)?.fetchedAt].filter(
      (s): s is string => Boolean(s),
    );
    retrievedAt = stamps.sort().pop() ?? null;
  }
  const filer = sources.size === 0 ? null : sources.has("ncua") && !sources.has("fdic") && !sources.has("ffiec") ? "credit_union" : "bank";
  return { quarters, filer, ffiecCodes: ffiec.codes, retrievedAt };
}

/** The latest quarter carrying a metric, and its value. */
export function latestOf(ledger: Ledger, metric: LedgerMetric): { quarter: LedgerQuarter; value: LedgerValue } | null {
  for (let i = ledger.quarters.length - 1; i >= 0; i--) {
    const v = ledger.quarters[i].values[metric];
    if (v) return { quarter: ledger.quarters[i], value: v };
  }
  return null;
}

/** The metric's value at a quarter end, when present. */
export function valueAt(ledger: Ledger, metric: LedgerMetric, reportDate: string): number | null {
  return ledger.quarters.find((q) => q.reportDate === reportDate)?.values[metric]?.value ?? null;
}

/** The same quarter a year earlier. */
export function yearEarlier(reportDate: string): string {
  return `${Number(reportDate.slice(0, 4)) - 1}${reportDate.slice(4)}`;
}

export interface Change {
  dollars: number;
  /** Null when the earlier figure is zero or of the other sign. */
  pct: number | null;
}

export function change(now: number | null, then: number | null): Change | null {
  if (!finite(now) || !finite(then)) return null;
  const pct = then > 0 && now >= 0 ? (now / then - 1) * 100 : null;
  return { dollars: now - then, pct };
}

// --- Ranges -----------------------------------------------------------------------------------

/** The financial performance chart's quarter switch. */
export const RANGES = [
  { key: "4", label: "4Q", quarters: 4 },
  { key: "8", label: "8Q", quarters: 8 },
  { key: "10", label: "10Q", quarters: 10 },
  { key: "all", label: "All", quarters: Number.POSITIVE_INFINITY },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

/** The quarters a range shows: the newest N that carry the metric, oldest first. */
export function rangeQuarters(quarters: LedgerQuarter[], metric: LedgerMetric, range: RangeKey): LedgerQuarter[] {
  const withValue = quarters.filter((q) => q.values[metric]);
  if (withValue.length === 0) return [];
  const n = RANGES.find((r) => r.key === range)?.quarters ?? 8;
  const from = Number.isFinite(n) ? withValue[Math.max(0, withValue.length - n)].reportDate : withValue[0].reportDate;
  return quarters.filter((q) => q.reportDate >= from);
}

/**
 * The connected panel's bars: the newest `count` quarters carrying service-charge income, oldest
 * first, as standalone quarters with the filing each came from. The panel draws the same figures
 * as the overview and financial performance, never a second calculation.
 */
export function connectedPanelSeries(
  ledger: Ledger,
  count: number,
): { reportDate: string; value: number; source: LedgerSource }[] {
  return ledger.quarters
    .filter((q) => q.values.serviceCharges)
    .slice(-count)
    .map((q) => ({ reportDate: q.reportDate, value: q.values.serviceCharges!.value, source: q.values.serviceCharges!.source }));
}
