import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  aggregateSbaFile,
  buildInstitutionIndex,
  chooseSbaResource,
  cleaningReport,
  commentSubmitter,
  eventDate,
  exactNameKey,
  fetchCdfiAwards,
  fetchFdicFailures,
  fetchFedH2Actions,
  fetchFhlbMembers,
  fetchNcuaLiquidations,
  fetchNcuaMergers,
  fetchNcuaProposedMergers,
  fetchOccBulletins,
  fetchRuleComments,
  fetchSbaResources,
  fetchSecDocumentText,
  fetchSecFeeFacts,
  hashKey,
  idValue,
  matchInstitution,
  moneyValue,
  RULE_COMMENT_TOPICS,
  SBA_FILES,
  SBA_PACKAGE_URL,
  scanSecFilingText,
  yearValue,
  type ApplicationEvent,
  type CleaningInput,
  type CleaningReport,
  type FetchedApplications,
  type FetchedEvents,
  type InstitutionIndex,
  type InstitutionIndexRow,
  type RuleCommentTopic,
  type SbaFileKey,
} from "@/lib/regulatory/industry-events";
import { loadAcceptedLinks } from "./identity";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";
import { cikBatch, SEC_FILING_BATCHES } from "./sec";

/**
 * Magellan registry step `registry-industry-events`: one source, one partition family per
 * publisher. Each partition reads one list, matches rows to institution_sources by an exact key
 * (FDIC cert, NCUA charter, RSSD, else an exact name that only one institution carries), runs the
 * cleaning pass and writes idempotently.
 *
 *   fed-h2, occ-bulletin           early warning: merger, branch and charter applications
 *   fdic-failures                  BankFind /failures             -> institution_structure_events
 *   ncua-mergers, ncua-liquidations NCUA published lists          -> institution_structure_events
 *   ncua-proposed-mergers          NCUA member-vote list          -> institution_structure_events
 *                                  (merging CU as institution, continuing CU's charter in acquirer_cert)
 *   fhlb-members                   FHFA quarterly membership XLSX -> fhlb_members
 *   cdfi-awards                    CDFI Fund award list           -> cdfi_awards
 *   sba:<file>                     SBA 7(a)/504 FOIA CSV          -> sba_lender_lending (per lender)
 *   sec:batch-N                    XBRL fee lines + merger 8-Ks   -> sec_fee_income_facts, sec_event_filings
 *   comments:<topic>               regulations.gov (key needed)   -> rule_comments
 *
 * The CourtListener fee-lawsuit partitions (lawsuits:<year>) were removed on 2026-10-17: its
 * terms allow only personal, educational or research use (DECISIONS.md "No non-commercial data").
 * Rows already in fee_lawsuits are never read.
 */

export const INDUSTRY_EVENTS_SOURCE = "industry-events";
export const INDUSTRY_EVENTS_PARSER_VERSION = 3;
const WRITE_CHUNK = 1_000;
const SEC_PAUSE_MS = 250;
const SEC_CONCURRENCY = 2;
/** Per run, so one partition stays inside a step's time limit; the rest wait for the next run. */
const MAX_8K_SCANS = 120;
const MAX_10K_SCANS = 30;

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30, quarter: 24 * 90 };

export function industryEventsPartitions(now: Date): string[] {
  void now;
  const out = [
    "fed-h2",
    "occ-bulletin",
    "fdic-failures",
    "ncua-mergers",
    "ncua-proposed-mergers",
    "ncua-liquidations",
    "fhlb-members",
    "cdfi-awards",
    ...(Object.keys(SBA_FILES) as SbaFileKey[]).map((k) => `sba:${k}`),
    ...Array.from({ length: SEC_FILING_BATCHES }, (_, i) => `sec:batch-${i}`),
  ];
  // Always listed: without DATA_GOV_API_KEY each run records the partition as skipped with that
  // reason (never a failure) and looks again a day later.
  out.push(...Object.keys(RULE_COMMENT_TOPICS).map((t) => `comments:${t}`));
  return out;
}

export interface RegistryIndustryEventsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  pauseMs?: number;
}

export interface RegistryIndustryEventsResult {
  source: string;
  partitionKey: string;
  family: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  matchedRows: number;
  unmatchedRows: number;
  missingFields: string[];
  unexpectedFields: string[];
  truncated: boolean;
  cleaning: CleaningReport | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  /** Nothing could be loaded for a reason outside the data (a missing key, a refused token). */
  skipped: boolean;
  extra: Record<string, unknown>;
}

interface Prepared {
  sourceUrl: string | null;
  rows: number;
  matched: number;
  missingFields: string[];
  unexpectedFields: string[];
  truncated: boolean;
  cleaning: CleaningInput[];
  reason: string | null;
  skipped?: boolean;
  refreshHours: number;
  extra: Record<string, unknown>;
  write: (db: RegistryDb, runId: number | null) => Promise<number>;
}

async function loadIndex(db: RegistryDb): Promise<InstitutionIndex> {
  const rows = await db<InstitutionIndexRow[]>`
    SELECT id, source, cert_number, rssd_id, institution_name, state_code FROM institution_sources
  `;
  return buildInstitutionIndex([...rows]);
}

