import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

/**
 * Filings reconciliation (#1925, Hamilton V5 T3), `FILINGS_RECONCILE_VERSION` v1. Read-only.
 *
 * Every figure the institution page and Hamilton show for a bank or credit union is read from
 * `institution_financial_records` (FDIC BankFind quarters; NCUA 5300 year to date). The filed line
 * items are stored apart, from the FFIEC call report and NCUA 5300 bulk files, in
 * `institution_call_report_items`. This check compares the two over the newest
 * `RECONCILE_QUARTERS` quarter ends, for a draw of `RECONCILE_SAMPLE_PER_CHARTER` banks and as
 * many credit unions that changes each day (ordered by md5(id || date)), so the whole population
 * is covered over a few weeks within a bounded daily read.
 *
 * | Shown (records)              | Filed (call report items)                         |
 * |------------------------------|---------------------------------------------------|
 * | bank assets (ASSET)          | RCFD2170 / RCON2170                               |
 * | bank deposits (DEP)          | RCON2200 (domestic offices)                       |
 * | bank service charges (ISERCHGQ) | RIAD4080 year to date, made a quarter          |
 * | bank revenue (NIMQ + NONIIQ) | RIAD4074 + RIAD4079 year to date, made a quarter  |
 * | CU fee income, year to date  | ACCT_131                                          |
 * | CU overdraft income, YTD     | ACCT_IS0048                                       |
 * | CU NSF income, YTD           | ACCT_IS0049                                       |
 *
 * A pair matches within $1K or 0.05% of the filed figure, whichever is larger. A difference with a
 * known cause is counted as explained, not as an error: a quarter in which the bank absorbed
 * another (its year to date carries the absorbed bank's earlier quarters, which BankFind takes out;
 * #2025), a quarter in which any income line differences to a negative figure (a year to date
 * that restarted mid-year, which throws off every differenced line of that quarter), and deposits of
 * a bank that files with foreign offices (BankFind's DEP includes them, RCON2200 does not). Assets
 * more than 10% apart mark an identity suspect: the two tables likely hold different institutions.
 * A credit union's overdraft or NSF line that NCUA files as 0 and the loader stored as not reported
 * (`blankUnreportedFeeIncome`) is counted as not reported, never as $0.
 *
 * Shown figures with no filed counterpart stored are listed in `NOT_COVERED`, never counted as a
 * match.
 */

type SqlTag = typeof sql;

export const FILINGS_RECONCILE_VERSION = 1;
export const RECONCILE_QUARTERS = 12;
export const RECONCILE_SAMPLE_PER_CHARTER = 150;
export const RECONCILE_TIMEOUT_MS = 20_000;
export const RECONCILE_MISMATCHES_LISTED = 25;
/** Assets further apart than this share of the filed figure mark an identity suspect. */
export const IDENTITY_SUSPECT_SHARE = 0.1;

export const BANK_METRICS = ["assets", "deposits", "serviceCharges", "revenue"] as const;
export const CREDIT_UNION_METRICS = ["feeIncomeYtd", "overdraftYtd", "nsfYtd"] as const;
export type BankMetric = (typeof BANK_METRICS)[number];
export type CreditUnionMetric = (typeof CREDIT_UNION_METRICS)[number];
export type ReconcileMetric = BankMetric | CreditUnionMetric;

export type MismatchClass = "merger_quarter" | "negative_differenced" | "foreign_offices" | "identity_suspect" | "unexplained";
export const EXPLAINED_CLASSES: ReadonlySet<MismatchClass> = new Set(["merger_quarter", "negative_differenced", "foreign_offices"]);

export const NOT_COVERED = [
  "bank net income and ROA: RIAD4340 is not among the stored FFIEC lines",
  "credit union assets, deposits, revenue and net income: ACCT_010, ACCT_018, the income totals and ACCT_661A are not among the stored NCUA lines",
] as const;

const BANK_ITEM_KEYS = ["total_assets", "total_deposits", "service_charges_deposits_ytd", "net_interest_income_ytd", "noninterest_income_total_ytd"];
const CREDIT_UNION_ITEM_KEYS = ["acct_131", "acct_is0048", "acct_is0049"];

