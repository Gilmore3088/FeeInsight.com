import { strFromU8 } from "fflate";
import { buildFinancialSeries, type FinancialPoint } from "@/app/(public)/institution/[id]/financial-history";
import type { InstitutionFinancialHistoryRow } from "@/lib/data-store/financial";
import { cells } from "@/lib/regulatory/ffiec";
import { quarterlyIncome, type ServiceChargeRow } from "./workspace/revenue";

/**
 * Direct filings check (#1925, go-live gate G3/D3). Read-only and pure.
 *
 * Compares every quarterly figure the gated Financial profile and Hamilton's workspace show for a
 * bank or credit union with the regulator's own bulk file for that quarter: the FFIEC CDR
 * "Call Reports -- Single Period" zip (tab-delimited schedule files keyed by IDRSSD, thousands of
 * dollars) and the NCUA 5300 quarterly zip (FS220*.txt keyed by CU_NUMBER, whole dollars, income
 * year to date). The daily `deming-filings-reconcile` step compares against our stored copy of
 * those files (`institution_call_report_items`); this check reads the files themselves, so a
 * loader fault, a stale copy or a refiling the stored copy missed shows up here.
 *
 * The shown side runs the stored rows through the display code itself: `buildFinancialSeries`
 * (the profile's chart and table) and `quarterlyIncome` (Hamilton's revenue evidence). The filed
 * side is worked out here from the file's line codes, independently of the loaders' mappings.
 *
 * | Metric | Bank (FFIEC) | Credit union (NCUA 5300) |
 * |---|---|---|
 * | assets | RCFD2170, else RCON2170 | ACCT_010 |
 * | deposits | RCON2200 + RCFN2200 (foreign offices) | ACCT_018 |
 * | loans | RCFDB529, else RCONB529 | ACCT_025B |
 * | equity | RCFDG105, else RCONG105 | ACCT_997 (net worth) |
 * | netIncome, quarter | RIAD4340 year to date, made a quarter | ACCT_661A, made a quarter |
 * | serviceCharges, quarter | RIAD4080, made a quarter | ACCT_131, made a quarter |
 * | provision, quarter | RIADJJ33, made a quarter | not shown |
 * | tier1Pct | RCFA7206, else RCOA7206 | ACCT_998 (net worth ratio, basis points) |
 * | leveragePct | RCFA7204, else RCOA7204 | not shown |
 * | totalCapitalPct | RCFA7205, else RCOA7205 | not shown |
 * | roaPct (derived) | quarter's RIAD4340 x 4 / RC-K average assets (RCFD3368, else RCON3368) | year-to-date ACCT_661A annualized / ACCT_010 |
 * | members | not shown | ACCT_083 |
 * | workspaceServiceCharges | as serviceCharges, through Hamilton's revenue code | as serviceCharges |
 * | workspaceOverdraft, quarter | RIADH032 (overdraft and NSF together), made a quarter | ACCT_IS0048, made a quarter |
 * | workspaceNsf, quarter | not shown | ACCT_IS0049, made a quarter |
 *
 * Tolerance: dollars within $1K or 0.05% of the filed figure, whichever is larger; percentages
 * within 0.01 points; counts exactly. `roaPct` is marked derived: the regulator files no ROA, so a
 * difference there can be the formula, not the data. A credit-union overdraft or NSF line NCUA
 * files as 0 that the display leaves empty is counted as not reported (`blankUnreportedFeeIncome`).
 * A quarter whose prior quarter's file is not loaded cannot be made a quarter and counts as
 * `filedMissing`, never as a match.
 */

export const DIRECT_CHECK_VERSION = 1;

export const BANK_DIRECT_METRICS = [
  "assets", "deposits", "loans", "equity", "netIncome", "serviceCharges", "provision",
  "tier1Pct", "leveragePct", "totalCapitalPct", "roaPct", "workspaceServiceCharges", "workspaceOverdraft",
] as const;
export const CREDIT_UNION_DIRECT_METRICS = [
  "assets", "deposits", "loans", "equity", "netIncome", "serviceCharges", "tier1Pct", "roaPct", "members",
  "workspaceServiceCharges", "workspaceOverdraft", "workspaceNsf",
] as const;
export type DirectMetric = (typeof BANK_DIRECT_METRICS)[number] | (typeof CREDIT_UNION_DIRECT_METRICS)[number];
export const DERIVED_METRICS: ReadonlySet<DirectMetric> = new Set(["roaPct"]);