async function writeChunks(rows: Array<Record<string, unknown>>, write: (payload: string) => Promise<unknown>): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
    const result = await write(JSON.stringify(rows.slice(at, at + WRITE_CHUNK)));
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Structure events (failures, mergers, liquidations, early-warning applications)
// ---------------------------------------------------------------------------

interface StructurePayload {
  event_key: string;
  cert: string | null;
  institution_id: number | null;
  institution_name: string | null;
  change_code: string | null;
  change_description: string | null;
  effective_date: string | null;
  acquirer_cert: string | null;
  acquirer_name: string | null;
  office_city: string | null;
  office_state: string | null;
  raw_json: unknown;
  source_url: string | null;
}

function writeStructureEvents(source: string, rows: StructurePayload[]) {
  return (db: RegistryDb, runId: number | null) =>
    writeChunks(rows as unknown as Array<Record<string, unknown>>, (payload) => db`
      INSERT INTO institution_structure_events (
        source, event_key, cert, institution_id, institution_name, change_code, change_description,
        effective_date, acquirer_cert, acquirer_name, office_city, office_state, raw_json, source_url,
        agent_run_id, fetched_at)
      SELECT ${source}, r.event_key, r.cert, r.institution_id, r.institution_name, r.change_code,
             r.change_description, r.effective_date, r.acquirer_cert, r.acquirer_name, r.office_city,
             r.office_state, COALESCE(r.raw_json, '{}'::jsonb), r.source_url, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          event_key text, cert text, institution_id bigint, institution_name text, change_code text,
          change_description text, effective_date date, acquirer_cert text, acquirer_name text,
          office_city text, office_state text, raw_json jsonb, source_url text)
      ON CONFLICT (source, event_key) DO UPDATE SET
        cert = EXCLUDED.cert,
        institution_id = EXCLUDED.institution_id,
        institution_name = EXCLUDED.institution_name,
        change_code = EXCLUDED.change_code,
        change_description = EXCLUDED.change_description,
        effective_date = EXCLUDED.effective_date,
        acquirer_cert = EXCLUDED.acquirer_cert,
        acquirer_name = EXCLUDED.acquirer_name,
        office_city = EXCLUDED.office_city,
        office_state = EXCLUDED.office_state,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    `);
}

function prepareListEvents(fetched: FetchedEvents, index: InstitutionIndex, source: string, charterKind: "fdic" | "ncua", refreshHours: number): Prepared {
  const unique = [...new Map(fetched.events.map((e) => [e.eventKey, e])).values()];
  const cleaning: CleaningInput[] = [];
  const rows: StructurePayload[] = unique.map((e) => {
    const match = matchInstitution(index, {
      fdicCert: charterKind === "fdic" ? e.cert : null,
      ncuaCharter: charterKind === "ncua" ? e.cert : null,
      name: e.institutionName,
      state: e.state,
    });
    cleaning.push({
      key: e.eventKey,
      institutionId: match.institutionId,
      ambiguous: match.ambiguous,
      fields: { cert: e.cert, name: e.institutionName, effective_date: e.effectiveDate, state: e.state },
      dates: { effective_date: e.effectiveDate },
      amounts: charterKind === "fdic" ? { assets: moneyValue(e.raw.QBFASSET), deposits: moneyValue(e.raw.QBFDEP) } : undefined,
    });
    return {
      event_key: e.eventKey,
      cert: e.cert,
      institution_id: match.institutionId,
      institution_name: e.institutionName,
      change_code: e.changeCode,
      change_description: e.changeDescription,
      effective_date: e.effectiveDate,
      acquirer_cert: e.acquirerCert,
      acquirer_name: e.acquirerName,
      office_city: e.city,
      office_state: e.state,
      raw_json: e.raw,
      source_url: fetched.sourceUrl,
    };
  });
  return {
    sourceUrl: fetched.sourceUrl,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: fetched.missingFields,
    unexpectedFields: fetched.unexpectedFields,
    truncated: fetched.truncated,
    cleaning,
    reason: rows.length === 0 ? fetched.reason ?? "no records" : null,
    refreshHours,
    extra: { ...fetched.extra, total: fetched.total, duplicate_records: fetched.events.length - unique.length },
    write: writeStructureEvents(source, rows),
  };
}

/**
 * NCUA's proposed-merger list names both credit unions but gives no charter or state, so each
 * name is matched exactly against credit union records only (a name two credit unions share stays
 * unmatched). The merging credit union is the row's institution; the continuing one's charter goes
 * in acquirer_cert, as the other NCUA lists do, so its own profile can find the deal.
 */