export interface FiledItemRow {
  institution_id: number | string;
  report_date: string;
  item_key: string;
  item_code: string;
  value: number | string | null;
  unit: string | null;
}

export interface ShownRecordRow {
  institution_id: number | string;
  report_date: string;
  total_assets: number | string | null;
  total_deposits: number | string | null;
  service_charge_income: number | string | null;
  total_revenue: number | string | null;
  net_income: number | string | null;
  overdraft_revenue: number | string | null;
  nsf_revenue: number | string | null;
}

export interface MergerRow {
  institution_id: number | string;
  effective_date: string;
}

export interface Mismatch {
  charter: "bank" | "credit_union";
  institutionId: number;
  reportDate: string;
  metric: ReconcileMetric;
  /** Whole dollars. */
  shown: number;
  filed: number;
  cls: MismatchClass;
}

export interface MetricTally {
  /** Pairs with both figures present. */
  compared: number;
  matched: number;
  explained: number;
  unexplained: number;
  /** NCUA filed 0 and the shown figure is stored as not reported (by rule, not a mismatch). */
  notReported: number;
  /** A filed figure with no shown figure (or one the page leaves empty). */
  shownMissing: number;
  /** A shown figure with no filed figure stored, or no prior quarter to difference from. */
  filedMissing: number;
}

export interface CharterResult {
  quarters: string[];
  institutions: number;
  tallies: Partial<Record<ReconcileMetric, MetricTally>>;
  mismatches: Mismatch[];
  error: string | null;
}

export interface FilingsReconcileReport {
  version: number;
  seed: string;
  sampleSize: number;
  bank: CharterResult;
  creditUnion: CharterResult;
  totals: { compared: number; matched: number; explained: number; unexplained: number };
  identitySuspects: { institutionId: number; reportDate: string; shown: number; filed: number }[];
}

// --- Pure helpers ------------------------------------------------------------------------------

const THOUSANDS = 1_000;

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Quarter-end date (YYYY-MM-DD) one quarter before `date`. */
export function previousQuarterEnd(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (month <= 3) return `${year - 1}-12-31`;
  const prior = month <= 6 ? 3 : month <= 9 ? 6 : 9;
  return `${year}-${String(prior).padStart(2, "0")}-${prior === 3 ? 31 : 30}`;
}

/** The `count` quarter ends ending at `newest`, oldest first. */
export function quarterEnds(newest: string, count: number): string[] {
  const out = [newest];
  while (out.length < count) out.unshift(previousQuarterEnd(out[0]));
  return out;
}

/** Shown and filed agree within $1K or 0.05% of the filed figure (dollars). */
export function sameFigure(shown: number, filed: number): boolean {
  return Math.abs(shown - filed) <= Math.max(THOUSANDS, Math.abs(filed) * 0.0005);
}

const isQ1 = (date: string) => Number(date.slice(5, 7)) <= 3;
const key = (id: number, date: string) => `${id}|${date}`;

function emptyTally(): MetricTally {
  return { compared: 0, matched: 0, explained: 0, unexplained: 0, notReported: 0, shownMissing: 0, filedMissing: 0 };
}

/** Filed item values in dollars, by item key, then institution|date. */
function filedIndex(items: FiledItemRow[]): { values: Map<string, Map<string, number>>; codes: Map<string, string> } {
  const values = new Map<string, Map<string, number>>();
  const codes = new Map<string, string>();
  for (const row of items) {
    const v = num(row.value);
    if (v === null) continue;
    const id = Number(row.institution_id);
    const dollars = (row.unit ?? "").toLowerCase() === "thousands" ? v * THOUSANDS : v;
    let byKey = values.get(row.item_key);
    if (!byKey) values.set(row.item_key, (byKey = new Map()));
    byKey.set(key(id, row.report_date), dollars);
    codes.set(`${row.item_key}|${key(id, row.report_date)}`, row.item_code);
  }
  return { values, codes };
}

