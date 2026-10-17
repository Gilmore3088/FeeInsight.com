import { sql } from "@/lib/data-store/connection";
import {
  cleanCraLending,
  cleanCraRatings,
  CRA_LENDING_FIRST_YEAR,
  fetchCraLendingYear,
  fetchCraRatings,
  layoutFailed,
  type CraLendingCleaning,
  type CraLendingRow,
  type CraRating,
  type CraRatingsCleaning,
  type CraRespondent,
} from "@/lib/regulatory/cra";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: Community Reinvestment Act data from the FFIEC.
 *
 * - Partition 'ratings-current': the interagency CRA ratings file, one row per examination,
 *   written to cra_ratings and linked to the bank's FDIC row by RSSD id, else FDIC cert.
 * - Partition '<year>': that activity year's CRA small business and small farm disclosure file
 *   (each reporter's loans by county and loan-size bucket) written to cra_small_business_lending,
 *   with the transmittal sheet (reporter name and RSSD id) in cra_lending_respondents.
 *
 * Header and layout checks live in src/lib/regulatory/cra.ts. A file that fails them writes
 * nothing and the partition records why; rows that cannot be linked to an institution are kept
 * with institution_id NULL and counted.
 */

export const CRA_SOURCE = "cra";
export const CRA_PARSER_VERSION = 1;
export const CRA_RATINGS_PARTITION = "ratings-current";
const RATINGS_REFRESH_HOURS = 24 * 7;
const LATEST_YEAR_REFRESH_HOURS = 24 * 30;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const UNPUBLISHED_RETRY_HOURS = 24 * 7;
const WRITE_CHUNK = 2_000;

/** FFIEC publishes a year's CRA lending data in the late summer or fall of the next year. */
export function latestCraLendingYear(now: Date): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
}

export function craPartitions(now: Date, firstYear: number = CRA_LENDING_FIRST_YEAR): string[] {
  const out = [CRA_RATINGS_PARTITION];
  for (let year = latestCraLendingYear(now); year >= firstYear; year -= 1) out.push(String(year));
  return out;
}

