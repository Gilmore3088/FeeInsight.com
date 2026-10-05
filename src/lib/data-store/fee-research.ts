/**
 * Readers for Hamilton's Research and Model screens: every peer's value for one fee at any layer
 * (national, Fed district, state, charter, asset tier) and the banks in an institution's own
 * local market with their deposit share. Values follow the statistics contract (approved,
 * sourced rows of published_fee_catalog; overdraft counts at its highest tier).
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
    `SELECT ef.institution_id, ef.fee_category, ef.amount,
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
  }[];

  const values = valuePerInstitution(rows);
  const info = new Map<number, (typeof rows)[number]>();
  for (const row of rows) info.set(Number(row.institution_id), row);
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
    });
  }
  return out.sort((a, b) => a.amount - b.amount || a.name.localeCompare(b.name));
}

export interface LocalMarketBank {
  institutionId: number | null;
  name: string;
  charterType: string | null;
  /** Deposits in the market's counties, in thousands of dollars (FDIC Summary of Deposits). */
  deposits: number;
  /** Share of all deposits in those counties, 0 to 1. */
  share: number;
  /** This bank's value for the fee; null when we haven't published it. */
  feeAmount: number | null;
  isSelf: boolean;
}

export interface LocalMarket {
  year: number;
  countyCount: number;
  banks: LocalMarketBank[];
}

/**
 * The banks with branches in the counties where `institutionId` has branches (latest Summary of
 * Deposits year), largest first, with their deposit share and their published `category` fee.
 * Credit unions aren't in the Summary of Deposits, so only banks appear. Null without branch data.
 */
export async function getLocalMarketBanks(
  institutionId: number,
  category: string,
  limit = 15,
): Promise<LocalMarket | null> {
  const rows = (await sql.unsafe(
    `WITH own AS (
       SELECT year, county_fips
         FROM institution_branch_deposits
        WHERE institution_id = $1
          AND county_fips IS NOT NULL
          AND year = (SELECT MAX(year) FROM institution_branch_deposits WHERE institution_id = $1)
     ),
     market AS (
       SELECT b.institution_id, b.cert, SUM(COALESCE(b.deposits, 0)) AS deposits
         FROM institution_branch_deposits b
        WHERE b.year = (SELECT MAX(year) FROM own)
          AND b.county_fips IN (SELECT county_fips FROM own)
        GROUP BY b.institution_id, b.cert
     )
     SELECT m.institution_id, m.cert, m.deposits,
            SUM(m.deposits) OVER () AS market_deposits,
            (SELECT MAX(year) FROM own) AS year,
            (SELECT COUNT(DISTINCT county_fips) FROM own) AS county_count,
            ct.institution_name, ct.charter_type
       FROM market m
       LEFT JOIN institution_sources ct ON ct.id = m.institution_id
      ORDER BY m.deposits DESC`,
    [institutionId] as never[],
  )) as {
    institution_id: number | string | null;
    cert: number;
    deposits: number | string;
    market_deposits: number | string;
    year: number;
    county_count: number | string;
    institution_name: string | null;
    charter_type: string | null;
  }[];
  if (rows.length === 0) return null;

  const total = Number(rows[0].market_deposits) || 0;
  const top = rows.slice(0, limit);
  if (!top.some((r) => Number(r.institution_id) === institutionId)) {
    const self = rows.find((r) => Number(r.institution_id) === institutionId);
    if (self) top.push(self);
  }
  const ids = top.map((r) => Number(r.institution_id)).filter((id) => Number.isFinite(id) && id > 0);
  const feeRows = ids.length
    ? ((await sql.unsafe(
        `SELECT ef.institution_id, ef.fee_category, ef.amount
           FROM published_fee_catalog ef
          WHERE ef.institution_id = ANY($1::bigint[])
            AND ef.fee_category = $2
            AND ef.review_status = 'approved'
            AND ${STATS_ROW_FILTER}`,
        [ids, category] as never[],
      )) as { institution_id: number; fee_category: string; amount: number | string | null }[])
    : [];
  const fees = valuePerInstitution(feeRows);

  return {
    year: Number(rows[0].year),
    countyCount: Number(rows[0].county_count),
    banks: top.map((r) => {
      const id = r.institution_id == null ? null : Number(r.institution_id);
      const deposits = Number(r.deposits) || 0;
      return {
        institutionId: id,
        name: r.institution_name ?? `FDIC certificate ${r.cert}`,
        charterType: r.charter_type,
        deposits,
        share: total > 0 ? deposits / total : 0,
        feeAmount: id != null ? (fees.get(id) ?? null) : null,
        isSelf: id === institutionId,
      };
    }),
  };
}