/** A year-to-date line made a quarter: Q1 as filed, later quarters less the prior quarter end. */
function filedQuarter(ytd: Map<string, number> | undefined, id: number, date: string): number | null {
  const now = ytd?.get(key(id, date));
  if (now === undefined) return null;
  if (isQ1(date)) return now;
  const prior = ytd?.get(key(id, previousQuarterEnd(date)));
  return prior === undefined ? null : now - prior;
}

interface Tallier {
  tallies: Partial<Record<ReconcileMetric, MetricTally>>;
  mismatches: Mismatch[];
  record(metric: ReconcileMetric, outcome: "matched" | "shownMissing" | "filedMissing" | "notReported"): void;
  mismatch(m: Mismatch): void;
}

function tallier(metrics: readonly ReconcileMetric[]): Tallier {
  const tallies: Partial<Record<ReconcileMetric, MetricTally>> = {};
  for (const m of metrics) tallies[m] = emptyTally();
  const mismatches: Mismatch[] = [];
  return {
    tallies,
    mismatches,
    record(metric, outcome) {
      const t = tallies[metric]!;
      if (outcome === "matched") {
        t.compared++;
        t.matched++;
      } else t[outcome]++;
    },
    mismatch(m) {
      const t = tallies[m.metric]!;
      t.compared++;
      if (EXPLAINED_CLASSES.has(m.cls)) t.explained++;
      else t.unexplained++;
      mismatches.push(m);
    },
  };
}

/**
 * Bank pairs over `quarters`. `items` may include the quarter end before the first, so the first
 * quarter can be differenced. Income is compared only where the record carries the registry's
 * income mapping (net income present), as the page leaves older rows' income empty.
 */
export function compareBanks(
  records: ShownRecordRow[],
  items: FiledItemRow[],
  mergers: MergerRow[],
  quarters: string[],
): Pick<CharterResult, "tallies" | "mismatches"> {
  const window = new Set(quarters);
  const { values, codes } = filedIndex(items);
  const merged = new Set(mergers.map((m) => Number(m.institution_id) + "|" + m.effective_date));
  const mergerIn = (id: number, date: string) => {
    const from = previousQuarterEnd(date);
    for (const entry of merged) {
      const [mid, effective] = entry.split("|");
      if (Number(mid) === id && effective > from && effective <= date) return true;
    }
    return false;
  };
  const t = tallier(BANK_METRICS);
  for (const row of records) {
    if (!window.has(row.report_date)) continue;
    const id = Number(row.institution_id);
    const k = key(id, row.report_date);
    const at = { institutionId: id, reportDate: row.report_date, charter: "bank" as const };
    const dollars = (v: number | string | null) => {
      const n = num(v);
      return n === null ? null : n * THOUSANDS;
    };

    const assetsShown = dollars(row.total_assets);
    const assetsFiled = values.get("total_assets")?.get(k) ?? null;
    const suspect = assetsShown !== null && assetsFiled !== null && assetsFiled !== 0
      && Math.abs(assetsShown - assetsFiled) > Math.abs(assetsFiled) * IDENTITY_SUSPECT_SHARE;

    const pair = (metric: BankMetric, shown: number | null, filed: number | null, classify: (shown: number, filed: number) => MismatchClass) => {
      if (shown === null && filed === null) return;
      if (shown === null) return t.record(metric, "shownMissing");
      if (filed === null) return t.record(metric, "filedMissing");
      if (sameFigure(shown, filed)) return t.record(metric, "matched");
      t.mismatch({ ...at, metric, shown, filed, cls: suspect ? "identity_suspect" : classify(shown, filed) });
    };

    pair("assets", assetsShown, assetsFiled, () => "unexplained");
    const assetsCode = codes.get(`total_assets|${k}`) ?? "";
    pair("deposits", dollars(row.total_deposits), values.get("total_deposits")?.get(k) ?? null, (shown, filed) =>
      assetsCode.startsWith("RCFD") && shown > filed ? "foreign_offices" : "unexplained",
    );

    const incomeShown = num(row.net_income) !== null;
    const sc = filedQuarter(values.get("service_charges_deposits_ytd"), id, row.report_date);
    const nii = filedQuarter(values.get("net_interest_income_ytd"), id, row.report_date);
    const nonii = filedQuarter(values.get("noninterest_income_total_ytd"), id, row.report_date);
    // A year to date that restarted mid-year shows as any income line going negative when
    // differenced; it throws off every differenced line of that quarter, not only the negative one.
    const restarted = [sc, nii, nonii].some((v) => v !== null && v < 0);
    const flow = (): MismatchClass =>
      mergerIn(id, row.report_date) ? "merger_quarter" : restarted ? "negative_differenced" : "unexplained";
    const hasYtd = (itemKey: string) => values.get(itemKey)?.has(k) ?? false;
    const flowPair = (metric: BankMetric, shownRaw: number | string | null, filed: number | null, filedPresent: boolean) => {
      const shown = incomeShown ? dollars(shownRaw) : null;
      if (shown === null) {
        if (filedPresent) t.record(metric, "shownMissing");
        return;
      }
      pair(metric, shown, filed, flow);
    };
    flowPair("serviceCharges", row.service_charge_income, sc, hasYtd("service_charges_deposits_ytd"));
    flowPair(
      "revenue",
      row.total_revenue,
      nii !== null && nonii !== null ? nii + nonii : null,
      hasYtd("net_interest_income_ytd") && hasYtd("noninterest_income_total_ytd"),
    );
  }
  return { tallies: t.tallies, mismatches: t.mismatches };
}

