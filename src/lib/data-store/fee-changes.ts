/**
 * Fee Change Events — DB Query
 *
 * Queries the fee_change_records table with graceful degradation.
 * Returns [] (no throw) when the table is absent or empty.
 */

import { getSql } from "./connection";

export interface FeeChangeEvent {
  id: number;
  institution_id: number;
  institution_name: string;
  fee_category: string;
  old_amount: number | null;
  new_amount: number | null;
  change_type: "increase" | "decrease" | "new" | "removed";
  changed_at: string; // ISO 8601
  charter_type: string;
}

export interface FeeChangeFilters {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
  state_code?: string;
  /** Only changes seen on or after this ISO date. */
  since?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function isTableMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("fee_change_records") ||
    msg.includes("does not exist") ||
    msg.includes("no such table")
  );
}

export async function getFeeChangeEvents(
  filters: FeeChangeFilters = {}
): Promise<FeeChangeEvent[]> {
  const sql = getSql();

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIdx = 0;

  if (filters.charter_type) {
    paramIdx++;
    conditions.push(`ct.charter_type = $${paramIdx}`);
    params.push(filters.charter_type);
  }

  if (filters.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers
      .map(() => {
        paramIdx++;
        return `$${paramIdx}`;
      })
      .join(", ");
    conditions.push(`ct.asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }

  if (filters.fed_districts && filters.fed_districts.length > 0) {
    const placeholders = filters.fed_districts
      .map(() => {
        paramIdx++;
        return `$${paramIdx}`;
      })
      .join(", ");
    conditions.push(`ct.fed_district IN (${placeholders})`);
    params.push(...filters.fed_districts);
  }

  if (filters.state_code) {
    paramIdx++;
    conditions.push(`ct.state_code = $${paramIdx}`);
    params.push(filters.state_code);
  }

  if (filters.since) {
    paramIdx++;
    conditions.push(`fce.changed_at >= $${paramIdx}`);
    params.push(filters.since);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rowLimit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const query = `
    SELECT
      fce.id,
      fce.institution_id,
      ct.institution_name,
      fce.fee_category,
      fce.old_amount,
      fce.new_amount,
      fce.change_type,
      fce.changed_at,
      ct.charter_type
    FROM fee_change_records fce
    JOIN institution_sources ct ON ct.id = fce.institution_id
    ${where}
    ORDER BY fce.changed_at DESC
    LIMIT ${rowLimit}
  `;

  try {
    const rows = (await sql.unsafe(query, params)) as {
      id: number;
      institution_id: number;
      institution_name: string;
      fee_category: string;
      old_amount: number | null;
      new_amount: number | null;
      change_type: string;
      changed_at: Date | string;
      charter_type: string;
    }[];

    return rows.map((row) => ({
      id: Number(row.id),
      institution_id: Number(row.institution_id),
      institution_name: row.institution_name,
      fee_category: row.fee_category,
      old_amount: row.old_amount !== null ? Number(row.old_amount) : null,
      new_amount: row.new_amount !== null ? Number(row.new_amount) : null,
      change_type: row.change_type as FeeChangeEvent["change_type"],
      changed_at:
        row.changed_at instanceof Date
          ? row.changed_at.toISOString()
          : String(row.changed_at),
      charter_type: row.charter_type,
    }));
  } catch (err) {
    if (isTableMissingError(err)) {
      return [];
    }
    throw err;
  }
}
