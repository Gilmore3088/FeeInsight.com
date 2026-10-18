import { sql } from "@/lib/data-store/connection";
import { buildInstitutionIndex, type InstitutionKeyRow } from "@/lib/regulatory/designation-lists";
import { checkAreaStats, dedupeAreaStats, type AreaStat } from "@/lib/regulatory/economy";
import { registryFetch, registryFetchJson, RegistryHttpError, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  countyNameIndex,
  dedupeDepositories,
  dedupeLenders,
  depositoryListDate,
  depositoryRowsFrom,
  findDepositoryFiles,
  findLicenseText,
  findUrbanFiles,
  lenderAreaStats,
  lenderDatasets,
  lenderPartitionKey,
  mapLenderFields,
  matchDepository,
  parseUrbanDebt,
  readDepositoryRows,
  readLenderRows,
  readSodaMetadata,
  SOCRATA_APP_TOKEN_ENV,
  SODA_PAGE_LIMIT,
  sodaMetadataUrl,
  sodaRowsUrl,
  STATE_DEPOSITORY_LISTS,
  URBAN_DEBT_COUNTY_URL_ENV,
  URBAN_DEBT_DEFAULT_PAGE_URL,
  URBAN_DEBT_ATTRIBUTION,
  URBAN_DEBT_LICENCE,
  URBAN_DEBT_PAGE_URL_ENV,
  URBAN_DEBT_STATE_URL_ENV,
  yearInName,
  type CountyNameIndex,
  type DepositoryRead,
  type LenderCountRow,
  type LenderRecord,
  type MatchedDepository,
} from "@/lib/regulatory/state-lists";
import { upsertAreaStats } from "./economy";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for state lists, one source string each:
 *
 * - state-public-depositories: one partition per state program (FL only), written to
 *   state_public_depositories, one row per depository per list date. Matched to institutions by
 *   FDIC cert / NCUA charter when the list carries one, else exact normalized name within the
 *   home-office state; unmatched rows are kept (institution_id NULL) and counted.
 * - state-nonbank-lenders: one partition per configured Socrata dataset (`<STATE>-<id>`), written
 *   to state_nonbank_licensees; then the state's licensee counts per license category, by state
 *   and county, are recounted from the table into area_statistics.
 * - urban-debt-in-america: one partition ("current"), into area_statistics. Licence ODC-By 1.0
 *   (commercial use allowed, attribution required; released 2026-10-18, DECISIONS.md "No
 *   non-commercial data"): each row's raw carries URBAN_DEBT_ATTRIBUTION, and the step still
 *   records the licence wording it finds on the catalog page so a change shows in the ledger.
 */

export const STATE_LISTS_PARSER_VERSION = 1;
export const STATE_DEPOSITORIES_SOURCE = "state-public-depositories";
export const STATE_NONBANK_LENDERS_SOURCE = "state-nonbank-lenders";
export const URBAN_DEBT_SOURCE = "urban-debt-in-america";
export const STATE_LISTS_SOURCES = [STATE_DEPOSITORIES_SOURCE, STATE_NONBANK_LENDERS_SOURCE, URBAN_DEBT_SOURCE] as const;
/** v2: Florida's list removed (2026-10-17, DECISIONS.md "No non-commercial data"). */
export const STATE_DEPOSITORIES_PARSER_VERSION = 2;
export const STATE_NONBANK_LENDERS_PARSER_VERSION = STATE_LISTS_PARSER_VERSION;
/** v2: licence confirmed (ODC-By 1.0); rows written with their attribution (2026-10-18). */
export const URBAN_DEBT_PARSER_VERSION = 2;
export const URBAN_DEBT_PARTITION = "current";

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30 };
const WRITE_CHUNK = 1_000;
/** A new read under this share of the stored rows keeps the old rows (reported, not removed). */
const MIN_SHARE_TO_PRUNE = 0.5;
/** Pages of 50,000 rows read per dataset per run. */
const SODA_MAX_PAGES = 10;

type Env = Record<string, string | undefined>;

export function stateDepositoriesPartitions(now: Date): string[] {
  void now;
  return STATE_DEPOSITORY_LISTS.map((l) => l.state);
}

export function stateNonbankLendersPartitions(now: Date, env: Env = process.env): string[] {
  void now;
  return lenderDatasets(env).datasets.map(lenderPartitionKey);
}