/** Shown figures this check does not compare yet, and why. */
export const DIRECT_NOT_CHECKED = [
  "nimPct, efficiencyPct, roePct, ncoRatePct, noncurrentRatePct: BankFind computes these from averages and adjustments whose exact definition is not confirmed against a filed line; comparing a guessed formula would report formula differences as data errors",
  "loan mix, securities, core, brokered and uninsured deposits, employees: several lines summed by BankFind; not mapped here yet",
] as const;

type Unit = "dollars" | "percent" | "count";
const UNIT: Record<DirectMetric, Unit> = {
  assets: "dollars", deposits: "dollars", loans: "dollars", equity: "dollars", netIncome: "dollars",
  serviceCharges: "dollars", provision: "dollars", workspaceServiceCharges: "dollars",
  workspaceOverdraft: "dollars", workspaceNsf: "dollars",
  tier1Pct: "percent", leveragePct: "percent", totalCapitalPct: "percent", roaPct: "percent", members: "count",
};

/** One quarter of one regulator file: filer id (IDRSSD or NCUA charter, no leading zeros) to line code to value. */
export type FiledQuarter = Map<string, Map<string, number>>;
/** Quarter end (YYYY-MM-DD) to that quarter's file. */
export type Filings = Map<string, FiledQuarter>;

export interface DirectSubject {
  institutionId: number;
  name?: string;
  charter: "bank" | "credit_union";
  /** IDRSSD for a bank, NCUA charter number for a credit union. */
  filerId: string;
  /** Rows as `getFinancialHistory` returns them (thousands of dollars, as stored). */
  rows: InstitutionFinancialHistoryRow[];
  /** NCUA NSF income (year to date, thousands) by quarter end; not in the history read. */
  nsfRevenue?: Record<string, number | null>;
}

export interface DirectTally {
  compared: number;
  matched: number;
  mismatched: number;
  /** A filed figure the display leaves empty. */
  shownMissing: number;
  /** A shown figure with no filed figure (line not filed, filer absent, or no prior quarter loaded). */
  filedMissing: number;
  /** NCUA filed 0 and the display leaves the line empty, by rule. */
  notReported: number;
}

export interface DirectMismatch {
  charter: "bank" | "credit_union";
  institutionId: number;
  name?: string;
  filerId: string;
  reportDate: string;
  metric: DirectMetric;
  shown: number;
  filed: number;
  /** The filed lines the figure came from. */
  lines: string;
  derived: boolean;
}

export interface DirectCharterResult {
  institutions: number;
  /** Subjects whose filer id is in no loaded file. */
  notInFile: number[];
  quarters: string[];
  tallies: Partial<Record<DirectMetric, DirectTally>>;
  mismatches: DirectMismatch[];
}

export interface DirectCheckReport {
  version: number;
  bank: DirectCharterResult;
  creditUnion: DirectCharterResult;
  totals: { compared: number; matched: number; mismatched: number };
  notChecked: readonly string[];
}

// --- Regulator file readers --------------------------------------------------------------------

const stripZeros = (id: string) => id.replace(/^0+/, "") || "0";

