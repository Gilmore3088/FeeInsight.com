import { sql } from "@/lib/data-store/connection";
import { CensusKeyError } from "@/lib/regulatory/census-acs";
import type { GeocodeInput } from "@/lib/regulatory/census-geocoder";
import {
  ATLANTA_FED_PAYMENTS_URL_ENV,
  BeaKeyError,
  checkAreaStats,
  dedupeAreaStats,
  FDIC_NATIONAL_RATES_URL_ENV,
  FDIC_SURVEY_URL_ENV,
  fetchBea,
  fetchCbp,
  fetchConfiguredCsv,
  fetchFdicSurvey,
  fetchFfiecTracts,
  fetchFhfaHpi,
  fetchHudCrosswalk,
  fetchIndustryRecords,
  fetchQcew,
  fetchRucc,
  fetchSaipe,
  fetchShed,
  HUD_TOKEN_ENV,
  HudTokenError,
  industryStats,
  parseHudCrosswalk,
  parseNationalWideCsv,
  parseRemittancePrices,
  placeAddressesInTracts,
  placePointInTract,
  RPW_URL_ENV,
  RUCC_VINTAGES,
  sumIndustry,
  type AreaFetch,
  type AreaStat,
  type AreaStatChecks,
  type CensusTractRow,
  type TractPlacement,
} from "@/lib/regulatory/economy";
import { registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { fdicRepdte, latestPublishableQuarter, parseQuarterKey, quartersNewestFirst, quarterKey } from "@/lib/regulatory/quarters";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for the local economy: one source per step, one partition per run,
 * newest first. Area-level figures (county, state, metro, nation) go to `area_statistics`, one
 * row per area, period and series. Three sources have their own shape and their own table:
 * FFIEC tract income levels (`census_tracts`, which already existed), branch-to-tract
 * placements (`branch_census_tracts`), remittance prices by provider (`remittance_prices`) and
 * the HUD ZIP-to-county crosswalk (`zip_county_crosswalk`).
 *
 * `urban-rural-fill` is the one step that touches institution data: it proposes
 * institution_sources.urban_rural from the HQ county's Rural-Urban Continuum Code and, by
 * default, only counts. It writes only when ECONOMY_URBAN_RURAL_WRITE=true, and then only fills
 * blanks; a stored value that disagrees is counted for review, never overwritten.
 */

export const ECONOMY_PARSER_VERSION = 1;

export const ECONOMY_SOURCES = {
  rucc: "usda-rucc",
  ffiecTracts: "ffiec-census-tracts",
  branchTracts: "branch-census-tracts",
  urbanRural: "urban-rural-fill",
  qcew: "bls-qcew",
  cbp: "census-cbp",
  saipe: "census-saipe",
  bea: "bea-personal-income",
  fhfa: "fhfa-hpi",
  fdicSurvey: "fdic-household-survey",
  shed: "fed-shed",
  fdicIndustry: "fdic-industry-totals",
  fdicRates: "fdic-national-rates",
  paymentChoice: "atlanta-fed-payment-choice",
  remittances: "world-bank-remittance-prices",
  hudCrosswalk: "hud-zip-county",
} as const;

export type EconomySource = (typeof ECONOMY_SOURCES)[keyof typeof ECONOMY_SOURCES];
export const ECONOMY_SOURCE_LIST: EconomySource[] = Object.values(ECONOMY_SOURCES);

export const ECONOMY_CURRENT_PARTITION = "current";
export const ECONOMY_PENDING_PARTITION = "pending";
export const URBAN_RURAL_WRITE_ENV = "ECONOMY_URBAN_RURAL_WRITE";
export const BEA_KEY_ENV = "BEA_API_KEY";
/** Branches sent to the Census geocoder per run (one batch, well inside the function time limit). */
export const BRANCH_TRACT_BATCH = 1_000;
/** Unmatched branches with coordinates looked up one by one per run. */
export const BRANCH_POINT_LOOKUPS = 200;
const FDIC_INDUSTRY_LAG_DAYS = 60;
const FDIC_INDUSTRY_FIRST = { year: 2015, quarter: 1 as const };
const SHED_FIRST_YEAR = 2019;
const UPSERT_CHUNK = 1_000;

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30, quarter: 24 * 90, year: 24 * 365 };

function years(from: number, to: number): string[] {
  const out: string[] = [];
  for (let y = to; y >= from; y -= 1) out.push(String(y));
  return out;
}

export interface EconomyDefinition {
  source: EconomySource;
  title: string;
  fixedPartition?: string;
  partitions: (now: Date) => string[];
}

