import { sql } from "./connection";
import { branchCitySpellings } from "./city-spellings";
import { COUNT_SHARED_SCHEDULE_ONCE, countedRepresentatives, HIGHEST_TIER_CATEGORIES, holdingCompanySql, institutionValueSql, peerRowFilter, scheduleGroupSql, scheduleKeysSql, statsRowFilter } from "./fee-stats";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { ownFeeFromRows, severalFeesOf, type SeveralFees } from "@/lib/own-fee";

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
  /**
   * Sourced consumer value per category under the statistics contract: median, or highest
   * overdraft tier. For local medians and ranges; it is the stated price only where `several`
   * lacks the category.
   */
  fees: Record<string, number>;
  /** Categories where the schedule states several different fees: their range and each by name (#1931). */
  several?: Record<string, SeveralFees>;
  /**
   * Statistics rule 7, per category: the charter this one counts under when sister charters
   * share one fee schedule, picked over the whole holding company as the national peer read picks
   * it (marketCountedAs), so it can name a charter outside this market. Absent where it counts as
   * itself. For countedAmounts; every charter keeps its own named row.
   */
  counted_as?: Record<string, number>;
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

/**
 * How `getLocalMarketCompetitors` computes a competitor's amount for a category from its catalog
 * rows: the highest overdraft tier ("max", `MAX(amount)`), else their median ("median",
 * `PERCENTILE_CONT(0.5)`), over its general rows when it also states named product exceptions
 * (fee-stats.ts rule 11, institutionValueSql). Either is an aggregate of the rows, never one fee record.
 */
export function competitorAmountBasis(category: string): "max" | "median" {
  return category === "overdraft" ? "max" : "median";
}

const SOD_THOUSANDS = 1_000;
const MAX_MARKET_COUNTIES = 3;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Each catalog row's name and amount behind one competitor's category, as jsonb arrives (parsed or as text). */
function feeLines(value: unknown): { fee_name?: string | null; amount: unknown; account_product_type?: string | null }[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((l): l is { fee_name?: string | null; amount: unknown; account_product_type?: string | null } => l !== null && typeof l === "object") : [];
}

/**
 * Rule 7 for a local market, per category: the charter each of these institutions counts as,
 * picked as the workspace's national peer read picks it (getPeerFeeValues with no filters, then
 * countedRepresentatives). Charters link only within one holding company, so reading every
 * charter of these institutions' holding companies under the peer read's own row filter
 * (peerRowFilter), the asking institution left out as the peer read leaves it out, gives each
 * institution the same linked group and the same lowest-id representative as the national read.
 * Picking over the market's rows alone missed a link through a sister charter outside the market
 * (or past the competitor limit), so the same market could count a group once in the workspace
 * and twice in the report. Institutions that count as themselves are absent.
 */
