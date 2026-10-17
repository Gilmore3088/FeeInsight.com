import { sql } from "@/lib/data-store/connection";
import {
  checkMergerDecisions,
  companyNameKey,
  fetchFedOrders,
  fetchOccMergerDecisions,
  type DecisionChecks,
  type FetchedDecisions,
  type MergerDecision,
} from "@/lib/regulatory/bank-merger-orders";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { buildInstitutionIndex, matchInstitution, type InstitutionIndex, type InstitutionIndexRow } from "@/lib/regulatory/industry-events";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step `bank-merger-orders`: decisions on merger and acquisition applications,
 * written to the existing institution_structure_events table (migration 20270110000058) with
 * two new `source` values beside fdic-history, fed-h2 and occ-bulletin:
 *
 *   'fed-orders'            Federal Reserve Board orders on banking applications
 *   'occ-merger-decisions'  OCC corporate decisions and conditional approvals on mergers
 *
 * Column use (no new columns): effective_date = decision date; change_code = approval |
 * conditional_approval | denial | withdrawal | other; change_description = the release title;
 * acquirer_name = applicant; outgoing_name = target; institution_name = applicant;
 * institution_id / acquirer_cert = the applicant bank when its name matches exactly one
 * institution; outgoing_cert = the target bank's FDIC cert on the same exact match;
 * source_url = the order or decision document. raw_json keeps the agency, both URLs, the
 * sentence the parties were read from, holding-company RSSDs matched by exact name, and the
 * competitive figures with their verbatim sentences.
 *
 * Partitions: fed:<year> (newest first, back to FED_FIRST_YEAR) and occ:current. An order already
 * stored with its document read is not fetched again; one whose PDF failed is retried.
 */

export const BANK_MERGER_ORDERS_SOURCE = "bank-merger-orders";
export const BANK_MERGER_ORDERS_PARSER_VERSION = 1;
export const FED_ORDERS_EVENT_SOURCE = "fed-orders";
export const OCC_DECISIONS_EVENT_SOURCE = "occ-merger-decisions";
export const FED_FIRST_YEAR = 2015;

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30 };
const WRITE_CHUNK = 500;

export function bankMergerOrdersPartitions(now: Date): string[] {
  const out = ["occ:current"];
  for (let y = now.getUTCFullYear(); y >= FED_FIRST_YEAR; y -= 1) out.push(`fed:${y}`);
  return out;
}

export interface RegistryBankMergerOrdersOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
  maxDocuments?: number;
}

export interface RegistryBankMergerOrdersResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  rows: number;
  writtenRows: number;
  matchedRows: number;
  withCompetitiveFigures: number;
  deferred: number;
  missingFields: string[];
  unexpectedFields: string[];
  checks: DecisionChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  skipped: boolean;
  summary: string;
  detail: Record<string, unknown>;
}

interface IndexRow extends InstitutionIndexRow {
  holding_company_rssd: string | null;
  holding_company_name: string | null;
}

export interface PartyIndex {
  banks: InstitutionIndex;
  certById: Map<number, string>;
  /** companyNameKey(holding company name) -> RSSDs carrying it. */
  holdingCompanies: Map<string, Set<string>>;
  /** holding company RSSD -> institution ids under it. */
  institutionsByHolding: Map<string, number[]>;
}

export function buildPartyIndex(rows: IndexRow[]): PartyIndex {
  const certById = new Map<number, string>();
  const holdingCompanies = new Map<string, Set<string>>();
  const institutionsByHolding = new Map<string, number[]>();
  for (const r of rows) {
    if (r.source === "fdic" && r.cert_number) certById.set(Number(r.id), r.cert_number);
    if (r.holding_company_rssd) {
      const list = institutionsByHolding.get(r.holding_company_rssd) ?? [];
      list.push(Number(r.id));
      institutionsByHolding.set(r.holding_company_rssd, list);
      const key = companyNameKey(r.holding_company_name);
      if (key) {
        const set = holdingCompanies.get(key) ?? new Set<string>();
        set.add(r.holding_company_rssd);
        holdingCompanies.set(key, set);
      }
    }
  }
  return { banks: buildInstitutionIndex(rows), certById, holdingCompanies, institutionsByHolding };
}

export interface PartyMatch {
  institutionId: number | null;
  fdicCert: string | null;
  holdingCompanyRssd: string | null;
  method: "exact_bank_name" | "holding_company_single_bank" | "holding_company" | null;
  ambiguous: boolean;
}

