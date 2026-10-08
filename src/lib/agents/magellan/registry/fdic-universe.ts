import { sql } from "@/lib/data-store/connection";
import {
  fetchFdicActiveInstitutions,
  fetchFdicInstitutionsByCert,
  parseFdicInstitution,
  type FdicInstitutionRow,
} from "@/lib/regulatory/fdic";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: keep the FDIC-insured bank universe current.
 *
 * - Refreshes identity on existing rows (RSSD, holding company, primary
 *   regulator, asset size/tier) and backfills missing websites.
 * - Adds newly chartered banks (status 'active', so the fee pipeline picks them up).
 * - Marks banks FDIC reports as closed or merged inactive instead of deleting
 *   them, so their fee and financial history stays queryable.
 * - Takes each bank's Federal Reserve district from FDIC (its FED field, set by
 *   the county of the head office, so split states such as Missouri or Tennessee
 *   come out right), then gives every credit union and closed bank the district
 *   most banks in its city have, or its state's when the city has no bank.
 */

export const FDIC_UNIVERSE_SOURCE = "fdic-universe";
export const FDIC_UNIVERSE_PARTITION = "current";
const UPDATE_CHUNK = 1_000;
const CERT_LOOKUP_BATCH = 50;
const MAX_CERT_LOOKUPS = 500;
const REFRESH_HOURS = 24 * 7;
/**
 * Bumped when the step starts writing something new, so a finished partition runs
 * again on the next registry tick. 2: FDIC's district replaces the stored one, and
 * credit unions take theirs from nearby banks.
 */
export const FDIC_UNIVERSE_PARSER_VERSION = 2;

export interface RegistryFdicUniverseOptions {
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
}

export interface RegistryFdicUniverseResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  activeInstitutions: number;
  existingMatched: number;
  updatedInstitutions: number;
  insertedInstitutions: number;
  deactivatedInstitutions: number;
  missingFromFdic: number;
  lookupsSkipped: number;
  /** Active banks whose stored Fed district differed from FDIC's. */
  banksDistrictChanged: number;
  /** Credit unions and closed banks whose district changed to match the banks around them. */
  othersDistrictChanged: number;
  dryRun: boolean;
}

async function loadKnownCerts(db: RegistryDb): Promise<Map<string, string | null>> {
  const rows = await db<{ cert_number: string; regulatory_status: string | null }[]>`
    SELECT cert_number, regulatory_status
      FROM institution_sources
     WHERE source = 'fdic' AND cert_number IS NOT NULL
  `;
  return new Map(rows.map((row) => [String(row.cert_number), row.regulatory_status ?? null]));
}

async function updateExisting(
  db: RegistryDb,
  rows: FdicInstitutionRow[],
): Promise<{ updated: number; districtChanged: number }> {
  const payload = JSON.stringify(rows);
  const result = await db<{ id: number; district_changed: boolean | null }[]>`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        cert text, rssd_id text, holding_company_rssd text, holding_company_name text,
        primary_regulator text, charter_agency text, website_url text, asset_size bigint,
        asset_size_tier text, fed_district integer, cbsa_code text, cbsa_name text, established_date text
      )
    )
    UPDATE institution_sources s SET
      rssd_id = COALESCE(
        s.rssd_id,
        CASE WHEN r.rssd_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM institution_sources x WHERE x.rssd_id = r.rssd_id)
             THEN r.rssd_id END
      ),
      holding_company_rssd = r.holding_company_rssd,
      holding_company_name = r.holding_company_name,
      primary_regulator = r.primary_regulator,
      charter_agency = r.charter_agency,
      website_url = COALESCE(NULLIF(btrim(s.website_url), ''), r.website_url),
      asset_size = COALESCE(r.asset_size, s.asset_size),
      asset_size_tier = COALESCE(r.asset_size_tier, s.asset_size_tier),
      -- FDIC's district is authoritative; a stored value only stands when FDIC sends none.
      fed_district = COALESCE(r.fed_district, s.fed_district),
      cbsa_code = COALESCE(s.cbsa_code, r.cbsa_code),
      cbsa_name = COALESCE(s.cbsa_name, r.cbsa_name),
      established_date = COALESCE(s.established_date, r.established_date),
      regulatory_status = 'active',
      closed_date = NULL,
      registry_synced_at = NOW()
    FROM r, institution_sources o
    WHERE s.source = 'fdic' AND s.cert_number = r.cert AND o.id = s.id
    RETURNING s.id, (o.fed_district IS DISTINCT FROM s.fed_district) AS district_changed
  `;
  const out = [...result];
  return { updated: out.length, districtChanged: out.filter((row) => row.district_changed === true).length };
}

