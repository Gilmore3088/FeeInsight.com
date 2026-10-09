import type { FeeAudience, FeeTreatment } from "@/lib/fee-audience";
import { sql } from "./connection";
import { readerFeeConditions } from "../fee-conditions";
import { STATS_ROW_FILTER, summarizeRates, type RateStatistics } from "./fee-stats";
import { formatRateFee, type RateFields } from "../percent-fees";

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
    });
  }
  return fees;
}

/** The live percentage fees of one institution. */
export async function getRateFeesByInstitution(institutionId: number): Promise<RateFee[]> {
  const rows = await sql<RateFeeDbRow[]>`
    SELECT ef.id, ef.institution_id, ef.fee_name, ef.fee_category, ef.frequency, ef.conditions,
           ef.source_url, ef.amount_kind, ef.rate_percent, ef.rate_min_amount, ef.rate_max_amount,
           ef.rate_basis, ef.fee_audience, ef.fee_treatment
      FROM published_fee_rate_catalog ef
     WHERE ef.institution_id = ${institutionId}
     ORDER BY ef.fee_category ASC NULLS LAST, ef.fee_name ASC
  `;
  return toRateFees(rows);
}

/**
 * National rate statistics for one category, under the stats contract: sourced rows only,
 * one value per institution, the same minimum sample as dollars.
 */
export async function getNationalRateStats(category: string): Promise<RateStatistics> {
  const rows = await sql.unsafe<Array<{ institution_id: number | string; rate_percent: number | string | null; amount_kind: string | null }>>(
    `SELECT ef.institution_id, ef.rate_percent, ef.amount_kind
       FROM published_fee_rate_catalog ef
      WHERE ef.fee_category = $1
        AND ${STATS_ROW_FILTER}`,
    [category],
  );
  return summarizeRates(rows);
}