/** The quarter end named in an FFIEC bulk file name ("... RC 06302026.txt", "... RCR 06302026(1 of 2).txt"). */
export function ffiecFileDate(name: string): string | null {
  const m = /(\d{2})(\d{2})(\d{4})(?:\(\d+ of \d+\))?\.txt$/i.exec(name);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/**
 * Every wanted line of every schedule file in one FFIEC bulk quarter, by IDRSSD. Row 1 holds the
 * line codes, row 2 the descriptions (skipped: its IDRSSD cell is not a number). Blank cells are
 * left out, never read as zero. A code filed twice for one bank with different values is listed
 * in `conflicts`.
 */
export function readFfiecQuarter(
  files: Record<string, Uint8Array | string>,
  wanted: ReadonlySet<string> = FFIEC_WANTED,
): { quarter: FiledQuarter; conflicts: string[] } {
  const quarter: FiledQuarter = new Map();
  const conflicts: string[] = [];
  for (const name of Object.keys(files).sort()) {
    const body = files[name];
    const lines = (typeof body === "string" ? body : strFromU8(body, true)).split(/\r?\n/);
    const header = cells(lines[0] ?? "").map((h) => h.toUpperCase());
    const rssdAt = header.indexOf("IDRSSD");
    if (rssdAt < 0) continue;
    const columns = header.map((code, i) => [code, i] as const).filter(([code]) => wanted.has(code));
    if (columns.length === 0) continue;
    for (const line of lines.slice(1)) {
      const row = cells(line);
      const rssd = row[rssdAt];
      if (!rssd || !/^\d+$/.test(rssd)) continue;
      const id = stripZeros(rssd);
      let values = quarter.get(id);
      for (const [code, i] of columns) {
        const raw = row[i];
        if (raw === undefined || raw === "") continue;
        const v = Number(raw);
        if (!Number.isFinite(v)) continue;
        if (!values) quarter.set(id, (values = new Map()));
        const prior = values.get(code);
        if (prior !== undefined && prior !== v) conflicts.push(`${id} ${code}: ${prior} vs ${v} (${name})`);
        else values.set(code, v);
      }
    }
  }
  return { quarter, conflicts };
}

/** RFC 4180 CSV (NCUA's FS220 files quote every field). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** The quarter end of an NCUA CYCLE_DATE ("6/30/2026 0:00:00" or "2026-06-30"). */
export function ncuaCycleDate(raw: string): string | null {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw.trim());
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/**
 * Every wanted account of every FS220*.txt file in one NCUA quarter, by charter number. An
 * account carried by two files with different values is listed in `conflicts` and the first
 * file's value is kept; the loader's own merge rule is deliberately not reused.
 */
export function readNcuaQuarter(
  files: Record<string, Uint8Array | string>,
  wanted: ReadonlySet<string> = NCUA_WANTED,
): { quarter: FiledQuarter; reportDate: string | null; conflicts: string[] } {
  const quarter: FiledQuarter = new Map();
  const conflicts: string[] = [];
  let reportDate: string | null = null;
  for (const name of Object.keys(files).sort()) {
    if (!/(^|\/)fs220[a-z0-9_]*\.txt$/i.test(name)) continue;
    const body = files[name];
    const [header, ...rows] = parseCsvRows(typeof body === "string" ? body : strFromU8(body, true));
    if (!header) continue;
    const keys = header.map((h) => h.trim().toUpperCase());
    const cuAt = keys.indexOf("CU_NUMBER");
    const cycleAt = keys.indexOf("CYCLE_DATE");
    if (cuAt < 0) continue;
    const columns = keys.map((code, i) => [code, i] as const).filter(([code]) => wanted.has(code));
    for (const row of rows) {
      const cu = row[cuAt]?.trim();
      if (!cu || !/^\d+$/.test(cu)) continue;
      if (!reportDate && cycleAt >= 0) reportDate = ncuaCycleDate(row[cycleAt] ?? "");
      const id = stripZeros(cu);
      let values = quarter.get(id);
      for (const [code, i] of columns) {
        const raw = row[i]?.trim();
        if (raw === undefined || raw === "") continue;
        const v = Number(raw);
        if (!Number.isFinite(v)) continue;
        if (!values) quarter.set(id, (values = new Map()));
        const prior = values.get(code);
        if (prior !== undefined && prior !== v) conflicts.push(`${id} ${code}: ${prior} vs ${v} (${name})`);
        else if (prior === undefined) values.set(code, v);
      }
    }
  }
  return { quarter, reportDate, conflicts };
}

// --- Filed figures -----------------------------------------------------------------------------

const THOUSANDS = 1_000;
const isQ1 = (date: string) => Number(date.slice(5, 7)) <= 3;
const quarterNo = (date: string) => Math.ceil(Number(date.slice(5, 7)) / 3);

export function priorQuarterEnd(date: string): string {
  const year = Number(date.slice(0, 4));
  const q = quarterNo(date);
  if (q === 1) return `${year - 1}-12-31`;
  return `${year}-${["03-31", "06-30", "09-30"][q - 2]}`;
}

interface Filed {
  value: number | null;
  lines: string;
}

type Lookup = (date: string, code: string) => number | undefined;

function first(get: Lookup, date: string, codes: string[]): { value: number; code: string } | null {
  for (const code of codes) {
    const v = get(date, code);
    if (v !== undefined) return { value: v, code };
  }
  return null;
}

/** A year-to-date line made a quarter: Q1 as filed, later quarters less the prior quarter end. */
function quarterOf(get: Lookup, date: string, code: string): number | null {
  const now = get(date, code);
  if (now === undefined) return null;
  if (isQ1(date)) return now;
  const prior = get(priorQuarterEnd(date), code);
  return prior === undefined ? null : now - prior;
}

const balance = (get: Lookup, date: string, codes: string[], scale: number): Filed => {
  const hit = first(get, date, codes);
  return { value: hit ? hit.value * scale : null, lines: hit?.code ?? codes.join("|") };
};
const flow = (get: Lookup, date: string, code: string, scale: number): Filed => {
  const v = quarterOf(get, date, code);
  return { value: v === null ? null : v * scale, lines: `${code} (year to date, made a quarter)` };
};

export function bankFiled(get: Lookup, date: string): Record<(typeof BANK_DIRECT_METRICS)[number], Filed> {
  const k = THOUSANDS;
  const domestic = get(date, "RCON2200");
  const foreign = get(date, "RCFN2200");
  const netIncome = flow(get, date, "RIAD4340", k);
  const avgAssets = first(get, date, ["RCFD3368", "RCON3368"]);
  const serviceCharges = flow(get, date, "RIAD4080", k);
  return {
    assets: balance(get, date, ["RCFD2170", "RCON2170"], k),
    deposits: { value: domestic === undefined ? null : (domestic + (foreign ?? 0)) * k, lines: foreign === undefined ? "RCON2200" : "RCON2200+RCFN2200" },
    loans: balance(get, date, ["RCFDB529", "RCONB529"], k),
    equity: balance(get, date, ["RCFDG105", "RCONG105"], k),
    netIncome,
    serviceCharges,
    provision: flow(get, date, "RIADJJ33", k),
    tier1Pct: balance(get, date, ["RCFA7206", "RCOA7206"], 1),
    leveragePct: balance(get, date, ["RCFA7204", "RCOA7204"], 1),
    totalCapitalPct: balance(get, date, ["RCFA7205", "RCOA7205"], 1),
    roaPct: {
      value: netIncome.value !== null && avgAssets && avgAssets.value !== 0 ? (netIncome.value * 4 * 100) / (avgAssets.value * k) : null,
      lines: `RIAD4340 quarter x4 / ${avgAssets?.code ?? "RCFD3368|RCON3368"}`,
    },
    workspaceServiceCharges: serviceCharges,
    workspaceOverdraft: flow(get, date, "RIADH032", k),
  };
}

export function creditUnionFiled(get: Lookup, date: string): Record<(typeof CREDIT_UNION_DIRECT_METRICS)[number], Filed> {
  const netYtd = get(date, "ACCT_661A");
  const assets = get(date, "ACCT_010");
  const ratio = get(date, "ACCT_998");
  const fee = flow(get, date, "ACCT_131", 1);
  return {
    assets: balance(get, date, ["ACCT_010"], 1),
    deposits: balance(get, date, ["ACCT_018"], 1),
    loans: balance(get, date, ["ACCT_025B"], 1),
    equity: balance(get, date, ["ACCT_997"], 1),
    netIncome: flow(get, date, "ACCT_661A", 1),
    serviceCharges: fee,
    tier1Pct: { value: ratio === undefined ? null : ratio / 100, lines: "ACCT_998 (basis points)" },
    roaPct: {
      value: netYtd !== undefined && assets ? (netYtd * (4 / quarterNo(date)) * 100) / assets : null,
      lines: "ACCT_661A annualized / ACCT_010",
    },
    members: balance(get, date, ["ACCT_083"], 1),
    workspaceServiceCharges: fee,
    workspaceOverdraft: flow(get, date, "ACCT_IS0048", 1),
    workspaceNsf: flow(get, date, "ACCT_IS0049", 1),
  };
}

export const FFIEC_WANTED: ReadonlySet<string> = new Set([
  "RCFD2170", "RCON2170", "RCON2200", "RCFN2200", "RCFDB529", "RCONB529", "RCFDG105", "RCONG105",
  "RIAD4340", "RIAD4080", "RIADJJ33", "RIADH032", "RCFA7206", "RCOA7206", "RCFA7204", "RCOA7204",
  "RCFA7205", "RCOA7205", "RCFD3368", "RCON3368",
]);
export const NCUA_WANTED: ReadonlySet<string> = new Set([
  "ACCT_010", "ACCT_018", "ACCT_025B", "ACCT_997", "ACCT_998", "ACCT_661A", "ACCT_131", "ACCT_083",
  "ACCT_IS0048", "ACCT_IS0049",
]);
const ZERO_IS_UNREPORTED: ReadonlySet<DirectMetric> = new Set(["workspaceOverdraft", "workspaceNsf"]);

// --- Shown figures -----------------------------------------------------------------------------

function shownFigures(subject: DirectSubject): Map<string, Partial<Record<DirectMetric, number | null>>> {
  const out = new Map<string, Partial<Record<DirectMetric, number | null>>>();
  const series: FinancialPoint[] = buildFinancialSeries(subject.rows);
  const source = subject.charter === "bank" ? "fdic" : "ncua";
  const revenueRows: ServiceChargeRow[] = subject.rows.map((r) => ({
    report_date: r.report_date,
    source: r.source,
    service_charge_income: r.service_charge_income,
    overdraft_revenue: r.overdraft_revenue ?? null,
    nsf_revenue: subject.nsfRevenue?.[r.report_date] ?? null,
  }));
  const fee = quarterlyIncome(revenueRows, source, "service_charge_income");
  const overdraft = quarterlyIncome(revenueRows, source, "overdraft_revenue");
  const nsf = quarterlyIncome(revenueRows, source, "nsf_revenue");
  for (const p of series) {
    if (p.source !== source) continue;
    out.set(p.reportDate, {
      assets: p.assets, deposits: p.deposits, loans: p.loans, equity: p.equity, netIncome: p.netIncome,
      serviceCharges: p.serviceCharges, provision: p.provision, tier1Pct: p.tier1Pct, leveragePct: p.leveragePct,
      totalCapitalPct: p.totalCapitalPct, roaPct: p.roaPct, members: p.members,
      workspaceServiceCharges: fee.get(p.reportDate) ?? null,
      workspaceOverdraft: overdraft.get(p.reportDate) ?? null,
      workspaceNsf: nsf.get(p.reportDate) ?? null,
    });
  }
  return out;
}

// --- Comparison --------------------------------------------------------------------------------

export function sameDirect(unit: Unit, shown: number, filed: number): boolean {
  if (unit === "count") return shown === filed;
  if (unit === "percent") return Math.abs(shown - filed) <= 0.01 + 1e-9;
  return Math.abs(shown - filed) <= Math.max(THOUSANDS, Math.abs(filed) * 0.0005);
}

const emptyTally = (): DirectTally => ({ compared: 0, matched: 0, mismatched: 0, shownMissing: 0, filedMissing: 0, notReported: 0 });

/**
 * Compares each subject of one charter over every quarter whose file is loaded. The prior
 * quarter's file is used only to make a year-to-date line a quarter.
 */
export function compareDirect(charter: "bank" | "credit_union", subjects: DirectSubject[], filings: Filings): DirectCharterResult {
  const metrics: readonly DirectMetric[] = charter === "bank" ? BANK_DIRECT_METRICS : CREDIT_UNION_DIRECT_METRICS;
  const quarters = [...filings.keys()].sort();
  const tallies: Partial<Record<DirectMetric, DirectTally>> = {};
  for (const m of metrics) tallies[m] = emptyTally();
  const mismatches: DirectMismatch[] = [];
  const notInFile: number[] = [];
  const mine = subjects.filter((s) => s.charter === charter);
  for (const subject of mine) {
    const filerId = stripZeros(subject.filerId);
    if (!quarters.some((q) => filings.get(q)?.has(filerId))) {
      notInFile.push(subject.institutionId);
      continue;
    }
    const get: Lookup = (date, code) => filings.get(date)?.get(filerId)?.get(code);
    const shownAt = shownFigures(subject);
    for (const date of quarters) {
      if (!filings.get(date)?.has(filerId)) continue;
      const filed: Record<string, Filed> = charter === "bank" ? bankFiled(get, date) : creditUnionFiled(get, date);
      const shown = shownAt.get(date) ?? {};
      for (const metric of metrics) {
        const t = tallies[metric]!;
        const s = shown[metric] ?? null;
        const f = filed[metric].value;
        if (s === null && f === null) continue;
        if (s === null) {
          if (ZERO_IS_UNREPORTED.has(metric) && charter === "credit_union" && f === 0) t.notReported++;
          else t.shownMissing++;
          continue;
        }
        if (f === null) {
          t.filedMissing++;
          continue;
        }
        t.compared++;
        if (sameDirect(UNIT[metric], s, f)) {
          t.matched++;
          continue;
        }
        t.mismatched++;
        mismatches.push({
          charter, institutionId: subject.institutionId, name: subject.name, filerId, reportDate: date, metric,
          shown: s, filed: f, lines: filed[metric].lines, derived: DERIVED_METRICS.has(metric),
        });
      }
    }
  }
  return { institutions: mine.length - notInFile.length, notInFile, quarters, tallies, mismatches };
}

export function directCheckReport(subjects: DirectSubject[], ffiec: Filings, ncua: Filings): DirectCheckReport {
  const bank = compareDirect("bank", subjects, ffiec);
  const creditUnion = compareDirect("credit_union", subjects, ncua);
  const totals = { compared: 0, matched: 0, mismatched: 0 };
  for (const r of [bank, creditUnion]) {
    for (const t of Object.values(r.tallies)) {
      if (!t) continue;
      totals.compared += t.compared;
      totals.matched += t.matched;
      totals.mismatched += t.mismatched;
    }
  }
  return { version: DIRECT_CHECK_VERSION, bank, creditUnion, totals, notChecked: DIRECT_NOT_CHECKED };
}

// --- Text --------------------------------------------------------------------------------------

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(4));