/** Credit-union pairs over `quarters`; both sides are year to date. */
export function compareCreditUnions(records: ShownRecordRow[], items: FiledItemRow[], quarters: string[]): Pick<CharterResult, "tallies" | "mismatches"> {
  const window = new Set(quarters);
  const { values } = filedIndex(items);
  const t = tallier(CREDIT_UNION_METRICS);
  const lines: [CreditUnionMetric, keyof ShownRecordRow, string, boolean][] = [
    ["feeIncomeYtd", "service_charge_income", "acct_131", false],
    ["overdraftYtd", "overdraft_revenue", "acct_is0048", true],
    ["nsfYtd", "nsf_revenue", "acct_is0049", true],
  ];
  for (const row of records) {
    if (!window.has(row.report_date)) continue;
    const id = Number(row.institution_id);
    const k = key(id, row.report_date);
    for (const [metric, field, itemKey, zeroIsUnreported] of lines) {
      const raw = num(row[field] as number | string | null);
      const shown = raw === null ? null : raw * THOUSANDS;
      const filed = values.get(itemKey)?.get(k) ?? null;
      if (shown === null && filed === null) continue;
      if (shown === null) {
        t.record(metric, zeroIsUnreported && filed === 0 ? "notReported" : "shownMissing");
        continue;
      }
      if (filed === null) {
        t.record(metric, "filedMissing");
        continue;
      }
      if (sameFigure(shown, filed)) t.record(metric, "matched");
      else t.mismatch({ charter: "credit_union", institutionId: id, reportDate: row.report_date, metric, shown, filed, cls: "unexplained" });
    }
  }
  return { tallies: t.tallies, mismatches: t.mismatches };
}

function sumTallies(results: CharterResult[]) {
  const totals = { compared: 0, matched: 0, explained: 0, unexplained: 0 };
  for (const r of results) {
    for (const tally of Object.values(r.tallies)) {
      if (!tally) continue;
      totals.compared += tally.compared;
      totals.matched += tally.matched;
      totals.explained += tally.explained;
      totals.unexplained += tally.unexplained;
    }
  }
  return totals;
}

export function buildFilingsReconcileReport(seed: string, sampleSize: number, bank: CharterResult, creditUnion: CharterResult): FilingsReconcileReport {
  const identitySuspects = bank.mismatches
    .filter((m) => m.metric === "assets" && m.cls === "identity_suspect")
    .map((m) => ({ institutionId: m.institutionId, reportDate: m.reportDate, shown: m.shown, filed: m.filed }));
  return {
    version: FILINGS_RECONCILE_VERSION,
    seed,
    sampleSize,
    bank,
    creditUnion,
    totals: sumTallies([bank, creditUnion]),
    identitySuspects,
  };
}

