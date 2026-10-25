import { ncuaCallMeasure } from "@/lib/data-catalog/ncua-call-measures";

/** Only the six curated, institution-level NCUA filing lines can enter these calculations. */
export interface NcuaDerivationInput {
  institution_id: number;
  measure: string;
  item_code: string;
  report_date: string;
  period_basis: "point_in_time" | "ytd";
  value: number;
  unit: "USD" | "count";
  source: "ncua";
  publisher: string;
  source_url: string;
  fetched_at: string | null;
}

export interface NcuaAnswerDerivation {
  id: string;
  institution_id: number;
  measure: string;
  metric: string;
  value: number;
  unit: "USD" | "count" | "percent";
  /** A ratio is a separate quantity: USD/account never establishes a total dollar figure. */
  denominator_unit?: "account" | "employee";
  period_start: string;
  report_date: string;
  baseline_report_date?: string;
  period_basis: "point_in_time" | "ytd" | "standalone_quarter";
  operation: "ytd_to_quarter" | "q1_ytd_as_quarter" | "difference" | "percent_change" | "ratio";
  comparison?: "quarter_over_quarter" | "year_over_year";
  source: "ncua";
  publisher: string;
  expression: string;
  inputs: NcuaDerivationInput[];
  caveat: string;
}

export interface NcuaDerivationRead { input?: unknown; output: unknown }
export interface NcuaAnswerDerivationEvidence { derivations: NcuaAnswerDerivation[]; limitations: string[] }

/** Bounded to the tool's current result cap and a small conversation, never an unbounded pair search. */
export const MAX_NCUA_DERIVATION_READS = 40;
export const MAX_NCUA_ANSWER_DERIVATIONS = 160;
const MAX_ROWS_PER_READ = 200;
const QUARTER_END = /^(\d{4})-(03-31|06-30|09-30|12-31)$/;
const LIMITATIONS = [
  "Derived figures retain their institution, reporting period and NCUA item definitions; they do not establish causes or effects of fee pricing.",
  "Share-draft accounts are not members or customers; full-time employees are headcount under NCUA's 26-hour rule, not FTEs; share dividends are expense, not evidence of cash paid.",
  "No peer-median differences, ratios of medians or peer growth are derived. Historical peer growth requires reviewed membership plus comparable economic perimeter and lifecycle/merger treatment; identical charter IDs alone establish neither. These results do not establish that basis.",
];

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function quarter(date: string): { year: number; index: number } | null {
  const match = QUARTER_END.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1900 || year > 2200) return null;
  return { year, index: ["03-31", "06-30", "09-30", "12-31"].indexOf(match[2]) };
}

function quarterDate(year: number, index: number): string {
  return `${year}-${["03-31", "06-30", "09-30", "12-31"][index]}`;
}

function periodStart(date: string, basis: NcuaAnswerDerivation["period_basis"]): string {
  const q = quarter(date)!;
  if (basis === "point_in_time") return date;
  return `${q.year}-${basis === "ytd" ? "01" : String(q.index * 3 + 1).padStart(2, "0")}-01`;
}

function ncuaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["ncua.gov", "www.ncua.gov"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

const factKey = (fact: NcuaDerivationInput) => `${fact.institution_id}:${fact.measure}:${fact.report_date}`;

/** Conflicting duplicate filings suppress that date; a later read never silently wins. Also the claim facts' reader (claim-evidence.ts). */
export function ncuaFilingInputs(reads: readonly NcuaDerivationRead[]): NcuaDerivationInput[] {
  const facts = new Map<string, NcuaDerivationInput>();
  const conflicts = new Set<string>();
  for (const read of reads.slice(-MAX_NCUA_DERIVATION_READS)) {
    const input = record(read.input);
    const scope = record(input?.scope);
    const output = record(read.output);
    if (!input || scope?.kind !== "institution" || output?.ok !== true || output.scope !== "institution") continue;
    if (typeof scope.id !== "string" || !/^\d{1,10}$/.test(scope.id)) continue;
    const institutionId = Number(scope.id);
    if (!Number.isSafeInteger(institutionId) || institutionId <= 0 || input.measure !== output.measure || typeof output.measure !== "string") continue;
    const measure = ncuaCallMeasure(output.measure.replace(/^call:/, ""));
    if (!measure || output.measure !== `call:${measure.key}` || output.unit !== measure.unit) continue;
    const metadata = record(output.measure_metadata);
    const citation = record(output.citation);
    if (metadata?.item_code !== measure.code || metadata.source !== "ncua-extras" || metadata.unit !== measure.unit || metadata.period_basis !== measure.periodBasis) continue;
    if (typeof metadata.publisher !== "string" || !metadata.publisher.includes("NCUA") || citation?.publisher !== metadata.publisher) continue;
    if (!Array.isArray(output.rows)) continue;
    for (const candidate of output.rows.slice(0, MAX_ROWS_PER_READ)) {
      const row = record(candidate);
      if (!row || row.institution_id !== institutionId || row.source !== "ncua" || row.item_code !== measure.code || row.unit !== measure.unit || row.period_basis !== measure.periodBasis) continue;
      if (typeof row.period !== "string" || !quarter(row.period) || !finite(row.value) || row.value < 0) continue;
      if (measure.unit === "count" && !Number.isSafeInteger(row.value)) continue;
      // Each historical input keeps its own filing URL, never the newest row's top-level citation.
      if (!ncuaUrl(row.source_url)) continue;
      const fact: NcuaDerivationInput = {
        institution_id: institutionId, measure: output.measure, item_code: measure.code,
        report_date: row.period, period_basis: measure.periodBasis, value: row.value, unit: measure.unit,
        source: "ncua", publisher: metadata.publisher, source_url: row.source_url,
        fetched_at: typeof row.fetched_at === "string" ? row.fetched_at : null,
      };
      const key = factKey(fact);
      const previous = facts.get(key);
      if (previous && (previous.value !== fact.value || previous.unit !== fact.unit || previous.period_basis !== fact.period_basis)) conflicts.add(key);
      else facts.set(key, fact);
    }
  }
  return [...facts.entries()].filter(([key]) => !conflicts.has(key)).map(([, fact]) => fact);
}

type Calculation = Pick<NcuaAnswerDerivation, "value" | "unit" | "period_start" | "report_date" | "period_basis" | "expression" | "inputs">;

function result(base: NcuaDerivationInput, calculation: Calculation, detail: Pick<NcuaAnswerDerivation, "metric" | "operation" | "caveat"> & Partial<Pick<NcuaAnswerDerivation, "denominator_unit" | "comparison" | "baseline_report_date">>): NcuaAnswerDerivation {
  return {
    id: `ncua:${base.institution_id}:${base.measure}:${calculation.report_date}:${calculation.period_basis}:${detail.operation}:${detail.comparison ?? detail.denominator_unit ?? ""}`,
    institution_id: base.institution_id, measure: base.measure, source: "ncua", publisher: base.publisher,
    ...calculation, ...detail,
  };
}

function rawCalculation(fact: NcuaDerivationInput): Calculation {
  return { value: fact.value, unit: fact.unit, period_start: periodStart(fact.report_date, fact.period_basis), report_date: fact.report_date,
    period_basis: fact.period_basis, expression: String(fact.value), inputs: [fact] };
}

/** Build only semantically allowed calculations from actual queryData calls, never from pooled numbers or prose. */
export function deriveNcuaAnswerEvidence(reads: readonly NcuaDerivationRead[]): NcuaAnswerDerivationEvidence {
  const facts = ncuaFilingInputs(reads);
  const byKey = new Map(facts.map((fact) => [factKey(fact), fact]));
  const derived: NcuaAnswerDerivation[] = [];
  const quarters = new Map<string, Calculation>();
  for (const fact of facts) {
    if (fact.period_basis !== "ytd") continue;
    const q = quarter(fact.report_date)!;
    const prior = q.index > 0 ? byKey.get(`${fact.institution_id}:${fact.measure}:${quarterDate(q.year, q.index - 1)}`) : null;
    if (q.index > 0 && !prior) continue;
    const value = fact.value - (prior?.value ?? 0);
    // A decreasing cumulative line may be a restatement; it is not safely a negative quarter.
    if (!Number.isFinite(value) || value < 0) continue;
    const calc: Calculation = { value, unit: fact.unit, period_start: periodStart(fact.report_date, "standalone_quarter"),
      report_date: fact.report_date, period_basis: "standalone_quarter",
      expression: prior ? `(${fact.value} - ${prior.value})` : String(fact.value), inputs: prior ? [fact, prior] : [fact] };
    quarters.set(factKey(fact), calc);
    derived.push(result(fact, calc, { metric: `${ncuaCallMeasure(fact.measure.slice(5))!.name}, standalone quarter`,
      operation: prior ? "ytd_to_quarter" : "q1_ytd_as_quarter",
      caveat: "Calculated from the institution's NCUA year-to-date filings, not a separately filed quarterly line; no annualization or cause of change is established." }));
  }

  for (const fact of facts) {
    const q = quarter(fact.report_date)!;
    const sameQuarterPriorYear = quarterDate(q.year - 1, q.index);
    const previousQuarter = q.index > 0 ? quarterDate(q.year, q.index - 1) : quarterDate(q.year - 1, 3);
    const variants: Calculation[] = [rawCalculation(fact), ...(quarters.has(factKey(fact)) ? [quarters.get(factKey(fact))!] : [])];
    for (const current of variants) {
      const comparisons = current.period_basis === "ytd"
        ? [["year_over_year", sameQuarterPriorYear]] as const
        : [["year_over_year", sameQuarterPriorYear], ["quarter_over_quarter", previousQuarter]] as const;
      for (const [comparison, date] of comparisons) {
        const priorFact = byKey.get(`${fact.institution_id}:${fact.measure}:${date}`);
        if (!priorFact) continue;
        const prior = current.period_basis === "standalone_quarter" ? quarters.get(factKey(priorFact)) : rawCalculation(priorFact);
        if (!prior || prior.unit !== current.unit || prior.period_basis !== current.period_basis) continue;
        const inputs = [...new Map([...current.inputs, ...prior.inputs].map((input) => [factKey(input), input])).values()];
        const delta = current.value - prior.value;
        if (!Number.isFinite(delta)) continue;
        const expression = `(${current.expression} - ${prior.expression})`;
        const detail = { metric: `${ncuaCallMeasure(fact.measure.slice(5))!.name}, ${comparison.replaceAll("_", " ")} change`,
          comparison, baseline_report_date: prior.report_date,
          caveat: "A change in the same institution's comparable filing metric; it does not identify pricing, customer growth or any cause of the change." };
        derived.push(result(fact, { ...current, value: delta, expression, inputs }, { ...detail, operation: "difference" }));
        if (prior.value > 0) {
          const pct = delta / prior.value * 100;
          if (Number.isFinite(pct)) derived.push(result(fact, { ...current, value: pct, unit: "percent", expression: `(${expression} / ${prior.expression} * 100)`, inputs }, { ...detail, operation: "percent_change" }));
        }
      }
    }
    const denominatorMeasure = fact.measure === "call:acct_902" ? "call:acct_452" : fact.measure === "call:acct_452" ? "call:acct_564a" : null;
    if (!denominatorMeasure || fact.period_basis !== "point_in_time") continue;
    const denominator = byKey.get(`${fact.institution_id}:${denominatorMeasure}:${fact.report_date}`);
    if (!denominator || denominator.period_basis !== "point_in_time" || denominator.unit !== "count" || denominator.value <= 0) continue;
    const value = fact.value / denominator.value;
    if (!Number.isFinite(value)) continue;
    const balanceRatio = fact.measure === "call:acct_902";
    derived.push(result(fact, { ...rawCalculation(fact), value, expression: `(${fact.value} / ${denominator.value})`, inputs: [fact, denominator] }, {
      metric: balanceRatio ? "Share-draft balance per share-draft account" : "Share-draft accounts per full-time employee",
      operation: "ratio", denominator_unit: balanceRatio ? "account" : "employee",
      caveat: balanceRatio ? "A quarter-end balance/account ratio, not a member balance, fee price or average over the quarter."
        : "A quarter-end accounts/headcount ratio, not members per employee, employee productivity or FTE workload.",
    }));
  }
  const derivations = derived.sort((a, b) => b.report_date.localeCompare(a.report_date) || a.id.localeCompare(b.id)).slice(0, MAX_NCUA_ANSWER_DERIVATIONS);
  return { derivations, limitations: derivations.length ? [...LIMITATIONS] : [] };
}

/** Same evidence contract for a single queryData result and for a conversation's accumulated reads. */
export function deriveNcuaQueryResult(input: unknown, output: unknown): NcuaAnswerDerivationEvidence {
  return deriveNcuaAnswerEvidence([{ input, output }]);
}