export function urbanDebtPartitions(now: Date): string[] {
  void now;
  return [URBAN_DEBT_PARTITION];
}

export function stateListsPartitions(source: string, now: Date, env: Env = process.env): string[] {
  if (source === STATE_DEPOSITORIES_SOURCE) return stateDepositoriesPartitions(now);
  if (source === STATE_NONBANK_LENDERS_SOURCE) return stateNonbankLendersPartitions(now, env);
  if (source === URBAN_DEBT_SOURCE) return urbanDebtPartitions(now);
  return [];
}

export interface RegistryStateListsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Env;
  now?: Date;
  /** Tests pass a small index; the default is every county in the bundled Census file. */
  counties?: CountyNameIndex;
}

export interface RegistryStateListsResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rowsRead: number;
  records: number;
  matched: number | null;
  unmatched: number | null;
  writtenRows: number;
  removedRows: number;
  areaRows: number;
  missingFields: string[];
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

const n = (value: number) => value.toLocaleString("en-US");
const dryText = (flag: boolean | undefined) => (flag ? " (dry run)" : "");

function base(source: string, options: RegistryStateListsOptions): RegistryStateListsResult {
  return {
    source,
    partitionKey: options.partitionKey,
    sourceUrl: null,
    rowsRead: 0,
    records: 0,
    matched: null,
    unmatched: null,
    writtenRows: 0,
    removedRows: 0,
    areaRows: 0,
    missingFields: [],
    dryRun: Boolean(options.dryRun),
    empty: false,
    emptyReason: null,
    summary: "",
    detail: {},
  };
}

async function recordEmpty(
  db: RegistryDb,
  source: string,
  options: RegistryStateListsOptions,
  reason: string,
  sourceUrl: string | null,
  retryHours: number,
  extra: Record<string, unknown> = {},
): Promise<RegistryStateListsResult> {
  const detail = { parser_version: STATE_LISTS_PARSER_VERSION, reason, ...extra };
  if (!options.dryRun) {
    await recordRegistryPartition(db, {
      source,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: retryHours,
      detail,
    });
  }
  return {
    ...base(source, options),
    sourceUrl,
    empty: true,
    emptyReason: reason,
    missingFields: (extra.missing_fields as string[] | undefined) ?? [],
    summary: `${source} ${options.partitionKey}: nothing loaded. ${reason}${dryText(options.dryRun)}.`,
    detail,
  };
}

const unavailable = (error: unknown) => error instanceof RegistryHttpError && error.status !== null && [403, 404, 410].includes(error.status);

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ===========================================================================
// State public depositories
// ===========================================================================

