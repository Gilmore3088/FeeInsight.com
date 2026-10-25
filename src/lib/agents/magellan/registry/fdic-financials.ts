import { sql } from "@/lib/data-store/connection";
import {
  fetchFdicFinancialsForQuarter,
  parseFdicFinancial,
  type FdicFinancialRow,
} from "@/lib/regulatory/fdic";
import { FFIEC_FILING_CERT_KEY } from "@/lib/regulatory/ffiec-call-items";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { latestPublishableQuarter, parseQuarterKey, compareQuarters, previousQuarter, quarterEndDate } from "@/lib/regulatory/quarters";
import { chunk, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: one FDIC call-report quarter into
 * institution_financial_records (source = 'fdic'). Rows join to
 * institution_sources by FDIC certificate; unmatched certificates are kept under
 * source_cert_number so a later universe sync can attach them.
 *
 * v2 (#2625): today's certificate is not always the one that filed a past quarter. When a bank
 * merges into a different, smaller charter, the surviving certificate's past quarters are the small
 * charter's own, while the bank's history (the one the FFIEC series carries by RSSD) was filed
 * under the predecessor's certificate. The FFIEC POR file says which certificate filed as each RSSD
 * that quarter; the FFIEC loader stores it as item `filing_fdic_cert`. Where it is stored for this
 * quarter (`assignFdicRows`):
 * - a BankFind row whose certificate matches no institution, but which POR names as the certificate
 *   an institution's RSSD filed under, is attached to that institution (`raw_json.attached_via =
 *   'ffiec_por_cert'`, `filing_cert`, `current_cert`), and its unmatched copy is removed;
 * - a BankFind row whose certificate matches an institution whose report that quarter POR says was
 *   filed under another certificate is that other charter's own filing: it is kept unmatched
 *   (`raw_json.detached_via = 'ffiec_por_cert'`), and the institution's stale row under it is
 *   removed unless the POR-named row replaces it in the same load.
 * The POR-named filer wins because POR says which certificate filed as that RSSD. A POR
 * certificate that another institution holds today, or that two institutions share, is ignored
 * (`porCertConflicts`): that is our RSSD link disagreeing with POR, not a merger. Where no POR
 * certificate is stored for the quarter (before 2023 Q1, or the FFIEC quarter not loaded yet) or for
 * the institution, rows attach by today's certificate, as before. The FFIEC loader makes this
 * quarter due again when its POR shows a bank filing under a certificate that is not today's
 * (`markFdicQuarterForPorCerts`), so the order the two loaders run in does not matter.
 *
 * The version is recorded on each partition but is deliberately not in REGISTRY_PARSER_VERSIONS:
 * that would reload every quarter back to 2010, and only quarters with POR certificates (2023 Q1
 * on) can change; those are made due by the FFIEC loader instead.
 */

export const FDIC_FINANCIALS_SOURCE = "fdic-financials";
export const FDIC_FINANCIALS_PARSER_VERSION = 2;
export const FDIC_FILING_LAG_DAYS = 30;
const UPSERT_CHUNK = 500;
/** Recent quarters get amended; refresh them weekly. Older quarters rarely change. */
const RECENT_REFRESH_HOURS = 24 * 7;
const HISTORICAL_REFRESH_HOURS = 24 * 180;
const EMPTY_RETRY_HOURS = 24;

export interface RegistryFdicFinancialsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
}

export interface RegistryFdicFinancialsResult {
  source: string;
  partitionKey: string;
  reportDate: string;
  sourceUrl: string;
  fetchedRows: number;
  parsedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  upsertedRows: number;
  /** Certificates attached to an institution because POR names them as its filing certificate. */
  porAttachedRows: number;
  /** Certificates matching an institution by today's certificate but filed as another charter. */
  porDetachedRows: number;
  /** Banks whose POR filing certificate for this quarter is not today's (0 with no POR stored). */
  porCertSplits: number;
  dryRun: boolean;
  empty: boolean;
}

/** A certificate as a lookup key: digits without leading zeros. */
export function certKey(cert: string | number | null | undefined): string | null {
  if (cert === null || cert === undefined) return null;
  const text = String(cert).trim();
  if (!/^\d+$/.test(text)) return null;
  return String(Number(text));
}

/** One stored POR filing certificate: institution, the certificate it filed under, today's certificate. */
export interface PorCertRow {
  institution_id: number | string;
  filing_cert: string | number | null;
  current_cert: string | null;
}

export interface FdicRowAssignment {
  institutionId: number | null;
  via: "cert" | "ffiec_por_cert" | null;
  /** The institution today's certificate matches, when POR says it filed under another one. */
  detachedFrom: number | null;
  /** POR's filing certificate for the institution involved, when one is stored. */
  filingCert: string | null;
  /** Today's certificate of the institution a POR-attached row goes to. */
  currentCert: string | null;
}

/** Banks whose POR filing certificate is not today's certificate. */
export function porCertSplits(por: readonly PorCertRow[]): number {
  return por.filter((row) => certKey(row.filing_cert) !== null && certKey(row.filing_cert) !== certKey(row.current_cert)).length;
}

/**
 * POR filing certificates that name a certificate another institution holds today, or that two
 * institutions share: our RSSD-to-certificate link disagrees with POR there, which is not a merger,
 * so those institutions keep attaching by today's certificate.
 */
export function porCertConflicts(byCert: ReadonlyMap<string, number>, por: readonly PorCertRow[]): Set<number> {
  const conflicts = new Set<number>();
  const filers = new Map<string, number[]>();
  for (const row of por) {
    const id = Number(row.institution_id);
    const filing = certKey(row.filing_cert);
    if (!Number.isSafeInteger(id) || filing === null) continue;
    const holder = byCert.get(filing);
    if (holder !== undefined && holder !== id) conflicts.add(id);
    filers.set(filing, [...(filers.get(filing) ?? []), id]);
  }
  for (const ids of filers.values()) if (new Set(ids).size > 1) for (const id of ids) conflicts.add(id);
  return conflicts;
}

/**
 * Which institution each BankFind certificate's row belongs to this quarter (#2625). `byCert` is
 * today's certificate to institution, covering both the quarter's certificates and the POR filing
 * certificates; `por` is the stored POR filing certificate per institution for the same quarter
 * (empty when none is stored, which keeps today's behaviour). A POR certificate in conflict
 * (`porCertConflicts`) is ignored.
 */
export function assignFdicRows(
  certs: readonly string[],
  byCert: ReadonlyMap<string, number>,
  por: readonly PorCertRow[],
): Map<string, FdicRowAssignment> {
  const conflicts = porCertConflicts(byCert, por);
  const filingCertOf = new Map<number, string>();
  const currentCertOf = new Map<number, string | null>();
  const filerOf = new Map<string, number>();
  for (const row of por) {
    const id = Number(row.institution_id);
    const filing = certKey(row.filing_cert);
    if (!Number.isSafeInteger(id) || filing === null || conflicts.has(id)) continue;
    filingCertOf.set(id, filing);
    currentCertOf.set(id, certKey(row.current_cert));
    filerOf.set(filing, id);
  }
  const out = new Map<string, FdicRowAssignment>();
  for (const cert of certs) {
    const k = certKey(cert);
    const own = k === null ? undefined : byCert.get(k);
    if (own !== undefined) {
      const filing = filingCertOf.get(own);
      out.set(
        cert,
        filing === undefined || filing === k
          ? { institutionId: own, via: "cert", detachedFrom: null, filingCert: filing ?? null, currentCert: k }
          : { institutionId: null, via: null, detachedFrom: own, filingCert: filing, currentCert: k },
      );
      continue;
    }
    const filer = k === null ? undefined : filerOf.get(k);
    out.set(
      cert,
      filer !== undefined
        ? { institutionId: filer, via: "ffiec_por_cert", detachedFrom: null, filingCert: k, currentCert: currentCertOf.get(filer) ?? null }
        : { institutionId: null, via: null, detachedFrom: null, filingCert: null, currentCert: null },
    );
  }
  return out;
}

/** Shape written to jsonb_to_recordset; keys must match the column list below. */
function toRecord(
  row: FdicFinancialRow,
  sourceUrl: string,
  runId: number | null,
  assignment: FdicRowAssignment,
  replacedByPor: ReadonlySet<number>,
) {
  let rawJson: Record<string, unknown> = row.raw_json;
  if (assignment.via === "ffiec_por_cert") {
    rawJson = { ...row.raw_json, attached_via: "ffiec_por_cert", filing_cert: assignment.filingCert, current_cert: assignment.currentCert };
  } else if (assignment.detachedFrom !== null) {
    rawJson = { ...row.raw_json, detached_via: "ffiec_por_cert", cert_matches_institution: assignment.detachedFrom, institution_filing_cert: assignment.filingCert };
  }
  return {
    ...row,
    raw_json: rawJson,
    institution_id: assignment.institutionId,
    attached_via: assignment.via,
    // The institution's stale row under this certificate is removed only when no POR-named row
    // replaces it in this load (the replacing upsert overwrites it instead).
    remove_stale_for: assignment.detachedFrom !== null && !replacedByPor.has(assignment.detachedFrom) ? assignment.detachedFrom : null,
    source_url: sourceUrl,
    agent_run_id: runId,
  };
}

async function readCertInstitutions(db: RegistryDb, certs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (certs.length === 0) return out;
  const rows = await db<{ institution_id: number; cert_number: string }[]>`
    SELECT id::int AS institution_id, cert_number
      FROM institution_sources
     WHERE source = 'fdic' AND cert_number IN ${db(certs)}
  `;
  for (const row of rows) {
    const k = certKey(row.cert_number);
    if (k !== null && !out.has(k)) out.set(k, Number(row.institution_id));
  }
  return out;
}

/** The POR filing certificates stored for one quarter end, with each institution's certificate today. */
export async function readPorCerts(db: RegistryDb, reportDate: string): Promise<PorCertRow[]> {
  const rows = await db<PorCertRow[]>`
    SELECT i.institution_id::int AS institution_id, (i.value::bigint)::text AS filing_cert, s.cert_number AS current_cert
      FROM institution_call_report_items i
      LEFT JOIN institution_sources s ON s.source = 'fdic' AND s.id = i.institution_id
     WHERE i.source = 'ffiec' AND i.item_key = ${FFIEC_FILING_CERT_KEY} AND i.report_date = ${reportDate}::date
  `;
  return [...rows];
}

/**
 * Called by the FFIEC loader after it stores a quarter's POR certificates: when a bank filed that
 * quarter under a certificate that is not today's, make the FDIC partition for the quarter due now,
 * unless it was already loaded with the same number of such banks.
 */
export async function markFdicQuarterForPorCerts(
  db: RegistryDb,
  partitionKey: string,
  reportDate: string,
): Promise<{ splits: number; marked: boolean }> {
  const splits = porCertSplits(await readPorCerts(db, reportDate));
  if (splits === 0) return { splits, marked: false };
  const rows = await db`
    UPDATE registry_ingest_partitions
       SET next_attempt_after = NOW(), updated_at = NOW()
     WHERE source = ${FDIC_FINANCIALS_SOURCE} AND partition_key = ${partitionKey}
       AND status = 'succeeded' AND next_attempt_after > NOW()
       AND COALESCE((detail->'por'->>'cert_splits')::int, -1) <> ${splits}
    RETURNING 1
  `;
  return { splits, marked: [...(rows as unknown as unknown[])].length > 0 };
}

async function upsertChunk(db: RegistryDb, records: ReturnType<typeof toRecord>[]): Promise<number> {
  const payload = JSON.stringify(records);
  const matched = await db`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        institution_id bigint, attached_via text, remove_stale_for bigint,
        cert text, report_date text, total_assets bigint, total_deposits bigint, total_loans bigint,
        total_equity bigint, total_securities bigint, net_income bigint, net_interest_income bigint,
        other_noninterest_income bigint, noninterest_expense bigint, provision_for_losses bigint,
        service_charge_income bigint, net_charge_offs bigint, noncurrent_loans bigint,
        loans_real_estate bigint, loans_commercial bigint, loans_consumer bigint, loans_credit_card bigint,
        loans_auto bigint, loans_agricultural bigint, core_deposits bigint, brokered_deposits bigint,
        uninsured_deposits bigint, total_revenue bigint, fee_income_ratio double precision,
        roa double precision, roe double precision, net_interest_margin double precision,
        efficiency_ratio double precision, net_charge_off_rate double precision,
        noncurrent_loan_rate double precision, leverage_ratio double precision,
        tier1_capital_ratio double precision, total_capital_ratio double precision,
        employee_count integer, branch_count integer, raw_json jsonb, source_url text, agent_run_id bigint
      )
    ), matched AS (
      INSERT INTO institution_financial_records AS f (
        institution_id, source_cert_number, report_date, source,
        total_assets, total_deposits, total_loans, total_equity, total_securities,
        net_income, net_interest_income, other_noninterest_income, noninterest_expense,
        provision_for_losses, service_charge_income, net_charge_offs, noncurrent_loans,
        loans_real_estate, loans_commercial, loans_consumer, loans_credit_card, loans_auto,
        loans_agricultural, core_deposits, brokered_deposits, uninsured_deposits,
        total_revenue, fee_income_ratio, roa, roe, net_interest_margin, efficiency_ratio,
        net_charge_off_rate, noncurrent_loan_rate, leverage_ratio, tier1_capital_ratio,
        total_capital_ratio, employee_count, branch_count, raw_json, source_url, agent_run_id, fetched_at
      )
      SELECT institution_id, cert, report_date, 'fdic',
        total_assets, total_deposits, total_loans, total_equity, total_securities,
        net_income, net_interest_income, other_noninterest_income, noninterest_expense,
        provision_for_losses, service_charge_income, net_charge_offs, noncurrent_loans,
        loans_real_estate, loans_commercial, loans_consumer, loans_credit_card, loans_auto,
        loans_agricultural, core_deposits, brokered_deposits, uninsured_deposits,
        total_revenue, fee_income_ratio, roa, roe, net_interest_margin, efficiency_ratio,
        net_charge_off_rate, noncurrent_loan_rate, leverage_ratio, tier1_capital_ratio,
        total_capital_ratio, employee_count, branch_count, raw_json, source_url, agent_run_id, NOW()
        FROM r
       WHERE institution_id IS NOT NULL
      ON CONFLICT (institution_id, report_date, source) DO UPDATE SET
        source_cert_number = EXCLUDED.source_cert_number,
        total_assets = EXCLUDED.total_assets,
        total_deposits = EXCLUDED.total_deposits,
        total_loans = EXCLUDED.total_loans,
        total_equity = EXCLUDED.total_equity,
        total_securities = EXCLUDED.total_securities,
        net_income = EXCLUDED.net_income,
        net_interest_income = EXCLUDED.net_interest_income,
        other_noninterest_income = EXCLUDED.other_noninterest_income,
        noninterest_expense = EXCLUDED.noninterest_expense,
        provision_for_losses = EXCLUDED.provision_for_losses,
        service_charge_income = EXCLUDED.service_charge_income,
        net_charge_offs = EXCLUDED.net_charge_offs,
        noncurrent_loans = EXCLUDED.noncurrent_loans,
        loans_real_estate = EXCLUDED.loans_real_estate,
        loans_commercial = EXCLUDED.loans_commercial,
        loans_consumer = EXCLUDED.loans_consumer,
        loans_credit_card = EXCLUDED.loans_credit_card,
        loans_auto = EXCLUDED.loans_auto,
        loans_agricultural = EXCLUDED.loans_agricultural,
        core_deposits = EXCLUDED.core_deposits,
        brokered_deposits = EXCLUDED.brokered_deposits,
        uninsured_deposits = EXCLUDED.uninsured_deposits,
        total_revenue = EXCLUDED.total_revenue,
        fee_income_ratio = EXCLUDED.fee_income_ratio,
        roa = EXCLUDED.roa,
        roe = EXCLUDED.roe,
        net_interest_margin = EXCLUDED.net_interest_margin,
        efficiency_ratio = EXCLUDED.efficiency_ratio,
        net_charge_off_rate = EXCLUDED.net_charge_off_rate,
        noncurrent_loan_rate = EXCLUDED.noncurrent_loan_rate,
        leverage_ratio = EXCLUDED.leverage_ratio,
        tier1_capital_ratio = EXCLUDED.tier1_capital_ratio,
        total_capital_ratio = EXCLUDED.total_capital_ratio,
        employee_count = EXCLUDED.employee_count,
        branch_count = EXCLUDED.branch_count,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    ), unmatched AS (
      INSERT INTO institution_financial_records AS f (
        institution_id, source_cert_number, report_date, source,
        total_assets, total_deposits, total_loans, total_equity, net_income,
        service_charge_income, roa, raw_json, source_url, agent_run_id, fetched_at
      )
      SELECT NULL, cert, report_date, 'fdic',
        total_assets, total_deposits, total_loans, total_equity, net_income,
        service_charge_income, roa, raw_json, source_url, agent_run_id, NOW()
        FROM r
       WHERE institution_id IS NULL
      ON CONFLICT (source_cert_number, report_date, source) WHERE institution_id IS NULL DO UPDATE SET
        total_assets = EXCLUDED.total_assets,
        total_deposits = EXCLUDED.total_deposits,
        total_loans = EXCLUDED.total_loans,
        total_equity = EXCLUDED.total_equity,
        net_income = EXCLUDED.net_income,
        service_charge_income = EXCLUDED.service_charge_income,
        roa = EXCLUDED.roa,
        raw_json = EXCLUDED.raw_json,
        source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id,
        fetched_at = NOW()
      RETURNING 1
    ), stale_detached AS (
      -- An institution's row under today's certificate for a quarter POR says it filed under
      -- another certificate: the other charter's filing, now kept unmatched above (#2625).
      DELETE FROM institution_financial_records f
       USING r
       WHERE r.remove_stale_for IS NOT NULL AND f.institution_id = r.remove_stale_for
         AND f.report_date = r.report_date AND f.source = 'fdic' AND f.source_cert_number = r.cert
      RETURNING 1
    ), claimed AS (
      -- The unmatched copy of a certificate now attached through POR.
      DELETE FROM institution_financial_records f
       USING r
       WHERE r.attached_via = 'ffiec_por_cert' AND f.institution_id IS NULL
         AND f.source_cert_number = r.cert AND f.report_date = r.report_date AND f.source = 'fdic'
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM matched)::int AS matched, (SELECT COUNT(*) FROM unmatched)::int AS unmatched,
           (SELECT COUNT(*) FROM stale_detached)::int AS stale_detached, (SELECT COUNT(*) FROM claimed)::int AS claimed
  `;
  const row = (matched as unknown as Array<{ matched: number; unmatched: number }>)[0];
  return Number(row?.matched ?? 0) + Number(row?.unmatched ?? 0);
}

/** Refresh cadence after a successful pull: weekly for the two newest quarters. */
export function fdicRefreshHours(partitionKey: string, now: Date): number {
  const q = parseQuarterKey(partitionKey);
  if (!q) return HISTORICAL_REFRESH_HOURS;
  const latest = latestPublishableQuarter(now, FDIC_FILING_LAG_DAYS);
  return compareQuarters(q, previousQuarter(latest)) >= 0 ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
}

export async function runRegistryFdicFinancials(
  options: RegistryFdicFinancialsOptions,
): Promise<RegistryFdicFinancialsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const quarter = parseQuarterKey(options.partitionKey);
  if (!quarter) throw new Error(`Invalid FDIC quarter partition: ${options.partitionKey}`);

  const page = await fetchFdicFinancialsForQuarter(quarter, options.fetchOptions);
  const parsed = page.rows
    .map((record) => parseFdicFinancial(record, quarter))
    .filter((row): row is FdicFinancialRow => row !== null);
  const reportDate = parsed[0]?.report_date ?? "";
  const certs = [...new Set(parsed.map((row) => row.cert))];
  const por = certs.length > 0 ? await readPorCerts(db, reportDate || quarterEndDate(quarter)) : [];
  const porCerts = por.map((row) => certKey(row.filing_cert)).filter((c): c is string => c !== null);
  const byCert = await readCertInstitutions(db, [...new Set([...certs, ...porCerts])]);
  const assignments = assignFdicRows(certs, byCert, por);
  const conflicts = porCertConflicts(byCert, por).size;
  const assigned = [...assignments.values()];
  const matchedRows = assigned.filter((a) => a.institutionId !== null).length;
  const porAttachedRows = assigned.filter((a) => a.via === "ffiec_por_cert").length;
  const porDetachedRows = assigned.filter((a) => a.detachedFrom !== null).length;
  const splits = porCertSplits(por);
  const base: RegistryFdicFinancialsResult = {
    source: FDIC_FINANCIALS_SOURCE,
    partitionKey: options.partitionKey,
    reportDate,
    sourceUrl: page.url,
    fetchedRows: page.rows.length,
    parsedRows: parsed.length,
    matchedRows,
    unmatchedRows: Math.max(0, certs.length - matchedRows),
    upsertedRows: 0,
    porAttachedRows,
    porDetachedRows,
    porCertSplits: splits,
    dryRun,
    empty: parsed.length === 0,
  };
  if (dryRun) return base;

  if (parsed.length === 0) {
    await recordRegistryPartition(db, {
      source: FDIC_FINANCIALS_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: page.url,
      runId: options.runId ?? null,
      nextAttemptAfterHours: EMPTY_RETRY_HOURS,
      detail: { reason: "FDIC has not published this quarter yet", parser_version: FDIC_FINANCIALS_PARSER_VERSION },
    });
    return base;
  }

  const replacedByPor = new Set(assigned.filter((a) => a.via === "ffiec_por_cert").map((a) => a.institutionId as number));
  const unassigned: FdicRowAssignment = { institutionId: null, via: null, detachedFrom: null, filingCert: null, currentCert: null };
  let upserted = 0;
  for (const group of chunk(parsed, UPSERT_CHUNK)) {
    upserted += await upsertChunk(
      db,
      group.map((row) => toRecord(row, page.url, options.runId ?? null, assignments.get(row.cert) ?? unassigned, replacedByPor)),
    );
  }

  await recordRegistryPartition(db, {
    source: FDIC_FINANCIALS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: parsed.length,
    matchedCount: matchedRows,
    unmatchedCount: base.unmatchedRows,
    insertedCount: upserted,
    sourceUrl: page.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: fdicRefreshHours(options.partitionKey, options.now ?? new Date()),
    detail: {
      report_date: reportDate,
      parser_version: FDIC_FINANCIALS_PARSER_VERSION,
      // POR filing certificates stored for this quarter (#2625); banks 0 means rows attached by
      // today's certificate only.
      por: { banks: por.length, cert_splits: splits, attached: porAttachedRows, detached: porDetachedRows, conflicts },
    },
  });

  return { ...base, upsertedRows: upserted };
}