export const ECONOMY_DEFINITIONS: EconomyDefinition[] = [
  { source: ECONOMY_SOURCES.rucc, title: "Pull USDA rural-urban continuum codes by county", partitions: () => [...RUCC_VINTAGES].reverse() },
  { source: ECONOMY_SOURCES.ffiecTracts, title: "Pull FFIEC census tract income levels", partitions: (now) => years(2022, now.getUTCFullYear()) },
  {
    source: ECONOMY_SOURCES.branchTracts,
    title: "Place bank and credit union branches in census tracts",
    fixedPartition: ECONOMY_PENDING_PARTITION,
    partitions: () => [ECONOMY_PENDING_PARTITION],
  },
  {
    source: ECONOMY_SOURCES.urbanRural,
    title: "Propose urban/rural for each institution from its HQ county",
    fixedPartition: ECONOMY_CURRENT_PARTITION,
    partitions: () => [ECONOMY_CURRENT_PARTITION],
  },
  { source: ECONOMY_SOURCES.qcew, title: "Pull BLS county employment and wages (QCEW)", partitions: (now) => years(now.getUTCFullYear() - 6, now.getUTCFullYear() - 1) },
  { source: ECONOMY_SOURCES.cbp, title: "Pull Census County Business Patterns establishments", partitions: (now) => years(now.getUTCFullYear() - 6, now.getUTCFullYear() - 2) },
  { source: ECONOMY_SOURCES.saipe, title: "Pull Census county poverty estimates (SAIPE)", partitions: (now) => years(now.getUTCFullYear() - 6, now.getUTCFullYear() - 2) },
  { source: ECONOMY_SOURCES.bea, title: "Pull BEA personal income by county, state and metro", partitions: (now) => years(now.getUTCFullYear() - 5, now.getUTCFullYear() - 1) },
  {
    source: ECONOMY_SOURCES.fhfa,
    title: "Pull the FHFA house price index by state and metro",
    fixedPartition: ECONOMY_CURRENT_PARTITION,
    partitions: () => [ECONOMY_CURRENT_PARTITION],
  },
  {
    source: ECONOMY_SOURCES.fdicSurvey,
    title: "Pull FDIC unbanked and underbanked household estimates",
    // Biennial survey, fielded in odd years.
    partitions: (now) => years(2009, now.getUTCFullYear() - 1).filter((y) => Number(y) % 2 === 1),
  },
  { source: ECONOMY_SOURCES.shed, title: "Summarise the Fed household survey's bank account and overdraft questions", partitions: (now) => years(SHED_FIRST_YEAR, now.getUTCFullYear() - 1) },
  {
    source: ECONOMY_SOURCES.fdicIndustry,
    title: "Sum FDIC industry totals for the quarter",
    partitions: (now) => quartersNewestFirst(FDIC_INDUSTRY_FIRST, latestPublishableQuarter(now, FDIC_INDUSTRY_LAG_DAYS)).map(quarterKey),
  },
  {
    source: ECONOMY_SOURCES.fdicRates,
    title: "Pull FDIC national deposit rates and rate caps",
    fixedPartition: ECONOMY_CURRENT_PARTITION,
    partitions: () => [ECONOMY_CURRENT_PARTITION],
  },
  {
    source: ECONOMY_SOURCES.paymentChoice,
    title: "Pull Atlanta Fed consumer payment choice summary tables",
    fixedPartition: ECONOMY_CURRENT_PARTITION,
    partitions: () => [ECONOMY_CURRENT_PARTITION],
  },
  {
    source: ECONOMY_SOURCES.remittances,
    title: "Pull World Bank remittance prices for US-send corridors",
    fixedPartition: ECONOMY_CURRENT_PARTITION,
    partitions: () => [ECONOMY_CURRENT_PARTITION],
  },
  {
    source: ECONOMY_SOURCES.hudCrosswalk,
    title: "Pull the HUD ZIP-to-county crosswalk",
    fixedPartition: ECONOMY_CURRENT_PARTITION,
    partitions: () => [ECONOMY_CURRENT_PARTITION],
  },
];

/** A source's partitions, newest first. */
export function economyPartitions(source: string, now: Date): string[] {
  return ECONOMY_DEFINITIONS.find((d) => d.source === source)?.partitions(now) ?? [];
}

export interface RegistryEconomyOptions {
  source: string;
  partitionKey: string;
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface RegistryEconomyResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  /** Rows read (after dropping exact duplicate keys). */
  rows: number;
  writtenRows: number;
  matchedCount: number | null;
  unmatchedCount: number | null;
  missingFields: string[];
  checks: AreaStatChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  /** Nothing loaded for want of a key, token or configured URL. */
  skipped: boolean;
  summary: string;
  detail: Record<string, unknown>;
}

const n = (value: number) => value.toLocaleString("en-US");
const dry = (flag: boolean) => (flag ? " (dry run)" : "");

function result(options: RegistryEconomyOptions, partial: Partial<RegistryEconomyResult> & { summary: string }): RegistryEconomyResult {
  return {
    source: options.source,
    partitionKey: options.partitionKey,
    sourceUrl: null,
    rows: 0,
    writtenRows: 0,
    matchedCount: null,
    unmatchedCount: null,
    missingFields: [],
    checks: null,
    dryRun: Boolean(options.dryRun),
    empty: false,
    emptyReason: null,
    skipped: false,
    detail: {},
    ...partial,
  };
}

async function recordEmpty(
  db: RegistryDb,
  options: RegistryEconomyOptions,
  reason: string,
  retryHours: number,
  sourceUrl: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (options.dryRun) return;
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "empty",
    rowCount: 0,
    sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: retryHours,
    detail: { parser_version: ECONOMY_PARSER_VERSION, reason, ...extra },
  });
}

// ---------------------------------------------------------------------------
// area_statistics
// ---------------------------------------------------------------------------

