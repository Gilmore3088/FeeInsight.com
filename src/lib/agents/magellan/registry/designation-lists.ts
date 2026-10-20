import { sql } from "@/lib/data-store/connection";
import { registryFetch, registryFetchJson, RegistryHttpError, type RegistryFetchOptions } from "@/lib/regulatory/http";
import { ncuaZipUrl } from "@/lib/regulatory/ncua";
import { latestPublishableQuarter, previousQuarter, quarterEndDate, type Quarter } from "@/lib/regulatory/quarters";
import {
  CDFI_LINK,
  CDFI_PAGE_URL,
  DESIGNATION_LIST_KEYS,
  DESIGNATION_LISTS,
  FDIC_FLAG_FIELDS,
  FDIC_INSTITUTIONS_URL,
  NCUA_MDI_LINK,
  NCUA_MDI_PAGE_URL,
  buildInstitutionIndex,
  cleanDesignationRecords,
  dateInFileName,
  dedupeRecords,
  findListLinks,
  foicuRowsFromZip,
  matchRecord,
  readCdfiList,
  readFdicFlags,
  readFoicuFlags,
  readNcuaMdiList,
  type DesignationList,
  type InstitutionKeyRow,
  type ListRead,
  type MatchedRecord,
} from "@/lib/regulatory/designation-lists";
import { NCUA_FILING_LAG_DAYS } from "./ncua-financials";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one published designation list per partition, written to
 * institution_designations (one row per list row and designation). The partition replaces
 * that list's rows: rows the list no longer carries are removed after the new rows are
 * written, unless the new read is under half the rows already stored, which is reported and
 * left for a person to check rather than wiping a list on a bad read.
 *
 * Partitions: fdic-institution-flags (MDI, specialty group, mutual vs stock, Subchapter S),
 * ncua-foicu-flags (low-income designation, field-of-membership type, year opened), ncua-mdi,
 * cdfi-fund. Matching: FDIC cert or NCUA charter when the list carries one, else exact
 * normalized name plus state; every unmatched row is kept (institution_id NULL) and listed in
 * the partition detail. The Bank On list was struck on 2026-10-17 (DECISIONS.md "No
 * non-commercial data"); its rows already loaded are never read.
 */

export const DESIGNATION_LISTS_SOURCE = "designation-lists";
export const DESIGNATION_LISTS_PARSER_VERSION = 2;
const FDIC_PAGE_LIMIT = 10_000;
const FDIC_MAX_PAGES = 5;
const REFRESH_HOURS: Record<DesignationList, number> = {
  [DESIGNATION_LISTS.fdic]: 24 * 7,
  [DESIGNATION_LISTS.ncuaFoicu]: 24 * 7,
  [DESIGNATION_LISTS.ncuaMdi]: 24 * 30,
  [DESIGNATION_LISTS.cdfi]: 24 * 30,
};
const EMPTY_RETRY_HOURS = 24;
const WRITE_CHUNK = 2_000;
/** A new read under this share of the stored rows keeps the old rows (reported, not removed). */
const MIN_SHARE_TO_PRUNE = 0.5;

/** Every list, every time: the lists are current snapshots, not history. */
export function designationListsPartitions(now: Date): string[] {
  void now;
  return [...DESIGNATION_LIST_KEYS];
}

export interface RegistryDesignationListsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryDesignationListsResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  asOf: string | null;
  rowsRead: number;
  records: number;
  matched: number;
  unmatched: number;
  writtenRows: number;
  removedRows: number;
  fieldsMissing: string[];
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

interface FetchedList {
  read: ListRead | null;
  sourceUrl: string | null;
  asOf: string | null;
  asOfBasis: string;
  emptyReason: string | null;
  extra: Record<string, unknown>;
}

const isStatus = (error: unknown, status: number) => error instanceof RegistryHttpError && error.status === status;

async function fetchFdic(options: RegistryFetchOptions, today: string): Promise<FetchedList> {
  const rows: Record<string, unknown>[] = [];
  let firstUrl: string | null = null;
  let fieldsParam = true;
  for (let page = 0; page < FDIC_MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      filters: "ACTIVE:1",
      limit: String(FDIC_PAGE_LIMIT),
      offset: String(page * FDIC_PAGE_LIMIT),
      format: "json",
      sort_by: "CERT",
      sort_order: "ASC",
    });
    if (fieldsParam) params.set("fields", Object.values(FDIC_FLAG_FIELDS).join(","));
    const url = `${FDIC_INSTITUTIONS_URL}?${params.toString()}`;
    let body: { meta?: { total?: number }; data?: Array<{ data?: Record<string, unknown> }> };
    try {
      body = await registryFetchJson(url, options);
    } catch (error) {
      // A field name BankFind does not know can be refused outright; ask for whole records instead
      // and let the field check name what is missing.
      if (fieldsParam && page === 0 && isStatus(error, 400)) {
        fieldsParam = false;
        page -= 1;
        continue;
      }
      throw error;
    }
    if (page === 0) firstUrl = url;
    const pageRows = (body.data ?? []).map((d) => d.data ?? {});
    rows.push(...pageRows);
    if (pageRows.length < FDIC_PAGE_LIMIT || rows.length >= Number(body.meta?.total ?? rows.length)) break;
  }
  const read = readFdicFlags(rows);
  return {
    read,
    sourceUrl: firstUrl,
    asOf: today,
    asOfBasis: "fetch date (BankFind serves current institution records)",
    emptyReason: rows.length === 0 ? "BankFind returned no active institutions" : read.records.length === 0 ? "No BankFind record carried an MDI, specialty, mutual or Subchapter S field" : null,
    extra: { requested_fields: fieldsParam },
  };
}