// --- Reads -------------------------------------------------------------------------------------

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

async function sampleIds(db: SqlTag, recordSource: "fdic" | "ncua", newest: string, seed: string, size: number): Promise<number[]> {
  const rows = await db<{ id: number }[]>`
    SELECT institution_id::int AS id
      FROM institution_financial_records
     WHERE source = ${recordSource} AND report_date = ${newest} AND institution_id IS NOT NULL
     ORDER BY md5(institution_id::text || ${seed})
     LIMIT ${size}
  `;
  return rows.map((r) => Number(r.id));
}

async function newestFiled(db: SqlTag, itemSource: "ffiec" | "ncua"): Promise<string | null> {
  const [row] = await db<{ newest: string | null }[]>`
    SELECT max(report_date)::text AS newest FROM institution_call_report_items WHERE source = ${itemSource}
  `;
  return row?.newest ?? null;
}

async function readRecords(db: SqlTag, recordSource: "fdic" | "ncua", ids: number[], dates: string[]): Promise<ShownRecordRow[]> {
  return db<ShownRecordRow[]>`
    SELECT institution_id::int AS institution_id, report_date, total_assets::float8 AS total_assets,
           total_deposits::float8 AS total_deposits, service_charge_income::float8 AS service_charge_income,
           total_revenue::float8 AS total_revenue, net_income::float8 AS net_income,
           overdraft_revenue::float8 AS overdraft_revenue, nsf_revenue::float8 AS nsf_revenue
      FROM institution_financial_records
     WHERE source = ${recordSource} AND institution_id = ANY(${ids}::bigint[]) AND report_date = ANY(${dates}::text[])
  `;
}

async function readItems(db: SqlTag, itemSource: "ffiec" | "ncua", ids: number[], dates: string[], keys: string[]): Promise<FiledItemRow[]> {
  return db<FiledItemRow[]>`
    SELECT institution_id::int AS institution_id, report_date::text AS report_date, item_key, item_code,
           value::float8 AS value, unit
      FROM institution_call_report_items
     WHERE source = ${itemSource} AND institution_id = ANY(${ids}::bigint[])
       AND report_date = ANY(${dates}::date[]) AND item_key = ANY(${keys}::text[])
  `;
}

async function readMergers(db: SqlTag, ids: number[], from: string, to: string): Promise<MergerRow[]> {
  // FDIC history code 810: the institution absorbed another (participated in a merger as survivor).
  return db<MergerRow[]>`
    SELECT institution_id::int AS institution_id, effective_date::text AS effective_date
      FROM institution_structure_events
     WHERE institution_id = ANY(${ids}::bigint[]) AND change_code = '810' AND office_number IS NULL
       AND effective_date > ${from}::date AND effective_date <= ${to}::date
  `;
}

async function reconcileCharter(
  db: SqlTag,
  charter: "bank" | "credit_union",
  seed: string,
  size: number,
): Promise<CharterResult> {
  const itemSource = charter === "bank" ? "ffiec" : "ncua";
  const recordSource = charter === "bank" ? "fdic" : "ncua";
  const empty: CharterResult = { quarters: [], institutions: 0, tallies: {}, mismatches: [], error: null };
  try {
    return await inSavepoint(db, async (scope) => {
      const newest = await newestFiled(scope, itemSource);
      if (!newest) return { ...empty, error: `no ${itemSource} call report items stored` };
      const quarters = quarterEnds(newest, RECONCILE_QUARTERS);
      const ids = await sampleIds(scope, recordSource, newest, seed, size);
      if (ids.length === 0) return { ...empty, quarters, error: `no ${recordSource} records for ${newest}` };
      const withPrior = [previousQuarterEnd(quarters[0]), ...quarters];
      const records = await readRecords(scope, recordSource, ids, quarters);
      if (charter === "bank") {
        const items = await readItems(scope, itemSource, ids, withPrior, BANK_ITEM_KEYS);
        const mergers = await readMergers(scope, ids, withPrior[0], newest);
        return { quarters, institutions: ids.length, ...compareBanks(records, items, mergers, quarters), error: null };
      }
      const items = await readItems(scope, itemSource, ids, quarters, CREDIT_UNION_ITEM_KEYS);
      return { quarters, institutions: ids.length, ...compareCreditUnions(records, items, quarters), error: null };
    });
  } catch (error) {
    // A failed read is unknown, never a clean result.
    return { ...empty, error: message(error) };
  }
}