async function marketCountedAs(institutionIds: number[], categories: string[], excludeInstitutionId: number): Promise<Map<string, Map<number, number>>> {
  const result = new Map<string, Map<number, number>>();
  if (!COUNT_SHARED_SCHEDULE_ONCE || institutionIds.length === 0 || categories.length === 0) return result;
  const rows = await sql`
    SELECT ef.institution_id, ef.fee_category,
           ${sql.unsafe(scheduleKeysSql("ef"))} AS schedule_keys, ${sql.unsafe(scheduleGroupSql("ef"))} AS schedule_group
      FROM published_fee_catalog ef
      JOIN institution_sources ct ON ct.id = ef.institution_id
     WHERE ef.fee_category = ANY(${categories}::text[])
       AND ef.institution_id <> ${excludeInstitutionId}
       AND ${sql.unsafe(holdingCompanySql("ct"))} IN (
             SELECT ${sql.unsafe(holdingCompanySql("g"))} FROM institution_sources g WHERE g.id = ANY(${institutionIds}::bigint[]))
       AND ${sql.unsafe(peerRowFilter("ef", "ct"))}
  `;
  const byCategory = new Map<string, { institution_id: number; schedule_keys: string[] | null; schedule_group: string | null }[]>();
  for (const row of rows) {
    const category = String(row.fee_category);
    const list = byCategory.get(category) ?? [];
    list.push({
      institution_id: Number(row.institution_id),
      schedule_keys: Array.isArray(row.schedule_keys) ? row.schedule_keys.map(String) : null,
      schedule_group: row.schedule_group == null ? null : String(row.schedule_group),
    });
    byCategory.set(category, list);
  }
  for (const [category, list] of byCategory) {
    const representatives = countedRepresentatives(list);
    if (!representatives) continue;
    const linked = new Map<number, number>();
    for (const [id, rep] of representatives) if (rep !== id) linked.set(id, rep);
    if (linked.size > 0) result.set(category, linked);
  }
  return result;
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

/** The counties of the branches in the headquarters city, under every spelling the fold reads as that city (#2092). */
async function marketFromHqCity(city: string, state: string): Promise<{ counties: number[]; year: number } | null> {
  const spellings = await branchCitySpellings(city, state);
  const rows = await sql`
    WITH latest AS (SELECT MAX(year) AS y FROM institution_branch_deposits WHERE state = ${state})
    SELECT DISTINCT b.county_fips, b.year
      FROM institution_branch_deposits b, latest
     WHERE b.year = latest.y AND b.state = ${state} AND UPPER(b.city) = ANY(${spellings}::text[])
       AND b.county_fips IS NOT NULL
     LIMIT ${MAX_MARKET_COUNTIES}
  `;
  if (rows.length === 0) return null;
  return { counties: rows.map((row) => Number(row.county_fips)), year: Number(rows[0].year) };
}

/**
 * Up to `limit` local competitors (largest market deposits first) with sourced consumer
 * evidence for at least one requested category. Returns null when no market can be located.
 * Fee rows pass the workspace's national peer read filter (peerRowFilter), so an institution the
 * regulator marks inactive is no competitor here, as it is in no workspace layer (#1441).
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
             ${sql.unsafe(institutionValueSql("c"))} AS amount,
             jsonb_agg(jsonb_build_object('fee_name', c.fee_name, 'amount', c.amount, 'account_product_type', c.account_product_type)) AS lines,
             MAX(c.document_url) AS document_url,
             MAX(c.updated_at) AS document_date
        FROM published_fee_catalog c
        JOIN institution_sources ct ON ct.id = c.institution_id
       WHERE c.institution_id IN (SELECT institution_id FROM rivals)
         AND c.amount IS NOT NULL AND c.amount >= 0
         AND c.fee_category = ANY(${params.categories})
         -- The national peer read's row filter (approved, statistics rows, an institution the
         -- regulator has not marked inactive), so the report lists the competitors the workspace does.
         AND ${sql.unsafe(peerRowFilter("c", "ct"))}
       GROUP BY c.institution_id, c.fee_category
    )
    SELECT r.institution_id, r.deposits, s.institution_name, s.charter_type, f.fee_category, f.amount, f.lines, f.document_url, f.document_date
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
        institution_name: institutionDisplayName(String(row.institution_name)),
        charter_type: row.charter_type ? String(row.charter_type) : null,
        market_deposits: own ? (num(row.deposits) ?? 0) * SOD_THOUSANDS : null,
        fees: {},
        several: {},
        document_url: row.document_url ? String(row.document_url) : null,
        document_date: row.document_date ? new Date(String(row.document_date)).toISOString().slice(0, 10) : null,
      };
      byInstitution.set(id, entry);
    }
    const amount = num(row.amount);
    if (amount === null) continue;
    const category = String(row.fee_category);
    entry.fees[category] = Math.round(amount * 100) / 100;
    const several = severalFeesOf(ownFeeFromRows(category, feeLines(row.lines), amount, HIGHEST_TIER_CATEGORIES.has(category)));
    if (several) (entry.several ??= {})[category] = several;
  }
  // Rule 7 (#1441): sister charters of one shared schedule count once in the local statistics,
  // each under the representative the workspace's national read picks.
  const counted = await marketCountedAs([...byInstitution.keys()], params.categories, params.institutionId);
  for (const entry of byInstitution.values()) {
    for (const category of Object.keys(entry.fees)) {
      const rep = counted.get(category)?.get(entry.institution_id);
      if (rep !== undefined) (entry.counted_as ??= {})[category] = rep;
    }
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
       -- Keep the original pairing gate, then require a live, same-audience consumer pair.
       AND c.like_for_like IS TRUE
       AND EXISTS (
         SELECT 1 FROM published_fee_catalog nl
         JOIN published_fee_records previous ON previous.fee_published_id = c.previous_fee_published_id
         WHERE nl.fee_published_id = c.new_fee_published_id
           AND nl.institution_id = c.institution_id AND previous.institution_id = c.institution_id
           AND nl.canonical_fee_key = c.fee_category AND previous.canonical_fee_key = c.fee_category
           AND ${sql.unsafe(statsRowFilter("nl"))}
           AND previous.fee_audience = nl.fee_audience
           AND previous.quarantined_at IS NULL
           AND nl.amount = c.new_amount
           AND previous.amount = COALESCE(c.previous_amount, c.old_amount)
           AND NOT EXISTS (SELECT 1 FROM pipeline_feedback pf WHERE pf.fee_published_id = nl.fee_published_id AND pf.kind = 'takedown_pending')
       )
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
      institution_name: institutionDisplayName(String(row.institution_name)),
      fee_category: String(row.fee_category),
      previous_amount: previous,
      new_amount: next,
      detected_at: new Date(row.detected_at as string | Date).toISOString().slice(0, 10),
    }];
  });
}