async function fetchFoicu(options: RegistryFetchOptions, now: Date): Promise<FetchedList> {
  let q: Quarter = latestPublishableQuarter(now, NCUA_FILING_LAG_DAYS);
  const tried: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1, q = previousQuarter(q)) {
    const url = ncuaZipUrl(q);
    tried.push(url);
    let bytes: Uint8Array;
    try {
      const response = await registryFetch(url, { timeoutMs: 180_000, ...options });
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (isStatus(error, 404)) continue;
      throw error;
    }
    const rows = foicuRowsFromZip(bytes);
    if (!rows) return { read: null, sourceUrl: url, asOf: quarterEndDate(q), asOfBasis: "5300 quarter end", emptyReason: "The 5300 zip has no FOICU.txt", extra: { tried } };
    const read = readFoicuFlags(rows);
    return {
      read,
      sourceUrl: url,
      asOf: quarterEndDate(q),
      asOfBasis: "5300 quarter end",
      emptyReason: read.records.length === 0 ? "FOICU carried no low-income, field-of-membership or year-opened column" : null,
      extra: { tried },
    };
  }
  return { read: null, sourceUrl: tried[0] ?? null, asOf: null, asOfBasis: "none", emptyReason: "NCUA has not published a 5300 zip for the last three quarters", extra: { tried } };
}

