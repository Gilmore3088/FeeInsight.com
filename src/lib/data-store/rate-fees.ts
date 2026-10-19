import type { FeeAudience, FeeTreatment } from "@/lib/fee-audience";
import { sql } from "./connection";
import { readerFeeConditions } from "../fee-conditions";
import { STATS_ROW_FILTER, STATS_SCHEDULE_KEYS, summarizeRates, type RateStatistics } from "./fee-stats";
import { formatRateFee, type RateFields } from "../percent-fees";
import { institutionDisplayName } from "@/lib/institution-display-name";

/**
 * Reads of percentage fees (published_fee_rate_catalog): fees stated as a rate, such as
 * "1.1% of the transaction". They are kept apart from published_fee_catalog, whose readers
 * treat amount as dollars, and are never pooled with dollar amounts.
 */

export interface RateFee extends RateFields {
  fee_audience?: FeeAudience;
  fee_treatment?: FeeTreatment;
  id: number;
  institution_id: number;
  fee_name: string;
  fee_category: string | null;
  frequency: string | null;
  conditions: string | null;
  source_url: string | null;
  rate_percent: number;
  /** "1.1% of the transaction", "3% of the advance ($10 minimum)". */
  rate_label: string;
  /** When the fee was published (ISO), where the reader selected it. */
  published_at?: string | null;
}