/** Per-metric counts, then every mismatch, as plain lines. */
export function formatDirectReport(report: DirectCheckReport): string {
  const out: string[] = [`Direct filings check v${report.version}`];
  for (const [label, r] of [["Banks (FFIEC CDR call reports)", report.bank], ["Credit unions (NCUA 5300)", report.creditUnion]] as const) {
    out.push("", `${label}: ${r.institutions} institutions, quarters ${r.quarters.join(", ") || "none loaded"}`);
    if (r.notInFile.length > 0) out.push(`  not in any loaded file: ${r.notInFile.join(", ")}`);
    out.push("  metric                    compared  matched  mismatched  shownMissing  filedMissing  notReported");
    for (const [metric, t] of Object.entries(r.tallies)) {
      if (!t) continue;
      const name = `${metric}${DERIVED_METRICS.has(metric as DirectMetric) ? " (derived)" : ""}`;
      out.push(`  ${name.padEnd(26)}${String(t.compared).padStart(8)}${String(t.matched).padStart(9)}${String(t.mismatched).padStart(12)}${String(t.shownMissing).padStart(14)}${String(t.filedMissing).padStart(14)}${String(t.notReported).padStart(13)}`);
    }
    for (const m of r.mismatches) {
      out.push(`  MISMATCH ${m.institutionId}${m.name ? ` ${m.name}` : ""} (${m.filerId}) ${m.reportDate} ${m.metric}: shown ${fmt(m.shown)}, filed ${fmt(m.filed)} [${m.lines}]${m.derived ? " derived" : ""}`);
    }
  }
  out.push("", `Total: ${report.totals.matched} of ${report.totals.compared} compared figures match; ${report.totals.mismatched} mismatched.`);
  out.push("Not checked:", ...report.notChecked.map((n) => `  - ${n}`));
  return out.join("\n");
}