export function prepareProposedMergers(fetched: FetchedEvents, creditUnions: InstitutionIndexRow[]): Prepared {
  const ncua = creditUnions.filter((r) => r.source === "ncua");
  const index = buildInstitutionIndex(ncua);
  const charterById = new Map(ncua.map((r) => [Number(r.id), idValue(r.cert_number)]));
  const unique = [...new Map(fetched.events.map((e) => [e.eventKey, e])).values()];
  const cleaning: CleaningInput[] = [];
  let acquirersMatched = 0;
  const rows: StructurePayload[] = unique.map((e) => {
    const merging = matchInstitution(index, { name: e.institutionName, nameWithoutState: true });
    const continuing = matchInstitution(index, { name: e.acquirerName, nameWithoutState: true });
    const acquirerCert = continuing.institutionId !== null ? charterById.get(continuing.institutionId) ?? null : null;
    if (acquirerCert) acquirersMatched += 1;
    cleaning.push({
      key: e.eventKey,
      institutionId: merging.institutionId,
      ambiguous: merging.ambiguous,
      fields: { name: e.institutionName, acquirer_name: e.acquirerName, effective_date: e.effectiveDate },
      dates: { effective_date: e.effectiveDate },
    });
    return {
      event_key: e.eventKey,
      cert: merging.institutionId !== null ? charterById.get(merging.institutionId) ?? null : null,
      institution_id: merging.institutionId,
      institution_name: e.institutionName,
      change_code: e.changeCode,
      change_description: e.changeDescription,
      effective_date: e.effectiveDate,
      acquirer_cert: acquirerCert,
      acquirer_name: e.acquirerName,
      office_city: null,
      office_state: null,
      raw_json: e.raw,
      source_url: fetched.sourceUrl,
    };
  });
  return {
    sourceUrl: fetched.sourceUrl,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: fetched.missingFields,
    unexpectedFields: fetched.unexpectedFields,
    truncated: fetched.truncated,
    cleaning,
    reason: rows.length === 0 ? fetched.reason ?? "no records" : null,
    refreshHours: HOURS.week,
    extra: { ...fetched.extra, total: fetched.total, duplicate_records: fetched.events.length - unique.length, acquirers_matched: acquirersMatched },
    write: writeStructureEvents("ncua-proposed-mergers", rows),
  };
}

function prepareApplications(fetched: FetchedApplications, index: InstitutionIndex, source: string): Prepared {
  const unique = [...new Map(fetched.events.map((e) => [e.eventKey, e])).values()];
  const cleaning: CleaningInput[] = [];
  const rows: StructurePayload[] = unique.map((e: ApplicationEvent) => {
    const match = matchInstitution(index, { name: e.institutionName, nameWithoutState: true });
    cleaning.push({ key: e.eventKey, institutionId: match.institutionId, ambiguous: match.ambiguous, fields: { release_date: e.releaseDate, section: e.section }, dates: { release_date: e.releaseDate } });
    return {
      event_key: e.eventKey,
      cert: null,
      institution_id: match.institutionId,
      institution_name: e.institutionName,
      // The release's own heading ("Bank Holding Companies", "Applications received") and line.
      change_code: e.section ? e.section.slice(0, 200) : null,
      change_description: e.text,
      effective_date: e.releaseDate,
      acquirer_cert: null,
      acquirer_name: null,
      office_city: null,
      office_state: null,
      raw_json: { release: e.release, section: e.section, text: e.text },
      source_url: e.sourceUrl,
    };
  });
  return {
    sourceUrl: fetched.sourceUrl,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: [],
    unexpectedFields: [],
    truncated: false,
    cleaning,
    reason: rows.length === 0 ? fetched.reason ?? "no merger, branch or charter lines in the releases read" : null,
    refreshHours: HOURS.day,
    extra: { releases: fetched.releases, undated_releases: fetched.releases.length - new Set(unique.filter((e) => e.releaseDate).map((e) => e.release)).size },
    write: writeStructureEvents(source, rows),
  };
}

// ---------------------------------------------------------------------------
// FHLB members and CDFI awards
// ---------------------------------------------------------------------------

