import { computePercentile, computeStats } from "./fees";

/**
 * The statistics contract: the one set of rules every fee index, summary and
 * breakdown follows. Pure and tested; data-store readers feed it rows from
 * `published_fee_catalog` and never compute medians their own way.
 *
 *   1. One value per institution per category: each bank counts once, at the median
 *      of the amounts it lists for that fee (so tiered or reduced variants neither
 *      dominate nor disappear).
 *   2. $0 counts. A free fee is a real price; null and negative amounts are dropped.
 *   3. Provenance is explicit. A row is "sourced" when it traces to a stored source
 *      document (`source_document_id`). A category whose sourced institutions reach
 *      SOURCED_SWITCH_INSTITUTIONS is computed from sourced values only (basis
 *      "sourced"); below that it uses everything and says so (basis "blended").
 *   4. No median below MIN_INSTITUTIONS institutions, only counts.
 */

export const MIN_INSTITUTIONS = 5;
export const STRONG_INSTITUTIONS = 20;
/** Sourced institutions needed before a category is computed from sourced data only. */
export const SOURCED_SWITCH_INSTITUTIONS = 20;
/** Bump when these rules change; cached and stored statistics carry it. */
export const STATS_METHOD_VERSION = 2;

export type StatsBasis = "sourced" | "blended";
export type StatsMaturity = "strong" | "provisional" | "insufficient";

export interface ContractRow {
  institution_id: number | string;
  amount: number | string | null;
  /** True when the row traces to a stored source document. */
  sourced: boolean;
  charter_type?: string | null;
}

export interface InstitutionValue {
  institutionId: number;
  amount: number;
  sourced: boolean;
  charterType: string | null;
}

export interface CategoryStats {
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  institution_count: number;
  sourced_institution_count: number;
  legacy_institution_count: number;
  bank_count: number;
  cu_count: number;
  basis: StatsBasis;
  maturity: StatsMaturity;
  stats_method_version: number;
}

/** A row traces to a source document (the SQL twin is `source_document_id IS NOT NULL`). */
export function isSourcedRow(row: { source_document_id?: unknown }): boolean {
  return row.source_document_id != null;
}

/** One value per institution: the median of its non-negative amounts; sourced if any row is. */
export function institutionValues(rows: ContractRow[]): InstitutionValue[] {
  const byInstitution = new Map<number, { amounts: number[]; sourced: boolean; charterType: string | null }>();
  for (const row of rows) {
    if (row.amount == null || row.amount === "") continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const institutionId = Number(row.institution_id);
    const current = byInstitution.get(institutionId) ?? { amounts: [], sourced: false, charterType: row.charter_type ?? null };
    current.amounts.push(amount);
    current.sourced = current.sourced || row.sourced;
    byInstitution.set(institutionId, current);
  }
  return [...byInstitution.entries()].map(([institutionId, value]) => ({
    institutionId,
    amount: Math.round(computePercentile([...value.amounts].sort((a, b) => a - b), 50) * 100) / 100,
    sourced: value.sourced,
    charterType: value.charterType,
  }));
}

export function maturityFor(institutionCount: number): StatsMaturity {
  if (institutionCount >= STRONG_INSTITUTIONS) return "strong";
  if (institutionCount >= MIN_INSTITUTIONS) return "provisional";
  return "insufficient";
}

/** Statistics for one category (or one slice of it) under the contract. */
export function categoryStats(rows: ContractRow[]): CategoryStats {
  const all = institutionValues(rows);
  const sourced = all.filter((value) => value.sourced);
  const basis: StatsBasis = sourced.length >= SOURCED_SWITCH_INSTITUTIONS ? "sourced" : "blended";
  const used = basis === "sourced" ? sourced : all;
  const maturity = maturityFor(used.length);
  const stats = computeStats(used.map((value) => value.amount));
  const enough = maturity !== "insufficient";
  return {
    median: enough ? stats.median : null,
    p25: enough ? stats.p25 : null,
    p75: enough ? stats.p75 : null,
    min: stats.min,
    max: stats.max,
    avg: enough ? stats.avg : null,
    institution_count: used.length,
    sourced_institution_count: sourced.length,
    legacy_institution_count: all.length - sourced.length,
    bank_count: used.filter((value) => value.charterType === "bank").length,
    cu_count: used.filter((value) => value.charterType !== "bank").length,
    basis,
    maturity,
    stats_method_version: STATS_METHOD_VERSION,
  };
}
