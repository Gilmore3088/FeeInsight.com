import { sql } from "@/lib/data-store/connection";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  BANK_SIC_CODES,
  fetchSecCompanyFacts,
  fetchSecSubmissions,
  fetchSecTickers,
  SEC_TICKERS_URL,
  type SecSubmissions,
} from "@/lib/regulatory/sec";
import { loadAcceptedLinks, loadIdentityIndex, matchCompany, upsertIdentityLinks, type IdentityLinkInput } from "./identity";
import { chunk, mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry steps for SEC EDGAR.
 *
 * registry-sec-links (partition "current"): match listed filers to bank holding
 * companies by name, confirm each candidate is a bank filer by SIC code, and
 * record the CIK on the institution (and its sibling charters).
 *
 * registry-sec-filings (partitions "batch-0".."batch-7", by CIK): recent 10-K,
 * 10-Q, 8-K and proxy filings into institution_filings, and quarterly XBRL
 * facts into holding_company_financials. Holding-company figures stay in their
 * own table so they never mix with bank-level call reports.
 */

export const SEC_LINKS_SOURCE = "sec-links";
export const SEC_FILINGS_SOURCE = "sec-filings";
export const SEC_LINKS_PARTITION = "current";
/** v2: re-match with the holding-company, short-name and exact-bank-name rules added after the first load (Oct 4 2026). */
export const SEC_LINKS_PARSER_VERSION = 2;
export const SEC_FILING_BATCHES = 8;
/** Two requests in flight with a pause each keeps us under SEC's 10 req/s. */
const SEC_CONCURRENCY = 2;
const SEC_PAUSE_MS = 250;
const LINKS_REFRESH_HOURS = 24 * 30;
const FILINGS_REFRESH_HOURS = 24;

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function secBatchPartitions(): string[] {
  return Array.from({ length: SEC_FILING_BATCHES }, (_, i) => `batch-${i}`);
}

export function cikBatch(cik: string): number {
  return Number(cik) % SEC_FILING_BATCHES;
}

interface SecOptions {
  runId?: number | null;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  pauseMs?: number;
}

export interface RegistrySecLinksResult {
  source: string;
  partitionKey: string;
  sourceUrl: string;
  listedFilers: number;
  nameMatches: number;
  bankFilers: number;
  acceptedLinks: number;
  reviewLinks: number;
  institutionsTagged: number;
  dryRun: boolean;
}

export async function runRegistrySecLinks(options: SecOptions = {}): Promise<RegistrySecLinksResult> {
  const db = options.db ?? sql;
  const pauseMs = options.pauseMs ?? SEC_PAUSE_MS;
  const tickers = await fetchSecTickers(options.fetchOptions);
  const index = await loadIdentityIndex(db);
  const candidates = tickers
    .map((ticker) => ({ ticker, match: matchCompany(ticker.name, index) }))
    .filter((entry): entry is { ticker: (typeof tickers)[number]; match: NonNullable<ReturnType<typeof matchCompany>> } => entry.match !== null);

  const confirmed = await mapWithConcurrency(candidates, SEC_CONCURRENCY, async (entry) => {
    const submissions = await fetchSecSubmissions(entry.ticker.cik, options.fetchOptions);
    await pause(pauseMs);
    return { ...entry, submissions };
  });
  const banks = confirmed.filter((entry) => entry.submissions.sic && BANK_SIC_CODES.has(entry.submissions.sic));
  const links: IdentityLinkInput[] = banks.map((entry) => ({
    externalKey: entry.ticker.cik,
    externalName: entry.submissions.name || entry.ticker.name,
    match: entry.match,
    detail: { ticker: entry.ticker.ticker, exchange: entry.ticker.exchange, sic: entry.submissions.sic },
  }));

  const result: RegistrySecLinksResult = {
    source: SEC_LINKS_SOURCE,
    partitionKey: SEC_LINKS_PARTITION,
    sourceUrl: SEC_TICKERS_URL,
    listedFilers: tickers.length,
    nameMatches: candidates.length,
    bankFilers: banks.length,
    acceptedLinks: links.filter((l) => l.match.status === "accepted").length,
    reviewLinks: links.filter((l) => l.match.status === "needs_review").length,
    institutionsTagged: 0,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  await upsertIdentityLinks(db, "sec_cik", links, options.runId ?? null);
  const accepted = await loadAcceptedLinks(db, "sec_cik");
  const payload = JSON.stringify([...accepted.entries()].map(([cik, institutionId]) => ({ cik, institution_id: institutionId })));
  const tagged = await db`
    WITH r AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(cik text, institution_id bigint)
    ), targets AS (
      SELECT r.cik, s.id
        FROM r
        JOIN institution_sources anchor ON anchor.id = r.institution_id
        JOIN institution_sources s
          ON s.id = anchor.id
          OR (anchor.holding_company_rssd IS NOT NULL AND s.holding_company_rssd = anchor.holding_company_rssd)
    )
    UPDATE institution_sources s SET sec_cik = t.cik
      FROM targets t
     WHERE s.id = t.id AND s.sec_cik IS DISTINCT FROM t.cik
    RETURNING s.id
  `;
  result.institutionsTagged = [...tagged].length;

  await recordRegistryPartition(db, {
    source: SEC_LINKS_SOURCE,
    partitionKey: SEC_LINKS_PARTITION,
    status: "succeeded",
    rowCount: tickers.length,
    matchedCount: result.acceptedLinks,
    unmatchedCount: result.reviewLinks,
    insertedCount: result.institutionsTagged,
    sourceUrl: SEC_TICKERS_URL,
    runId: options.runId ?? null,
    nextAttemptAfterHours: LINKS_REFRESH_HOURS,
    detail: { name_matches: result.nameMatches, bank_filers: result.bankFilers, parser_version: SEC_LINKS_PARSER_VERSION },
  });
  return result;
}

export interface RegistrySecFilingsResult {
  source: string;
  partitionKey: string;
  ciks: number;
  filings: number;
  factQuarters: number;
  dryRun: boolean;
}

async function writeFilings(db: RegistryDb, submissions: SecSubmissions, institutionId: number, runId: number | null): Promise<number> {
  if (submissions.filings.length === 0) return 0;
  const payload = JSON.stringify(submissions.filings.filter((f) => f.accession_no && f.filed_at));
  const written = await db`
    INSERT INTO institution_filings
      (cik, institution_id, company_name, form, filed_at, period_of_report, accession_no, primary_doc_url,
       description, agent_run_id, fetched_at)
    SELECT ${submissions.cik}, ${institutionId}, ${submissions.name}, r.form, r.filed_at::date,
           NULLIF(r.period_of_report, '')::date, r.accession_no, r.primary_doc_url, r.description, ${runId}, NOW()
      FROM jsonb_to_recordset(${payload}::jsonb) AS r(
        accession_no text, form text, filed_at text, period_of_report text, primary_doc_url text, description text
      )
    ON CONFLICT (accession_no) DO UPDATE SET
      institution_id = EXCLUDED.institution_id,
      company_name = EXCLUDED.company_name,
      primary_doc_url = EXCLUDED.primary_doc_url,
      description = EXCLUDED.description,
      fetched_at = NOW()
    RETURNING 1
  `;
  return [...written].length;
}

export async function runRegistrySecFilings(options: SecOptions & { partitionKey: string }): Promise<RegistrySecFilingsResult> {
  const db = options.db ?? sql;
  const pauseMs = options.pauseMs ?? SEC_PAUSE_MS;
  const match = /^batch-(\d+)$/.exec(options.partitionKey);
  if (!match || Number(match[1]) >= SEC_FILING_BATCHES) throw new Error(`Invalid SEC filings partition: ${options.partitionKey}`);
  const batch = Number(match[1]);

  const accepted = await loadAcceptedLinks(db, "sec_cik");
  const ciks = [...accepted.entries()].filter(([cik]) => cikBatch(cik) === batch);
  const result: RegistrySecFilingsResult = {
    source: SEC_FILINGS_SOURCE,
    partitionKey: options.partitionKey,
    ciks: ciks.length,
    filings: 0,
    factQuarters: 0,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  await mapWithConcurrency(ciks, SEC_CONCURRENCY, async ([cik, institutionId]) => {
    const submissions = await fetchSecSubmissions(cik, options.fetchOptions);
    await pause(pauseMs);
    result.filings += await writeFilings(db, submissions, institutionId, options.runId ?? null);
    const facts = await fetchSecCompanyFacts(cik, options.fetchOptions);
    await pause(pauseMs);
    if (!facts || facts.facts.length === 0) return;
    for (const group of chunk(facts.facts, 200)) {
      const payload = JSON.stringify(group);
      const written = await db`
        INSERT INTO holding_company_financials
          (cik, period_end, fiscal_period, total_assets, total_liabilities, stockholders_equity, net_income,
           eps_diluted, source_url, agent_run_id, fetched_at)
        SELECT ${cik}, r.period_end::date, r.fiscal_period, r.total_assets, r.total_liabilities,
               r.stockholders_equity, r.net_income, r.eps_diluted, ${facts.url}, ${options.runId ?? null}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            period_end text, fiscal_period text, total_assets bigint, total_liabilities bigint,
            stockholders_equity bigint, net_income bigint, eps_diluted double precision
          )
        ON CONFLICT (cik, period_end) DO UPDATE SET
          fiscal_period = EXCLUDED.fiscal_period,
          total_assets = EXCLUDED.total_assets,
          total_liabilities = EXCLUDED.total_liabilities,
          stockholders_equity = EXCLUDED.stockholders_equity,
          net_income = EXCLUDED.net_income,
          eps_diluted = EXCLUDED.eps_diluted,
          source_url = EXCLUDED.source_url,
          agent_run_id = EXCLUDED.agent_run_id,
          fetched_at = NOW()
        RETURNING 1
      `;
      result.factQuarters += [...written].length;
    }
  });

  await recordRegistryPartition(db, {
    source: SEC_FILINGS_SOURCE,
    partitionKey: options.partitionKey,
    status: ciks.length === 0 ? "empty" : "succeeded",
    rowCount: ciks.length,
    insertedCount: result.filings + result.factQuarters,
    sourceUrl: "https://data.sec.gov/submissions/",
    runId: options.runId ?? null,
    nextAttemptAfterHours: FILINGS_REFRESH_HOURS,
    detail: { filings: result.filings, fact_quarters: result.factQuarters },
  });
  return result;
}