async function prepareFhlb(index: InstitutionIndex, options: RegistryFetchOptions | undefined): Promise<Prepared> {
  const list = await fetchFhlbMembers(options);
  const cleaning: CleaningInput[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const { fields: f, raw } of list.table?.rows ?? []) {
    const memberKey = idValue(f.fhfaId) ? `fhfa:${idValue(f.fhfaId)}` : idValue(f.rssd) ? `rssd:${idValue(f.rssd)}` : `name:${exactNameKey(f.memberName)}|${f.state ?? ""}`;
    const rowKey = `${exactNameKey(f.fhlbank)}|${memberKey}`;
    const match = matchInstitution(index, { rssd: f.rssd, fdicCert: f.fdicCert, ncuaCharter: f.ncuaCharter, name: f.memberName, state: f.state });
    cleaning.push({
      key: rowKey,
      institutionId: match.institutionId,
      ambiguous: match.ambiguous,
      fields: { fhlbank: f.fhlbank, member_name: f.memberName, state: f.state, rssd: f.rssd },
      dates: { membership_date: eventDate(f.membershipDate) },
    });
    byKey.set(rowKey, {
      row_key: rowKey,
      fhlbank: f.fhlbank,
      member_name: f.memberName,
      city: f.city,
      state: f.state,
      rssd_id: idValue(f.rssd),
      fdic_cert: idValue(f.fdicCert),
      ncua_charter: idValue(f.ncuaCharter),
      fhfa_id: idValue(f.fhfaId),
      charter_type: f.charterType,
      membership_date: eventDate(f.membershipDate),
      institution_id: match.institutionId,
      match_method: match.method,
      raw_json: raw,
    });
  }
  const rows = [...byKey.values()];
  return {
    sourceUrl: list.sourceUrl,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: list.table?.missingFields ?? [],
    unexpectedFields: list.table?.unexpectedHeaders ?? [],
    truncated: false,
    cleaning,
    reason: rows.length === 0 ? list.reason ?? "the membership file had no rows" : null,
    refreshHours: HOURS.month,
    extra: { pages_tried: list.pagesTried, candidates: list.candidates.slice(0, 10), file_url: list.fileUrl, mapped_headers: list.table?.mapped ?? {} },
    write: (db, runId) =>
      writeChunks(rows, (payload) => db`
        INSERT INTO fhlb_members (
          row_key, fhlbank, member_name, city, state, rssd_id, fdic_cert, ncua_charter, fhfa_id, charter_type,
          membership_date, institution_id, match_method, raw_json, file_url, agent_run_id, first_seen_at, last_seen_at)
        SELECT r.row_key, r.fhlbank, r.member_name, r.city, r.state, r.rssd_id, r.fdic_cert, r.ncua_charter, r.fhfa_id,
               r.charter_type, r.membership_date, r.institution_id, r.match_method, COALESCE(r.raw_json, '{}'::jsonb),
               ${list.fileUrl ?? list.sourceUrl}, ${runId}, NOW(), NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            row_key text, fhlbank text, member_name text, city text, state text, rssd_id text, fdic_cert text,
            ncua_charter text, fhfa_id text, charter_type text, membership_date date, institution_id bigint,
            match_method text, raw_json jsonb)
        ON CONFLICT (row_key) DO UPDATE SET
          fhlbank = EXCLUDED.fhlbank, member_name = EXCLUDED.member_name, city = EXCLUDED.city, state = EXCLUDED.state,
          rssd_id = EXCLUDED.rssd_id, fdic_cert = EXCLUDED.fdic_cert, ncua_charter = EXCLUDED.ncua_charter,
          fhfa_id = EXCLUDED.fhfa_id, charter_type = EXCLUDED.charter_type, membership_date = EXCLUDED.membership_date,
          institution_id = EXCLUDED.institution_id, match_method = EXCLUDED.match_method, raw_json = EXCLUDED.raw_json,
          file_url = EXCLUDED.file_url, agent_run_id = EXCLUDED.agent_run_id, last_seen_at = NOW()
        RETURNING 1
      `),
  };
}

async function prepareCdfi(index: InstitutionIndex, options: RegistryFetchOptions | undefined): Promise<Prepared> {
  const list = await fetchCdfiAwards(options);
  const cleaning: CleaningInput[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const { fields: f, raw } of list.table?.rows ?? []) {
    const amount = moneyValue(f.amount);
    const rowKey = hashKey([exactNameKey(f.name), f.state, f.program, f.year, f.amount]);
    const match = matchInstitution(index, { name: f.name, state: f.state });
    cleaning.push({
      key: rowKey,
      institutionId: match.institutionId,
      ambiguous: match.ambiguous,
      fields: { name: f.name, state: f.state, program: f.program, year: f.year, amount },
      amounts: { award_amount: amount },
    });
    byKey.set(rowKey, {
      row_key: rowKey,
      awardee_name: f.name,
      city: f.city,
      state: f.state,
      program: f.program,
      award_year: yearValue(f.year),
      award_year_raw: f.year,
      award_amount: amount,
      institution_type: f.institutionType,
      institution_id: match.institutionId,
      match_method: match.method,
      raw_json: raw,
    });
  }
  const rows = [...byKey.values()];
  return {
    sourceUrl: list.sourceUrl,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: list.table?.missingFields ?? [],
    unexpectedFields: list.table?.unexpectedHeaders ?? [],
    truncated: false,
    cleaning,
    reason: rows.length === 0 ? list.reason ?? "the award list had no rows" : null,
    refreshHours: HOURS.quarter,
    extra: { pages_tried: list.pagesTried, candidates: list.candidates.slice(0, 10), file_url: list.fileUrl, mapped_headers: list.table?.mapped ?? {} },
    write: (db, runId) =>
      writeChunks(rows, (payload) => db`
        INSERT INTO cdfi_awards (
          row_key, awardee_name, city, state, program, award_year, award_year_raw, award_amount, institution_type,
          institution_id, match_method, raw_json, source_url, agent_run_id, fetched_at)
        SELECT r.row_key, r.awardee_name, r.city, r.state, r.program, r.award_year, r.award_year_raw, r.award_amount,
               r.institution_type, r.institution_id, r.match_method, COALESCE(r.raw_json, '{}'::jsonb),
               ${list.fileUrl ?? list.sourceUrl}, ${runId}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            row_key text, awardee_name text, city text, state text, program text, award_year int, award_year_raw text,
            award_amount numeric, institution_type text, institution_id bigint, match_method text, raw_json jsonb)
        ON CONFLICT (row_key) DO UPDATE SET
          institution_id = EXCLUDED.institution_id, match_method = EXCLUDED.match_method, raw_json = EXCLUDED.raw_json,
          institution_type = EXCLUDED.institution_type, city = EXCLUDED.city, source_url = EXCLUDED.source_url,
          agent_run_id = EXCLUDED.agent_run_id, fetched_at = NOW()
        RETURNING 1
      `),
  };
}

// ---------------------------------------------------------------------------
// SBA lending per lender
// ---------------------------------------------------------------------------

