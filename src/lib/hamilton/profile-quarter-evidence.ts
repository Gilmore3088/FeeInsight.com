import type { AnswerToolEvidence } from "./written-answer-evidence";
import { dollarUnitScale } from "./monetary-units";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const ends = ["03-31", "06-30", "09-30", "12-31"];
const ownUnit = (value: RecordValue, inherited?: unknown) => Object.hasOwn(value, "unit") ? value.unit
  : Object.hasOwn(value, "units") ? value.units : inherited;
const monetaryScale = (value: RecordValue, inherited?: unknown) => {
  const fields = record(value.field_units);
  const unit = typeof fields?.service_charge_income === "string" ? fields.service_charge_income : ownUnit(value, inherited);
  return dollarUnitScale(unit);
};

export interface ProfileQuarterCalculation {
  id: string;
  institution_id: number;
  measure: "broad_credit_union_fee_income";
  metric: "Fee income, standalone quarter";
  value: number;
  unit: "USD";
  source: "ncua";
  publisher: string;
  source_kind: "canonical regulatory institution profile";
  period_basis: "standalone_quarter";
  operation: "ytd_to_quarter";
  report_date: string;
  period_start: string;
  expression: string;
  inputs: { institution_id: number; report_date: string; value: number; unit: "USD"; source: "ncua" }[];
  caveat: string;
}

/** Recompute only the profile's explicitly defined, same-institution NCUA quarter.
 * These rounded aggregate records have their own provenance; they are not raw filing rows. */
export function profileQuarterCalculations(reads: readonly AnswerToolEvidence[]): ProfileQuarterCalculation[] {
  const found = new Map<string, ProfileQuarterCalculation>();
  const conflicts = new Set<string>();
  const seenTotals = new Map<string, number>();
  const conflictingTotals = new Set<string>();
  for (const read of reads.slice(-40)) {
    if (read.toolName !== "getInstitution") continue;
    const input = record(read.input);
    const output = record(read.output);
    const identity = record(output?.identity);
    const id = number(input?.id);
    if (!id || !Number.isSafeInteger(id) || identity?.id !== id || identity.charter_type !== "credit_union") continue;
    const financials = record(output?.financials);
    const definition = record(financials?.definition);
    const trendDefinition = record(output?.revenue_trend_definition);
    if (definition?.source !== "ncua" || definition.charter_type !== "credit_union" || definition.measure !== "broad_credit_union_fee_income" || definition.unit !== "thousands of dollars"
      || definition.period_basis !== "year_to_date" || trendDefinition?.source !== "ncua" || trendDefinition.measure !== definition.measure
      || typeof definition.publisher !== "string" || !definition.publisher.includes("NCUA") || trendDefinition.charter_type !== "credit_union"
      || trendDefinition.unit !== definition.unit || trendDefinition.period_basis !== "standalone_quarter"
      || !Array.isArray(financials?.records) || !Array.isArray(output?.revenue_trend)) continue;
    const totals = new Map<string, number>();
    const conflictingDates = new Set<string>();
    for (const raw of [financials.latest, ...financials.records.slice(0, 8)]) {
      const row = record(raw);
      if (row?.institution_id !== id || row.source !== "ncua" || typeof row.report_date !== "string"
        || !/^20\d{2}-(?:03-31|06-30|09-30|12-31)$/.test(row.report_date)) continue;
      const value = number(row.service_charge_income);
      const key = `${id}:${row.report_date}`;
      if (value === null || !Number.isSafeInteger(value * 1000) || monetaryScale(row, ownUnit(financials)) !== 1000) {
        conflictingDates.add(row.report_date); conflictingTotals.add(key); continue;
      }
      if (totals.has(row.report_date) && totals.get(row.report_date) !== value) conflictingDates.add(row.report_date);
      else totals.set(row.report_date, value);
      if (seenTotals.has(key) && seenTotals.get(key) !== value) conflictingTotals.add(key);
      else seenTotals.set(key, value);
    }
    for (const date of conflictingDates) totals.delete(date);
    for (const raw of output.revenue_trend.slice(0, 8)) {
      const row = record(raw);
      const match = typeof row?.quarter === "string" ? /^(20\d{2})-?Q([2-4])$/.exec(row.quarter) : null;
      if (!match || row?.source !== "ncua") continue;
      const index = Number(match[2]) - 1;
      const date = `${match[1]}-${ends[index]}`;
      const priorDate = `${match[1]}-${ends[index - 1]}`;
      const current = totals.get(date);
      const prior = totals.get(priorDate);
      const quarter = number(row.service_charge_income);
      if (quarter === null || !Number.isSafeInteger(quarter * 1000) || monetaryScale(row) !== 1000
        || (current !== undefined && prior !== undefined && current - prior !== quarter)) {
        conflictingTotals.add(`${id}:${date}`); continue;
      }
      if (current === undefined || prior === undefined) continue;
      const calculation: ProfileQuarterCalculation = {
        id: `ncua-profile:${id}:service_charge_income:${date}:ytd_to_quarter`, institution_id: id,
        measure: "broad_credit_union_fee_income", metric: "Fee income, standalone quarter", value: quarter * 1000,
        unit: "USD", source: "ncua", publisher: String(definition.publisher), source_kind: "canonical regulatory institution profile",
        period_basis: "standalone_quarter", operation: "ytd_to_quarter", report_date: date,
        period_start: `${match[1]}-${String(index * 3 + 1).padStart(2, "0")}-01`, expression: `(${current * 1000} - ${prior * 1000})`,
        inputs: [{ institution_id: id, report_date: date, value: current * 1000, unit: "USD", source: "ncua" },
          { institution_id: id, report_date: priorDate, value: prior * 1000, unit: "USD", source: "ncua" }],
        caveat: "Computed from the same institution's NCUA profile records, rounded to thousands of dollars; not a separately filed quarterly line.",
      };
      const previous = found.get(calculation.id);
      if (previous && previous.expression !== calculation.expression) conflicts.add(calculation.id);
      else found.set(calculation.id, calculation);
    }
  }
  return [...found.values()].filter((calculation) => !conflicts.has(calculation.id)
    && calculation.inputs.every((input) => !conflictingTotals.has(`${input.institution_id}:${input.report_date}`)));
}
