import { sql } from "@/lib/data-store/connection";
import { fetchFdicHistoryYear, FDIC_HISTORY_URL, type FdicHistoryEvent } from "@/lib/regulatory/fdic-history";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one calendar year of FDIC structure history (mergers, charter and
 * name changes, failures, branch openings and closings) written to
 * institution_structure_events, linked to the bank's FDIC row by certificate when we hold it.
 * Partitions are years, newest first; the current year refreshes weekly.
 */

export const FDIC_HISTORY_SOURCE = "fdic-history";
export const FDIC_HISTORY_PARSER_VERSION = 1;
export const FDIC_HISTORY_FIRST_YEAR = 2005;
const CURRENT_REFRESH_HOURS = 24 * 7;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const WRITE_CHUNK = 2_000;

export function fdicHistoryPartitions(now: Date, firstYear: number = FDIC_HISTORY_FIRST_YEAR): string[] {
  const out: string[] = [];
  for (let year = now.getUTCFullYear(); year >= firstYear; year -= 1) out.push(String(year));
  return out;
}

export interface RegistryFdicHistoryOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFdicHistoryResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  total: number;
  events: number;
  writtenRows: number;
  linkedEvents: number;
  truncated: boolean;
  missingFields: string[];
  undatedRecords: number;
  topChangeCodes: Array<{ code: string | null; description: string | null; events: number }>;
  dryRun: boolean;
  empty: boolean;
}

function topCodes(events: FdicHistoryEvent[]): RegistryFdicHistoryResult["topChangeCodes"] {
  const counts = new Map<string, { code: string | null; description: string | null; events: number }>();
  for (const e of events) {
    const key = e.changeCode ?? "";
    const row = counts.get(key) ?? { code: e.changeCode, description: e.changeDescription, events: 0 };
    row.events += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.events - a.events).slice(0, 15);
}

async function writeEvents(db: RegistryDb, events: FdicHistoryEvent[], runId: number | null): Promise<{ written: number; linked: number }> {
  let written = 0;
  let linked = 0;
  for (let at = 0; at < events.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      events.slice(at, at + WRITE_CHUNK).map((e) => ({
        event_key: e.eventKey,
        cert: e.cert,
        institution_name: e.institutionName,
        change_code: e.changeCode,
        change_description: e.changeDescription,
        effective_date: e.effectiveDate,
        process_date: e.processDate,
        acquirer_cert: e.acquirerCert,
        acquirer_name: e.acquirerName,
        outgoing_cert: e.outgoingCert,
        outgoing_name: e.outgoingName,
        survivor_cert: e.survivorCert,
        survivor_name: e.survivorName,
        office_number: e.officeNumber,
        office_name: e.officeName,
        office_city: e.officeCity,
        office_state: e.officeState,
        office_zip: e.officeZip,
        office_county: e.officeCounty,
        raw_json: e.raw,
      })),
    );
    const result = await db`
      WITH r AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
          event_key text, cert text, institution_name text, change_code text, change_description text,
          effective_date date, process_date date, acquirer_cert text, acquirer_name text, outgoing_cert text,
          outgoing_name text, survivor_cert text, survivor_name text, office_number text, office_name text,
          office_city text, office_state text, office_zip text, office_county text, raw_json jsonb)
      ), ids AS (
        SELECT DISTINCT ON (s.cert_number) s.cert_number, s.id AS institution_id
          FROM institution_sources s
         WHERE s.source = 'fdic' AND s.cert_number IN (SELECT DISTINCT cert FROM r WHERE cert IS NOT NULL)
         ORDER BY s.cert_number, s.id
      )
      INSERT INTO institution_structure_events (
        source, event_key, cert, institution_id, institution_name, change_code, change_description,
        effective_date, process_date, acquirer_cert, acquirer_name, outgoing_cert, outgoing_name,
        survivor_cert, survivor_name, office_number, office_name, office_city, office_state, office_zip,
        office_county, raw_json, source_url, agent_run_id, fetched_at)
      SELECT ${FDIC_HISTORY_SOURCE}, r.event_key, r.cert, ids.institution_id, r.institution_name, r.change_code,
             r.change_description, r.effective_date, r.process_date, r.acquirer_cert, r.acquirer_name,
             r.outgoing_cert, r.outgoing_name, r.survivor_cert, r.survivor_name, r.office_number, r.office_name,
             r.office_city, r.office_state, r.office_zip, r.office_county, COALESCE(r.raw_json, '{}'::jsonb),
             ${FDIC_HISTORY_URL}, ${runId}, NOW()
        FROM r LEFT JOIN ids ON ids.cert_number = r.cert
      ON CONFLICT (source, event_key) DO UPDATE SET
        cert = EXCLUDED.cert,
        institution_id = EXCLUDED.institution_id,
        institution_name = EXCLUDED.institution_name,
        change_code = EXCLUDED.change_code,
        change_description = EXCLUDED.change_description,
        effective_date = EXCLUDED.effective_date,
        process_date = EXCLUDED.process_date,
        acquirer_cert = EXCLUDED.acquirer_cert,
        acquirer_name = EXCLUDED.acquirer_name,
        outgoing_cert = EXCLUDED.outgoing_cert,
        outgoing_name = EXCLUDED.outgoing_name,
        survivor_cert = EXCLUDED.survivor_cert,
        survivor_name = EXCLUDED.survivor_name,
        office_number = EXCLUDED.office_number,
        office_name = EXCLUDED.office_name,
        office_city = EXCLUDED.office_city,
        office_state = EXCLUDED.office_state,
        office_zip = EXCLUDED.office_zip,
        office_county = EXCLUDED.office_county,
        raw_json = EXCLUDED.raw_json,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING (institution_id IS NOT NULL) AS linked
    `;
    const rows = [...(result as unknown as Array<{ linked: boolean }>)];
    written += rows.length;
    linked += rows.filter((row) => row.linked).length;
  }
  return { written, linked };
}