async function prepareSba(key: SbaFileKey, index: InstitutionIndex, options: RegistryFetchOptions | undefined): Promise<Prepared> {
  const resources = await fetchSbaResources(options);
  const resource = chooseSbaResource(resources, key);
  const base = { matched: 0, unexpectedFields: [], truncated: false, cleaning: [], refreshHours: HOURS.month, write: async () => 0 };
  if (!resource) {
    return {
      ...base,
      sourceUrl: SBA_PACKAGE_URL,
      rows: 0,
      missingFields: [],
      reason: `no CSV resource in the SBA FOIA package matched ${key}`,
      extra: { resources: resources.map((r) => r.name).slice(0, 30) },
    };
  }
  const program = SBA_FILES[key].program;
  const agg = await aggregateSbaFile(resource.url, program, options);
  const cleaning: CleaningInput[] = [];
  const rows = agg.groups.map((g) => {
    const match = matchInstitution(index, { fdicCert: g.fdicCert, ncuaCharter: g.ncuaCharter, name: g.lenderName, state: g.lenderState });
    cleaning.push({
      key: g.rowKey,
      institutionId: match.institutionId,
      ambiguous: match.ambiguous,
      fields: { lender_state: g.lenderState, project_state: g.projectState, gross_approval: g.grossApproval },
    });
    return {
      row_key: g.rowKey,
      program: g.program,
      fiscal_year: g.fiscalYear,
      lender_name: g.lenderName,
      lender_city: g.lenderCity,
      lender_state: g.lenderState,
      lender_fdic_cert: g.fdicCert,
      lender_ncua_charter: g.ncuaCharter,
      project_state: g.projectState,
      loans: g.loans,
      loans_with_amount: g.loansWithAmount,
      gross_approval: g.grossApproval,
      sba_guaranteed: g.sbaGuaranteed,
      third_party_dollars: g.thirdPartyDollars,
      institution_id: match.institutionId,
      match_method: match.method,
    };
  });
  const required = agg.missingFields.filter((f) => /lender_?name|bankname|fiscalyear|grossapproval/i.test(f));
  return {
    ...base,
    sourceUrl: resource.url,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: agg.missingFields,
    unexpectedFields: agg.unexpectedHeaders,
    cleaning,
    reason: rows.length === 0 ? (required.length > 0 ? `the file lacks ${required.join(", ")}` : "the file had no loan rows") : null,
    extra: {
      resource: resource.name,
      resource_modified: resource.lastModified,
      rows_read: agg.rowsRead,
      rows_without_lender: agg.rowsWithoutLender,
      rows_without_year: agg.rowsWithoutYear,
      rows_without_amount: agg.rowsWithoutAmount,
      negative_amounts: agg.negativeAmounts,
      loan_amount_flags: agg.amountCheck,
    },
    write: (db, runId) =>
      writeChunks(rows, (payload) => db`
        INSERT INTO sba_lender_lending (
          row_key, program, fiscal_year, lender_name, lender_city, lender_state, lender_fdic_cert, lender_ncua_charter,
          project_state, loans, loans_with_amount, gross_approval, sba_guaranteed, third_party_dollars, institution_id,
          match_method, partition_key, source_url, agent_run_id, fetched_at)
        SELECT r.row_key, r.program, r.fiscal_year, r.lender_name, r.lender_city, r.lender_state, r.lender_fdic_cert,
               r.lender_ncua_charter, r.project_state, r.loans, r.loans_with_amount, r.gross_approval, r.sba_guaranteed,
               r.third_party_dollars, r.institution_id, r.match_method, ${`sba:${key}`}, ${resource.url}, ${runId}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            row_key text, program text, fiscal_year int, lender_name text, lender_city text, lender_state text,
            lender_fdic_cert text, lender_ncua_charter text, project_state text, loans int, loans_with_amount int,
            gross_approval numeric, sba_guaranteed numeric, third_party_dollars numeric, institution_id bigint,
            match_method text)
        ON CONFLICT (row_key) DO UPDATE SET
          lender_name = EXCLUDED.lender_name, lender_city = EXCLUDED.lender_city, loans = EXCLUDED.loans,
          loans_with_amount = EXCLUDED.loans_with_amount, gross_approval = EXCLUDED.gross_approval,
          sba_guaranteed = EXCLUDED.sba_guaranteed, third_party_dollars = EXCLUDED.third_party_dollars,
          institution_id = EXCLUDED.institution_id, match_method = EXCLUDED.match_method,
          partition_key = EXCLUDED.partition_key, source_url = EXCLUDED.source_url,
          agent_run_id = EXCLUDED.agent_run_id, fetched_at = NOW()
        RETURNING 1
      `),
  };
}

// ---------------------------------------------------------------------------
// Rule comments
// ---------------------------------------------------------------------------