async function fetchLinkedList(
  options: RegistryFetchOptions,
  today: string,
  pageUrl: string,
  link: RegExp,
  reader: (bytes: Uint8Array) => ListRead & { format: string; sheet: string | null },
  label: string,
  pageReader?: (html: string) => ListRead & { format: string; sheet: string | null },
): Promise<FetchedList> {
  const page = await registryFetch(pageUrl, options);
  const html = await page.text();
  const links = findListLinks(html, link, pageUrl);
  if (links.length === 0 && pageReader) {
    // No file linked: read the page's own table.
    const read = pageReader(html);
    return {
      read,
      sourceUrl: pageUrl,
      asOf: today,
      asOfBasis: "fetch date (read from the page's table)",
      emptyReason: read.records.length === 0 ? `No ${label} file link or readable table on ${pageUrl} (${read.fieldsMissing.join(", ") || "no rows"})` : null,
      extra: { page_url: pageUrl, links, format: read.format },
    };
  }
  if (links.length === 0) {
    return { read: null, sourceUrl: pageUrl, asOf: null, asOfBasis: "none", emptyReason: `No ${label} file link found on ${pageUrl}`, extra: { page_url: pageUrl, links } };
  }
  const fileUrl = links[0];
  const response = await registryFetch(fileUrl, { timeoutMs: 120_000, ...options });
  const read = reader(new Uint8Array(await response.arrayBuffer()));
  const named = dateInFileName(fileUrl);
  return {
    read,
    sourceUrl: fileUrl,
    asOf: named ?? today,
    asOfBasis: named ? "date in the file name" : "fetch date (the file name carries no date)",
    emptyReason: read.records.length === 0 ? `The ${label} file had no rows we could read (${read.fieldsMissing.join(", ") || "no rows"})` : null,
    extra: { page_url: pageUrl, links, format: read.format, sheet: read.sheet },
  };
}