/**
 * Credit unions (NCUA has no district field) and closed banks (FDIC no longer sends
 * them) take the district of the nearest active bank head office in the same state,
 * once the credit union's main office has map coordinates. Without coordinates they
 * take the district most active banks in the same city have, else the one most banks
 * in the state have. Runs after the bank refresh so it reads FDIC's values, and after
 * each credit union geocoding batch so districts improve as coordinates arrive.
 */
export async function deriveOtherDistricts(db: RegistryDb): Promise<number> {
  const result = await db`
    WITH banks AS (
      SELECT state_code, UPPER(BTRIM(city)) AS city, fed_district
        FROM institution_sources
       WHERE source = 'fdic' AND regulatory_status = 'active' AND fed_district BETWEEN 1 AND 12
    ),
    by_city AS (
      SELECT state_code, city, fed_district,
             ROW_NUMBER() OVER (PARTITION BY state_code, city ORDER BY COUNT(*) DESC, fed_district) AS rk
        FROM banks WHERE city IS NOT NULL
       GROUP BY state_code, city, fed_district
    ),
    by_state AS (
      SELECT state_code, fed_district,
             ROW_NUMBER() OVER (PARTITION BY state_code ORDER BY COUNT(*) DESC, fed_district) AS rk
        FROM banks
       GROUP BY state_code, fed_district
    ),
    bank_hq AS (
      SELECT b.state, b.latitude, b.longitude, s.fed_district
        FROM institution_branch_deposits b
        JOIN institution_sources s ON s.id = b.institution_id
       WHERE b.year = (SELECT MAX(year) FROM institution_branch_deposits)
         AND b.is_main_office AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
         AND s.source = 'fdic' AND s.regulatory_status = 'active' AND s.fed_district BETWEEN 1 AND 12
    ),
    cu_point AS (
      SELECT DISTINCT ON (c.institution_id) c.institution_id, c.state, c.latitude, c.longitude
        FROM credit_union_branches c
       WHERE c.institution_id IS NOT NULL AND c.is_main_office AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
       ORDER BY c.institution_id, c.id
    ),
    nearest AS (
      SELECT p.institution_id, n.fed_district
        FROM cu_point p
        CROSS JOIN LATERAL (
          SELECT h.fed_district FROM bank_hq h
           WHERE h.state = p.state
           ORDER BY (h.latitude - p.latitude) ^ 2 + ((h.longitude - p.longitude) * COS(RADIANS(p.latitude))) ^ 2
           LIMIT 1
        ) n
    ),
    target AS (
      SELECT i.id, COALESCE(n.fed_district, c.fed_district, st.fed_district) AS fed_district
        FROM institution_sources i
        LEFT JOIN nearest n ON n.institution_id = i.id
        LEFT JOIN by_city c ON c.rk = 1 AND c.state_code = i.state_code AND c.city = UPPER(BTRIM(i.city))
        LEFT JOIN by_state st ON st.rk = 1 AND st.state_code = i.state_code
       WHERE i.source <> 'fdic' OR i.regulatory_status IS DISTINCT FROM 'active'
    )
    UPDATE institution_sources s SET fed_district = t.fed_district
      FROM target t
     WHERE s.id = t.id AND t.fed_district IS NOT NULL AND s.fed_district IS DISTINCT FROM t.fed_district
    RETURNING s.id
  `;
  return [...result].length;
}

async function insertNew(db: RegistryDb, rows: FdicInstitutionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = JSON.stringify(rows);
  const result = await db`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        cert text, name text, rssd_id text, holding_company_rssd text, holding_company_name text,
        primary_regulator text, charter_agency text, state_code text, state_name text, city text,
        website_url text, asset_size bigint, asset_size_tier text, fed_district integer,
        cbsa_code text, cbsa_name text, established_date text
      )
    )
    INSERT INTO institution_sources (
      institution_name, website_url, charter_type, state, state_code, city, asset_size,
      asset_size_tier, cert_number, source, status, fed_district, cbsa_code, cbsa_name,
      established_date, rssd_id, holding_company_rssd, holding_company_name, primary_regulator,
      charter_agency, regulatory_status, registry_synced_at
    )
    SELECT r.name, r.website_url, 'bank', r.state_name, r.state_code, r.city, r.asset_size,
           r.asset_size_tier, r.cert, 'fdic', 'active', r.fed_district, r.cbsa_code, r.cbsa_name,
           r.established_date,
           CASE WHEN r.rssd_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM institution_sources x WHERE x.rssd_id = r.rssd_id)
                THEN r.rssd_id END,
           r.holding_company_rssd, r.holding_company_name, r.primary_regulator, r.charter_agency,
           'active', NOW()
      FROM r
    ON CONFLICT (source, cert_number) DO NOTHING
    RETURNING id
  `;
  return [...result].length;
}