async function prepareComments(topic: RuleCommentTopic, index: InstitutionIndex, options: RegistryFetchOptions | undefined, env: NodeJS.ProcessEnv): Promise<Prepared> {
  const key = env.DATA_GOV_API_KEY?.trim();
  if (!key) {
    return {
      sourceUrl: null, rows: 0, matched: 0, missingFields: [], unexpectedFields: [], truncated: false, cleaning: [],
      reason: "No DATA_GOV_API_KEY set: regulations.gov needs a free api.data.gov key, so fee-rule comments were not loaded",
      skipped: true, refreshHours: HOURS.day, extra: {}, write: async () => 0,
    };
  }
  const isMatched = (name: string) => matchInstitution(index, { name, nameWithoutState: true }).institutionId !== null;
  const fetched = await fetchRuleComments(topic, key, options, isMatched);
  const cleaning: CleaningInput[] = [];
  const rows = fetched.comments.map((c) => {
    const match = matchInstitution(index, { name: c.submitterName ?? commentSubmitter(c.title), nameWithoutState: true });
    cleaning.push({ key: c.commentId, institutionId: match.institutionId, ambiguous: match.ambiguous, fields: { posted_date: c.postedDate, submitter: c.submitterName }, dates: { posted_date: c.postedDate } });
    return {
      comment_id: c.commentId,
      docket_id: c.docketId,
      docket_title: c.docketTitle,
      agency_id: c.agencyId,
      title: c.title,
      submitter_name: c.submitterName,
      posted_date: c.postedDate,
      comment_url: c.commentUrl,
      institution_id: match.institutionId,
      match_method: match.method,
      raw_json: c.raw,
    };
  });
  return {
    sourceUrl: fetched.sourceUrl,
    rows: rows.length,
    matched: rows.filter((r) => r.institution_id !== null).length,
    missingFields: fetched.missingFields,
    unexpectedFields: [],
    truncated: fetched.truncated,
    cleaning,
    reason: rows.length === 0 ? (fetched.dockets.length === 0 ? "no rulemaking dockets found for this topic" : "no comments from banks or credit unions on the dockets read") : null,
    refreshHours: HOURS.week,
    extra: { dockets: fetched.dockets, comments_read: fetched.commentsRead },
    write: (db, runId) =>
      writeChunks(rows, (payload) => db`
        INSERT INTO rule_comments (
          comment_id, topic, docket_id, docket_title, agency_id, title, submitter_name, posted_date, comment_url,
          institution_id, match_method, raw_json, agent_run_id, fetched_at)
        SELECT r.comment_id, ${topic}, r.docket_id, r.docket_title, r.agency_id, r.title, r.submitter_name, r.posted_date,
               r.comment_url, r.institution_id, r.match_method, COALESCE(r.raw_json, '{}'::jsonb), ${runId}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            comment_id text, docket_id text, docket_title text, agency_id text, title text, submitter_name text,
            posted_date date, comment_url text, institution_id bigint, match_method text, raw_json jsonb)
        ON CONFLICT (comment_id) DO UPDATE SET
          docket_title = EXCLUDED.docket_title, title = EXCLUDED.title, submitter_name = EXCLUDED.submitter_name,
          posted_date = EXCLUDED.posted_date, institution_id = EXCLUDED.institution_id,
          match_method = EXCLUDED.match_method, raw_json = EXCLUDED.raw_json, agent_run_id = EXCLUDED.agent_run_id,
          fetched_at = NOW()
        RETURNING 1
      `),
  };
}

// ---------------------------------------------------------------------------
// SEC: XBRL fee-income lines, merger 8-Ks, and passages from the newest 10-K
// ---------------------------------------------------------------------------