export async function runRegistryFdicHistory(options: RegistryFdicHistoryOptions): Promise<RegistryFdicHistoryResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const year = Number(options.partitionKey);
  if (!Number.isInteger(year) || year < 1900) throw new Error(`Invalid FDIC history year partition: ${options.partitionKey}`);
  const now = options.now ?? new Date();

  const fetched = await fetchFdicHistoryYear(year, options.fetchOptions);
  // Identical records hash to one key; keep one so the upsert never touches a row twice.
  const events = [...new Map(fetched.events.map((e) => [e.eventKey, e])).values()];
  const base: RegistryFdicHistoryResult = {
    source: FDIC_HISTORY_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    total: fetched.total,
    events: events.length,
    writtenRows: 0,
    linkedEvents: 0,
    truncated: fetched.truncated,
    missingFields: fetched.missingFields,
    undatedRecords: fetched.undatedRecords,
    topChangeCodes: topCodes(events),
    dryRun,
    empty: events.length === 0,
  };
  if (dryRun) return base;

  const refreshHours = year === now.getUTCFullYear() ? CURRENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
  const detail = {
    parser_version: FDIC_HISTORY_PARSER_VERSION,
    year,
    total: fetched.total,
    truncated: fetched.truncated,
    missing_fields: fetched.missingFields,
    undated_records: fetched.undatedRecords,
    duplicate_records: fetched.events.length - events.length,
    top_change_codes: base.topChangeCodes,
  };
  if (events.length === 0) {
    await recordRegistryPartition(db, {
      source: FDIC_HISTORY_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: fetched.url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: refreshHours,
      detail: { ...detail, reason: "FDIC returned no structure events for this year" },
    });
    return base;
  }

  const written = await writeEvents(db, events, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: FDIC_HISTORY_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: events.length,
    matchedCount: written.linked,
    unmatchedCount: written.written - written.linked,
    insertedCount: written.written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: refreshHours,
    detail: { ...detail, written_rows: written.written, linked_events: written.linked },
  });
  return { ...base, writtenRows: written.written, linkedEvents: written.linked };
}