async function writeDepositories(db: RegistryDb, records: MatchedDepository[], listDate: string, basis: string, url: string | null, runId: number | null): Promise<number> {
  let written = 0;
  for (const group of chunk(records, WRITE_CHUNK)) {
    const payload = JSON.stringify(
      group.map((r) => ({
        program_state: r.programState,
        record_key: r.recordKey,
        listed_name: r.name,
        listed_city: r.city,
        listed_home_state: r.homeState,
        listed_cert: r.cert,
        listed_charter: r.charter,
        status: r.status,
        status_text: r.statusText,
        status_date: r.statusDate,
        institution_id: r.institutionId,
        matched_by: r.matchedBy,
        unmatched_reason: r.unmatchedReason,
        raw: r.raw,
      })),
    );
    const out = await db`
      INSERT INTO state_public_depositories
        (program_state, list_date, list_date_basis, record_key, listed_name, listed_city, listed_home_state,
         listed_cert, listed_charter, status, status_text, status_date, institution_id, matched_by,
         unmatched_reason, source_url, raw, agent_run_id, fetched_at)
      SELECT x.program_state, ${listDate}::date, ${basis}, x.record_key, x.listed_name, x.listed_city, x.listed_home_state,
             x.listed_cert, x.listed_charter, x.status, x.status_text, x.status_date::date, x.institution_id, x.matched_by,
             x.unmatched_reason, ${url}, COALESCE(x.raw, '{}'::jsonb), ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          program_state text, record_key text, listed_name text, listed_city text, listed_home_state text,
          listed_cert text, listed_charter text, status text, status_text text, status_date text,
          institution_id bigint, matched_by text, unmatched_reason text, raw jsonb)
      ON CONFLICT (program_state, list_date, record_key) DO UPDATE SET
        list_date_basis = EXCLUDED.list_date_basis,
        listed_name = EXCLUDED.listed_name,
        listed_city = EXCLUDED.listed_city,
        listed_home_state = EXCLUDED.listed_home_state,
        listed_cert = EXCLUDED.listed_cert,
        listed_charter = EXCLUDED.listed_charter,
        status = EXCLUDED.status,
        status_text = EXCLUDED.status_text,
        status_date = EXCLUDED.status_date,
        institution_id = EXCLUDED.institution_id,
        matched_by = EXCLUDED.matched_by,
        unmatched_reason = EXCLUDED.unmatched_reason,
        source_url = EXCLUDED.source_url,
        raw = EXCLUDED.raw,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistryStateDepositories(options: RegistryStateListsOptions): Promise<RegistryStateListsResult> {
  const db = options.db ?? sql;
  const source = STATE_DEPOSITORIES_SOURCE;
  const list = STATE_DEPOSITORY_LISTS.find((l) => l.state === options.partitionKey);
  if (!list) throw new Error(`Invalid state depository list: ${options.partitionKey}`);
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const fetchOptions = options.fetchOptions ?? {};

  let fileUrl = env[list.urlEnv]?.trim() || null;
  let rowsSource: { format: string; rows: string[][] } | null = null;
  const pageDetail: Record<string, unknown> = { page_url: list.pageUrl, url_from_env: Boolean(fileUrl) };
  try {
    if (!fileUrl) {
      const html = await (await registryFetch(list.pageUrl, fetchOptions)).text();
      const files = findDepositoryFiles(html, list);
      pageDetail.candidate_files = files.files;
      pageDetail.unreadable_links = files.unreadable;
      if (files.files.length > 0) fileUrl = files.files[0];
      else {
        const pageRows = depositoryRowsFrom(new TextEncoder().encode(html), "html");
        if (readDepositoryRows(pageRows.rows, list.state).records.length > 0) {
          rowsSource = pageRows;
          fileUrl = list.pageUrl;
        } else {
          const reason =
            files.unreadable.length > 0
              ? `${list.title}: the page links only PDF or old .xls files, whose layout is not confirmed as parseable; nothing read`
              : `${list.title}: no list file or table found on the page`;
          return recordEmpty(db, source, options, reason, list.pageUrl, HOURS.week, pageDetail);
        }
      }
    }
    if (!rowsSource) rowsSource = depositoryRowsFrom(new Uint8Array(await (await registryFetch(fileUrl!, fetchOptions)).arrayBuffer()), "file");
  } catch (error) {
    if (unavailable(error)) return recordEmpty(db, source, options, `${list.title}: ${(error as Error).message}`, fileUrl ?? list.pageUrl, HOURS.day, pageDetail);
    throw error;
  }

  const read: DepositoryRead = readDepositoryRows(rowsSource.rows, list.state);
  if (read.records.length === 0) {
    return recordEmpty(db, source, options, `${list.title}: no depository rows read`, fileUrl, HOURS.week, {
      ...pageDetail,
      format: rowsSource.format,
      missing_fields: read.fieldsMissing,
      unexpected_fields: read.unexpectedFields,
      skipped_records: read.skipped,
    });
  }
  const { listDate, basis } = depositoryListDate(fileUrl === list.pageUrl ? null : fileUrl, read, today(now));

  const institutions = (await db`
    SELECT id, source, cert_number, ncua_charter_id, institution_name, state_code
      FROM institution_sources
     WHERE source IN ('fdic', 'ncua')
  `) as unknown as InstitutionKeyRow[];
  const index = buildInstitutionIndex([...(institutions ?? [])]);
  const { records, duplicates, examples } = dedupeDepositories(read.records.map((r) => matchDepository(r, index)));
  const matched = records.filter((r) => r.institutionId !== null).length;
  const unmatchedByReason: Record<string, number> = {};
  for (const r of records) if (r.unmatchedReason) unmatchedByReason[r.unmatchedReason] = (unmatchedByReason[r.unmatchedReason] ?? 0) + 1;
  const statusCounts: Record<string, number> = {};
  for (const r of records) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;

  const detail: Record<string, unknown> = {
    parser_version: STATE_LISTS_PARSER_VERSION,
    ...pageDetail,
    file_url: fileUrl,
    format: rowsSource.format,
    list_date: listDate,
    list_date_basis: basis,
    rows_read: read.rowsRead,
    records: records.length,
    fields_found: read.fieldsFound,
    missing_fields: read.fieldsMissing,
    unexpected_fields: read.unexpectedFields,
    skipped_records: read.skipped,
    duplicate_keys: duplicates,
    duplicate_examples: examples,
    matched,
    unmatched: records.length - matched,
    unmatched_by_reason: unmatchedByReason,
    unmatched_examples: records.filter((r) => r.institutionId === null).slice(0, 15).map((r) => ({ name: r.name, state: r.matchState, reason: r.unmatchedReason })),
    status_counts: statusCounts,
  };
  const result: RegistryStateListsResult = {
    ...base(source, options),
    sourceUrl: fileUrl,
    rowsRead: read.rowsRead,
    records: records.length,
    matched,
    unmatched: records.length - matched,
    missingFields: read.fieldsMissing,
    detail,
    summary: "",
  };
  const gaps = read.fieldsMissing.length ? `; not in file: ${read.fieldsMissing.join(", ")}` : "";
  if (options.dryRun) {
    return { ...result, summary: `${list.title} ${listDate}: read ${n(records.length)} depositories, ${n(matched)} matched${gaps} (dry run).` };
  }
  const written = await writeDepositories(db, records, listDate, basis, fileUrl, options.runId ?? null);
  await recordRegistryPartition(db, {
    source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: records.length,
    matchedCount: matched,
    unmatchedCount: records.length - matched,
    insertedCount: written,
    sourceUrl: fileUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.week,
    detail: { ...detail, written_rows: written },
  });
  return {
    ...result,
    writtenRows: written,
    detail: { ...detail, written_rows: written },
    summary: `Magellan loaded ${list.title} ${listDate}: ${n(written)} depositories, ${n(matched)} matched to institutions, ${n(records.length - matched)} unmatched${gaps}.`,
  };
}

// ===========================================================================
// State non-bank lenders (Socrata)
// ===========================================================================

async function writeLenders(db: RegistryDb, domain: string, records: LenderRecord[], url: string, runId: number | null): Promise<number> {
  let written = 0;
  for (const group of chunk(records, WRITE_CHUNK)) {
    const payload = JSON.stringify(
      group.map((r) => ({
        state: r.state,
        dataset_id: r.dataset,
        record_key: r.recordKey,
        licensee_name: r.licenseeName,
        dba: r.dba,
        license_type: r.licenseType,
        license_category: r.licenseCategory,
        license_number: r.licenseNumber,
        address: r.address,
        city: r.city,
        zip: r.zip,
        county: r.county,
        county_fips: r.countyFips,
        county_basis: r.countyBasis,
        license_status: r.status,
        active: r.active,
        license_date: r.licenseDate,
        raw: r.raw,
      })),
    );
    const out = await db`
      INSERT INTO state_nonbank_licensees
        (state, dataset_domain, dataset_id, record_key, licensee_name, dba, license_type, license_category,
         license_number, address, city, zip, county, county_fips, county_basis, license_status, active,
         license_date, source_url, raw, agent_run_id, fetched_at)
      SELECT x.state, ${domain}, x.dataset_id, x.record_key, x.licensee_name, x.dba, x.license_type, x.license_category,
             x.license_number, x.address, x.city, x.zip, x.county, x.county_fips, x.county_basis, x.license_status, x.active,
             x.license_date::date, ${url}, COALESCE(x.raw, '{}'::jsonb), ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          state text, dataset_id text, record_key text, licensee_name text, dba text, license_type text,
          license_category text, license_number text, address text, city text, zip text, county text,
          county_fips text, county_basis text, license_status text, active boolean, license_date text, raw jsonb)
      ON CONFLICT (state, dataset_id, record_key) DO UPDATE SET
        dataset_domain = EXCLUDED.dataset_domain,
        licensee_name = EXCLUDED.licensee_name,
        dba = EXCLUDED.dba,
        license_type = EXCLUDED.license_type,
        license_category = EXCLUDED.license_category,
        license_number = EXCLUDED.license_number,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        zip = EXCLUDED.zip,
        county = EXCLUDED.county,
        county_fips = EXCLUDED.county_fips,
        county_basis = EXCLUDED.county_basis,
        license_status = EXCLUDED.license_status,
        active = EXCLUDED.active,
        license_date = EXCLUDED.license_date,
        source_url = EXCLUDED.source_url,
        raw = EXCLUDED.raw,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  return written;
}