interface FilingRow {
  accession_no: string;
  cik: string;
  institution_id: number | null;
  form: string;
  filed_at: string;
  primary_doc_url: string;
}

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function prepareSec(batch: number, db: RegistryDb, options: RegistryFetchOptions | undefined, pauseMs: number): Promise<Prepared> {
  const accepted = await loadAcceptedLinks(db, "sec_cik");
  const ciks = [...accepted.entries()].filter(([cik]) => cikBatch(cik) === batch);
  const factRows: Array<Record<string, unknown>> = [];
  const conceptsSeen = new Map<string, { label: string | null; ciks: number }>();
  let factErrors = 0;
  await mapWithConcurrency(ciks, SEC_CONCURRENCY, async ([cik, institutionId]) => {
    try {
      const facts = await fetchSecFeeFacts(cik, options);
      for (const f of facts?.facts ?? []) {
        factRows.push({
          cik, institution_id: institutionId, concept: f.concept, label: f.label, description: f.description, frame: f.frame,
          period_start: f.periodStart, period_end: f.periodEnd, value: f.value, accession_no: f.accession, form: f.form,
          filed: f.filed, source_url: facts!.url,
        });
      }
      for (const concept of new Set((facts?.facts ?? []).map((f) => f.concept))) {
        const entry = conceptsSeen.get(concept) ?? { label: facts!.facts.find((f) => f.concept === concept)?.label ?? null, ciks: 0 };
        entry.ciks += 1;
        conceptsSeen.set(concept, entry);
      }
    } catch {
      factErrors += 1;
    }
    await pause(pauseMs);
  });

  const toScan = await db<FilingRow[]>`
    WITH unscanned AS (
      SELECT f.accession_no, f.cik, f.institution_id, f.form, f.filed_at::text AS filed_at, f.primary_doc_url
        FROM institution_filings f
       WHERE f.primary_doc_url IS NOT NULL
         AND f.cik ~ '^[0-9]+$' AND (f.cik::bigint % ${SEC_FILING_BATCHES}) = ${batch}
         AND NOT EXISTS (SELECT 1 FROM sec_event_filings s
                          WHERE s.accession_no = f.accession_no AND s.parser_version >= ${INDUSTRY_EVENTS_PARSER_VERSION})
    ), eight_k AS (
      SELECT * FROM unscanned WHERE form IN ('8-K', '8-K/A') ORDER BY filed_at DESC LIMIT ${MAX_8K_SCANS}
    ), ten_k AS (
      SELECT DISTINCT ON (cik) * FROM unscanned WHERE form = '10-K' ORDER BY cik, filed_at DESC
    )
    SELECT * FROM eight_k
    UNION ALL
    SELECT * FROM (SELECT * FROM ten_k ORDER BY filed_at DESC LIMIT ${MAX_10K_SCANS}) t
  `;
  const filings = [...toScan];
  const scanRows: Array<Record<string, unknown>> = [];
  await mapWithConcurrency(filings, SEC_CONCURRENCY, async (f) => {
    try {
      const scan = scanSecFilingText(f.form, await fetchSecDocumentText(f.primary_doc_url, options));
      scanRows.push({
        accession_no: f.accession_no, cik: f.cik, institution_id: f.institution_id, form: f.form, filed_at: f.filed_at,
        filing_url: f.primary_doc_url, items: scan.items, merger_agreement: scan.mergerAgreement,
        merger_completion: scan.mergerCompletion, passages: scan.passages, text_chars: scan.textChars,
        text_truncated: scan.truncated, status: "scanned", error: null,
      });
    } catch (error) {
      scanRows.push({
        accession_no: f.accession_no, cik: f.cik, institution_id: f.institution_id, form: f.form, filed_at: f.filed_at,
        filing_url: f.primary_doc_url, items: [], merger_agreement: null, merger_completion: null, passages: [],
        text_chars: null, text_truncated: false, status: "fetch_failed", error: String(error).slice(0, 500),
      });
    }
    await pause(pauseMs);
  });
  const cleaning: CleaningInput[] = factRows.map((r) => ({
    key: `${r.cik}|${r.concept}|${r.frame}`,
    institutionId: r.institution_id as number | null,
    fields: { label: r.label as string | null },
    amounts: { [String(r.concept)]: r.value as number },
    dates: { period_end: r.period_end as string },
  }));
  const rows = factRows.length + scanRows.length;
  return {
    sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/",
    rows,
    matched: rows,
    missingFields: [],
    unexpectedFields: [],
    truncated: filings.length >= MAX_8K_SCANS,
    cleaning,
    reason: ciks.length === 0 ? "no linked SEC filers in this batch" : rows === 0 ? "no fee-income facts and no unscanned 8-K or 10-K filings" : null,
    refreshHours: HOURS.day,
    extra: {
      ciks: ciks.length,
      fee_facts: factRows.length,
      fact_fetch_errors: factErrors,
      fee_concepts_found: [...conceptsSeen].map(([concept, v]) => ({ concept, label: v.label, ciks: v.ciks })).sort((a, b) => b.ciks - a.ciks),
      filings_scanned: scanRows.filter((r) => r.status === "scanned").length,
      filings_failed: scanRows.filter((r) => r.status === "fetch_failed").length,
      merger_agreements: scanRows.filter((r) => r.merger_agreement).length,
      merger_completions: scanRows.filter((r) => r.merger_completion).length,
      ten_k_with_fee_passages: scanRows.filter((r) => /^10-K/.test(String(r.form)) && (r.passages as unknown[]).length > 0).length,
    },
    write: async (writeDb, runId) => {
      const facts = await writeChunks(factRows, (payload) => writeDb`
        INSERT INTO sec_fee_income_facts (
          cik, institution_id, concept, label, description, frame, period_start, period_end, value, accession_no, form,
          filed, source_url, agent_run_id, fetched_at)
        SELECT r.cik, r.institution_id, r.concept, r.label, r.description, r.frame, r.period_start, r.period_end, r.value,
               r.accession_no, r.form, r.filed, r.source_url, ${runId}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            cik text, institution_id bigint, concept text, label text, description text, frame text, period_start date,
            period_end date, value numeric, accession_no text, form text, filed date, source_url text)
        ON CONFLICT (cik, concept, frame) DO UPDATE SET
          institution_id = EXCLUDED.institution_id, label = EXCLUDED.label, description = EXCLUDED.description,
          period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, value = EXCLUDED.value,
          accession_no = EXCLUDED.accession_no, form = EXCLUDED.form, filed = EXCLUDED.filed,
          agent_run_id = EXCLUDED.agent_run_id, fetched_at = NOW()
        RETURNING 1
      `);
      const scans = await writeChunks(scanRows, (payload) => writeDb`
        INSERT INTO sec_event_filings (
          accession_no, cik, institution_id, form, filed_at, filing_url, items, merger_agreement, merger_completion,
          passages, text_chars, text_truncated, status, error, parser_version, agent_run_id, scanned_at)
        SELECT r.accession_no, r.cik, r.institution_id, r.form, r.filed_at, r.filing_url,
               ARRAY(SELECT jsonb_array_elements_text(COALESCE(r.items, '[]'::jsonb))), r.merger_agreement,
               r.merger_completion, COALESCE(r.passages, '[]'::jsonb), r.text_chars, r.text_truncated, r.status, r.error,
               ${INDUSTRY_EVENTS_PARSER_VERSION}, ${runId}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            accession_no text, cik text, institution_id bigint, form text, filed_at date, filing_url text, items jsonb,
            merger_agreement boolean, merger_completion boolean, passages jsonb, text_chars int, text_truncated boolean,
            status text, error text)
        ON CONFLICT (accession_no) DO UPDATE SET
          institution_id = EXCLUDED.institution_id, items = EXCLUDED.items, merger_agreement = EXCLUDED.merger_agreement,
          merger_completion = EXCLUDED.merger_completion, passages = EXCLUDED.passages, text_chars = EXCLUDED.text_chars,
          text_truncated = EXCLUDED.text_truncated, status = EXCLUDED.status, error = EXCLUDED.error,
          parser_version = EXCLUDED.parser_version, agent_run_id = EXCLUDED.agent_run_id, scanned_at = NOW()
        RETURNING 1
      `);
      return facts + scans;
    },
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function partitionFamily(partitionKey: string): string {
  return partitionKey.split(":")[0];
}

async function prepare(options: RegistryIndustryEventsOptions, db: RegistryDb, now: Date, env: NodeJS.ProcessEnv): Promise<Prepared> {
  const key = options.partitionKey;
  const fo = options.fetchOptions;
  const [family, arg] = key.split(":");
  if (family === "sec") {
    const m = /^batch-(\d+)$/.exec(arg ?? "");
    if (!m || Number(m[1]) >= SEC_FILING_BATCHES) throw new Error(`Invalid industry-events SEC partition: ${key}`);
    return prepareSec(Number(m[1]), db, fo, options.pauseMs ?? SEC_PAUSE_MS);
  }
  if (family === "ncua-proposed-mergers") {
    const creditUnions = await db<InstitutionIndexRow[]>`
      SELECT id, source, cert_number, rssd_id, institution_name, state_code FROM institution_sources WHERE source = 'ncua'
    `;
    return prepareProposedMergers(await fetchNcuaProposedMergers(fo), [...creditUnions]);
  }
  const index = await loadIndex(db);
  switch (family) {
    case "fdic-failures":
      return prepareListEvents(await fetchFdicFailures(fo), index, "fdic-failures", "fdic", HOURS.week);
    case "ncua-mergers":
      return prepareListEvents(await fetchNcuaMergers(fo), index, "ncua-mergers", "ncua", HOURS.month);
    case "ncua-liquidations":
      return prepareListEvents(await fetchNcuaLiquidations(fo), index, "ncua-liquidations", "ncua", HOURS.month);
    case "fed-h2":
      return prepareApplications(await fetchFedH2Actions(fo), index, "fed-h2");
    case "occ-bulletin":
      return prepareApplications(await fetchOccBulletins(fo), index, "occ-bulletin");
    case "fhlb-members":
      return prepareFhlb(index, fo);
    case "cdfi-awards":
      return prepareCdfi(index, fo);
    case "sba":
      if (!arg || !(arg in SBA_FILES)) throw new Error(`Invalid industry-events SBA partition: ${key}`);
      return prepareSba(arg as SbaFileKey, index, fo);
    case "comments":
      if (!arg || !(arg in RULE_COMMENT_TOPICS)) throw new Error(`Invalid industry-events comments partition: ${key}`);
      return prepareComments(arg as RuleCommentTopic, index, fo, env);
    default:
      throw new Error(`Unknown industry-events partition: ${key}`);
  }
}

export async function runRegistryIndustryEvents(options: RegistryIndustryEventsOptions): Promise<RegistryIndustryEventsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const p = await prepare(options, db, now, env);
  const cleaning = p.cleaning.length > 0 ? cleaningReport(p.cleaning, now) : null;
  const empty = p.rows === 0;
  const result: RegistryIndustryEventsResult = {
    source: INDUSTRY_EVENTS_SOURCE,
    partitionKey: options.partitionKey,
    family: partitionFamily(options.partitionKey),
    sourceUrl: p.sourceUrl,
    rows: p.rows,
    writtenRows: 0,
    matchedRows: p.matched,
    unmatchedRows: p.rows - p.matched,
    missingFields: p.missingFields,
    unexpectedFields: p.unexpectedFields,
    truncated: p.truncated,
    cleaning,
    dryRun,
    empty,
    emptyReason: empty ? p.reason : null,
    skipped: Boolean(p.skipped),
    extra: p.extra,
  };
  if (dryRun) return result;

  const detail = {
    parser_version: INDUSTRY_EVENTS_PARSER_VERSION,
    family: result.family,
    missing_fields: p.missingFields,
    unexpected_fields: p.unexpectedFields.slice(0, 40),
    truncated: p.truncated,
    cleaning,
    ...p.extra,
  };
  if (empty) {
    await recordRegistryPartition(db, {
      source: INDUSTRY_EVENTS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: p.sourceUrl,
      runId: options.runId ?? null,
      nextAttemptAfterHours: p.refreshHours,
      detail: { ...detail, reason: p.reason, skipped: Boolean(p.skipped) },
    });
    return result;
  }
  result.writtenRows = await p.write(db, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: INDUSTRY_EVENTS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: p.rows,
    matchedCount: p.matched,
    unmatchedCount: p.rows - p.matched,
    insertedCount: result.writtenRows,
    sourceUrl: p.sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: p.refreshHours,
    detail: { ...detail, written_rows: result.writtenRows },
  });
  return result;
}