/** Runs the reconciliation under a statement timeout, restoring the prior setting afterwards. */
export async function runFilingsReconcile({
  db = sql,
  now = new Date(),
  sampleSize = RECONCILE_SAMPLE_PER_CHARTER,
}: { db?: SqlTag; now?: Date; sampleSize?: number } = {}): Promise<FilingsReconcileReport> {
  const seed = now.toISOString().slice(0, 10);
  const [prior] = await db<{ value: string | null }[]>`SELECT current_setting('statement_timeout') AS value`;
  await db`SELECT set_config('statement_timeout', ${String(RECONCILE_TIMEOUT_MS)}::text, true)`;
  try {
    const bank = await reconcileCharter(db, "bank", seed, sampleSize);
    const creditUnion = await reconcileCharter(db, "credit_union", seed, sampleSize);
    return buildFilingsReconcileReport(seed, sampleSize, bank, creditUnion);
  } finally {
    if (prior?.value != null) await db`SELECT set_config('statement_timeout', ${prior.value}::text, true)`;
  }
}

// --- Ledger text -------------------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString("en-US");

export function summarizeFilingsReconcile(report: FilingsReconcileReport): string {
  const { totals } = report;
  const failed = [report.bank.error && "banks", report.creditUnion.error && "credit unions"].filter(Boolean);
  const scope = `${fmt(report.bank.institutions)} banks and ${fmt(report.creditUnion.institutions)} credit unions over ${RECONCILE_QUARTERS} quarters`;
  const result = totals.compared === 0
    ? "nothing compared"
    : `${fmt(totals.matched)} of ${fmt(totals.compared)} figures match the stored filings, ${fmt(totals.explained)} differ for a known reason`;
  const alarm = totals.unexplained > 0 ? `ALARM: ${fmt(totals.unexplained)} unexplained` : "none unexplained";
  const suspects = report.identitySuspects.length > 0 ? `, ${fmt(new Set(report.identitySuspects.map((s) => s.institutionId)).size)} identity suspect(s)` : "";
  const errors = failed.length > 0 ? `; could not read ${failed.join(" or ")}` : "";
  return `Deming reconciled ${scope}: ${result}, ${alarm}${suspects}${errors}.`;
}

/** The step's stored detail: counts, the first listed mismatches (unexplained first), reasons. */
export function filingsReconcileDetail(report: FilingsReconcileReport): Record<string, unknown> {
  const order = (m: Mismatch) => (EXPLAINED_CLASSES.has(m.cls) ? 1 : 0);
  const listed = [...report.bank.mismatches, ...report.creditUnion.mismatches]
    .sort((a, b) => order(a) - order(b) || b.reportDate.localeCompare(a.reportDate) || a.institutionId - b.institutionId)
    .slice(0, RECONCILE_MISMATCHES_LISTED)
    .map((m) => ({ charter: m.charter, institution_id: m.institutionId, report_date: m.reportDate, metric: m.metric, shown: m.shown, filed: m.filed, class: m.cls }));
  const charter = (r: CharterResult) => ({ quarters: r.quarters, institutions: r.institutions, tallies: r.tallies, mismatches: r.mismatches.length, error: r.error });
  return {
    version: report.version,
    seed: report.seed,
    sample_size: report.sampleSize,
    totals: report.totals,
    bank: charter(report.bank),
    credit_union: charter(report.creditUnion),
    identity_suspects: report.identitySuspects.slice(0, RECONCILE_MISMATCHES_LISTED),
    mismatches: listed,
    not_covered: NOT_COVERED,
  };
}
