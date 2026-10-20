import { ncuaCallMeasure } from "@/lib/data-catalog/ncua-call-measures";
import { MAX_COHORT_PERIODS, MAX_COHORT_REPORTERS, type CallCohortHistory } from "@/lib/data-catalog/call-cohort-history";
import { FFIEC_CALL_ITEMS } from "@/lib/regulatory/ffiec-call-items";
import { financialMeasureDefinition, financialSourceForCharter, validFinancialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import { filedPeerIncomeEvidenceResult } from "./filed-peer-evidence";
import type { AnswerToolEvidence } from "./written-answer-evidence";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const quarterEnd = (value: unknown): value is string => typeof value === "string" && /^20\d{2}-(?:03-31|06-30|09-30|12-31)$/.test(value);
const canonical = (value: unknown): unknown => Array.isArray(value) ? [...new Set(value.map((v) => JSON.stringify(canonical(v))))].sort()
  : record(value) ? Object.fromEntries(Object.entries(value as RecordValue).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;

export interface CallPeerHistoryObservation {
  measure: string;
  source: "ncua" | "ffiec";
  unit: "USD" | "count";
  period_basis: "ytd" | "point_in_time" | "standalone_quarter";
  period: string;
  median: number | null;
  values: number[];
}

export interface CallPeerHistoryEvidence {
  basis: CallCohortHistory["basis"];
  observed: boolean;
  catalog_observed: boolean;
  national_financial_observed: boolean;
  invalid: boolean;
  observations: CallPeerHistoryObservation[];
  /** Exact reporter-ID equality only; never economic-perimeter or merger comparability. */
  matching_reporter_ids: boolean;
}

/** Reconstruct only from observed catalog calls. No returned flag can authorize peer growth. */
export function callPeerHistoryEvidence(reads: readonly AnswerToolEvidence[], institutionId: number | null = null): CallPeerHistoryEvidence {
  const result: CallPeerHistoryEvidence = { basis: "period_cross_sections", observed: false, catalog_observed: false, national_financial_observed: false, invalid: false, observations: [], matching_reporter_ids: false };
  // A raw YTD read does not invalidate an independently validated quarterly median
  // supplied by another actual financial tool. It still supplies no population proof.
  for (const value of filedPeerIncomeEvidenceResult(reads, institutionId).observations) {
    if (value.peer_median_income_usd === null) continue;
    result.observations.push({ measure: value.source === "ncua" ? "call:acct_131" : "call:service_charges_deposits_ytd",
      source: value.source === "ncua" ? "ncua" : "ffiec", unit: "USD", period_basis: "standalone_quarter",
      period: value.report_date, median: value.peer_median_income_usd, values: [value.peer_median_income_usd] });
  }
  const profileIds = new Set(reads.filter((read) => read.toolName === "getInstitution").map((read) => record(read.input)?.id).filter(positiveId));
  const profileId = institutionId ?? (profileIds.size === 1 ? [...profileIds][0] : null);
  const profiles = new Map<string, CallPeerHistoryObservation | null>();
  for (const read of reads.slice(-40)) {
    const input = record(read.input); const output = record(read.output); const identity = record(output?.identity);
    const ranking = record(output?.peer_ranking); const comparison = ranking?.comparison;
    if (read.toolName !== "getInstitution" || !positiveId(profileId) || input?.id !== profileId || identity?.id !== profileId
      || !ranking || !validFinancialPeerComparison(comparison) || financialSourceForCharter(identity.charter_type) !== comparison.source
      || !quarterEnd(comparison.report_date) || comparison.reported_count < comparison.minimum_median_count || !finite(ranking.peer_median_sc)
      || (ranking.unit !== undefined && ranking.unit !== comparison.unit) || (ranking.units !== undefined && ranking.units !== comparison.unit)
      || (record(ranking.field_units)?.peer_median_sc !== undefined && record(ranking.field_units)?.peer_median_sc !== comparison.unit)) continue;
    const value = ranking.peer_median_sc * 1000;
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) continue;
    const observation: CallPeerHistoryObservation = { measure: comparison.source === "ncua" ? "call:acct_131" : "call:service_charges_deposits_ytd",
      source: comparison.source === "ncua" ? "ncua" : "ffiec", unit: "USD", period_basis: "standalone_quarter",
      period: comparison.report_date, median: value, values: [value] };
    const key = JSON.stringify([profileId, observation.source, observation.period]);
    if (!profiles.has(key)) profiles.set(key, observation);
    else if (JSON.stringify(profiles.get(key)) !== JSON.stringify(observation)) profiles.set(key, null);
  }
  if ([...profiles.values()].some((value) => value === null)) result.invalid = true;
  result.observations.push(...[...profiles.values()].filter((value): value is CallPeerHistoryObservation => value !== null));
  const groups = new Map<string, Array<{ period: string; ids: number[] | null }>>();
  let retained = 0;
  for (const read of reads.slice(-40)) {
    const input = record(read.input); const scope = record(input?.scope); const output = record(read.output);
    const financialTool = (read.toolName === "queryNationalData" && ["call_reports", "health", "derived"].includes(String(input?.source)))
      || (read.toolName === "queryFeeRevenueCorrelation" && ["peers", "institutions", "by_tier", "by_charter"].includes(String(input?.view)));
    if (financialTool) {
      result.observed = true;
      if (Array.isArray(output?.financial_groups)) for (const value of output.financial_groups) {
        const group = record(value); const source = group?.financial_source;
        if (source !== "fdic" && source !== "ncua") { result.invalid = true; continue; }
        const definition = financialMeasureDefinition(source); const supplied = record(group?.fee_income_definition);
        const valid = group?.source === source && group.charter_type === definition.charter_type
          && (input?.financial_source === undefined || input.financial_source === source)
          && supplied && ["source", "charter_type", "measure", "unit", "period_basis", "source_period_basis"].every((key) => supplied[key] === definition[key as keyof typeof definition]);
        if (!valid) { result.invalid = true; continue; }
        if (read.toolName === "queryNationalData" && input?.source === "call_reports") {
          result.national_financial_observed = true;
          const trend = record(group.trend);
          if (Array.isArray(trend?.quarters) && typeof group.units === "string" && /^(?:dollar amounts in thousands\b|thousands of dollars(?:$|[;,]))/i.test(group.units)) {
            for (const value of trend.quarters.slice(0, 40)) {
              const quarter = record(value); const match = typeof quarter?.quarter === "string" ? /^(20\d{2})-?Q([1-4])$/.exec(quarter.quarter) : null;
              if (!quarter || !match || !finite(quarter.total_service_charges)) continue;
              if ([group, trend, quarter].some((container) => (container.unit !== undefined && container.unit !== "thousands of dollars")
                || (record(container.field_units)?.total_service_charges !== undefined && record(container.field_units)?.total_service_charges !== "thousands of dollars"))
                || [trend, quarter].some((container) => container.units !== undefined && container.units !== "thousands of dollars")) { result.invalid = true; continue; }
              const amount = quarter.total_service_charges * 1000;
              if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER) continue;
              result.observations.push({ measure: source === "ncua" ? "call:acct_131" : "call:service_charges_deposits_ytd",
                source: source === "ncua" ? "ncua" : "ffiec", unit: "USD", period_basis: "standalone_quarter",
                period: `${match[1]}-${["03-31", "06-30", "09-30", "12-31"][Number(match[2]) - 1]}`, median: null, values: [amount] });
            }
          }
        }
      }
    }
    if (read.toolName !== "queryData" || !["peer_set", "state", "metro", "national"].includes(String(scope?.kind))
      || typeof input?.measure !== "string" || !input.measure.startsWith("call:")) continue;
    const key = input.measure.slice(5); const ncua = ncuaCallMeasure(key); const bank = FFIEC_CALL_ITEMS.find((item) => item.key === key);
    if (!ncua && !bank) continue;
    result.observed = true;
    result.catalog_observed = true;
    if (output?.ok !== true) continue;
    const source = ncua ? "ncua" : "ffiec";
    const unit = ncua?.unit ?? (bank!.unit === "count" ? "count" : "USD");
    const basis = ncua?.periodBasis ?? bank!.basis;
    if (output.measure !== input.measure || output.scope !== scope?.kind || !Array.isArray(output.rows)
      || (output.unit != null && output.unit !== unit)) { result.invalid = true; continue; }
    const metadata = record(output.measure_metadata);
    if (ncua && metadata && (metadata.source !== "ncua-extras" || metadata.unit !== unit || metadata.period_basis !== basis
      || (metadata.item_code !== undefined && metadata.item_code !== ncua.code))) { result.invalid = true; continue; }
    const history = record(record(output.peer_comparison)?.cohort_history);
    const periods = Array.isArray(history?.periods) && history.periods.length <= MAX_COHORT_PERIODS ? history.periods : [];
    const historyValid = history?.basis === "period_cross_sections" && history.growth_status === "not_established" && history.merger_adjusted === false
      && history.identity_basis === "current_registry_links_not_dated_identity" && history.eligibility_basis === "reported_curated_line"
      && history.periods_complete === true && !/\b(?:rows|periods):/i.test(String(output._shortened ?? ""));
    for (const value of output.rows.slice(0, 200)) {
      if (++retained > 200) { result.invalid = true; break; }
      const row = record(value);
      if (!row) continue;
      const sources = typeof row.sources === "string" ? row.sources.split(/[\s,/]+/).filter(Boolean) : [];
      // Older/incomplete shapes can support a refusal, never a typed historical figure.
      if (row.unit === undefined || row.period_basis === undefined || sources.length === 0) continue;
      if (row.unit !== unit || row.period_basis !== basis || sources.length !== 1 || sources[0] !== source) { result.invalid = true; continue; }
      if ([row, output].some((container) => (container.units !== undefined && container.units !== unit)
        || ["median", "p25", "p75"].some((field) => Object.hasOwn(record(container.field_units) ?? {}, field)
          && record(container.field_units)?.[field] !== unit))) { result.invalid = true; continue; }
      if (!quarterEnd(row.period)) { result.invalid = true; continue; }
      const values = [row.median, row.p25, row.p75].filter(finite);
      result.observations.push({ measure: input.measure, source, unit, period_basis: basis, period: row.period,
        median: finite(row.median) ? row.median : null, values });
      const matches = periods.map(record).filter((period) => period !== null && period.period === row.period && period.source === source
        && period.unit === unit && period.period_basis === basis);
      const period = matches.length === 1 ? matches[0] : null;
      const ids = period?.reporting_institution_ids;
      const complete = historyValid && period?.reporter_ids_complete === true && Array.isArray(ids) && ids.length <= MAX_COHORT_REPORTERS
        && ids.every(positiveId) && new Set(ids).size === ids.length && ids.length === row.institution_count
        && period.reported_count === row.institution_count && row.reported_count === row.institution_count;
      const groupKey = JSON.stringify([input.measure, source, unit, basis, canonical(scope)]);
      const previous = groups.get(groupKey) ?? [];
      previous.push({ period: row.period, ids: complete ? [...ids as number[]].sort((a, b) => a - b) : null });
      groups.set(groupKey, previous);
    }
  }
  if (result.observed && reads.length > 40) result.invalid = true;
  // Repeated single-period reads cannot establish a historical population either.
  result.matching_reporter_ids = !result.invalid && groups.size > 0 && [...groups.values()].every((rows) => new Set(rows.map((row) => row.period)).size >= 2
    && rows.every(({ ids }) => ids !== null && JSON.stringify(ids) === JSON.stringify(rows[0].ids)));
  return result;
}
