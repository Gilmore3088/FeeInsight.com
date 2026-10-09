import { createHash } from "crypto";

import type { sql } from "@/lib/data-store/connection";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import type { DocumentVault } from "@/lib/agents/document-vault";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { detectFormat, documentTypeForFormat } from "@/lib/agents/learning/format";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { inSavepoint } from "@/lib/agents/savepoint";
import { NOT_CONSUMER_FEE_PAGE_REASON, companionStreamsReady } from "@/lib/agents/companion-streams";

import { accountNameFor, isGenericAccountName, isNonDepositLink } from "./second-document";
import { markCurrentCopy } from "./current-copy";
import { OTHER_BANK_HOST_CODE } from "./other-bank-host";
import { looksLikeBotChallenge } from "./site-signals";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * Companion fetch: downloads the account pages and fee documents the companion finder
 * (`second-document.ts`) stored for a bank, each as its own source document with
 * `companion_source_id` set. Rosetta, Knox, Darwin and Hamilton then treat every page
 * as a separate stream (see `companion-streams.ts`). The bank's main fee link, its
 * fetch state and its profile are never touched here.
 *
 * Runs at the end of each Magellan fetch step with a small time budget. A page is
 * fetched when new, then again after COMPANION_REFETCH_DAYS. Business documents are not
 * fetched: their fees are not the consumer schedule. Two dead-link answers in a row (or
 * five failures of any kind) retire the page.
 */

export const COMPANION_FETCH_STRATEGY = { strategy: "fetch.companion", version: 1 } as const;
export const COMPANION_FETCH_LIMIT = 10;
export const COMPANION_REFETCH_DAYS = 30;
export const COMPANION_FETCH_BUDGET_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const RETRY_AFTER_FAILURE_HOURS = 24;
const MAX_FAILURES = 5;

export interface CompanionRow {
  id: number | string;
  institution_id: number | string;
  url: string;
  document_role: string;
  account_name: string | null;
  fetch_failures: number | string | null;
  last_source_document_id: number | string | null;
  last_hash: string | null;
}

export type CompanionFetchOutcome = "success" | "unchanged" | "failed";

export interface CompanionFetchResult {
  companionId: number;
  institutionId: number;
  url: string;
  accountName: string | null;
  outcome: CompanionFetchOutcome;
  attemptOutcome: AttemptOutcome;
  sourceDocumentId: number | null;
  documentType: string | null;
  bytes: number;
  reason: string | null;
}

export interface CompanionReviewResult {
  checked: number;
  retired: Array<{ companionId: number; institutionId: number; url: string; accountName: string | null }>;
  renamed: Array<{ companionId: number; from: string | null; to: string }>;
  /** Hand-found schedules a link-word rule had retired, put back to be fetched. */
  restored?: Array<{ companionId: number; institutionId: number; url: string }>;
}

export interface RunCompanionFetchResult {
  status: "ran" | "schema_pending";
  review: CompanionReviewResult;
  selected: number;
  fetched: number;
  unchanged: number;
  failed: number;
  results: CompanionFetchResult[];
}

