/**
 * Two readers the Hamilton engine doesn't cover yet: the institutions behind a market layer (for
 * the screens' CSV download) and an institution's own published rows for one fee (for the audit
 * trail). Every number on screen comes from the engine (`src/lib/hamilton/workspace`). Values
 * follow the statistics contract (approved, sourced rows of published_fee_catalog; overdraft
 * counts at its highest tier).
 */
import { sql } from "./connection";
import { STATS_ROW_FILTER, valuePerInstitution } from "./fee-stats";

export interface PeerAmountFilters {
  charter?: string | null;
  assetTiers?: string[] | null;
  stateCode?: string | null;
  fedDistrict?: number | null;
}

export interface PeerAmount {
  institutionId: number;
  name: string;
  stateCode: string | null;
  charterType: string | null;
  fedDistrict: number | null;
  assetTier: string | null;
  amount: number;
  /** The institution's own fee schedule this value was read from (its latest published row). */
  sourceUrl: string | null;
  /** When the latest of its rows for this fee was published. */
  publishedAt: string | null;
}

/** One value per institution for `category`, filtered to a layer. Sorted by amount. */
export async function getCategoryPeerAmounts(
  category: string,
  filters: PeerAmountFilters = {},
): Promise<PeerAmount[]> {
  const params: (string | number | string[])[] = [category];
  const conditions = [
    "ef.fee_category = $1",
    "ef.review_status = 'approved'",
    STATS_ROW_FILTER,
  ];
  if (filters.charter) {
    params.push(filters.charter);
    conditions.push(`ct.charter_type = $${params.length}`);
  }
  if (filters.assetTiers && filters.assetTiers.length > 0) {
    params.push(filters.assetTiers);
    conditions.push(`ct.asset_size_tier = ANY($${params.length}::text[])`);
  }
  if (filters.stateCode) {
    params.push(filters.stateCode);
    conditions.push(`ct.state_code = $${params.length}`);
  }
  if (filters.fedDistrict != null) {
    params.push(filters.fedDistrict);
    conditions.push(`ct.fed_district = $${params.length}`);
  }
  const rows = (await sql.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.amount, ef.source_url, ef.created_at,
            ct.institution_name, ct.state_code, ct.charter_type, ct.fed_district, ct.asset_size_tier
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ${conditions.join(" AND ")}`,
    params as never[],
  )) as {
    institution_id: number;
    fee_category: string;
    amount: number | string | null;
    institution_name: string;
    state_code: string | null;
    charter_type: string | null;
    fed_district: number | null;
    asset_size_tier: string | null;
    source_url: string | null;
    created_at: string | Date | null;
  }[];

  const values = valuePerInstitution(rows);
  // Keep each institution's most recently published row for its source and date.
  const info = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    const prev = info.get(id);
    if (!prev || isoDate(row.created_at) > isoDate(prev.created_at)) info.set(id, row);
  }
  const out: PeerAmount[] = [];
  for (const [id, amount] of values) {
    const row = info.get(id)!;
    out.push({
      institutionId: id,
      name: row.institution_name,
      stateCode: row.state_code,
      charterType: row.charter_type,
      fedDistrict: row.fed_district == null ? null : Number(row.fed_district),
      assetTier: row.asset_size_tier,
      amount,
      sourceUrl: row.source_url,
      publishedAt: isoDate(row.created_at) || null,
    });
  }
  return out.sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));
}

function isoDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export interface FeeEvidenceRow {
  feeName: string;
  amount: number | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  /** The agent event that verified this fee against the document; null when not recorded. */
  /** The agent event that verified this fee, when recorded. */
  verifiedByEventId: string | null;
}

/** Every published row behind one institution's value for a fee: the audit trail for "your fee". */
export async function getInstitutionFeeEvidence(institutionId: number, category: string): Promise<FeeEvidenceRow[]> {
  const rows = (await sql.unsafe(
    `SELECT ef.fee_name, ef.amount, ef.source_url, ef.created_at, ef.verified_by_agent_event_id
       FROM published_fee_catalog ef
      WHERE ef.institution_id = $1
        AND ef.fee_category = $2
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}
      ORDER BY ef.amount DESC NULLS LAST`,
    [institutionId, category] as never[],
  )) as {
    fee_name: string;
    amount: number | string | null;
    source_url: string | null;
    created_at: string | Date | null;
    verified_by_agent_event_id: number | string | null;
  }[];
  return rows.map((r) => ({
    feeName: r.fee_name,
    amount: r.amount == null ? null : Number(r.amount),
    sourceUrl: r.source_url,
    publishedAt: isoDate(r.created_at) || null,
    verifiedByEventId: r.verified_by_agent_event_id == null ? null : String(r.verified_by_agent_event_id),
  }));
}
