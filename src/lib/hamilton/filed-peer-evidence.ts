import { financialMeasureDefinition, financialSourceForCharter } from "@/lib/data-store/financial-peer-contract";
import type { AnswerToolEvidence } from "./written-answer-evidence";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const monetaryUnit = "thousands of dollars";
const intensityUnit = "USD income per 10,000 USD assets";
const quarterEnd = (value: unknown): value is string => typeof value === "string" && /^20\d{2}-(?:03-31|06-30|09-30|12-31)$/.test(value);
const monetaryFieldsMatch = (value: RecordValue, field: string) =>
  (!Object.hasOwn(value, "unit") || value.unit === monetaryUnit)
  && (!Object.hasOwn(value, "period_basis") || value.period_basis === "standalone_quarter")
  && (!Object.hasOwn(record(value.field_units) ?? {}, field) || record(value.field_units)?.[field] === monetaryUnit);

function sameFilters(input: RecordValue, filters: RecordValue): boolean {
  if (Object.keys(filters).some((key) => !["institutionIds", "states", "assetTiers", "fedDistricts", "charterType"].includes(key))) return false;
  const arrays = [
    ["peer_institution_ids", "institutionIds"], ["states", "states"],
    ["asset_tiers", "assetTiers"], ["fed_districts", "fedDistricts"],
  ];
  for (const [inputKey, outputKey] of arrays) {
    const before = input[inputKey] ?? [];
    const after = filters[outputKey] ?? [];
    if (!Array.isArray(before) || !Array.isArray(after)) return false;
    const valid = (value: unknown) => outputKey === "institutionIds" ? positiveId(value)
      : outputKey === "fedDistricts" ? Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 12
        : typeof value === "string" && (outputKey !== "states" || value.length === 2);
    if (!before.every(valid) || !after.every(valid)) return false;
    const normalized = (values: unknown[]) => [...new Set(values.map((value) => outputKey === "states" ? String(value).toUpperCase() : String(value)))].sort();
    if (JSON.stringify(normalized(before)) !== JSON.stringify(normalized(after))) return false;
  }
  return (input.charter_type ?? null) === (filters.charterType ?? null);
}

/** Dated observations from a server-observed filing-only peer tool, not a fabricated raw filing. */
export interface FiledPeerIncomeEvidence {
  institution_id: number;
  source: "fdic" | "ncua";
  report_date: string;
  subject_income_usd: number;
  peer_median_income_usd: number | null;
  peer_count: number;
  minimum_median_count: number;
}