async function selectDue(db: SqlTag, stateCode: string | null, institutionId: number | null, limit: number): Promise<CompanionRow[]> {
  return db<CompanionRow[]>`
    SELECT ias.id, ias.institution_id, ias.url, ias.document_role, ias.account_name, ias.fetch_failures,
           ias.last_source_document_id, latest.content_hash AS last_hash
      FROM institution_additional_sources ias
      JOIN institution_sources inst ON inst.id = ias.institution_id
      LEFT JOIN source_documents latest ON latest.id = ias.last_source_document_id
     WHERE ias.status IN ('found', 'fetched')
       AND ias.document_role <> 'business'
       AND (
         COALESCE(inst.status, 'active') = 'active'
         -- A schedule found by hand is fetched for a bank whose own link went dormant (Stock
         -- Yards, $10B, 2026-10-08): that is why it was found by hand. A closed charter is not.
         OR (inst.status = 'dormant' AND ias.found_by_strategy = 'discover.operator_schedule')
       )
       AND (
         ${stateCode}::text IS NULL
         OR upper(btrim(inst.state_code)) = ${stateCode}
         -- A schedule found by hand is fetched by the next state lane, whatever its state:
         -- waiting for its own state's lane left Comerica, Cadence and three more unfetched
         -- for six hours on 2026-10-08.
         OR (ias.found_by_strategy = 'discover.operator_schedule' AND ias.last_fetched_at IS NULL)
       )
       AND (${institutionId}::bigint IS NULL OR ias.institution_id = ${institutionId}::bigint)
       AND (
         ias.last_fetched_at IS NULL
         OR ias.last_fetched_at < NOW() - CASE
           WHEN ias.fetch_failures > 0 THEN make_interval(hours => ${RETRY_AFTER_FAILURE_HOURS})
           ELSE make_interval(days => ${COMPANION_REFETCH_DAYS})
         END
       )
     -- Schedules found by hand go first, so a state with more due pages than the limit
     -- never leaves one waiting (NY had 12 due on 2026-10-07 and skipped Morgan Stanley).
     ORDER BY (ias.found_by_strategy = 'discover.operator_schedule') DESC,
              ias.last_fetched_at ASC NULLS FIRST, ias.id ASC
     LIMIT ${limit}
  `;
}

export const COMPANION_REVIEW_LIMIT = 500;

interface ReviewRow {
  id: number | string;
  institution_id: number | string;
  url: string;
  account_name: string | null;
  found_by_strategy?: string | null;
}

const NON_DEPOSIT_REASON = `${NOT_CONSUMER_FEE_PAGE_REASON}: loan or other non-deposit document`;

/**
 * Re-applies today's finder rules to the companion pages already stored for a state, so
 * a rule learned later reaches every bank found before it. A page that today's rules
 * call a loan, HELOC or business document is retired with NOT_CONSUMER_FEE_PAGE_REASON
 * (Hamilton then takes down the live fees read from it), and a page named after its
 * link text ("Download", "Features and Fees") is renamed from its URL.
 */
