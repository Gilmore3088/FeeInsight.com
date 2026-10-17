import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { checkSecMarketFacts, fetchSecMarketFacts, type SecMarketChecks, type SecMarketFact } from "@/lib/regulatory/sec-market-value";
import { loadAcceptedLinks } from "./identity";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";
import { cikBatch, SEC_FILING_BATCHES } from "./sec";

/**
 * Magellan registry step `sec-market-value`: public float and shares outstanding for the bank
 * holding companies the SEC link step has already matched (institution_identity_links, link_type
 * 'sec_cik', status 'accepted'), one CIK batch per partition (batch-0..batch-7, the same split as
 * sec-filings). Writes sec_market_value_facts (migration-fragments/sec-market-value.sql).
 *
 * Why not sec_fee_income_facts: its reader (getFeeIncomeFactMedians) treats every concept in the
 * table as a fee-income line and keys rows by SEC's calendar frame, which many cover-page dei
 * facts do not carry; a market-value row there would show up as a fee line or need an invented
 * frame. area_statistics is for areas, not filers.
 *
 * SEC fair access: the shared client sends the pipeline's User-Agent with a contact address; two
 * requests in flight with a 250 ms pause after each stays under 10 requests a second.
 */

export const SEC_MARKET_VALUE_SOURCE = "sec-market-value";
export const SEC_MARKET_VALUE_PARSER_VERSION = 1;
const SEC_CONCURRENCY = 2;
const SEC_PAUSE_MS = 250;
const REFRESH_HOURS = 24 * 7;
const WRITE_CHUNK = 1_000;

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function secMarketValuePartitions(now: Date): string[] {
  void now;
  return Array.from({ length: SEC_FILING_BATCHES }, (_, i) => `batch-${i}`);
}

export interface RegistrySecMarketValueOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  pauseMs?: number;
}

export interface RegistrySecMarketValueResult {
  source: string;
  partitionKey: string;
  ciks: number;
  rows: number;
  writtenRows: number;
  fetchErrors: number;
  notFound: number;
  missingFields: Record<string, number>;
  checks: SecMarketChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  skipped: boolean;
  detail: Record<string, unknown>;
}

export function factRow(cik: string, institutionId: number, sourceUrl: string, f: SecMarketFact) {
  return {
    cik,
    institution_id: institutionId,
    concept: `dei:${f.concept}`,
    label: f.label,
    description: f.description,
    unit: f.unit,
    period_end: f.periodEnd,
    value: f.value,
    fiscal_year: f.fiscalYear,
    fiscal_period: f.fiscalPeriod,
    frame: f.frame,
    accession_no: f.accession,
    form: f.form,
    filed: f.filed,
    source_url: sourceUrl,
  };
}

async function writeFacts(db: RegistryDb, rows: ReturnType<typeof factRow>[], runId: number | null): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(rows.slice(at, at + WRITE_CHUNK));
    const out = await db`
      INSERT INTO sec_market_value_facts (
        cik, institution_id, concept, label, description, unit, period_end, value, fiscal_year, fiscal_period, frame,
        accession_no, form, filed, source_url, agent_run_id, fetched_at)
      SELECT r.cik, r.institution_id, r.concept, r.label, r.description, r.unit, r.period_end, r.value, r.fiscal_year,
             r.fiscal_period, r.frame, r.accession_no, r.form, r.filed, r.source_url, ${runId}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          cik text, institution_id bigint, concept text, label text, description text, unit text, period_end date,
          value numeric, fiscal_year int, fiscal_period text, frame text, accession_no text, form text, filed date,
          source_url text)
      ON CONFLICT (cik, concept, period_end) DO UPDATE SET
        institution_id = EXCLUDED.institution_id, label = EXCLUDED.label, description = EXCLUDED.description,
        unit = EXCLUDED.unit, value = EXCLUDED.value, fiscal_year = EXCLUDED.fiscal_year,
        fiscal_period = EXCLUDED.fiscal_period, frame = EXCLUDED.frame, accession_no = EXCLUDED.accession_no,
        form = EXCLUDED.form, filed = EXCLUDED.filed, source_url = EXCLUDED.source_url,
        agent_run_id = EXCLUDED.agent_run_id, fetched_at = NOW()
      RETURNING 1
    `;
    written += [...(out as unknown as unknown[])].length;
  }
  return written;
}