interface RateFeeDbRow extends RateFields {
  fee_audience?: FeeAudience;
  fee_treatment?: FeeTreatment;
  id: number | string;
  institution_id: number | string;
  fee_name: string;
  fee_category: string | null;
  frequency: string | null;
  conditions: string | null;
  source_url: string | null;
  /** The catalog's publish time (published_at), where the reader selects it. */
  created_at?: Date | string | null;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Turns catalog rows into display rows; a row without a usable rate is dropped. */
export function toRateFees(rows: RateFeeDbRow[]): RateFee[] {
  const fees: RateFee[] = [];
  for (const row of rows) {
    const label = formatRateFee(row);
    if (label == null) continue;
    fees.push({
      id: Number(row.id),
      institution_id: Number(row.institution_id),
      fee_name: String(row.fee_name),
      fee_category: row.fee_category ?? null,
      frequency: row.frequency ?? null,
      conditions: readerFeeConditions(row.conditions),
      source_url: row.source_url ?? null,
      fee_audience: row.fee_audience ?? "unknown",
      fee_treatment: row.fee_treatment ?? "unknown",
      amount_kind: row.amount_kind,
      rate_percent: Number(row.rate_percent),
      rate_min_amount: row.rate_min_amount == null ? null : Number(row.rate_min_amount),
      rate_max_amount: row.rate_max_amount == null ? null : Number(row.rate_max_amount),
      rate_basis: row.rate_basis ?? null,
      rate_label: label,
      ...("created_at" in row ? { published_at: isoOrNull(row.created_at) } : {}),
    });
  }
  return fees;
}

/** All audiences remain available for labeled institution display; comparisons opt in to consumer evidence. */
export async function getRateFeesByInstitution(institutionId: number, scope: "all" | "consumer" = "all"): Promise<RateFee[]> {
  const rows = await sql<RateFeeDbRow[]>`
    SELECT ef.id, ef.institution_id, ef.fee_name, ef.fee_category, ef.frequency, ef.conditions,
           ef.source_url, ef.amount_kind, ef.rate_percent, ef.rate_min_amount, ef.rate_max_amount,
           ef.rate_basis, ef.fee_audience, ef.fee_treatment, ef.created_at
      FROM published_fee_rate_catalog ef
     WHERE ef.institution_id = ${institutionId}
       AND ${sql.unsafe(scope === "consumer" ? STATS_ROW_FILTER : "TRUE")}
     ORDER BY ef.fee_category ASC NULLS LAST, ef.fee_name ASC
  `;
  return toRateFees(rows);
}

/**
 * National rate statistics for one category, under the stats contract: sourced rows only,
 * one value per institution, the same minimum sample as dollars.
 */
export async function getNationalRateStats(category: string): Promise<RateStatistics> {
  const rows = await sql.unsafe<Array<{
    institution_id: number | string;
    rate_percent: number | string | null;
    amount_kind: string | null;
    schedule_keys: string[] | null;
    schedule_group: string | null;
  }>>(
    `SELECT ef.institution_id, ef.rate_percent, ef.amount_kind, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_rate_catalog ef
      WHERE ef.fee_category = $1
        AND ${STATS_ROW_FILTER}`,
    [category],
  );
  return summarizeRates(rows);
}

export interface RateFeeListFilters {
  institution_id?: number | null;
  state_code?: string | null;
  fee_category?: string | null;
  charter_type?: string | null;
  /** Only rows published at or after this time (the catalog's created_at, which is published_at). */
  updated_since?: Date | null;
}

export interface RateFeeListRow extends RateFee {
  institution_name: string;
  state: string | null;
  charter_type: string | null;
}

interface RateFeeListDbRow extends RateFeeDbRow {
  institution_name: string | null;
  state_code: string | null;
  charter_type: string | null;
}

/** WHERE clause and parameters for listRateFees; values only ever travel as parameters. */
export function rateFeeListWhere(filters: RateFeeListFilters): { where: string; params: (string | number)[] } {
  // The same rows toRateFees keeps (a usable rate), so the count matches what pages hold.
  const conditions = ["ef.rate_percent > 0"];
  const params: (string | number)[] = [];
  const add = (sqlText: (n: number) => string, value: string | number) => {
    params.push(value);
    conditions.push(sqlText(params.length));
  };
  if (filters.institution_id != null) add((n) => `ef.institution_id = $${n}`, filters.institution_id);
  if (filters.state_code) add((n) => `ct.state_code = $${n}`, filters.state_code);
  if (filters.fee_category) add((n) => `ef.fee_category = $${n}`, filters.fee_category);
  if (filters.charter_type) add((n) => `ct.charter_type = $${n}`, filters.charter_type);
  if (filters.updated_since) add((n) => `ef.created_at >= $${n}::timestamptz`, filters.updated_since.toISOString());
  return { where: conditions.join(" AND "), params };
}

/**
 * Published rate fees across institutions, oldest publish first and then by fee id, so pages
 * stay stable. Every audience is listed, labeled as on an institution's own page; these rows
 * are never pooled with dollar amounts.
 */
export async function listRateFees(
  filters: RateFeeListFilters,
  page: { limit: number; offset: number },
): Promise<{ total: number; rows: RateFeeListRow[] }> {
  const { where, params } = rateFeeListWhere(filters);
  const [countRow] = await sql.unsafe<{ total: number | string }[]>(
    `SELECT COUNT(*) AS total
       FROM published_fee_rate_catalog ef
       JOIN institution_sources ct ON ct.id = ef.institution_id
      WHERE ${where}`,
    params,
  );
  const rows = await sql.unsafe<RateFeeListDbRow[]>(
    `SELECT ef.id, ef.institution_id, ct.institution_name, ct.state_code, ct.charter_type,
            ef.fee_name, ef.fee_category, ef.frequency, ef.conditions, ef.source_url,
            ef.amount_kind, ef.rate_percent, ef.rate_min_amount, ef.rate_max_amount, ef.rate_basis,
            ef.fee_audience, ef.fee_treatment, ef.created_at
       FROM published_fee_rate_catalog ef
       JOIN institution_sources ct ON ct.id = ef.institution_id
      WHERE ${where}
      ORDER BY ef.created_at ASC NULLS FIRST, ef.id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page.limit, page.offset],
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return {
    total: Number(countRow?.total ?? 0),
    rows: toRateFees(rows).map((fee) => {
      const row = byId.get(fee.id);
      return {
        ...fee,
        institution_name: institutionDisplayName(row?.institution_name ?? null) ?? `Institution ${fee.institution_id}`,
        state: row?.state_code ?? null,
        charter_type: row?.charter_type ?? null,
      };
    }),
  };
}