/** Counts from parsed rows (dry run) in the shape the table recount returns. */
export function countLenders(records: LenderRecord[]): LenderCountRow[] {
  const map = new Map<string, LenderCountRow>();
  for (const r of records) {
    if (r.active === false) continue;
    const key = `${r.state}|${r.countyFips ?? ""}|${r.licenseCategory}`;
    const row = map.get(key) ?? { state: r.state, county_fips: r.countyFips, license_category: r.licenseCategory, licensees: 0, with_status: 0 };
    row.licensees += 1;
    if (r.active === true) row.with_status += 1;
    map.set(key, row);
  }
  return [...map.values()];
}

export async function runRegistryStateNonbankLenders(options: RegistryStateListsOptions): Promise<RegistryStateListsResult> {
  const db = options.db ?? sql;
  const source = STATE_NONBANK_LENDERS_SOURCE;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const { datasets, errors } = lenderDatasets(env);
  const dataset = datasets.find((d) => lenderPartitionKey(d) === options.partitionKey);
  if (!dataset) {
    return recordEmpty(db, source, options, `No confirmed dataset ${options.partitionKey}; add it to STATE_LENDER_DATASETS once its page is checked`, null, HOURS.month, { config_errors: errors });
  }
  const token = env[SOCRATA_APP_TOKEN_ENV]?.trim();
  const fetchOptions: RegistryFetchOptions = { ...options.fetchOptions, headers: { ...options.fetchOptions?.headers, ...(token ? { "X-App-Token": token } : {}) } };
  const metaUrl = sodaMetadataUrl(dataset);

  let meta;
  try {
    meta = readSodaMetadata(await registryFetchJson<unknown>(metaUrl, fetchOptions));
  } catch (error) {
    if (unavailable(error)) return recordEmpty(db, source, options, `Dataset metadata unavailable: ${(error as Error).message}`, metaUrl, HOURS.day);
    throw error;
  }
  const map = mapLenderFields(meta.columns, dataset);
  const metaDetail = {
    dataset_name: meta.name,
    dataset_license: meta.license,
    dataset_license_link: meta.licenseLink,
    rows_updated: meta.rowsUpdated,
    field_map: map.fields,
    missing_fields: map.missing,
    unexpected_fields: map.unexpected,
  };
  if (!map.fields.name || (!map.fields.licenseType && !dataset.licenseType)) {
    return recordEmpty(db, source, options, "Dataset lacks a licensee name or license type field; nothing read", metaUrl, HOURS.week, metaDetail);
  }

  const rows: Array<Record<string, unknown>> = [];
  let truncated = false;
  for (let page = 0; page < SODA_MAX_PAGES; page += 1) {
    const body = await registryFetchJson<unknown>(sodaRowsUrl(dataset, page * SODA_PAGE_LIMIT), fetchOptions);
    if (!Array.isArray(body)) throw new Error(`Socrata returned no row array for ${dataset.domain}/${dataset.dataset}`);
    rows.push(...(body as Array<Record<string, unknown>>));
    if (body.length < SODA_PAGE_LIMIT) break;
    if (page === SODA_MAX_PAGES - 1) truncated = true;
  }
  const read = readLenderRows(rows, dataset, map, options.counties ?? countyNameIndex());
  const { records, duplicates } = dedupeLenders(read.records);
  const sourceUrl = `https://${dataset.domain}/resource/${dataset.dataset}.json`;
  const byCategory: Record<string, number> = {};
  for (const r of records) byCategory[r.licenseCategory] = (byCategory[r.licenseCategory] ?? 0) + 1;
  const period = (meta.rowsUpdated ?? today(now)).slice(0, 7);
  const detail: Record<string, unknown> = {
    parser_version: STATE_LISTS_PARSER_VERSION,
    ...metaDetail,
    // The dataset's own license as Socrata records it; the source list rates these portals OK (mostly open licenses).
    period,
    period_basis: meta.rowsUpdated ? "rows_updated" : "fetched",
    rows_read: read.rowsRead,
    records: records.length,
    truncated,
    duplicate_keys: duplicates,
    skipped_records: read.skipped,
    license_types: read.licenseTypes,
    by_category: byCategory,
    without_county: records.filter((r) => !r.countyFips).length,
    county_unmatched: Object.fromEntries(Object.entries(read.countyUnmatched).slice(0, 20)),
    without_status: records.filter((r) => r.active === null).length,
  };
  if (records.length === 0) return recordEmpty(db, source, options, "No licensee rows read", sourceUrl, HOURS.week, detail);

  if (options.dryRun) {
    const areaRows = dedupeAreaStats(lenderAreaStats(countLenders(records), period));
    return {
      ...base(source, options),
      sourceUrl,
      rowsRead: read.rowsRead,
      records: records.length,
      areaRows: areaRows.length,
      missingFields: map.missing,
      detail: { ...detail, area_checks: checkAreaStats(areaRows) },
      summary: `${dataset.state} ${dataset.dataset}: read ${n(records.length)} licensees, ${n(areaRows.length)} area counts (dry run).`,
    };
  }

  const [stored] = (await db`
    SELECT COUNT(*)::int AS rows FROM state_nonbank_licensees WHERE state = ${dataset.state} AND dataset_id = ${dataset.dataset}
  `) as unknown as Array<{ rows: number }>;
  const storedRows = Number(stored?.rows ?? 0);
  const written = await writeLenders(db, dataset.domain, records, sourceUrl, options.runId ?? null);
  let removedRows = 0;
  const prune = !truncated && (storedRows === 0 || records.length >= storedRows * MIN_SHARE_TO_PRUNE);
  if (prune) {
    const keys = JSON.stringify(records.map((r) => r.recordKey));
    const removed = await db`
      DELETE FROM state_nonbank_licensees
       WHERE state = ${dataset.state} AND dataset_id = ${dataset.dataset}
         AND record_key NOT IN (SELECT jsonb_array_elements_text(${keys}::jsonb))
      RETURNING 1
    `;
    removedRows = [...(removed as unknown as unknown[])].length;
  }

  // Recount the whole state from the table, so two datasets in one state add up rather than overwrite.
  const counts = (await db`
    SELECT state, county_fips, license_category,
           COUNT(*) FILTER (WHERE active IS DISTINCT FROM false)::int AS licensees,
           COUNT(*) FILTER (WHERE active IS TRUE)::int AS with_status
      FROM state_nonbank_licensees
     WHERE state = ${dataset.state}
     GROUP BY state, county_fips, license_category
  `) as unknown as LenderCountRow[];
  const areaRows = dedupeAreaStats(lenderAreaStats([...(counts ?? [])], period));
  const areaChecks = checkAreaStats(areaRows);
  const areaWritten = await upsertAreaStats(db, source, areaRows, sourceUrl, options.runId ?? null);
  const finalDetail = {
    ...detail,
    written_rows: written,
    removed_rows: removedRows,
    pruned: prune,
    stored_rows_before: storedRows,
    area_rows: areaWritten,
    area_checks: areaChecks,
  };
  await recordRegistryPartition(db, {
    source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: records.length,
    insertedCount: written,
    sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.week,
    detail: finalDetail,
  });
  return {
    ...base(source, options),
    sourceUrl,
    rowsRead: read.rowsRead,
    records: records.length,
    writtenRows: written,
    removedRows,
    areaRows: areaWritten,
    missingFields: map.missing,
    detail: finalDetail,
    summary: `Magellan loaded ${dataset.state} non-bank licensees (${dataset.dataset}): ${n(written)} rows, ${n(areaWritten)} state and county counts.`,
  };
}