async function deactivate(db: RegistryDb, rows: FdicInstitutionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = JSON.stringify(rows.map((row) => ({ cert: row.cert, closed_date: row.closed_date })));
  const result = await db`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(cert text, closed_date date)
    )
    UPDATE institution_sources s SET
      regulatory_status = 'inactive',
      status = 'inactive',
      closed_date = r.closed_date,
      registry_synced_at = NOW()
    FROM r
    WHERE s.source = 'fdic' AND s.cert_number = r.cert
    RETURNING s.id
  `;
  return [...result].length;
}

export async function runRegistryFdicUniverse(
  options: RegistryFdicUniverseOptions = {},
): Promise<RegistryFdicUniverseResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);

  const page = await fetchFdicActiveInstitutions(options.fetchOptions);
  const active = page.rows
    .map(parseFdicInstitution)
    .filter((row): row is FdicInstitutionRow => row !== null && row.active);
  const known = await loadKnownCerts(db);
  const activeCerts = new Set(active.map((row) => row.cert));

  const existing = active.filter((row) => known.has(row.cert));
  const fresh = active.filter((row) => !known.has(row.cert));
  const missing = [...known.entries()]
    .filter(([cert, status]) => !activeCerts.has(cert) && status !== "inactive")
    .map(([cert]) => cert);
  const toLookup = missing.slice(0, MAX_CERT_LOOKUPS);

  const closed: FdicInstitutionRow[] = [];
  for (const batch of chunk(toLookup, CERT_LOOKUP_BATCH)) {
    const lookup = await fetchFdicInstitutionsByCert(batch, options.fetchOptions);
    for (const record of lookup.rows) {
      const parsed = parseFdicInstitution(record);
      if (parsed && !parsed.active) closed.push(parsed);
    }
  }

  const result: RegistryFdicUniverseResult = {
    source: FDIC_UNIVERSE_SOURCE,
    partitionKey: FDIC_UNIVERSE_PARTITION,
    sourceUrl: page.url,
    activeInstitutions: active.length,
    existingMatched: existing.length,
    updatedInstitutions: 0,
    insertedInstitutions: 0,
    deactivatedInstitutions: 0,
    missingFromFdic: missing.length,
    lookupsSkipped: Math.max(0, missing.length - toLookup.length),
    banksDistrictChanged: 0,
    othersDistrictChanged: 0,
    dryRun,
  };
  if (dryRun) {
    return { ...result, insertedInstitutions: fresh.length, deactivatedInstitutions: closed.length };
  }
  if (active.length === 0) {
    // An empty active list is an upstream failure, never a reason to deactivate everyone.
    throw new Error("FDIC returned no active institutions; refusing to sync the universe.");
  }

  for (const group of chunk(existing, UPDATE_CHUNK)) {
    const counts = await updateExisting(db, group);
    result.updatedInstitutions += counts.updated;
    result.banksDistrictChanged += counts.districtChanged;
  }
  for (const group of chunk(fresh, UPDATE_CHUNK)) {
    result.insertedInstitutions += await insertNew(db, group);
  }
  result.deactivatedInstitutions = await deactivate(db, closed);
  result.othersDistrictChanged = await deriveOtherDistricts(db);

  await recordRegistryPartition(db, {
    source: FDIC_UNIVERSE_SOURCE,
    partitionKey: FDIC_UNIVERSE_PARTITION,
    status: "succeeded",
    rowCount: active.length,
    matchedCount: existing.length,
    unmatchedCount: fresh.length,
    insertedCount: result.insertedInstitutions,
    sourceUrl: page.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: {
      updated: result.updatedInstitutions,
      inserted: result.insertedInstitutions,
      deactivated: result.deactivatedInstitutions,
      missing_from_fdic: result.missingFromFdic,
      banks_district_changed: result.banksDistrictChanged,
      others_district_changed: result.othersDistrictChanged,
      parser_version: FDIC_UNIVERSE_PARSER_VERSION,
    },
  });

  return result;
}