export async function runRegistrySecMarketValue(options: RegistrySecMarketValueOptions): Promise<RegistrySecMarketValueResult> {
  const db = options.db ?? sql;
  const m = /^batch-(\d+)$/.exec(options.partitionKey);
  if (!m || Number(m[1]) >= SEC_FILING_BATCHES) throw new Error(`Invalid sec-market-value partition: ${options.partitionKey}`);
  const batch = Number(m[1]);
  const dryRun = Boolean(options.dryRun);
  const pauseMs = options.pauseMs ?? SEC_PAUSE_MS;

  const accepted = await loadAcceptedLinks(db, "sec_cik");
  const ciks = [...accepted.entries()].filter(([cik]) => cikBatch(cik) === batch);
  const rows: ReturnType<typeof factRow>[] = [];
  const perCik: Array<{ cik: string; facts: SecMarketFact[] }> = [];
  const missingFields: Record<string, number> = {};
  const labelMismatches = new Set<string>();
  const unexpectedUnits = new Set<string>();
  let fetchErrors = 0;
  let notFound = 0;
  let repeatedDates = 0;
  await mapWithConcurrency(ciks, SEC_CONCURRENCY, async ([cik, institutionId]) => {
    try {
      const got = await fetchSecMarketFacts(cik, options.fetchOptions);
      if (!got) notFound += 1;
      else {
        perCik.push({ cik, facts: got.read.facts });
        for (const f of got.read.facts) rows.push(factRow(cik, institutionId, got.url, f));
        for (const field of got.read.missingFields) missingFields[field] = (missingFields[field] ?? 0) + 1;
        for (const l of got.read.labelMismatches) labelMismatches.add(l);
        for (const u of got.read.unexpectedUnits) unexpectedUnits.add(u);
        repeatedDates += got.read.repeatedDates;
      }
    } catch {
      fetchErrors += 1;
    }
    await pause(pauseMs);
  });

  const checks = perCik.length > 0 ? checkSecMarketFacts(perCik) : null;
  const detail = {
    parser_version: SEC_MARKET_VALUE_PARSER_VERSION,
    ciks: ciks.length,
    filers_read: perCik.length,
    not_found: notFound,
    fetch_errors: fetchErrors,
    missing_fields: missingFields,
    label_mismatches: [...labelMismatches].slice(0, 10),
    unexpected_units: [...unexpectedUnits].slice(0, 10),
    repeated_dates: repeatedDates,
    checks,
  };
  const result: RegistrySecMarketValueResult = {
    source: SEC_MARKET_VALUE_SOURCE,
    partitionKey: options.partitionKey,
    ciks: ciks.length,
    rows: rows.length,
    writtenRows: 0,
    fetchErrors,
    notFound,
    missingFields,
    checks,
    dryRun,
    empty: rows.length === 0,
    emptyReason: null,
    skipped: false,
    detail,
  };
  if (rows.length === 0) {
    result.emptyReason =
      ciks.length === 0
        ? "no accepted SEC CIK links in this batch (run sec-links first)"
        : fetchErrors === ciks.length
          ? "every company-facts request failed"
          : "no public float or shares outstanding tagged by the filers in this batch";
  }
  if (dryRun) return result;
  if (rows.length === 0) {
    await recordRegistryPartition(db, {
      source: SEC_MARKET_VALUE_SOURCE,
      partitionKey: options.partitionKey,
      status: "empty",
      rowCount: 0,
      sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/",
      runId: options.runId ?? null,
      nextAttemptAfterHours: fetchErrors > 0 ? 24 : REFRESH_HOURS,
      detail: { ...detail, reason: result.emptyReason },
    });
    return result;
  }
  result.writtenRows = await writeFacts(db, rows, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: SEC_MARKET_VALUE_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: perCik.length,
    unmatchedCount: notFound + fetchErrors,
    insertedCount: result.writtenRows,
    sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/",
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
    detail: { ...detail, written_rows: result.writtenRows },
  });
  return result;
}