export async function upsertAreaStats(db: RegistryDb, source: string, rows: AreaStat[], sourceUrl: string | null, runId: number | null): Promise<number> {
  let written = 0;
  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const payload = JSON.stringify(
      group.map((r) => ({
        geo_type: r.geo_type,
        geo_code: r.geo_code,
        geo_name: r.geo_name,
        state_code: r.state_code,
        period: r.period,
        series_key: r.series_key,
        value: r.value,
        unit: r.unit,
        note: r.note,
        raw_json: r.raw,
      })),
    );
    const out = await db`
      INSERT INTO area_statistics
        (source, geo_type, geo_code, geo_name, state_code, period, series_key, value, unit, note,
         raw_json, source_url, agent_run_id, fetched_at)
      SELECT ${source}, r.geo_type, r.geo_code, r.geo_name, r.state_code, r.period, r.series_key, r.value,
             r.unit, r.note, COALESCE(r.raw_json, '{}'::jsonb), ${sourceUrl}, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          geo_type text, geo_code text, geo_name text, state_code text, period text, series_key text,
          value double precision, unit text, note text, raw_json jsonb)
      ON CONFLICT (source, geo_type, geo_code, period, series_key) DO UPDATE SET
        geo_name = EXCLUDED.geo_name,
        state_code = EXCLUDED.state_code,
        value = EXCLUDED.value,
        unit = EXCLUDED.unit,
        note = EXCLUDED.note,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  return written;
}

interface AreaRunPlan {
  label: string;
  refreshHours: number;
  emptyRetryHours: number;
}

/** Shared path for every source that lands in area_statistics. `fetched` null = not published yet. */
async function runAreaSource(db: RegistryDb, options: RegistryEconomyOptions, fetched: AreaFetch | null, plan: AreaRunPlan): Promise<RegistryEconomyResult> {
  if (!fetched || fetched.rows.length === 0) {
    const reason = fetched?.emptyReason ?? `${plan.label} ${options.partitionKey} is not published yet`;
    await recordEmpty(db, options, reason, plan.emptyRetryHours, fetched?.url ?? null, { missing_fields: fetched?.missingFields ?? [], skipped_records: fetched?.skipped ?? {} });
    return result(options, {
      sourceUrl: fetched?.url ?? null,
      missingFields: fetched?.missingFields ?? [],
      empty: true,
      emptyReason: reason,
      summary: `${plan.label} ${options.partitionKey}: nothing loaded. ${reason}${dry(Boolean(options.dryRun))}.`,
      detail: { empty_reason: reason, missing_fields: fetched?.missingFields ?? [], skipped_records: fetched?.skipped ?? {} },
    });
  }
  const checks = checkAreaStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  const byGeo: Record<string, number> = {};
  for (const r of rows) byGeo[r.geo_type] = (byGeo[r.geo_type] ?? 0) + 1;
  const detail = {
    parser_version: ECONOMY_PARSER_VERSION,
    rows: rows.length,
    rows_by_geo_type: byGeo,
    series: [...new Set(rows.map((r) => r.series_key))],
    missing_fields: fetched.missingFields,
    skipped_records: fetched.skipped,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    duplicate_examples: checks.duplicateExamples,
    flagged_values: checks.flagged,
  };
  const gaps = fetched.missingFields.length > 0 ? `; not found: ${fetched.missingFields.slice(0, 6).join(", ")}` : "";
  const geoText = Object.entries(byGeo).map(([g, c]) => `${n(c)} ${g}`).join(", ");
  if (options.dryRun) {
    return result(options, { sourceUrl: fetched.url, rows: rows.length, missingFields: fetched.missingFields, checks, summary: `${plan.label} ${options.partitionKey}: read ${n(rows.length)} values (${geoText})${gaps} (dry run).`, detail });
  }
  const written = await upsertAreaStats(db, options.source, rows, fetched.url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: plan.refreshHours,
    detail,
  });
  return result(options, {
    sourceUrl: fetched.url,
    rows: rows.length,
    writtenRows: written,
    missingFields: fetched.missingFields,
    checks,
    summary: `Magellan loaded ${plan.label} ${options.partitionKey}: ${n(written)} values (${geoText})${gaps}.`,
    detail: { ...detail, written_rows: written },
  });
}

/** A step with nothing to load until a key, token or URL is configured. */
async function skipFor(db: RegistryDb, options: RegistryEconomyOptions, label: string, reason: string, retryHours: number): Promise<RegistryEconomyResult> {
  await recordEmpty(db, options, reason, retryHours, null, { no_key: true });
  return result(options, { empty: true, emptyReason: reason, skipped: true, summary: `Skipped ${label} ${options.partitionKey}: ${reason}.`, detail: { empty_reason: reason, no_key: true } });
}

function censusKeyReason(env: Record<string, string | undefined>): string {
  // The "No CENSUS_API_KEY set" prefix is what the scheduler looks for to re-run once a key is set.
  return env.CENSUS_API_KEY?.trim()
    ? "Census rejected CENSUS_API_KEY; check the key"
    : "No CENSUS_API_KEY set; Census requires a key, so this year was skipped";
}

function yearOf(options: RegistryEconomyOptions, min: number): number {
  const year = Number(options.partitionKey);
  if (!Number.isInteger(year) || year < min) throw new Error(`Invalid year partition for ${options.source}: ${options.partitionKey}`);
  return year;
}

function recentRefresh(year: number, now: Date): number {
  return now.getUTCFullYear() - year <= 2 ? HOURS.quarter : HOURS.year;
}

// ---------------------------------------------------------------------------
// FFIEC census tracts -> census_tracts
// ---------------------------------------------------------------------------

async function upsertTracts(db: RegistryDb, rows: CensusTractRow[]): Promise<number> {
  let written = 0;
  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const payload = JSON.stringify(group);
    const out = await db`
      INSERT INTO census_tracts
        (tract_id, state_fips, county_fips, msa_code, income_level, median_family_income,
         tract_median_income, income_ratio, year, fetched_at)
      SELECT r.tract_id, r.state_fips, r.county_fips, r.msa_code, r.income_level, r.median_family_income,
             r.tract_median_income, r.income_ratio, r.year, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          tract_id text, state_fips text, county_fips text, msa_code text, income_level text,
          median_family_income integer, tract_median_income integer, income_ratio double precision, year integer)
      ON CONFLICT (tract_id, year) DO UPDATE SET
        state_fips = EXCLUDED.state_fips,
        county_fips = EXCLUDED.county_fips,
        msa_code = EXCLUDED.msa_code,
        income_level = EXCLUDED.income_level,
        median_family_income = EXCLUDED.median_family_income,
        tract_median_income = EXCLUDED.tract_median_income,
        income_ratio = EXCLUDED.income_ratio,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  return written;
}

async function runFfiecTracts(db: RegistryDb, options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const year = yearOf(options, 2000);
  const fetched = await fetchFfiecTracts(year, options.fetchOptions);
  const levels: Record<string, number> = {};
  for (const r of fetched.rows) levels[r.income_level ?? "unknown"] = (levels[r.income_level ?? "unknown"] ?? 0) + 1;
  const detail = {
    parser_version: ECONOMY_PARSER_VERSION,
    year,
    file: fetched.file,
    layout: fetched.layout,
    tracts: fetched.rows.length,
    duplicate_tracts: fetched.duplicateTracts,
    income_levels: levels,
    income_level_basis: "CRA thresholds on the file's tract-to-area median family income ratio",
  };
  if (fetched.emptyReason || fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? "FFIEC file held no tracts";
    await recordEmpty(db, options, reason, HOURS.week, fetched.url, detail);
    return result(options, { sourceUrl: fetched.url, empty: true, emptyReason: reason, summary: `FFIEC census tracts ${year}: nothing loaded. ${reason}${dry(Boolean(options.dryRun))}.`, detail });
  }
  const levelText = `${n(levels.low ?? 0)} low, ${n(levels.moderate ?? 0)} moderate, ${n(levels.middle ?? 0)} middle, ${n(levels.upper ?? 0)} upper, ${n(levels.unknown ?? 0)} unknown`;
  if (options.dryRun) {
    return result(options, { sourceUrl: fetched.url, rows: fetched.rows.length, summary: `FFIEC census tracts ${year}: read ${n(fetched.rows.length)} tracts (${levelText}) (dry run).`, detail });
  }
  const written = await upsertTracts(db, fetched.rows);
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: fetched.rows.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: recentRefresh(year, options.now ?? new Date()),
    detail: { ...detail, written_rows: written },
  });
  return result(options, { sourceUrl: fetched.url, rows: fetched.rows.length, writtenRows: written, summary: `Magellan loaded ${n(written)} FFIEC census tracts for ${year}: ${levelText}.`, detail: { ...detail, written_rows: written } });
}