/** Never accept a tool-output-shaped object without the actual observed read and selected identity. */
export function filedPeerIncomeEvidence(reads: readonly AnswerToolEvidence[], institutionId: number | null): FiledPeerIncomeEvidence[] {
  if (institutionId !== null && !positiveId(institutionId)) return [];
  if (institutionId === null) {
    // A named institution can arrive through the observed tool without a selected
    // workspace. Multiple peer-tool subjects do not choose a subject for the reader.
    const ids = new Set(reads.filter((read) => read.toolName === "queryFeeRevenueCorrelation")
      .map((read) => record(read.input)).filter((input) => input?.view === "peers")
      .map((input) => input?.institution_id).filter(positiveId));
    if (ids.size !== 1) return [];
    institutionId = [...ids][0];
  }
  const observations = new Map<string, FiledPeerIncomeEvidence | null>();
  const sources = new Set<string>();
  const subjectValues = new Map<string, Set<number>>();
  for (const read of reads) {
    if (read.toolName !== "queryFeeRevenueCorrelation") continue;
    const input = record(read.input);
    const output = record(read.output);
    const subject = record(output?.subject);
    const comparison = record(output?.comparison);
    const filters = record(comparison?.filters);
    const source = financialSourceForCharter(subject?.charter_type);
    if (input?.view !== "peers" || input.institution_id !== institutionId
      || output?.view !== "peers" || subject?.institution_id !== institutionId || !source || !comparison || !filters) continue;
    const definition = financialMeasureDefinition(source);
    if (input.financial_source !== undefined && input.financial_source !== source) continue;
    if (input.charter_type !== undefined && financialSourceForCharter(input.charter_type) !== source) continue;
    if (!sameFilters(input, filters) || output.source !== source || subject.source !== source || subject.financial_source !== source
      || comparison.source !== source || comparison.financial_source !== source || comparison.charter_type !== subject.charter_type
      || comparison.measure !== definition.measure || comparison.source_period_basis !== definition.source_period_basis
      || comparison.period_basis !== "standalone_quarter" || comparison.unit !== monetaryUnit
      || output.units !== monetaryUnit || subject.units !== monetaryUnit || comparison.income_unit !== monetaryUnit
      || !monetaryFieldsMatch(output, "peer_median_service_charge_income") || !monetaryFieldsMatch(subject, "service_charge_income")
      || comparison.ratio_unit !== intensityUnit || record(output.field_units)?.peer_median_income_per_10k_assets !== intensityUnit
      || record(subject.field_units)?.income_per_10k_assets !== intensityUnit
      || !quarterEnd(comparison.report_date) || output.quarter !== comparison.report_date || subject.report_date !== comparison.report_date
      || comparison.population_basis !== "filed_financials" || comparison.fee_schedule_coverage_required !== false
      || comparison.subject_included !== false || !Number.isSafeInteger(comparison.sample_size) || Number(comparison.sample_size) < 0
      || output.peer_count !== comparison.sample_size || !Number.isSafeInteger(comparison.minimum_median_count)
      || Number(comparison.minimum_median_count) < 5 || !finite(subject.service_charge_income)) continue;
    const peerCount = Number(output.peer_count);
    const rows = output.peers;
    if (!Array.isArray(rows) || rows.length > peerCount || (peerCount > 0 && rows.length === 0)) continue;
    const peerIds = new Set<number>();
    const validRows = rows.every((value) => {
      const peer = record(value);
      if (!peer || !positiveId(peer.institution_id) || peer.institution_id === institutionId || peerIds.has(peer.institution_id)
        || peer.source !== source || peer.financial_source !== source || financialSourceForCharter(peer.charter_type) !== source
        || peer.report_date !== comparison.report_date || peer.units !== monetaryUnit
        || !monetaryFieldsMatch(peer, "service_charge_income")
        || record(peer.field_units)?.income_per_10k_assets !== intensityUnit || !finite(peer.service_charge_income)
        || !finite(peer.total_assets) || peer.total_assets <= 0 || !finite(peer.income_per_10k_assets)) return false;
      peerIds.add(peer.institution_id);
      return true;
    });
    if (!validRows || (peerCount <= 15 && !output._shortened && rows.length !== peerCount)) continue;
    const enough = peerCount >= Number(comparison.minimum_median_count);
    if (enough ? !finite(output.peer_median_service_charge_income) : output.peer_median_service_charge_income !== null) continue;
    const subjectUsd = subject.service_charge_income * 1000;
    const medianUsd = enough ? Number(output.peer_median_service_charge_income) * 1000 : null;
    if (!Number.isFinite(subjectUsd) || Math.abs(subjectUsd) > Number.MAX_SAFE_INTEGER
      || (medianUsd !== null && (!Number.isFinite(medianUsd) || Math.abs(medianUsd) > Number.MAX_SAFE_INTEGER))) continue;
    const observation: FiledPeerIncomeEvidence = {
      institution_id: institutionId, source, report_date: comparison.report_date,
      subject_income_usd: subjectUsd, peer_median_income_usd: medianUsd,
      peer_count: peerCount, minimum_median_count: Number(comparison.minimum_median_count),
    };
    sources.add(source);
    const values = subjectValues.get(observation.report_date) ?? new Set<number>();
    values.add(subjectUsd);
    subjectValues.set(observation.report_date, values);
    const key = JSON.stringify([source, comparison.report_date, filters]);
    if (!observations.has(key)) observations.set(key, observation);
    else if (JSON.stringify(observations.get(key)) !== JSON.stringify(observation)) observations.set(key, null);
  }
  const retained = [...observations.values()].filter((value): value is FiledPeerIncomeEvidence => value !== null);
  if (sources.size > 1) return [];
  return retained.filter((value) => subjectValues.get(value.report_date)?.size === 1);
}