// ===========================================================================
// Urban Institute, Debt in America (ODC-By 1.0, attribution required)
// ===========================================================================

export async function runRegistryUrbanDebt(options: RegistryStateListsOptions): Promise<RegistryStateListsResult> {
  const db = options.db ?? sql;
  const source = URBAN_DEBT_SOURCE;
  if (options.partitionKey !== URBAN_DEBT_PARTITION) throw new Error(`Invalid Urban Debt in America partition: ${options.partitionKey}`);
  const env = options.env ?? process.env;
  const fetchOptions = options.fetchOptions ?? {};
  const pageUrl = env[URBAN_DEBT_PAGE_URL_ENV]?.trim() || URBAN_DEBT_DEFAULT_PAGE_URL;

  let licenseText: string[] = [];
  let pageError: string | null = null;
  let links = { county: env[URBAN_DEBT_COUNTY_URL_ENV]?.trim() || null, state: env[URBAN_DEBT_STATE_URL_ENV]?.trim() || null, all: [] as string[] };
  try {
    const html = await (await registryFetch(pageUrl, fetchOptions)).text();
    licenseText = findLicenseText(html);
    const found = findUrbanFiles(html, pageUrl);
    links = { county: links.county ?? found.county, state: links.state ?? found.state, all: found.all };
  } catch (error) {
    if (!unavailable(error)) throw error;
    pageError = (error as Error).message;
  }
  const license = { name: URBAN_DEBT_LICENCE, attribution: URBAN_DEBT_ATTRIBUTION, page_url: pageUrl, text_found: licenseText, page_error: pageError };
  if (!links.county && !links.state) {
    return recordEmpty(db, source, options, "No Debt in America county or state file found (set URBAN_DEBT_COUNTY_CSV_URL / URBAN_DEBT_STATE_CSV_URL once checked)", pageUrl, HOURS.week, {
      parser_version: URBAN_DEBT_PARSER_VERSION,
      license,
      links_on_page: links.all,
    });
  }

  const rows: AreaStat[] = [];
  const missing: string[] = [];
  const files: Record<string, unknown> = {};
  for (const [geoType, url] of [["county", links.county], ["state", links.state]] as const) {
    if (!url) {
      missing.push(`${geoType} file`);
      continue;
    }
    const period = yearInName(url);
    if (!period) {
      files[geoType] = { url, skipped: "no single data year in the file name" };
      missing.push(`${geoType} data year`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await (await registryFetch(url, fetchOptions)).arrayBuffer());
    } catch (error) {
      if (!unavailable(error)) throw error;
      files[geoType] = { url, error: (error as Error).message };
      continue;
    }
    const parsed = parseUrbanDebt(bytes, geoType, period, url);
    files[geoType] = { url, period, rows: parsed.rows.length, scale: parsed.scale, missing_fields: parsed.missingFields, skipped_records: parsed.skipped, empty_reason: parsed.emptyReason };
    missing.push(...parsed.missingFields.map((f) => `${geoType}: ${f}`));
    rows.push(...parsed.rows);
  }
  const deduped = dedupeAreaStats(rows);
  const checks = checkAreaStats(rows);
  const detail: Record<string, unknown> = { parser_version: URBAN_DEBT_PARSER_VERSION, license, files, missing_fields: missing, rows: deduped.length, checks };
  const sourceUrl = links.county ?? links.state;
  if (deduped.length === 0) return recordEmpty(db, source, options, "No Debt in America rows read", sourceUrl, HOURS.week, detail);

  if (options.dryRun) {
    return {
      ...base(source, options),
      sourceUrl,
      rowsRead: deduped.length,
      records: deduped.length,
      missingFields: missing,
      detail,
      summary: `Urban Debt in America: read ${n(deduped.length)} values${dryText(options.dryRun)}.`,
    };
  }
  const written = await upsertAreaStats(db, source, deduped, sourceUrl, options.runId ?? null);
  await recordRegistryPartition(db, {
    source,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: deduped.length,
    insertedCount: written,
    sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.month,
    detail: { ...detail, written_rows: written },
  });
  return {
    ...base(source, options),
    sourceUrl,
    rowsRead: deduped.length,
    records: deduped.length,
    writtenRows: written,
    areaRows: written,
    missingFields: missing,
    detail: { ...detail, written_rows: written },
    summary: `Magellan loaded Urban Debt in America: ${n(written)} county and state values.`,
  };
}

/** One entry point for the three sources. */
export async function runRegistryStateLists(options: RegistryStateListsOptions & { source: string }): Promise<RegistryStateListsResult> {
  if (options.source === STATE_DEPOSITORIES_SOURCE) return runRegistryStateDepositories(options);
  if (options.source === STATE_NONBANK_LENDERS_SOURCE) return runRegistryStateNonbankLenders(options);
  if (options.source === URBAN_DEBT_SOURCE) return runRegistryUrbanDebt(options);
  throw new Error(`Unknown state-lists source: ${options.source}`);
}