export async function reviewStoredCompanions(
  db: SqlTag,
  options: { stateCode: string | null; institutionId: number | null; limit?: number },
): Promise<CompanionReviewResult> {
  // A schedule a person found is judged by reading it, not by words in its link: Valley's
  // "Schedule of Fees-Privacy Policy" PDF and First United's overdraft "opt-in-form" were
  // retired by the link words "privacy" and "opt in" (2026-10-09). Put them back.
  const restored = await db<Array<{ id: number | string; institution_id: number | string; url: string }>>`
    UPDATE institution_additional_sources ias
       SET status = 'found',
           reason = 'Consumer fee schedule given by hand; restored after a link-word rule retired it',
           updated_at = NOW()
      FROM institution_sources inst
     WHERE inst.id = ias.institution_id
       AND ias.status = 'rejected'
       AND ias.found_by_strategy = 'discover.operator_schedule'
       AND ias.reason = ${NON_DEPOSIT_REASON}
       AND (${options.stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode})
       AND (${options.institutionId}::bigint IS NULL OR ias.institution_id = ${options.institutionId}::bigint)
    RETURNING ias.id, ias.institution_id, ias.url
  `;
  // A page on another institution's own website is that bank's schedule, even when a person
  // gave it: First United of Durant, Oklahoma (118) was given First United Bank & Trust of
  // Oakland, Maryland's mybank.com disclosures (595) and First Bank of St. Louis's first.bank
  // schedule, and every re-read published Maryland's fees under Oklahoma (2026-10-09).
  // Discovery already refuses such links (`other-bank-host.ts`); this retires stored ones.
  const otherBank = await db<Array<{ id: number | string; institution_id: number | string; url: string; account_name: string | null; other_name: string }>>`
    UPDATE institution_additional_sources ias
       SET status = 'rejected',
           reason = ${OTHER_BANK_HOST_CODE} || ': on the website of ' || other.institution_name || COALESCE(' (' || other.state_code || ')', ''),
           updated_at = NOW()
      FROM institution_sources inst, institution_sources other
     WHERE inst.id = ias.institution_id
       AND ias.status IN ('found', 'fetched')
       AND other.id <> inst.id
       AND other.website_url IS NOT NULL
       AND regexp_replace(lower(substring(other.website_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '')
         = regexp_replace(lower(substring(ias.url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '')
       AND regexp_replace(lower(substring(COALESCE(inst.website_url, '') from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '')
         IS DISTINCT FROM regexp_replace(lower(substring(ias.url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '')
       -- Every state, not just this lane's: the query is cheap, and waiting for Oklahoma's lane
       -- left First United's three pages live for hours after the rule shipped (2026-10-09).
       AND (${options.institutionId}::bigint IS NULL OR ias.institution_id = ${options.institutionId}::bigint)
    RETURNING ias.id, ias.institution_id, ias.url, ias.account_name, other.institution_name AS other_name
  `;
  const rows = await db<ReviewRow[]>`
    SELECT ias.id, ias.institution_id, ias.url, ias.account_name, ias.found_by_strategy
      FROM institution_additional_sources ias
      JOIN institution_sources inst ON inst.id = ias.institution_id
     WHERE ias.status IN ('found', 'fetched')
       AND (${options.stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode})
       AND (${options.institutionId}::bigint IS NULL OR ias.institution_id = ${options.institutionId}::bigint)
     ORDER BY ias.id ASC
     LIMIT ${options.limit ?? COMPANION_REVIEW_LIMIT}
  `;
  const result: CompanionReviewResult = {
    checked: rows.length,
    retired: otherBank.map((row) => ({
      companionId: Number(row.id), institutionId: Number(row.institution_id), url: row.url, accountName: row.account_name,
    })),
    renamed: [],
    restored: restored.map((row) => ({ companionId: Number(row.id), institutionId: Number(row.institution_id), url: row.url })),
  };
  for (const row of rows) {
    const companionId = Number(row.id);
    const label = row.account_name ?? "";
    if (row.found_by_strategy !== "discover.operator_schedule" && isNonDepositLink(label, row.url)) {
      await db`
        UPDATE institution_additional_sources
           SET status = 'rejected',
               reason = ${NON_DEPOSIT_REASON},
               updated_at = NOW()
         WHERE id = ${companionId}
      `;
      result.retired.push({ companionId, institutionId: Number(row.institution_id), url: row.url, accountName: row.account_name });
      continue;
    }
    if (row.account_name != null && isGenericAccountName(row.account_name)) {
      const name = accountNameFor(label, row.url);
      if (name !== row.url && name !== row.account_name) {
        await db`UPDATE institution_additional_sources SET account_name = ${name}, updated_at = NOW() WHERE id = ${companionId}`;
        result.renamed.push({ companionId, from: row.account_name, to: name });
      }
    }
  }
  return result;
}

async function download(fetchImpl: Fetcher, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": crawlerUserAgent("Magellan"),
        Accept: "text/html,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function recordFailure(db: SqlTag, row: CompanionRow, status: number | null, reason: string): Promise<void> {
  const failures = Number(row.fetch_failures ?? 0) + 1;
  const dead = status === 404 || status === 410;
  const retire = failures >= MAX_FAILURES || (dead && failures >= 2);
  await db`
    UPDATE institution_additional_sources
       SET fetch_failures = ${failures},
           last_fetch_error = ${reason},
           last_fetched_at = NOW(),
           status = CASE WHEN ${retire}::boolean THEN 'rejected' ELSE status END,
           updated_at = NOW()
     WHERE id = ${Number(row.id)}
  `;
}

