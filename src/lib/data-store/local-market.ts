import { sql } from "./connection";
import { BUSINESS_PATH_SQL, CONSUMER_PATH_SQL } from "@/lib/agents/magellan/link-coverage";

/**
 * Local competitors for a Hamilton report: the institutions with branches in the
 * counties where the selected institution holds most of its deposits (FDIC Summary
 * of Deposits). Credit unions are not in the SOD, so for them the market is the
 * counties of the SOD branches in their headquarters city.
 */
export interface LocalMarketCompetitorRow {
  institution_id: number;
  institution_name: string;
  charter_type: string | null;
  /** Deposits held in the market counties, whole dollars; null for HQ-city matches. */
  market_deposits: number | null;
  /** Median published amount per fee category (approved rows only). */
  fees: Record<string, number>;
  document_url: string | null;
  document_date: string | null;
}

export interface LocalMarket {
  basis: "branch_counties" | "hq_city";
  /** e.g. "Xenia, IL area (2 counties)". */
  label: string;
  county_fips: number[];
  sod_year: number;
  competitors: LocalMarketCompetitorRow[];
}

const SOD_THOUSANDS = 1_000;
const MAX_MARKET_COUNTIES = 3;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function marketFromOwnBranches(cert: number): Promise<{ counties: number[]; year: number; places: string[] } | null> {
  const rows = await sql`
    WITH latest AS (
      SELECT MAX(year) AS y FROM institution_branch_deposits WHERE cert = ${cert}
    )
    SELECT b.county_fips, b.year,
           MIN(b.city) AS city, MIN(b.state) AS state,
           SUM(COALESCE(b.deposits, 0)) AS deposits
      FROM institution_branch_deposits b, latest
     WHERE b.cert = ${cert} AND b.year = latest.y AND b.county_fips IS NOT NULL
     GROUP BY b.county_fips, b.year
     ORDER BY deposits DESC
     LIMIT ${MAX_MARKET_COUNTIES}
  `;
  if (rows.length === 0) return null;
  return {
    counties: rows.map((row) => Number(row.county_fips)),
    year: Number(rows[0].year),
    places: rows.map((row) => `${row.city}, ${row.state}`),
  };
}

async function marketFromHqCity(city: string, state: string): Promise<{ counties: number[]; year: number } | null> {
  const rows = await sql`
    WITH latest AS (SELECT MAX(year) AS y FROM institution_branch_deposits WHERE state = ${state})
    SELECT DISTINCT b.county_fips, b.year
      FROM institution_branch_deposits b, latest
     WHERE b.year = latest.y AND b.state = ${state} AND UPPER(b.city) = UPPER(${city})
       AND b.county_fips IS NOT NULL
     LIMIT ${MAX_MARKET_COUNTIES}
  `;
  if (rows.length === 0) return null;
  return { counties: rows.map((row) => Number(row.county_fips)), year: Number(rows[0].year) };
}

/**
 * Up to `limit` local competitors (largest market deposits first) that publish at
 * least one of `categories`, with their median approved amount per category.
 * Returns null when no market can be located.
 */