export interface RegistryCraOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryCraResult {
  source: string;
  partitionKey: string;
  kind: "ratings" | "lending";
  sourceUrl: string;
  /** Ratings read, or lending rows read. */
  rows: number;
  writtenRows: number;
  matchedRows: number;
  unmatchedRows: number;
  /** Lending only: reporters on the transmittal sheet. */
  respondents: number;
  missingFields: string[];
  unexpectedFields: string[];
  badLines: number;
  ratingsCleaning: CraRatingsCleaning | null;
  lendingCleaning: CraLendingCleaning | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

/** Keep one record per key (the last), so one upsert never touches a row twice. */
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

async function writeRatings(db: RegistryDb, ratings: CraRating[], sourceUrl: string, runId: number | null): Promise<{ written: number; matched: number }> {
  let written = 0;
  let matched = 0;
  for (let at = 0; at < ratings.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      ratings.slice(at, at + WRITE_CHUNK).map((r) => ({
        rating_key: r.ratingKey,
        rssd: r.rssd,
        fdic_cert: r.fdicCert,
        agency_id: r.agencyId,
        regulator_raw: r.regulatorRaw,
        regulator: r.regulator,
        institution_name: r.name,
        file_city: r.city,
        file_state: r.state,
        exam_date: r.examDate,
        exam_date_raw: r.examDateRaw,
        rating_raw: r.ratingRaw,
        rating_code: r.ratingCode,
        exam_method: r.examMethod,
        asset_size: r.assetSize,
        evaluation_url: r.evaluationUrl,
        raw_json: r.raw,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          rating_key text, rssd text, fdic_cert text, agency_id text, regulator_raw text, regulator text,
          institution_name text, file_city text, file_state text, exam_date date, exam_date_raw text,
          rating_raw text, rating_code int, exam_method text, asset_size numeric, evaluation_url text, raw_json jsonb)
      ), by_rssd AS (
        SELECT DISTINCT ON (s.rssd_id) s.rssd_id, s.id AS institution_id
          FROM institution_sources s
         WHERE s.source = 'fdic' AND s.rssd_id IN (SELECT rssd FROM r WHERE rssd IS NOT NULL)
         ORDER BY s.rssd_id, s.id
      ), by_cert AS (
        SELECT DISTINCT ON (s.cert_number) s.cert_number, s.id AS institution_id
          FROM institution_sources s
         WHERE s.source = 'fdic' AND s.cert_number IN (SELECT fdic_cert FROM r WHERE fdic_cert IS NOT NULL)
         ORDER BY s.cert_number, s.id
      )
      INSERT INTO cra_ratings (
        rating_key, institution_id, rssd, fdic_cert, agency_id, regulator_raw, regulator, institution_name,
        file_city, file_state, exam_date, exam_date_raw, rating_raw, rating_code, exam_method, asset_size,
        evaluation_url, raw_json, source_url, agent_run_id, fetched_at)
      SELECT r.rating_key, COALESCE(by_rssd.institution_id, by_cert.institution_id), r.rssd, r.fdic_cert, r.agency_id,
             r.regulator_raw, r.regulator, r.institution_name, r.file_city, r.file_state, r.exam_date, r.exam_date_raw,
             r.rating_raw, r.rating_code, r.exam_method, r.asset_size, r.evaluation_url, COALESCE(r.raw_json, '{}'::jsonb),
             ${sourceUrl}, ${runId}, NOW()
        FROM r
        LEFT JOIN by_rssd ON by_rssd.rssd_id = r.rssd
        LEFT JOIN by_cert ON by_cert.cert_number = r.fdic_cert
      ON CONFLICT (rating_key) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        regulator = EXCLUDED.regulator,
        institution_name = EXCLUDED.institution_name,
        file_city = EXCLUDED.file_city,
        file_state = EXCLUDED.file_state,
        exam_date = EXCLUDED.exam_date,
        rating_raw = EXCLUDED.rating_raw,
        rating_code = EXCLUDED.rating_code,
        exam_method = EXCLUDED.exam_method,
        asset_size = EXCLUDED.asset_size,
        evaluation_url = EXCLUDED.evaluation_url,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING (institution_id IS NOT NULL) AS linked
    `;
    const rows = [...(result as unknown as Array<{ linked: boolean }>)];
    written += rows.length;
    matched += rows.filter((row) => row.linked).length;
  }
  return { written, matched };
}

async function writeRespondents(db: RegistryDb, respondents: CraRespondent[], sourceUrl: string, runId: number | null): Promise<{ written: number; matched: number }> {
  let written = 0;
  let matched = 0;
  for (let at = 0; at < respondents.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      respondents.slice(at, at + WRITE_CHUNK).map((t) => ({
        activity_year: t.activityYear,
        agency_code: t.agencyCode,
        respondent_id: t.respondentId,
        respondent_name: t.name,
        respondent_city: t.city,
        respondent_state: t.state,
        rssd: t.rssd,
        assets: t.assets,
        raw_line: t.rawLine,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          activity_year int, agency_code text, respondent_id text, respondent_name text, respondent_city text,
          respondent_state text, rssd text, assets numeric, raw_line text)
      ), ids AS (
        SELECT DISTINCT ON (s.rssd_id) s.rssd_id, s.id AS institution_id
          FROM institution_sources s
         WHERE s.source = 'fdic' AND s.rssd_id IN (SELECT rssd FROM r WHERE rssd IS NOT NULL)
         ORDER BY s.rssd_id, s.id
      )
      INSERT INTO cra_lending_respondents (
        activity_year, agency_code, respondent_id, institution_id, respondent_name, respondent_city,
        respondent_state, rssd, assets, raw_line, source_url, agent_run_id, fetched_at)
      SELECT r.activity_year, r.agency_code, r.respondent_id, ids.institution_id, r.respondent_name, r.respondent_city,
             r.respondent_state, r.rssd, r.assets, r.raw_line, ${sourceUrl}, ${runId}, NOW()
        FROM r LEFT JOIN ids ON ids.rssd_id = r.rssd
      ON CONFLICT (activity_year, agency_code, respondent_id) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        respondent_name = EXCLUDED.respondent_name,
        respondent_city = EXCLUDED.respondent_city,
        respondent_state = EXCLUDED.respondent_state,
        rssd = EXCLUDED.rssd,
        assets = EXCLUDED.assets,
        raw_line = EXCLUDED.raw_line,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING (institution_id IS NOT NULL) AS linked
    `;
    const rows = [...(result as unknown as Array<{ linked: boolean }>)];
    written += rows.length;
    matched += rows.filter((row) => row.linked).length;
  }
  return { written, matched };
}

async function writeLending(db: RegistryDb, rows: CraLendingRow[], sourceUrl: string, runId: number | null): Promise<{ written: number; matched: number }> {
  let written = 0;
  let matched = 0;
  for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      rows.slice(at, at + WRITE_CHUNK).map((r) => ({
        row_key: r.rowKey,
        activity_year: r.activityYear,
        table_id: r.tableId,
        agency_code: r.agencyCode,
        respondent_id: r.respondentId,
        loan_type: r.loanType,
        action_taken: r.actionTaken,
        state_fips: r.stateFips,
        county_fips: r.countyFips,
        msa_md: r.msaMd,
        assessment_area: r.assessmentArea,
        partial_county: r.partialCounty,
        split_county: r.splitCounty,
        population_class: r.populationClass,
        income_group: r.incomeGroup,
        report_level: r.reportLevel,
        count_size_1: r.countSize1,
        amount_size_1: r.amountSize1,
        count_size_2: r.countSize2,
        amount_size_2: r.amountSize2,
        count_size_3: r.countSize3,
        amount_size_3: r.amountSize3,
        count_rev_under_1m: r.countRevUnder1m,
        amount_rev_under_1m: r.amountRevUnder1m,
        raw_line: r.rawLine,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          row_key text, activity_year int, table_id text, agency_code text, respondent_id text, loan_type text,
          action_taken text, state_fips text, county_fips text, msa_md text, assessment_area text, partial_county text,
          split_county text, population_class text, income_group text, report_level text,
          count_size_1 bigint, amount_size_1 bigint, count_size_2 bigint, amount_size_2 bigint,
          count_size_3 bigint, amount_size_3 bigint, count_rev_under_1m bigint, amount_rev_under_1m bigint, raw_line text)
      )
      INSERT INTO cra_small_business_lending (
        row_key, activity_year, table_id, agency_code, respondent_id, institution_id, loan_type, action_taken,
        state_fips, county_fips, msa_md, assessment_area, partial_county, split_county, population_class,
        income_group, report_level, count_size_1, amount_size_1, count_size_2, amount_size_2, count_size_3,
        amount_size_3, count_rev_under_1m, amount_rev_under_1m, raw_line, source_url, agent_run_id, fetched_at)
      SELECT r.row_key, r.activity_year, r.table_id, r.agency_code, r.respondent_id, t.institution_id, r.loan_type,
             r.action_taken, r.state_fips, r.county_fips, r.msa_md, r.assessment_area, r.partial_county, r.split_county,
             r.population_class, r.income_group, r.report_level, r.count_size_1, r.amount_size_1, r.count_size_2,
             r.amount_size_2, r.count_size_3, r.amount_size_3, r.count_rev_under_1m, r.amount_rev_under_1m, r.raw_line,
             ${sourceUrl}, ${runId}, NOW()
        FROM r
        LEFT JOIN cra_lending_respondents t
          ON t.activity_year = r.activity_year AND t.agency_code = r.agency_code AND t.respondent_id = r.respondent_id
      ON CONFLICT (row_key) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        count_size_1 = EXCLUDED.count_size_1,
        amount_size_1 = EXCLUDED.amount_size_1,
        count_size_2 = EXCLUDED.count_size_2,
        amount_size_2 = EXCLUDED.amount_size_2,
        count_size_3 = EXCLUDED.count_size_3,
        amount_size_3 = EXCLUDED.amount_size_3,
        count_rev_under_1m = EXCLUDED.count_rev_under_1m,
        amount_rev_under_1m = EXCLUDED.amount_rev_under_1m,
        raw_line = EXCLUDED.raw_line,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING (institution_id IS NOT NULL) AS linked
    `;
    const out = [...(result as unknown as Array<{ linked: boolean }>)];
    written += out.length;
    matched += out.filter((row) => row.linked).length;
  }
  return { written, matched };
}

async function runRatings(options: RegistryCraOptions, db: RegistryDb, dryRun: boolean): Promise<RegistryCraResult> {
  const now = options.now ?? new Date();
  const download = await fetchCraRatings(options.fetchOptions);
  const parsed = download.parsed;
  const cleaning = cleanCraRatings(parsed, now);
  const ratings = uniqueBy(parsed.ratings, (r) => r.ratingKey);
  const emptyReason = parsed.layoutProblem ?? (ratings.length === 0 ? "The ratings file has no data rows" : null);
  const base: RegistryCraResult = {
    source: CRA_SOURCE,
    partitionKey: options.partitionKey,
    kind: "ratings",
    sourceUrl: download.url,
    rows: ratings.length,
    writtenRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    respondents: 0,
    missingFields: parsed.missingFields,
    unexpectedFields: parsed.unexpectedHeaders,
    badLines: parsed.raggedLines,
    ratingsCleaning: cleaning,
    lendingCleaning: null,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const detail = {
    parser_version: CRA_PARSER_VERSION,
    kind: "ratings",
    file: download.fileName,
    zip_entries: download.zipEntries,
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    field_columns: parsed.fieldColumns,
    missing_fields: parsed.missingFields,
    unexpected_headers: parsed.unexpectedHeaders,
    ragged_lines: parsed.raggedLines,
    cleaning,
  };
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: CRA_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: download.url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: RATINGS_REFRESH_HOURS,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const written = await writeRatings(db, ratings, download.url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: CRA_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: ratings.length,
    matchedCount: written.matched,
    unmatchedCount: written.written - written.matched,
    insertedCount: written.written,
    sourceUrl: download.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: RATINGS_REFRESH_HOURS,
    detail: { ...detail, written_rows: written.written, matched_rows: written.matched },
  });
  return { ...base, writtenRows: written.written, matchedRows: written.matched, unmatchedRows: written.written - written.matched };
}

async function runLending(options: RegistryCraOptions, db: RegistryDb, dryRun: boolean, year: number): Promise<RegistryCraResult> {
  const now = options.now ?? new Date();
  const download = await fetchCraLendingYear(year, options.fetchOptions);
  const disclosure = download.disclosure;
  const transmittal = download.transmittal;
  const rows = uniqueBy(disclosure?.rows ?? [], (r) => r.rowKey);
  const respondents = uniqueBy(transmittal?.rows ?? [], (t) => `${t.agencyCode}|${t.respondentId}`);
  const cleaning = disclosure ? cleanCraLending(disclosure.rows, transmittal?.rows ?? []) : null;
  const emptyReason = !download.published
    ? `FFIEC has not published the ${year} CRA flat files`
    : download.disclosureFiles.length === 0
      ? `No D1/D2 table file in the disclosure zip (entries: ${download.disclosureEntries.join(", ") || "none"})`
      : layoutFailed(disclosure!)
        ? `Disclosure lines failed the layout check (${disclosure!.badLines} of ${disclosure!.candidateLines}); nothing written`
        : transmittal && transmittal.candidateLines > 0 && layoutFailed(transmittal)
          ? `Transmittal lines failed the layout check (${transmittal.badLines} of ${transmittal.candidateLines}); nothing written`
          : null;

  const base: RegistryCraResult = {
    source: CRA_SOURCE,
    partitionKey: options.partitionKey,
    kind: "lending",
    sourceUrl: download.urls.disclosure,
    rows: rows.length,
    writtenRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    respondents: respondents.length,
    missingFields: transmittal ? [] : ["transmittal sheet"],
    unexpectedFields: [],
    badLines: (disclosure?.badLines ?? 0) + (transmittal?.badLines ?? 0),
    ratingsCleaning: null,
    lendingCleaning: cleaning,
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  if (dryRun) return base;

  const layout = (read: typeof disclosure | typeof transmittal) =>
    read ? { candidate_lines: read.candidateLines, bad_lines: read.badLines, problems: read.problems, samples: read.samples, skipped_tables: read.skippedTables } : null;
  const detail = {
    parser_version: CRA_PARSER_VERSION,
    kind: "lending",
    year,
    urls: download.urls,
    disclosure_entries: download.disclosureEntries,
    disclosure_files: download.disclosureFiles,
    transmittal_entries: download.transmittalEntries,
    disclosure_layout: layout(disclosure),
    transmittal_layout: layout(transmittal),
    cleaning,
  };
  const refreshHours = !download.published
    ? UNPUBLISHED_RETRY_HOURS
    : year === latestCraLendingYear(now)
      ? LATEST_YEAR_REFRESH_HOURS
      : HISTORICAL_REFRESH_HOURS;
  if (emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: CRA_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: download.urls.disclosure,
      runId: options.runId ?? null,
      nextAttemptAfterHours: refreshHours,
      detail: { ...detail, reason: emptyReason },
    });
    return base;
  }

  const runId = options.runId ?? null;
  const respondentWrite = await writeRespondents(db, respondents, download.urls.transmittal, runId);
  const written = await writeLending(db, rows, download.urls.disclosure, runId);
  await recordRegistryPartition(db, {
    source: CRA_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: written.matched,
    unmatchedCount: written.written - written.matched,
    insertedCount: written.written,
    sourceUrl: download.urls.disclosure,
    runId,
    nextAttemptAfterHours: refreshHours,
    detail: {
      ...detail,
      written_rows: written.written,
      matched_rows: written.matched,
      respondents_written: respondentWrite.written,
      respondents_matched: respondentWrite.matched,
      respondents_unmatched: respondentWrite.written - respondentWrite.matched,
    },
  });
  return { ...base, writtenRows: written.written, matchedRows: written.matched, unmatchedRows: written.written - written.matched };
}

export async function runRegistryCra(options: RegistryCraOptions): Promise<RegistryCraResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  if (options.partitionKey === CRA_RATINGS_PARTITION) return runRatings(options, db, dryRun);
  const year = Number(options.partitionKey);
  if (!/^\d{4}$/.test(options.partitionKey) || year < CRA_LENDING_FIRST_YEAR) {
    throw new Error(`Invalid CRA partition: ${options.partitionKey}`);
  }
  return runLending(options, db, dryRun, year);
}