// ---------------------------------------------------------------------------
// Branches -> census tracts (branch_census_tracts)
// ---------------------------------------------------------------------------

interface PendingBranch {
  branch_kind: "bank" | "credit_union";
  branch_key: string;
  institution_id: string | number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  address_hash: string;
}

/**
 * Current branches: bank offices in the newest Summary of Deposits year and every credit union
 * office. A branch is pending when it has no placement yet or its address changed.
 */
async function pendingBranches(db: RegistryDb, limit: number): Promise<{ rows: PendingBranch[]; pending: number }> {
  const rows = await db<Array<PendingBranch & { pending: number }>>`
    WITH bank AS (
      SELECT 'bank'::text AS branch_kind, d.cert::text || ':' || d.branch_number::text AS branch_key,
             d.institution_id, d.address, d.city, d.state, left(d.zip, 5) AS zip, d.latitude, d.longitude,
             d.is_main_office
        FROM institution_branch_deposits d
       WHERE d.year = (SELECT MAX(year) FROM institution_branch_deposits)
    ), cu AS (
      SELECT 'credit_union'::text, b.charter || ':' || b.site_id, b.institution_id, b.address, b.city, b.state,
             left(b.zip, 5), b.latitude, b.longitude, b.is_main_office
        FROM credit_union_branches b
    ), branches AS (
      SELECT a.*, md5(concat_ws('|', upper(a.address), upper(a.city), upper(a.state), a.zip)) AS address_hash
        FROM (SELECT * FROM bank UNION ALL SELECT * FROM cu) a
    ), pending AS (
      SELECT b.*
        FROM branches b
        LEFT JOIN branch_census_tracts t ON t.branch_kind = b.branch_kind AND t.branch_key = b.branch_key
       WHERE t.id IS NULL OR t.address_hash IS DISTINCT FROM b.address_hash
    )
    SELECT p.branch_kind, p.branch_key, p.institution_id, p.address, p.city, p.state, p.zip, p.latitude,
           p.longitude, p.address_hash, COUNT(*) OVER ()::int AS pending
      FROM pending p
     ORDER BY p.is_main_office DESC, p.branch_kind, p.branch_key
     LIMIT ${limit}
  `;
  const list = [...rows];
  return { rows: list, pending: list[0]?.pending ?? 0 };
}