export async function getLocalMarketCompetitors(params: {
  institutionId: number;
  certNumber: string | null | undefined;
  city: string | null | undefined;
  stateCode: string | null | undefined;
  categories: string[];
  limit?: number;
}): Promise<LocalMarket | null> {
  const limit = params.limit ?? 12;
  const cert = num(params.certNumber);
  const own = cert !== null ? await marketFromOwnBranches(cert) : null;
  const hq =
    own === null && params.city && params.stateCode
      ? await marketFromHqCity(params.city, params.stateCode)
      : null;
  const market = own ?? hq;
  if (!market || params.categories.length === 0) return null;

  const rows = await sql`
    WITH rivals AS (
      SELECT b.institution_id, SUM(COALESCE(b.deposits, 0)) AS deposits
        FROM institution_branch_deposits b
       WHERE b.year = ${market.year}
         AND b.county_fips = ANY(${market.counties})
         AND b.institution_id IS NOT NULL
         AND b.institution_id <> ${params.institutionId}
       GROUP BY b.institution_id
    ),
    fees AS (
      SELECT c.institution_id, c.fee_category,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.amount) AS amount,
             MAX(c.document_url) AS document_url,
             MAX(c.updated_at) AS document_date
        FROM published_fee_catalog c
       WHERE c.institution_id IN (SELECT institution_id FROM rivals)
         AND c.review_status = 'approved'
         AND c.amount IS NOT NULL
         AND c.fee_category = ANY(${params.categories})
         -- Business-only schedules are not the rival's consumer price (fee-stats rule 6).
         AND NOT (lower(regexp_replace(COALESCE(c.source_url, ''), '^https?://[^/]+', '')) ~ ${BUSINESS_PATH_SQL}
                  AND lower(regexp_replace(COALESCE(c.source_url, ''), '^https?://[^/]+', '')) !~ ${CONSUMER_PATH_SQL})
       GROUP BY c.institution_id, c.fee_category
    )
    SELECT r.institution_id, r.deposits, s.institution_name, s.charter_type,
           f.fee_category, f.amount, f.document_url, f.document_date
      FROM rivals r
      JOIN fees f ON f.institution_id = r.institution_id
      JOIN institution_sources s ON s.id = r.institution_id
     ORDER BY r.deposits DESC, r.institution_id
  `;

  const byInstitution = new Map<number, LocalMarketCompetitorRow>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    let entry = byInstitution.get(id);
    if (!entry) {
      if (byInstitution.size >= limit) continue;
      entry = {
        institution_id: id,
        institution_name: String(row.institution_name),
        charter_type: row.charter_type ? String(row.charter_type) : null,
        market_deposits: own ? (num(row.deposits) ?? 0) * SOD_THOUSANDS : null,
        fees: {},
        document_url: row.document_url ? String(row.document_url) : null,
        document_date: row.document_date ? new Date(String(row.document_date)).toISOString().slice(0, 10) : null,
      };
      byInstitution.set(id, entry);
    }
    const amount = num(row.amount);
    if (amount !== null) entry.fees[String(row.fee_category)] = Math.round(amount * 100) / 100;
  }

  const countyCount = market.counties.length;
  const label = `${own ? own.places[0] : `${params.city}, ${params.stateCode}`} area${countyCount > 1 ? ` (${countyCount} counties)` : ""}`;

  return {
    basis: own ? "branch_counties" : "hq_city",
    label,
    county_fips: market.counties,
    sod_year: market.year,
    competitors: [...byInstitution.values()],
  };
}

/**
 * Hamilton publish has recorded a price change only for the same fee line at a new
 * amount in a newer document since PR 78 (deployed 2026-10-05 06:43 UTC). Almost
 * every change recorded before that was a false replacement, so earlier rows are
 * never shown as competitor moves.
 */
export const FEE_MOVES_TRACKED_SINCE = "2026-10-05T06:43:00Z";

export interface LocalFeeMove {
  institution_id: number;
  institution_name: string;
  fee_category: string;
  previous_amount: number;
  new_amount: number;
  /** When a newer published fee schedule showed the new amount (not the bank's own effective date). */
  detected_at: string;
}

/** Price changes by the given competitors on the given fees, newest first. */
export async function getLocalFeeMoves(params: {
  institutionIds: number[];
  categories: string[];
  limit?: number;
}): Promise<LocalFeeMove[]> {
  if (params.institutionIds.length === 0 || params.categories.length === 0) return [];
  const rows = await sql`
    SELECT c.institution_id, s.institution_name, c.fee_category,
           COALESCE(c.previous_amount, c.old_amount) AS previous_amount,
           c.new_amount, c.detected_at
      FROM fee_change_records c
      JOIN institution_sources s ON s.id = c.institution_id
     WHERE c.institution_id = ANY(${params.institutionIds}::int[])
       AND c.fee_category = ANY(${params.categories}::text[])
       AND c.detected_at >= ${FEE_MOVES_TRACKED_SINCE}::timestamptz
       -- One schedule against an older copy of itself (hamilton/change-pairing.ts).
       AND c.like_for_like IS TRUE
       AND COALESCE(c.previous_amount, c.old_amount) IS NOT NULL
       AND c.new_amount IS NOT NULL
     ORDER BY c.detected_at DESC
     LIMIT ${params.limit ?? 20}
  `;
  return rows.flatMap((row) => {
    const previous = num(row.previous_amount);
    const next = num(row.new_amount);
    if (previous === null || next === null || Math.abs(previous - next) < 0.005) return [];
    return [{
      institution_id: Number(row.institution_id),
      institution_name: String(row.institution_name),
      fee_category: String(row.fee_category),
      previous_amount: previous,
      new_amount: next,
      detected_at: new Date(row.detected_at as string | Date).toISOString().slice(0, 10),
    }];
  });
}
