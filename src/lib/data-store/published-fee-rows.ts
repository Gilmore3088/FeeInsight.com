import { sql } from "./connection";
import { readerFeeConditions } from "../fee-conditions";
import { institutionDisplayName } from "@/lib/institution-display-name";

/**
 * Row-level published dollar fees across institutions (published_fee_catalog), oldest
 * publish first, for partners keeping their own copy in step: ask for the rows published at
 * or after the newest date already held. The order (publish date, then fee id) is total, so
 * a page holds the same rows however often it is asked for, until rows are added or taken
 * down. Fees stated as a rate live in published_fee_rate_catalog (rate-fees.ts) and are
 * never mixed in here.
 */

export interface PublishedFeeRowFilters {
  institution_id?: number | null;
  state_code?: string | null;
  charter_type?: string | null;
  /** Only rows published at or after this time (the catalog's created_at, which is published_at). */
  updated_since?: Date | null;
}

export interface PublishedFeeRow {
  fee_id: number;
  institution_id: number;
  institution_name: string;
  state: string | null;
  charter_type: string | null;
  fee_name: string;
  fee_category: string | null;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  source_url: string | null;
  published_at: string | null;
}

interface RawRow {
  id: number | string;
  institution_id: number | string;
  institution_name: string | null;
  state_code: string | null;
  charter_type: string | null;
  fee_name: string;
  fee_category: string | null;
  amount: number | string | null;
  frequency: string | null;
  conditions: string | null;
  source_url: string | null;
  created_at: Date | string | null;
}

/** WHERE clause and parameters shared by the count and the page; values only ever travel as parameters. */
export function publishedFeeRowWhere(filters: PublishedFeeRowFilters): { where: string; params: (string | number)[] } {
  const conditions = ["ef.review_status = 'approved'"];
  const params: (string | number)[] = [];
  if (filters.institution_id != null) {
    params.push(filters.institution_id);
    conditions.push(`ef.institution_id = $${params.length}`);
  }
  if (filters.state_code) {
    params.push(filters.state_code);
    conditions.push(`ct.state_code = $${params.length}`);
  }
  if (filters.charter_type) {
    params.push(filters.charter_type);
    conditions.push(`ct.charter_type = $${params.length}`);
  }
  if (filters.updated_since) {
    params.push(filters.updated_since.toISOString());
    conditions.push(`ef.created_at >= $${params.length}::timestamptz`);
  }
  return { where: conditions.join(" AND "), params };
}

function iso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function listPublishedFeeRows(
  filters: PublishedFeeRowFilters,
  page: { limit: number; offset: number },
): Promise<{ total: number; rows: PublishedFeeRow[] }> {
  const { where, params } = publishedFeeRowWhere(filters);
  const [countRow] = await sql.unsafe<{ total: number | string }[]>(
    `SELECT COUNT(*) AS total
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ct.id = ef.institution_id
      WHERE ${where}`,
    params,
  );
  const rows = await sql.unsafe<RawRow[]>(
    `SELECT ef.id, ef.institution_id, ct.institution_name, ct.state_code, ct.charter_type,
            ef.fee_name, ef.fee_category, ef.amount, ef.frequency, ef.conditions, ef.source_url, ef.created_at
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ct.id = ef.institution_id
      WHERE ${where}
      ORDER BY ef.created_at ASC NULLS FIRST, ef.id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, page.limit, page.offset],
  );
  return {
    total: Number(countRow?.total ?? 0),
    rows: rows.map((r) => ({
      fee_id: Number(r.id),
      institution_id: Number(r.institution_id),
      institution_name: institutionDisplayName(r.institution_name) ?? `Institution ${r.institution_id}`,
      state: r.state_code,
      charter_type: r.charter_type,
      fee_name: r.fee_name,
      fee_category: r.fee_category,
      amount: r.amount === null || r.amount === "" ? null : Number(r.amount),
      frequency: r.frequency,
      conditions: readerFeeConditions(r.conditions),
      source_url: r.source_url,
      published_at: iso(r.created_at),
    })),
  };
}