async function upsertPlacements(db: RegistryDb, rows: Array<PendingBranch & TractPlacement>, runId: number | null): Promise<number> {
  let written = 0;
  for (const group of chunk(rows, UPSERT_CHUNK)) {
    const payload = JSON.stringify(
      group.map((r) => ({
        branch_kind: r.branch_kind,
        branch_key: r.branch_key,
        institution_id: r.institution_id === null ? null : Number(r.institution_id),
        address_hash: r.address_hash,
        status: r.status,
        state_fips: r.state_fips,
        county_fips: r.county_fips,
        tract_id: r.tract_id,
      })),
    );
    const out = await db`
      INSERT INTO branch_census_tracts
        (branch_kind, branch_key, institution_id, address_hash, status, state_fips, county_fips, tract_id,
         tract_vintage, agent_run_id, placed_at)
      SELECT r.branch_kind, r.branch_key, r.institution_id, r.address_hash, r.status, r.state_fips,
             r.county_fips, r.tract_id, 2020, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          branch_kind text, branch_key text, institution_id bigint, address_hash text, status text,
          state_fips text, county_fips text, tract_id text)
      ON CONFLICT (branch_kind, branch_key) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        address_hash = EXCLUDED.address_hash,
        status = EXCLUDED.status,
        state_fips = EXCLUDED.state_fips,
        county_fips = EXCLUDED.county_fips,
        tract_id = EXCLUDED.tract_id,
        agent_run_id = EXCLUDED.agent_run_id,
        placed_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  return written;
}

async function runBranchTracts(db: RegistryDb, options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const { rows, pending } = await pendingBranches(db, BRANCH_TRACT_BATCH);
  const withAddress = rows.filter((r) => r.address && r.city && r.state);
  const placements = new Map<string, TractPlacement>();
  for (const r of rows) {
    if (!withAddress.includes(r)) placements.set(`${r.branch_kind}|${r.branch_key}`, { id: "", status: "no_address", state_fips: null, county_fips: null, tract_id: null });
  }
  let pointLookups = 0;
  if (!options.dryRun && withAddress.length > 0) {
    const inputs: GeocodeInput[] = withAddress.map((r, i) => ({ id: String(i), street: r.address!, city: r.city!, state: r.state!, zip: r.zip }));
    const placed = await placeAddressesInTracts(inputs, options.fetchOptions);
    const byId = new Map(placed.map((p) => [p.id, p]));
    withAddress.forEach((r, i) => {
      placements.set(`${r.branch_kind}|${r.branch_key}`, byId.get(String(i)) ?? { id: String(i), status: "no_match", state_fips: null, county_fips: null, tract_id: null });
    });
    // Address not matched but coordinates on file (SOD carries them; NCUA offices once geocoded): one lookup each.
    const retry = withAddress
      .filter((r) => placements.get(`${r.branch_kind}|${r.branch_key}`)?.status !== "matched" && r.latitude !== null && r.longitude !== null)
      .slice(0, BRANCH_POINT_LOOKUPS);
    pointLookups = retry.length;
    await mapWithConcurrency(retry, 4, async (r) => {
      const tract = await placePointInTract(r.latitude!, r.longitude!, options.fetchOptions);
      if (tract) placements.set(`${r.branch_kind}|${r.branch_key}`, { id: "", status: "matched_coordinates", state_fips: tract.slice(0, 2), county_fips: tract.slice(0, 5), tract_id: tract });
    });
  }
  const counts: Record<string, number> = {};
  for (const p of placements.values()) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const base = { parser_version: ECONOMY_PARSER_VERSION, pending_before: pending, batch: rows.length, sent_to_geocoder: withAddress.length, point_lookups: pointLookups, outcomes: counts };
  if (options.dryRun) {
    return result(options, {
      rows: rows.length,
      summary: `${n(pending)} branches wait for a census tract; the next batch holds ${n(rows.length)}, ${n(rows.length - withAddress.length)} without a street address (dry run).`,
      detail: base,
    });
  }
  const toWrite = rows.map((r) => ({ ...r, ...placements.get(`${r.branch_kind}|${r.branch_key}`)! }));
  const written = await upsertPlacements(db, toWrite, options.runId ?? null);
  const placedNow = (counts.matched ?? 0) + (counts.matched_coordinates ?? 0);
  const remaining = Math.max(0, pending - rows.length);
  const [totals] = await db<Array<{ placed: number; no_match: number; no_address: number; tie: number }>>`
    SELECT COUNT(*) FILTER (WHERE status IN ('matched', 'matched_coordinates'))::int AS placed,
           COUNT(*) FILTER (WHERE status = 'no_match')::int AS no_match,
           COUNT(*) FILTER (WHERE status = 'no_address')::int AS no_address,
           COUNT(*) FILTER (WHERE status = 'tie')::int AS tie
      FROM branch_census_tracts
  `;
  const detail = { ...base, written_rows: written, remaining, totals: totals ?? null };
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: rows.length === 0 ? "empty" : "succeeded",
    rowCount: rows.length,
    matchedCount: placedNow,
    unmatchedCount: rows.length - placedNow,
    insertedCount: written,
    sourceUrl: null,
    runId: options.runId ?? null,
    nextAttemptAfterHours: remaining > 0 ? 1 : HOURS.week,
    detail,
  });
  const cannot = totals ? totals.no_match + totals.no_address + totals.tie : null;
  return result(options, {
    rows: rows.length,
    writtenRows: written,
    matchedCount: placedNow,
    unmatchedCount: rows.length - placedNow,
    empty: rows.length === 0,
    emptyReason: rows.length === 0 ? "Every current branch already has a placement" : null,
    summary:
      rows.length === 0
        ? `Every current branch already has a census tract placement${cannot !== null ? `; ${n(cannot)} could not be placed` : ""}.`
        : `Magellan placed ${n(placedNow)} of ${n(rows.length)} branches in census tracts (${n(counts.no_address ?? 0)} without an address, ${n((counts.no_match ?? 0) + (counts.tie ?? 0))} not matched); ${n(remaining)} still to go${cannot !== null ? `; ${n(cannot)} branches in all cannot be placed` : ""}.`,
    detail,
  });
}

// ---------------------------------------------------------------------------
// institution_sources.urban_rural from the HQ county's RUCC (proposal by default)
// ---------------------------------------------------------------------------

export interface UrbanRuralCounts {
  source: string;
  institutions: number;
  with_hq_county: number;
  county_without_rucc: number;
  urban: number;
  rural: number;
  unchanged: number;
  would_fill: number;
  /** Stored value disagrees with the RUCC class: listed for review, never overwritten. */
  conflicts: number;
}

async function runUrbanRural(db: RegistryDb, options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const env = options.env ?? process.env;
  const writeEnabled = env[URBAN_RURAL_WRITE_ENV]?.trim().toLowerCase() === "true";
  const counts = [
    ...(await db<UrbanRuralCounts[]>`
      WITH rucc AS (
        SELECT DISTINCT ON (geo_code) geo_code, value
          FROM area_statistics
         WHERE source = 'usda-rucc' AND geo_type = 'county' AND series_key = 'rucc_code'
         ORDER BY geo_code, period DESC
      ), p AS (
        SELECT s.source, s.urban_rural AS current_value, h.county_fips, r.value AS rucc,
               CASE WHEN r.value BETWEEN 1 AND 3 THEN 'urban' WHEN r.value BETWEEN 4 AND 9 THEN 'rural' END AS proposed
          FROM institution_sources s
          LEFT JOIN institution_hq_counties h ON h.institution_id = s.id
          LEFT JOIN rucc r ON r.geo_code = h.county_fips
         WHERE s.source IN ('fdic', 'ncua') AND COALESCE(s.regulatory_status, 'active') = 'active'
      )
      SELECT source,
             COUNT(*)::int AS institutions,
             COUNT(county_fips)::int AS with_hq_county,
             COUNT(*) FILTER (WHERE county_fips IS NOT NULL AND rucc IS NULL)::int AS county_without_rucc,
             COUNT(*) FILTER (WHERE proposed = 'urban')::int AS urban,
             COUNT(*) FILTER (WHERE proposed = 'rural')::int AS rural,
             COUNT(*) FILTER (WHERE proposed IS NOT NULL AND current_value = proposed)::int AS unchanged,
             COUNT(*) FILTER (WHERE proposed IS NOT NULL AND current_value IS NULL)::int AS would_fill,
             COUNT(*) FILTER (WHERE proposed IS NOT NULL AND current_value IS NOT NULL AND current_value <> proposed)::int AS conflicts
        FROM p
       GROUP BY source
       ORDER BY source
    `),
  ];
  const sum = (k: keyof Omit<UrbanRuralCounts, "source">) => counts.reduce((acc, c) => acc + Number(c[k] ?? 0), 0);
  const detail = {
    parser_version: ECONOMY_PARSER_VERSION,
    mode: writeEnabled && !options.dryRun ? "write" : "proposal",
    rule: "RUCC 1-3 (metro county) -> urban; 4-9 (nonmetro) -> rural; HQ county from the SOD main office (banks) or the NCUA main office (credit unions)",
    by_source: counts,
  };
  const proposalText = `${n(sum("institutions"))} institutions, ${n(sum("with_hq_county"))} with an HQ county; ${n(sum("urban"))} urban, ${n(sum("rural"))} rural; ${n(sum("would_fill"))} blanks to fill, ${n(sum("conflicts"))} stored values disagree, ${n(sum("county_without_rucc"))} HQ counties have no RUCC`;
  if (options.dryRun || !writeEnabled) {
    if (!options.dryRun) {
      await recordRegistryPartition(db, {
        source: options.source,
        partitionKey: options.partitionKey,
        status: "succeeded",
        rowCount: sum("institutions"),
        matchedCount: sum("urban") + sum("rural"),
        unmatchedCount: sum("institutions") - sum("urban") - sum("rural"),
        insertedCount: 0,
        runId: options.runId ?? null,
        nextAttemptAfterHours: HOURS.week,
        detail: { ...detail, write_disabled_reason: `${URBAN_RURAL_WRITE_ENV} is not true; counts only` },
      });
    }
    return result(options, {
      rows: sum("institutions"),
      matchedCount: sum("urban") + sum("rural"),
      unmatchedCount: sum("institutions") - sum("urban") - sum("rural"),
      summary: `Urban/rural proposal (nothing written): ${proposalText}${dry(Boolean(options.dryRun))}.`,
      detail,
    });
  }
  const updated = [
    ...(await db`
      WITH rucc AS (
        SELECT DISTINCT ON (geo_code) geo_code, value
          FROM area_statistics
         WHERE source = 'usda-rucc' AND geo_type = 'county' AND series_key = 'rucc_code'
         ORDER BY geo_code, period DESC
      ), p AS (
        SELECT s.id, CASE WHEN r.value BETWEEN 1 AND 3 THEN 'urban' WHEN r.value BETWEEN 4 AND 9 THEN 'rural' END AS proposed
          FROM institution_sources s
          JOIN institution_hq_counties h ON h.institution_id = s.id
          JOIN rucc r ON r.geo_code = h.county_fips
         WHERE s.source IN ('fdic', 'ncua') AND s.urban_rural IS NULL
           AND COALESCE(s.regulatory_status, 'active') = 'active'
      )
      UPDATE institution_sources s
         SET urban_rural = p.proposed
        FROM p
       WHERE s.id = p.id AND p.proposed IS NOT NULL AND s.urban_rural IS NULL
      RETURNING s.id
    `),
  ].length;
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: sum("institutions"),
    matchedCount: sum("urban") + sum("rural"),
    unmatchedCount: sum("institutions") - sum("urban") - sum("rural"),
    insertedCount: updated,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.week,
    detail: { ...detail, filled: updated },
  });
  return result(options, {
    rows: sum("institutions"),
    writtenRows: updated,
    matchedCount: sum("urban") + sum("rural"),
    unmatchedCount: sum("institutions") - sum("urban") - sum("rural"),
    summary: `Magellan filled urban/rural for ${n(updated)} institutions from their HQ county: ${proposalText}.`,
    detail: { ...detail, filled: updated },
  });
}

// ---------------------------------------------------------------------------
// FDIC industry totals
// ---------------------------------------------------------------------------

async function runFdicIndustry(db: RegistryDb, options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const q = parseQuarterKey(options.partitionKey);
  if (!q) throw new Error(`Invalid quarter partition for ${options.source}: ${options.partitionKey}`);
  const fetched = await fetchIndustryRecords(fdicRepdte(q), options.fetchOptions);
  if (fetched.records.length === 0) {
    return runAreaSource(db, options, { url: fetched.url, rows: [], missingFields: [], skipped: {}, emptyReason: `FDIC has no ${options.partitionKey} filings yet` }, { label: "FDIC industry totals", refreshHours: HOURS.month, emptyRetryHours: HOURS.week });
  }
  const totals = sumIndustry(fetched.records);
  const truncated = fetched.records.length < fetched.total;
  const area: AreaFetch = {
    url: fetched.url,
    rows: truncated ? [] : industryStats(options.partitionKey, totals),
    missingFields: totals.missingFields,
    skipped: totals.duplicateCerts > 0 ? { duplicate_certs: totals.duplicateCerts } : {},
    // A partial read would understate every total: load nothing rather than a wrong sum.
    emptyReason: truncated ? `FDIC reported ${fetched.total} filers but ${fetched.records.length} were read` : null,
  };
  const recent = (options.now ?? new Date()).getUTCFullYear() - q.year <= 1;
  return runAreaSource(db, options, area, { label: "FDIC industry totals", refreshHours: recent ? HOURS.month : HOURS.year, emptyRetryHours: HOURS.day });
}

// ---------------------------------------------------------------------------
// Remittance prices and the HUD crosswalk (own tables)
// ---------------------------------------------------------------------------

async function runRemittances(db: RegistryDb, options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const env = options.env ?? process.env;
  const url = env[RPW_URL_ENV]?.trim();
  if (!url) return skipFor(db, options, "World Bank remittance prices", `No ${RPW_URL_ENV} set; the RPW dataset is published as a workbook and no CSV download is confirmed`, HOURS.week);
  const response = await registryFetch(url, { timeoutMs: 180_000, ...options.fetchOptions });
  const parsed = parseRemittancePrices(await response.text());
  const unique = [...new Map(parsed.rows.map((r) => [`${r.period}|${r.destination_country}|${r.firm}|${r.product ?? ""}`, r])).values()];
  const detail = {
    parser_version: ECONOMY_PARSER_VERSION,
    rows: unique.length,
    duplicate_keys: parsed.rows.length - unique.length,
    non_us_rows: parsed.nonUsRows,
    missing_fields: parsed.missingFields,
    corridors: new Set(unique.map((r) => r.destination_country)).size,
    firms: new Set(unique.map((r) => r.firm)).size,
    blank_fee: unique.filter((r) => r.fee === null).length,
    negative_values: unique.filter((r) => [r.fee, r.fx_margin_pct, r.total_cost_pct].some((v) => v !== null && v < 0)).length,
  };
  if (unique.length === 0) {
    const reason = parsed.emptyReason ?? "No US-send rows";
    await recordEmpty(db, options, reason, HOURS.week, url, detail);
    return result(options, { sourceUrl: url, empty: true, emptyReason: reason, missingFields: parsed.missingFields, summary: `World Bank remittance prices: nothing loaded. ${reason}${dry(Boolean(options.dryRun))}.`, detail });
  }
  if (options.dryRun) return result(options, { sourceUrl: url, rows: unique.length, missingFields: parsed.missingFields, summary: `World Bank remittance prices: read ${n(unique.length)} US-send quotes across ${n(detail.corridors)} corridors (dry run).`, detail });
  let written = 0;
  let linked = 0;
  for (const group of chunk(unique, UPSERT_CHUNK)) {
    const payload = JSON.stringify(group.map((r) => ({ ...r, raw_json: r.raw, raw: undefined })));
    const out = await db<Array<{ linked: boolean }>>`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          period text, source_country text, destination_country text, firm text, firm_type text, product text,
          amount_sent double precision, fee double precision, fx_margin_pct double precision,
          total_cost_pct double precision, raw_json jsonb)
      ), names AS (
        -- Exact name only (case aside), and only when one institution carries it.
        SELECT lower(institution_name) AS name, MIN(id) AS institution_id
          FROM institution_sources
         WHERE lower(institution_name) IN (SELECT lower(firm) FROM r)
         GROUP BY lower(institution_name)
        HAVING COUNT(*) = 1
      )
      INSERT INTO remittance_prices
        (period, source_country, destination_country, firm, firm_type, product, amount_sent, fee,
         fx_margin_pct, total_cost_pct, institution_id, raw_json, source_url, agent_run_id, fetched_at)
      SELECT r.period, r.source_country, r.destination_country, r.firm, r.firm_type, r.product, r.amount_sent,
             r.fee, r.fx_margin_pct, r.total_cost_pct, names.institution_id, COALESCE(r.raw_json, '{}'::jsonb),
             ${url}, ${options.runId ?? null}, NOW()
        FROM r LEFT JOIN names ON names.name = lower(r.firm)
      ON CONFLICT (period, source_country, destination_country, firm, (COALESCE(product, ''))) DO UPDATE SET
        firm_type = EXCLUDED.firm_type,
        amount_sent = EXCLUDED.amount_sent,
        fee = EXCLUDED.fee,
        fx_margin_pct = EXCLUDED.fx_margin_pct,
        total_cost_pct = EXCLUDED.total_cost_pct,
        institution_id = EXCLUDED.institution_id,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING (institution_id IS NOT NULL) AS linked
    `;
    const list = [...out];
    written += list.length;
    linked += list.filter((x) => x.linked).length;
  }
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: unique.length,
    matchedCount: linked,
    unmatchedCount: written - linked,
    insertedCount: written,
    sourceUrl: url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.quarter,
    detail: { ...detail, written_rows: written, linked_to_institution: linked },
  });
  return result(options, {
    sourceUrl: url,
    rows: unique.length,
    writtenRows: written,
    matchedCount: linked,
    unmatchedCount: written - linked,
    missingFields: parsed.missingFields,
    summary: `Magellan loaded ${n(written)} US-send remittance quotes across ${n(detail.corridors)} corridors; ${n(linked)} name an institution we track exactly.`,
    detail: { ...detail, written_rows: written, linked_to_institution: linked },
  });
}

async function runHudCrosswalk(db: RegistryDb, options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const env = options.env ?? process.env;
  const token = env[HUD_TOKEN_ENV]?.trim();
  if (!token) return skipFor(db, options, "HUD ZIP-to-county crosswalk", `No ${HUD_TOKEN_ENV} set; HUD's crosswalk API needs a free token`, HOURS.day);
  let fetched: { url: string; body: unknown };
  try {
    fetched = await fetchHudCrosswalk(token, options.fetchOptions);
  } catch (error) {
    if (error instanceof HudTokenError) return skipFor(db, options, "HUD ZIP-to-county crosswalk", `HUD rejected ${HUD_TOKEN_ENV}; check the token`, HOURS.day);
    throw error;
  }
  const parsed = parseHudCrosswalk(fetched.body);
  const unique = [...new Map(parsed.rows.map((r) => [`${r.zip}|${r.county_fips}`, r])).values()];
  const ratioOutOfRange = unique.filter((r) => [r.res_ratio, r.bus_ratio, r.oth_ratio, r.tot_ratio].some((v) => v !== null && (v < 0 || v > 1))).length;
  const detail = {
    parser_version: ECONOMY_PARSER_VERSION,
    period: parsed.period,
    rows: unique.length,
    zips: new Set(unique.map((r) => r.zip)).size,
    duplicate_keys: parsed.rows.length - unique.length,
    skipped_records: parsed.skipped,
    missing_fields: parsed.missingFields,
    ratio_out_of_range: ratioOutOfRange,
  };
  if (unique.length === 0 || !parsed.period) {
    const reason = !parsed.period ? "HUD reply carried no year/quarter" : "HUD reply held no ZIP rows";
    await recordEmpty(db, options, reason, HOURS.week, fetched.url, detail);
    return result(options, { sourceUrl: fetched.url, empty: true, emptyReason: reason, missingFields: parsed.missingFields, summary: `HUD ZIP-to-county crosswalk: nothing loaded. ${reason}${dry(Boolean(options.dryRun))}.`, detail });
  }
  if (options.dryRun) return result(options, { sourceUrl: fetched.url, rows: unique.length, missingFields: parsed.missingFields, summary: `HUD ZIP-to-county crosswalk ${parsed.period}: read ${n(unique.length)} ZIP-county pairs for ${n(detail.zips)} ZIPs (dry run).`, detail });
  let written = 0;
  for (const group of chunk(unique, UPSERT_CHUNK * 2)) {
    const payload = JSON.stringify(group);
    const out = await db`
      INSERT INTO zip_county_crosswalk
        (period, zip, county_fips, state_code, city, res_ratio, bus_ratio, oth_ratio, tot_ratio, agent_run_id, fetched_at)
      SELECT ${parsed.period}, r.zip, r.county_fips, r.state_code, r.city, r.res_ratio, r.bus_ratio, r.oth_ratio,
             r.tot_ratio, ${options.runId ?? null}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          zip text, county_fips text, state_code text, city text, res_ratio double precision,
          bus_ratio double precision, oth_ratio double precision, tot_ratio double precision)
      ON CONFLICT (period, zip, county_fips) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        city = EXCLUDED.city,
        res_ratio = EXCLUDED.res_ratio,
        bus_ratio = EXCLUDED.bus_ratio,
        oth_ratio = EXCLUDED.oth_ratio,
        tot_ratio = EXCLUDED.tot_ratio,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  await recordRegistryPartition(db, {
    source: options.source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: unique.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.quarter,
    detail: { ...detail, written_rows: written },
  });
  return result(options, {
    sourceUrl: fetched.url,
    rows: unique.length,
    writtenRows: written,
    missingFields: parsed.missingFields,
    summary: `Magellan loaded the ${parsed.period} HUD ZIP-to-county crosswalk: ${n(written)} pairs for ${n(detail.zips)} ZIPs.`,
    detail: { ...detail, written_rows: written },
  });
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function runRegistryEconomy(options: RegistryEconomyOptions): Promise<RegistryEconomyResult> {
  const db = options.db ?? sql;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const fo = options.fetchOptions;
  switch (options.source) {
    case ECONOMY_SOURCES.rucc: {
      yearOf(options, 1970);
      return runAreaSource(db, options, await fetchRucc(options.partitionKey, fo), { label: "USDA rural-urban continuum codes", refreshHours: HOURS.year, emptyRetryHours: HOURS.month });
    }
    case ECONOMY_SOURCES.ffiecTracts:
      return runFfiecTracts(db, options);
    case ECONOMY_SOURCES.branchTracts:
      return runBranchTracts(db, options);
    case ECONOMY_SOURCES.urbanRural:
      return runUrbanRural(db, options);
    case ECONOMY_SOURCES.qcew: {
      const year = yearOf(options, 1990);
      return runAreaSource(db, options, await fetchQcew(year, fo), { label: "BLS QCEW annual averages", refreshHours: recentRefresh(year, now), emptyRetryHours: HOURS.week });
    }
    case ECONOMY_SOURCES.cbp:
    case ECONOMY_SOURCES.saipe: {
      const year = yearOf(options, 1990);
      const label = options.source === ECONOMY_SOURCES.cbp ? "Census County Business Patterns" : "Census SAIPE poverty estimates";
      try {
        const fetched = options.source === ECONOMY_SOURCES.cbp ? await fetchCbp(year, fo) : await fetchSaipe(year, fo);
        return runAreaSource(db, options, fetched, { label, refreshHours: recentRefresh(year, now), emptyRetryHours: HOURS.week });
      } catch (error) {
        if (!(error instanceof CensusKeyError)) throw error;
        return skipFor(db, options, label, censusKeyReason(env), HOURS.day);
      }
    }
    case ECONOMY_SOURCES.bea: {
      const year = yearOf(options, 1990);
      const key = env[BEA_KEY_ENV]?.trim();
      if (!key) return skipFor(db, options, "BEA personal income", `No ${BEA_KEY_ENV} set; BEA's API needs a free key, so this year was skipped`, HOURS.day);
      try {
        return runAreaSource(db, options, await fetchBea(year, key, fo), { label: "BEA personal income", refreshHours: recentRefresh(year, now), emptyRetryHours: HOURS.week });
      } catch (error) {
        if (!(error instanceof BeaKeyError)) throw error;
        return skipFor(db, options, "BEA personal income", `BEA rejected ${BEA_KEY_ENV}: ${error.message.slice(0, 120)}`, HOURS.day);
      }
    }
    case ECONOMY_SOURCES.fhfa:
      return runAreaSource(db, options, await fetchFhfaHpi(fo), { label: "FHFA house price index", refreshHours: HOURS.month, emptyRetryHours: HOURS.week });
    case ECONOMY_SOURCES.fdicSurvey: {
      const year = yearOf(options, 2009);
      const url = env[FDIC_SURVEY_URL_ENV];
      if (!url?.trim()) return skipFor(db, options, "FDIC household survey", `No ${FDIC_SURVEY_URL_ENV} set; no machine-readable download for the survey's state and metro tables is confirmed`, HOURS.week);
      return runAreaSource(db, options, await fetchFdicSurvey(year, url, fo), { label: "FDIC household survey", refreshHours: HOURS.year, emptyRetryHours: HOURS.month });
    }
    case ECONOMY_SOURCES.shed: {
      const year = yearOf(options, SHED_FIRST_YEAR);
      return runAreaSource(db, options, await fetchShed(year, fo), { label: "Fed SHED summary", refreshHours: HOURS.year, emptyRetryHours: HOURS.month });
    }
    case ECONOMY_SOURCES.fdicIndustry:
      return runFdicIndustry(db, options);
    case ECONOMY_SOURCES.fdicRates:
    case ECONOMY_SOURCES.paymentChoice: {
      const rates = options.source === ECONOMY_SOURCES.fdicRates;
      const envName = rates ? FDIC_NATIONAL_RATES_URL_ENV : ATLANTA_FED_PAYMENTS_URL_ENV;
      const label = rates ? "FDIC national rates and rate caps" : "Atlanta Fed payment choice tables";
      const url = env[envName];
      if (!url?.trim()) return skipFor(db, options, label, `No ${envName} set; no confirmed plain-file download for this source`, HOURS.week);
      const fetched = await fetchConfiguredCsv(envName, url, (csv) => parseNationalWideCsv(csv, rates ? { prefix: "fdic_national_rate", unit: "percent (APY)" } : { prefix: "atlanta_fed_payment_choice", unit: "as published" }), fo);
      return runAreaSource(db, options, fetched, { label, refreshHours: rates ? HOURS.week : HOURS.quarter, emptyRetryHours: HOURS.week });
    }
    case ECONOMY_SOURCES.remittances:
      return runRemittances(db, options);
    case ECONOMY_SOURCES.hudCrosswalk:
      return runHudCrosswalk(db, options);
    default:
      throw new Error(`Unknown economy source: ${options.source}`);
  }
}