// --- Production read (through the read-only SQL tool) --------------------------------------

/**
 * One SELECT returning `{ subjects: [...] }`: a reproducible draw of `perCharter` banks and as many
 * credit unions (ordered by md5(id || seed)) plus any `extraIds`, with every stored FDIC or NCUA
 * row since `from`. Read-only; run it through the read-only SQL tool and save its single value.
 */
export function directCheckSql({ perCharter, seed, from, extraIds = [] }: { perCharter: number; seed: string; from: string; extraIds?: number[] }): string {
  const n = Math.max(0, Math.floor(perCharter));
  const safeSeed = seed.replace(/[^A-Za-z0-9_-]/g, "");
  const safeFrom = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "2023-01-01";
  const ids = extraIds.filter((id) => Number.isSafeInteger(id)).join(",") || "NULL";
  return `WITH pick AS (
  (SELECT s.id, 'bank' AS charter, s.rssd_id::text AS filer_id, s.institution_name AS name
     FROM institution_sources s
    WHERE s.source = 'fdic' AND s.rssd_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM institution_financial_records f WHERE f.institution_id = s.id AND f.source = 'fdic' AND f.report_date >= '${safeFrom}')
    ORDER BY md5(s.id::text || '${safeSeed}') LIMIT ${n})
  UNION
  (SELECT s.id, 'credit_union', coalesce(nullif(s.ncua_charter_id::text, ''), s.cert_number::text), s.institution_name
     FROM institution_sources s
    WHERE s.source = 'ncua' AND coalesce(nullif(s.ncua_charter_id::text, ''), s.cert_number::text) IS NOT NULL
      AND EXISTS (SELECT 1 FROM institution_financial_records f WHERE f.institution_id = s.id AND f.source = 'ncua' AND f.report_date >= '${safeFrom}')
    ORDER BY md5(s.id::text || '${safeSeed}') LIMIT ${n})
  UNION
  (SELECT s.id, CASE WHEN s.source = 'ncua' THEN 'credit_union' ELSE 'bank' END,
          CASE WHEN s.source = 'ncua' THEN coalesce(nullif(s.ncua_charter_id::text, ''), s.cert_number::text) ELSE s.rssd_id::text END,
          s.institution_name
     FROM institution_sources s WHERE s.id IN (${ids}))
)
SELECT json_build_object('subjects', coalesce(json_agg(json_build_object(
  'institution_id', p.id, 'charter', p.charter, 'filer_id', p.filer_id, 'name', p.name,
  'rows', (SELECT coalesce(json_agg(to_jsonb(f) - 'raw_json' ORDER BY f.report_date), '[]'::json)
             FROM (SELECT institution_id, report_date::text AS report_date, source, total_assets, total_deposits, total_loans,
                          service_charge_income, other_noninterest_income, net_interest_margin, efficiency_ratio, roa, roe,
                          tier1_capital_ratio, branch_count, employee_count, member_count, total_revenue, fee_income_ratio,
                          overdraft_revenue, nsf_revenue, net_income, net_interest_income, noninterest_expense, provision_for_losses,
                          net_charge_offs, noncurrent_loans, total_equity, loans_real_estate, loans_commercial, loans_consumer,
                          loans_agricultural, net_charge_off_rate, noncurrent_loan_rate, leverage_ratio, total_capital_ratio,
                          total_securities, loans_credit_card, loans_auto, core_deposits, brokered_deposits, uninsured_deposits,
                          fetched_at::text AS fetched_at
                     FROM institution_financial_records
                    WHERE institution_id = p.id AND source IN ('fdic', 'ncua') AND report_date >= '${safeFrom}') f)
)), '[]'::json)) AS found
FROM pick p WHERE p.filer_id IS NOT NULL`;
}