async function writeRecords(db: RegistryDb, list: string, records: MatchedRecord[], asOf: string | null, url: string | null, runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < records.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      records.slice(at, at + WRITE_CHUNK).map((r) => ({
        designation: r.designation,
        value: r.value,
        record_key: r.recordKey,
        institution_id: r.institutionId,
        listed_name: r.name,
        listed_state: r.state,
        listed_city: r.city,
        listed_cert: r.fdicCert,
        listed_charter: r.ncuaCharter,
        org_type: r.orgType,
        matched_by: r.matchedBy,
        unmatched_reason: r.unmatchedReason,
        raw: r.raw,
      })),
    );
    const result = await db`
      INSERT INTO institution_designations
        (source, designation, value, record_key, institution_id, listed_name, listed_state, listed_city,
         listed_cert, listed_charter, org_type, matched_by, unmatched_reason, as_of, source_url, raw,
         agent_run_id, fetched_at)
      SELECT ${list}, x.designation, x.value, x.record_key, x.institution_id, x.listed_name, x.listed_state, x.listed_city,
             x.listed_cert, x.listed_charter, x.org_type, x.matched_by, x.unmatched_reason, ${asOf}::date, ${url}, x.raw,
             ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          designation text, value text, record_key text, institution_id bigint, listed_name text, listed_state text,
          listed_city text, listed_cert text, listed_charter text, org_type text, matched_by text, unmatched_reason text, raw jsonb)
      ON CONFLICT (source, designation, record_key) DO UPDATE SET
        value = EXCLUDED.value,
        institution_id = EXCLUDED.institution_id,
        listed_name = EXCLUDED.listed_name,
        listed_state = EXCLUDED.listed_state,
        listed_city = EXCLUDED.listed_city,
        listed_cert = EXCLUDED.listed_cert,
        listed_charter = EXCLUDED.listed_charter,
        org_type = EXCLUDED.org_type,
        matched_by = EXCLUDED.matched_by,
        unmatched_reason = EXCLUDED.unmatched_reason,
        as_of = EXCLUDED.as_of,
        source_url = EXCLUDED.source_url,
        raw = EXCLUDED.raw,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistryDesignationLists(options: RegistryDesignationListsOptions): Promise<RegistryDesignationListsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const list = options.partitionKey as DesignationList;
  if (!DESIGNATION_LIST_KEYS.includes(list)) throw new Error(`Invalid designation list partition: ${options.partitionKey}`);
  const now = options.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const fetchOptions = options.fetchOptions ?? {};

  const fetched =
    list === DESIGNATION_LISTS.fdic
      ? await fetchFdic(fetchOptions, today)
      : list === DESIGNATION_LISTS.ncuaFoicu
        ? await fetchFoicu(fetchOptions, now)
        : list === DESIGNATION_LISTS.ncuaMdi
          ? await fetchLinkedList(fetchOptions, today, NCUA_MDI_PAGE_URL, NCUA_MDI_LINK, readNcuaMdiList, "NCUA MDI list")
          : await fetchLinkedList(fetchOptions, today, CDFI_PAGE_URL, CDFI_LINK, readCdfiList, "CDFI Fund certified list");

  const institutions = (await db`
    SELECT id, source, cert_number, ncua_charter_id, institution_name, state_code
      FROM institution_sources
     WHERE source IN ('fdic', 'ncua')
  `) as unknown as InstitutionKeyRow[];
  const index = buildInstitutionIndex([...(institutions ?? [])]);
  const matched = (fetched.read?.records ?? []).map((r) => matchRecord(r, index));
  const cleaning = cleanDesignationRecords(matched, now.getUTCFullYear());
  const records = dedupeRecords(matched);

  const base: RegistryDesignationListsResult = {
    source: DESIGNATION_LISTS_SOURCE,
    partitionKey: list,
    sourceUrl: fetched.sourceUrl,
    asOf: fetched.asOf,
    rowsRead: fetched.read?.rowsRead ?? 0,
    records: records.length,
    matched: records.filter((r) => r.institutionId !== null).length,
    unmatched: records.filter((r) => r.institutionId === null).length,
    writtenRows: 0,
    removedRows: 0,
    fieldsMissing: fetched.read?.fieldsMissing ?? [],
    dryRun,
    empty: fetched.emptyReason !== null,
    emptyReason: fetched.emptyReason,
  };
  if (dryRun) return base;

  const detail = {
    parser_version: DESIGNATION_LISTS_PARSER_VERSION,
    as_of: fetched.asOf,
    as_of_basis: fetched.asOfBasis,
    rows_read: base.rowsRead,
    fields_found: fetched.read?.fieldsFound ?? [],
    fields_missing: base.fieldsMissing,
    unexpected_fields: fetched.read?.unexpectedFields ?? [],
    skipped_rows: fetched.read?.skipped ?? {},
    cleaning,
    ...fetched.extra,
  };

  if (fetched.emptyReason !== null) {
    await recordRegistryPartition(db, {
      source: DESIGNATION_LISTS_SOURCE,
      partitionKey: list,
      status: "empty",
      rowCount: 0,
      sourceUrl: fetched.sourceUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: EMPTY_RETRY_HOURS,
      detail: { ...detail, reason: fetched.emptyReason },
    });
    return base;
  }

  const [stored] = (await db`
    SELECT COUNT(*)::int AS rows FROM institution_designations WHERE source = ${list}
  `) as unknown as Array<{ rows: number }>;
  const storedRows = Number(stored?.rows ?? 0);
  const writtenRows = await writeRecords(db, list, records, fetched.asOf, fetched.sourceUrl, options.runId ?? null);
  let removedRows = 0;
  const prune = storedRows === 0 || records.length >= storedRows * MIN_SHARE_TO_PRUNE;
  if (prune) {
    const keys = JSON.stringify(records.map((r) => `${r.designation}|${r.recordKey}`));
    const removed = await db`
      DELETE FROM institution_designations
       WHERE source = ${list}
         AND (designation || '|' || record_key) NOT IN (SELECT jsonb_array_elements_text(${keys}::jsonb))
      RETURNING 1
    `;
    removedRows = [...(removed as unknown as unknown[])].length;
  }

  await recordRegistryPartition(db, {
    source: DESIGNATION_LISTS_SOURCE,
    partitionKey: list,
    status: "succeeded",
    rowCount: records.length,
    matchedCount: base.matched,
    unmatchedCount: base.unmatched,
    insertedCount: writtenRows,
    sourceUrl: fetched.sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS[list],
    detail: {
      ...detail,
      written_rows: writtenRows,
      removed_rows: removedRows,
      stored_rows_before: storedRows,
      stale_rows_kept: prune ? null : `New read has ${records.length} rows against ${storedRows} stored; old rows kept for review`,
    },
  });
  return { ...base, writtenRows, removedRows };
}