const PDF_LINK = /\.pdf($|[?#])/i;

export function isPdfLink(url: string): boolean {
  return PDF_LINK.test(url);
}

async function fetchOne(
  db: SqlTag,
  row: CompanionRow,
  fetchImpl: Fetcher,
  vault: DocumentVault | null,
): Promise<CompanionFetchResult> {
  const companionId = Number(row.id);
  const institutionId = Number(row.institution_id);
  const base = { companionId, institutionId, url: row.url, accountName: row.account_name, sourceDocumentId: null, documentType: null, bytes: 0 };
  const fail = async (status: number | null, reason: string, error?: unknown, attemptOutcome?: AttemptOutcome): Promise<CompanionFetchResult> => {
    await recordFailure(db, row, status, reason);
    return { ...base, outcome: "failed", attemptOutcome: attemptOutcome ?? classifyFetchFailure(status, error), reason };
  };

  let response: Response;
  try {
    response = await download(fetchImpl, row.url);
  } catch (error) {
    return fail(null, `Fetch failed: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  if (!response.ok) return fail(response.status, `HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return fail(response.status, "Document too large", undefined, "too_large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return fail(response.status, "Document too large", undefined, "too_large");

  const contentType = response.headers.get("content-type");
  const finalUrl = response.url || row.url;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const format = detectFormat(bytes, contentType, finalUrl);
  const documentType = documentTypeForFormat(format);
  // A PDF link answered with a web page is the site's bot wall, not the document: 53.com
  // served Fifth Third's fee PDFs as a "page doesn't exist" page (7 Oct 2026). Storing it
  // would hand Rosetta an error page; the paid fetch (blocked-fetch.ts) tries it instead.
  if (format === "html" && isPdfLink(row.url)) {
    return fail(response.status, "PDF link answered with a web page (bot wall)", undefined, "blocked_bot");
  }
  // A challenge page in place of the page itself, as discovery judges a homepage: Arvest's
  // fee page came back as a 928-byte challenge (8 Oct 2026) and was stored and read blank.
  if (format === "html" && looksLikeBotChallenge(new TextDecoder("utf-8").decode(bytes))) {
    return fail(response.status, "Page answered with a bot challenge", undefined, "blocked_bot");
  }

  // Same bytes as this page's last copy, or as any stored document of the bank (the
  // unique index on institution and content allows one): reuse it.
  let sourceDocumentId: number | null = null;
  let outcome: CompanionFetchOutcome = "unchanged";
  if (row.last_hash && row.last_hash === contentHash && row.last_source_document_id != null) {
    sourceDocumentId = Number(row.last_source_document_id);
  } else {
    const [existing] = await db`
      SELECT id FROM source_documents
       WHERE institution_id = ${institutionId}
         AND content_hash = ${contentHash}
         AND status = 'success'
         AND duplicate_of_id IS NULL
       ORDER BY id ASC
       LIMIT 1
    `;
    if (existing?.id != null) {
      sourceDocumentId = Number(existing.id);
    } else {
      const [inserted] = await db`
        INSERT INTO source_documents
          (institution_id, status, document_url, document_path, content_hash, fees_extracted, error_message,
           crawled_at, status_code, etag, last_modified, last_checked_at, companion_source_id)
        VALUES
          (${institutionId}, 'success', ${finalUrl}, NULL, ${contentHash}, 0, NULL,
           NOW(), ${response.status}, ${response.headers.get("etag")}, ${response.headers.get("last-modified")}, NOW(), ${companionId})
        RETURNING id
      `;
      sourceDocumentId = inserted?.id == null ? null : Number(inserted.id);
      outcome = "success";
      if (vault?.configured && sourceDocumentId != null) {
        const stored = await vault.store(bytes, contentHash, contentType);
        if (stored.key) {
          await db`
            UPDATE source_documents
               SET document_r2_key = ${stored.key}, content_type = ${contentType}, byte_size = ${bytes.byteLength}
             WHERE id = ${sourceDocumentId}
          `;
        } else if (stored.error) {
          console.error(`Document vault store failed for companion page ${companionId}: ${stored.error}`);
        }
      }
    }
  }
  if (outcome === "unchanged" && sourceDocumentId != null) {
    await db`UPDATE source_documents SET last_checked_at = NOW() WHERE id = ${sourceDocumentId}`;
  }
  // The copy this fetch stored or confirmed is the page's current one.
  await markCurrentCopy(db, sourceDocumentId);

  await db`
    UPDATE institution_additional_sources
       SET status = 'fetched',
           document_type = ${documentType},
           last_fetched_at = NOW(),
           last_source_document_id = ${sourceDocumentId},
           fetch_failures = 0,
           last_fetch_error = NULL,
           updated_at = NOW()
     WHERE id = ${companionId}
  `;
  return { ...base, outcome, attemptOutcome: outcome === "success" ? "ok" : "unchanged", sourceDocumentId, documentType, bytes: bytes.byteLength, reason: null };
}

export async function runCompanionFetch(options: {
  db: SqlTag;
  fetchImpl: Fetcher;
  vault: DocumentVault | null;
  runId: number;
  stepId?: number | null;
  stateCode?: string | null;
  institutionId?: number | null;
  limit?: number;
  deadline?: number;
}): Promise<RunCompanionFetchResult> {
  const db = options.db;
  if (!(await companionStreamsReady(db))) {
    return {
      status: "schema_pending",
      review: { checked: 0, retired: [], renamed: [] },
      selected: 0,
      fetched: 0,
      unchanged: 0,
      failed: 0,
      results: [],
    };
  }
  const deadline = options.deadline ?? Date.now() + COMPANION_FETCH_BUDGET_MS;
  const stateCode = normalizeStateCode(options.stateCode ?? undefined);
  let review: CompanionReviewResult = { checked: 0, retired: [], renamed: [] };
  try {
    review = await inSavepoint(db, (scope) => reviewStoredCompanions(scope, { stateCode, institutionId: options.institutionId ?? null }));
  } catch (error) {
    // A failed review must never stop the fetch.
    console.error("Companion review failed:", error);
  }
  const rows = await selectDue(
    db,
    stateCode,
    options.institutionId ?? null,
    options.limit ?? COMPANION_FETCH_LIMIT,
  );
  const results: CompanionFetchResult[] = [];
  for (const row of rows) {
    if (Date.now() > deadline) break;
    results.push(await fetchAndRecordCompanion(db, row, options.fetchImpl, options.vault, {
      runId: options.runId,
      stepId: options.stepId ?? null,
      strategy: COMPANION_FETCH_STRATEGY,
    }));
  }
  return {
    status: "ran",
    review,
    selected: rows.length,
    fetched: results.filter((result) => result.outcome === "success").length,
    unchanged: results.filter((result) => result.outcome === "unchanged").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
  };
}

/**
 * Fetches one companion page and records the attempt. The plain companion fetch and the
 * paid fetch for blocked pages (blocked-fetch.ts) share it, so a page stored either way is
 * kept the same way.
 */
export async function fetchAndRecordCompanion(
  db: SqlTag,
  row: CompanionRow,
  fetchImpl: Fetcher,
  vault: DocumentVault | null,
  ctx: { runId: number; stepId: number | null; strategy: { strategy: string; version: number }; costMicrousd?: number; note?: string | null },
): Promise<CompanionFetchResult> {
  const startedAt = Date.now();
  const result = await fetchOne(db, row, fetchImpl, vault);
  await recordAttempt(db, {
    institutionId: result.institutionId,
    sourceDocumentId: result.sourceDocumentId,
    stage: "fetch",
    strategy: ctx.strategy.strategy,
    version: ctx.strategy.version,
    fingerprint: row.url,
    outcome: result.attemptOutcome,
    yieldCount: result.outcome === "success" ? 1 : 0,
    costMicrousd: ctx.costMicrousd ?? 0,
    durationMs: Date.now() - startedAt,
    runId: ctx.runId,
    stepId: ctx.stepId,
    // The bank's playbook describes its main fee link; companion pages stay out of it.
    foldIntoPlaybook: false,
    detail: {
      url: result.url,
      companion_source_id: result.companionId,
      account: result.accountName,
      role: row.document_role,
      document_type: result.documentType,
      bytes: result.bytes,
      reason: result.reason,
      ...(ctx.note ? { note: ctx.note } : {}),
    },
  });
  return result;
}