/**
 * Exact matches only. A bank name that one institution carries -> that institution. Else a
 * holding-company name that one RSSD carries -> that RSSD, and its institution only when it owns
 * exactly one. A name shared by several is ambiguous and stays unmatched.
 */
export function matchParty(index: PartyIndex, name: string | null): PartyMatch {
  const none: PartyMatch = { institutionId: null, fdicCert: null, holdingCompanyRssd: null, method: null, ambiguous: false };
  if (!name) return none;
  const bank = matchInstitution(index.banks, { name, nameWithoutState: true });
  if (bank.institutionId !== null) return { ...none, institutionId: bank.institutionId, fdicCert: index.certById.get(bank.institutionId) ?? null, method: "exact_bank_name" };
  const rssds = index.holdingCompanies.get(companyNameKey(name));
  if (!rssds || rssds.size === 0) return { ...none, ambiguous: bank.ambiguous };
  if (rssds.size > 1) return { ...none, ambiguous: true };
  const rssd = [...rssds][0];
  const owned = index.institutionsByHolding.get(rssd) ?? [];
  if (owned.length === 1) return { institutionId: owned[0], fdicCert: index.certById.get(owned[0]) ?? null, holdingCompanyRssd: rssd, method: "holding_company_single_bank", ambiguous: false };
  return { ...none, holdingCompanyRssd: rssd, method: "holding_company" };
}

export function decisionRow(d: MergerDecision, index: PartyIndex) {
  const applicant = matchParty(index, d.applicant);
  const target = matchParty(index, d.target);
  return {
    event_key: d.eventKey,
    institution_id: applicant.institutionId,
    institution_name: d.applicant,
    change_code: d.kind,
    change_description: d.title,
    effective_date: d.decisionDate,
    acquirer_cert: applicant.fdicCert,
    acquirer_name: d.applicant,
    outgoing_cert: target.fdicCert,
    outgoing_name: d.target,
    source_url: d.documentUrl ?? d.pageUrl,
    raw_json: {
      agency: d.agency,
      decision_kind: d.kind,
      document_url: d.documentUrl,
      page_url: d.pageUrl,
      pdf_status: d.pdfStatus,
      parties_sentence: d.partiesSentence,
      applicant_match: applicant.method,
      applicant_ambiguous: applicant.ambiguous,
      applicant_holding_company_rssd: applicant.holdingCompanyRssd,
      target_institution_id: target.institutionId,
      target_match: target.method,
      target_ambiguous: target.ambiguous,
      target_holding_company_rssd: target.holdingCompanyRssd,
      competitive: d.competitive,
      ...d.raw,
    },
  };
}

async function loadPartyIndex(db: RegistryDb): Promise<PartyIndex> {
  const rows = await db<IndexRow[]>`
    SELECT id, source, cert_number, rssd_id, institution_name, state_code, holding_company_rssd, holding_company_name
      FROM institution_sources
  `;
  return buildPartyIndex([...rows]);
}

async function loadKnown(db: RegistryDb, eventSource: string): Promise<Set<string>> {
  const rows = await db<Array<{ event_key: string }>>`
    SELECT event_key FROM institution_structure_events
     WHERE source = ${eventSource} AND raw_json->>'pdf_status' = 'read'
  `;
  return new Set([...rows].map((r) => r.event_key));
}

async function writeDecisions(db: RegistryDb, eventSource: string, rows: ReturnType<typeof decisionRow>[], runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(rows.slice(at, at + WRITE_CHUNK));
    const out = await db`
      INSERT INTO institution_structure_events (
        source, event_key, institution_id, institution_name, change_code, change_description, effective_date,
        acquirer_cert, acquirer_name, outgoing_cert, outgoing_name, raw_json, source_url, agent_run_id, fetched_at)
      SELECT ${eventSource}, r.event_key, r.institution_id, r.institution_name, r.change_code, r.change_description,
             r.effective_date, r.acquirer_cert, r.acquirer_name, r.outgoing_cert, r.outgoing_name,
             COALESCE(r.raw_json, '{}'::jsonb), r.source_url, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          event_key text, institution_id bigint, institution_name text, change_code text, change_description text,
          effective_date date, acquirer_cert text, acquirer_name text, outgoing_cert text, outgoing_name text,
          raw_json jsonb, source_url text)
      ON CONFLICT (source, event_key) DO UPDATE SET
        institution_id = EXCLUDED.institution_id,
        institution_name = EXCLUDED.institution_name,
        change_code = EXCLUDED.change_code,
        change_description = EXCLUDED.change_description,
        effective_date = EXCLUDED.effective_date,
        acquirer_cert = EXCLUDED.acquirer_cert,
        acquirer_name = EXCLUDED.acquirer_name,
        outgoing_cert = EXCLUDED.outgoing_cert,
        outgoing_name = EXCLUDED.outgoing_name,
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

export async function runRegistryBankMergerOrders(options: RegistryBankMergerOrdersOptions): Promise<RegistryBankMergerOrdersResult> {
  const db = options.db ?? sql;
  const now = options.now ?? new Date();
  const dryRun = Boolean(options.dryRun);
  const [family, arg] = options.partitionKey.split(":");
  let eventSource: string;
  let fetched: FetchedDecisions;
  let refreshHours: number;
  if (family === "fed") {
    const year = Number(arg);
    if (!Number.isInteger(year) || year < 1990 || year > now.getUTCFullYear()) throw new Error(`Invalid bank-merger-orders partition: ${options.partitionKey}`);
    eventSource = FED_ORDERS_EVENT_SOURCE;
    const known = await loadKnown(db, eventSource);
    fetched = await fetchFedOrders(year, { ...options.fetchOptions, known, maxDocuments: options.maxDocuments });
    refreshHours = year >= now.getUTCFullYear() ? HOURS.day : HOURS.month;
  } else if (options.partitionKey === "occ:current") {
    eventSource = OCC_DECISIONS_EVENT_SOURCE;
    const known = await loadKnown(db, eventSource);
    fetched = await fetchOccMergerDecisions({ ...options.fetchOptions, known, maxDocuments: options.maxDocuments });
    refreshHours = HOURS.week;
  } else {
    throw new Error(`Unknown bank-merger-orders partition: ${options.partitionKey}`);
  }
  if (fetched.deferred > 0) refreshHours = 1;

  const checks = fetched.decisions.length > 0 ? checkMergerDecisions(fetched.decisions, now) : null;
  const detailBase = {
    parser_version: BANK_MERGER_ORDERS_PARSER_VERSION,
    event_source: eventSource,
    missing_fields: fetched.missingFields,
    unexpected_fields: fetched.unexpectedFields.slice(0, 40),
    deferred: fetched.deferred,
    checks,
    ...fetched.extra,
  };
  const base: RegistryBankMergerOrdersResult = {
    source: BANK_MERGER_ORDERS_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.sourceUrl,
    rows: 0,
    writtenRows: 0,
    matchedRows: 0,
    withCompetitiveFigures: checks?.withCompetitiveFigures ?? 0,
    deferred: fetched.deferred,
    missingFields: fetched.missingFields,
    unexpectedFields: fetched.unexpectedFields,
    checks,
    dryRun,
    empty: false,
    emptyReason: null,
    skipped: false,
    summary: "",
    detail: detailBase,
  };

  if (fetched.decisions.length === 0) {
    const reason = fetched.reason ?? "no decisions read";
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: BANK_MERGER_ORDERS_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: fetched.sourceUrl,
        runId: options.runId ?? null,
        nextAttemptAfterHours: refreshHours,
        detail: { ...detailBase, reason },
      });
    }
    return { ...base, empty: true, emptyReason: reason, summary: `No new ${eventSource} decisions for ${options.partitionKey}: ${reason}.`, detail: { ...detailBase, reason } };
  }

  const index = await loadPartyIndex(db);
  const rows = fetched.decisions.map((d) => decisionRow(d, index));
  const matched = rows.filter((r) => r.institution_id !== null).length;
  const detail = {
    ...detailBase,
    rows: rows.length,
    applicant_matched: matched,
    target_matched: rows.filter((r) => r.raw_json.target_institution_id !== null).length,
    holding_company_matched: rows.filter((r) => r.raw_json.applicant_holding_company_rssd !== null).length,
  };
  if (dryRun) {
    return { ...base, rows: rows.length, matchedRows: matched, summary: `Read ${rows.length} ${eventSource} decisions for ${options.partitionKey} (dry run).`, detail };
  }
  const written = await writeDecisions(db, eventSource, rows, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: BANK_MERGER_ORDERS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: matched,
    unmatchedCount: rows.length - matched,
    insertedCount: written,
    sourceUrl: fetched.sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: refreshHours,
    detail: { ...detail, written_rows: written },
  });
  return {
    ...base,
    rows: rows.length,
    writtenRows: written,
    matchedRows: matched,
    summary: `Magellan stored ${written} ${eventSource} decisions for ${options.partitionKey}: ${matched} matched to an institution, ${base.withCompetitiveFigures} with stated HHI or deposit-share figures${fetched.deferred > 0 ? `; ${fetched.deferred} left for the next run` : ""}.`,
    detail: { ...detail, written_rows: written },
  };
}
