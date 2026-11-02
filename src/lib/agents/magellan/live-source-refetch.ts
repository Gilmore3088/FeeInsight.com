import type { sql } from "@/lib/data-store/connection";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { learningSchemaReady } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";

import { HOLD_REFETCH_REQUEST_KIND } from "@/lib/agents/darwin/hold-source-reread-switch";
import { KNOX_REREAD_BACKLOG_LIVE, KNOX_REREAD_REFETCH_DAYS } from "@/lib/agents/knox/reread-backlog";

import { fetchAndRecordLink, type FetchCandidateRow } from "./fetch";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * The pages live fees come from, fetched again when nothing else does (#1200). The plain fetch
 * asks for one address per bank (`profile.canonical_source_url ?? fee_schedule_url`, fetch.ts) and
 * judges a bank due by its own last crawl, never by which document its live fees cite. When the
 * bank's fee page moved, or the remembered address was re-pointed to another page, the page the
 * live fees were read from was never asked for again, and superseding only works within one
 * address (`markCurrentCopy`), so its old copy stayed current. On prod (read-only, Oct 20) 20
 * active banks' live fees (391) cited only documents last checked more than 90 days ago, five of
 * them the same five flagged on Oct 13: Partner Colorado's fee PDF (Feb 17) answered 403 once in
 * April and was never asked for again; Railway's fee PDF the same; Bank of Ontario's, Self-Reliance's
 * and Synergy's fee pages were left behind when their remembered address moved. 101 such pages
 * (101 banks, 1,219 live fees) had no successful copy in 30 days, 99 of them in 90.
 *
 * This pass fetches those pages, oldest first, as a side copy (`keepRemembered`): the copy is
 * stored under the page's own address, so it supersedes the page's old copy and the usual read,
 * extract, verify, publish and current-copy checks judge the live fees against what the bank
 * serves today. It never changes the bank's fetch address, failure count, saved link or playbook.
 * When the bank still serves the same bytes, the cited document's check date moves forward, so
 * its age stops saying "not checked since February". A failure is retried on a growing wait
 * (`LIVE_SOURCE_RETRY_DAYS`), never given up: one 403 in April must not freeze a page for good.
 * Free: a plain GET with Magellan's crawler identity, no provider.
 *
 * Held fees' pages (Pipeline wiring audit gap 2, Nov 2): Darwin's hold source re-read
 * (`darwin/hold-source-reread.ts`) asks for a fresh copy of the page a range or peer hold was read
 * from when that copy is over LIVE_SOURCE_REFETCH_DAYS old, with one `pipeline_feedback` row of kind
 * `magellan_refetch_requested` per document (`HOLD_REFETCH_REQUEST_KIND`). A request made or
 * renewed in the last LIVE_SOURCE_REFETCH_DAYS puts its page in this pass's queue on the same
 * terms (a stale copy, past its retry wait, not the plain fetch's own address), after every page
 * live fees cite. No request is written while Darwin's switch (`HOLD_SOURCE_REREAD_LIVE`) is off.
 */
export const LIVE_SOURCE_REFETCH_STRATEGY = { strategy: "fetch.live_source", version: 2 } as const;
/**
 * The switch. On, since the pass fetches only pages the bank's live fees already come from, the
 * same way the plain fetch re-fetches every bank's main page each month: what reaches live fees
 * from a new copy goes through the same read, verify and publish checks as any other copy. Off,
 * each fetch step reports the pages it would fetch (`live_sources.would_fetch`) and fetches none.
 */
export const LIVE_SOURCE_REFETCH_LIVE = true;
/** A page with a successful copy this recent is current enough. */
export const LIVE_SOURCE_REFETCH_DAYS = 30;
/** Waits after the 1st, 2nd, 3rd and later failures in a row; never given up. */
export const LIVE_SOURCE_RETRY_DAYS = [1, 3, 7, 30] as const;
/** Pages tried per fetch step. */
export const LIVE_SOURCE_PAGES_PER_STEP = 10;
/** The whole pass, so the fetch step's other passes still get their time. */
export const LIVE_SOURCE_BUDGET_MS = 45_000;
/**
 * Version 2. On prod (read-only, Nov 2) 552 of the 8,603 documents behind live fees were last
 * checked more than 90 days ago. 63 of them (63 banks, 657 live fees) were pages this pass had
 * fetched on Oct 20 with an answer: the page redirected to another address, the copy was stored
 * under that address, and the cited document never moved; "ok" then waited 30 days and the next
 * try would land the same way, for good. Six more were the bank's own remembered address, which
 * this pass left to the plain fetch, whose answer also landed under a new address (Alva State
 * Bank's page now answers from wisdomheritage.bank). Now an answer counts only when it came from
 * the page itself; a redirect elsewhere is a failed try on the growing wait, and the remembered
 * address is taken here once the plain fetch has had an answer since its newest copy without storing one
 * under it. A page that fails LIVE_SOURCE_UNREACHABLE_TRIES tries in a row is reported.
 */
export const LIVE_SOURCE_UNREACHABLE_TRIES = 3;

/** A page live fees cite that has not answered for LIVE_SOURCE_UNREACHABLE_TRIES tries in a row. */
export interface UnreachableLiveSource {
  institutionId: number;
  url: string;
  /** Where the last try landed when the page redirected elsewhere, else null. */
  landedUrl: string | null;
  /** "moved" for a redirect elsewhere, else the attempt outcome (http_404, timeout, ...). */
  lastOutcome: string;
  tries: number;
  liveFees: number;
  documentIds: number[];
}

export interface LiveSourceRow extends FetchCandidateRow {
  /** The page as the attempt log keys it: no scheme, "www.", ":443", case or trailing slash. */
  page: string;
  /** Live fees whose document is a copy of this page. */
  live_fees: number | string;
  /** Held fees Darwin asked a fresh copy of this page for (`HOLD_REFETCH_REQUEST_KIND`). */
  held_fees?: number | string;
  /** The page's documents those fees cite. */
  document_ids: Array<number | string>;
  /** The newest successful copy of this page, if any. */
  newest_copy_at: string | Date | null;
  failures: number | string | null;
}

export interface LiveSourceFetchResult {
  institutionId: number;
  url: string;
  liveFees: number;
  outcome: AttemptOutcome | "skipped";
  sourceDocumentId: number | null;
  /** Cited documents whose check date moved forward because the bank still serves the same bytes. */
  confirmed: number;
}

export interface RunLiveSourceRefetchResult {
  live: boolean;
  selected: number;
  tried: number;
  /** A new copy of the page stored. */
  stored: number;
  /** The page answered with bytes the bank already has. */
  matched: number;
  failed: number;
  results: LiveSourceFetchResult[];
  /** The page answered from another address (a redirect elsewhere). */
  moved: number;
  /**
   * Pages live fees cite that failed LIVE_SOURCE_UNREACHABLE_TRIES tries in a row (a redirect
   * elsewhere counts): the fetch step reports them (`live_sources.unreachable`) so the bank's
   * current page is found again. Their live fees are not touched here.
   */
  unreachable: UnreachableLiveSource[];
  /** Switch off: the pages this step would fetch. */
  wouldFetch: Array<{ institutionId: number; url: string; liveFees: number; newestCopyAt: string | null }>;
}

/** Pure: a page address as the attempt log keys it (the SQL's normalisation): no scheme, "www.", ":443", case or trailing slash. */
export function livePageKey(url: string | null | undefined): string | null {
  if (url == null || url.trim() === "") return null;
  return url.trim().replace(/^https?:\/\/(www\.)?/i, "").replace(/:443(\/|$)/, "$1").replace(/\/+$/, "").toLowerCase();
}

/**
 * Pure: a page key as a landing is compared to it (the SQL's `landing` normalisation). The final URL
 * a fetch reports drops the "#..." fragment and percent-encodes spaces, so both sides lose the
 * fragment, read "%20" as a space and lose a trailing slash left behind:
 * "customersbank.com/consumer-disclosures/#fee-schedule" lands as "customersbank.com/consumer-disclosures".
 */
export function liveLandingKey(key: string | null | undefined): string | null {
  if (key == null) return null;
  return key.replace(/#.*$/, "").replaceAll("%20", " ").replace(/\/+$/, "");
}

/**
 * Pure: did the page itself answer? An answer that landed under another address is the page moved,
 * unless the bank still serves the cited bytes there (`confirmed`), which counts as an answer.
 */
export function liveSourceAnswer(attemptOutcome: string | null | undefined, landedUrl: string | null | undefined, page: string, confirmed = false): "answered" | "moved" | "failed" {
  if (attemptOutcome !== "ok" && attemptOutcome !== "unchanged") return "failed";
  if (confirmed) return "answered";
  const landed = liveLandingKey(livePageKey(landedUrl));
  return landed == null || landed === liveLandingKey(page) ? "answered" : "moved";
}

/** Pure: days to wait after the last try (an answer waits LIVE_SOURCE_REFETCH_DAYS). */
export function liveSourceRetryDays(lastOutcome: string | null, failures: number): number {
  if (lastOutcome === "ok" || lastOutcome === "unchanged") return LIVE_SOURCE_REFETCH_DAYS;
  const index = Math.min(Math.max(failures, 1), LIVE_SOURCE_RETRY_DAYS.length) - 1;
  return LIVE_SOURCE_RETRY_DAYS[index];
}

/**
 * Pages that live fees cite and nothing fetched lately: not a companion page (those have their own
 * monthly fetch), not the address the plain fetch asks for, no successful copy in
 * LIVE_SOURCE_REFETCH_DAYS, and past their retry wait. Oldest page first, then the most live fees.
 */
export async function selectStaleLiveSources(
  db: SqlTag,
  limit: number,
  institutionId: number | null = null,
  options: { refetchRequestDays?: number | null } = {},
): Promise<LiveSourceRow[]> {
  if (limit <= 0) return [];
  // Gap 10 (Nov 2, `knox/reread-backlog.ts`): a page whose cited current document nothing checked in
  // this many days is a refetch request. It is asked for even when it is the plain fetch's own address
  // or another copy of the page is newer, since neither moved that document's check date. Null: off.
  const requestDays = options.refetchRequestDays == null ? null : Math.max(1, Math.floor(options.refetchRequestDays));
  const [first, second, third, later] = LIVE_SOURCE_RETRY_DAYS;
  return db<LiveSourceRow[]>`
    WITH cited AS (
      SELECT fr.source_document_id AS document_id, count(*)::int AS live_fees, 0 AS held_fees
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
         AND (${institutionId}::bigint IS NULL OR fp.institution_id = ${institutionId}::bigint)
       GROUP BY fr.source_document_id
      UNION ALL
      -- Darwin's requests for held fees' pages, made or renewed within the window.
      SELECT req.source_document_id, 0, max(COALESCE((req.evidence->>'held_fees')::int, 1))
        FROM pipeline_feedback req
       WHERE req.kind = ${HOLD_REFETCH_REQUEST_KIND}
         AND req.source_document_id IS NOT NULL
         AND COALESCE(req.updated_at, req.created_at) > NOW() - make_interval(days => ${LIVE_SOURCE_REFETCH_DAYS}::int)
         AND (${institutionId}::bigint IS NULL OR req.institution_id = ${institutionId}::bigint)
       GROUP BY req.source_document_id
    ), live AS (
      SELECT document_id, sum(live_fees)::int AS live_fees, sum(held_fees)::int AS held_fees
        FROM cited
       GROUP BY document_id
    ), pages AS (
      SELECT doc.institution_id,
             lower(regexp_replace(regexp_replace(regexp_replace(btrim(doc.document_url), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', '')) AS page,
             min(btrim(doc.document_url)) AS url,
             sum(live.live_fees)::int AS live_fees,
             sum(live.held_fees)::int AS held_fees,
             array_agg(doc.id ORDER BY doc.id) AS document_ids,
             min(COALESCE(doc.last_checked_at, doc.crawled_at)) FILTER (WHERE doc.superseded_by_id IS NULL) AS oldest_current_check
        FROM live
        JOIN source_documents doc ON doc.id = live.document_id
       WHERE doc.companion_source_id IS NULL
         AND btrim(COALESCE(doc.document_url, '')) ~* '^https?://'
       GROUP BY 1, 2
    )
    SELECT inst.id,
           inst.institution_name,
           pages.url AS fee_schedule_url,
           inst.asset_size,
           inst.last_crawl_at,
           inst.consecutive_failures,
           pages.page,
           pages.live_fees,
           pages.held_fees,
           pages.document_ids,
           newest.copy_at AS newest_copy_at,
           tried.failures
      FROM pages
      JOIN institution_sources inst ON inst.id = pages.institution_id
      LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
      LEFT JOIN LATERAL (
        SELECT max(COALESCE(doc.last_checked_at, doc.crawled_at)) AS copy_at
          FROM source_documents doc
         WHERE doc.institution_id = pages.institution_id
           AND doc.status = 'success'
           AND lower(regexp_replace(regexp_replace(regexp_replace(btrim(COALESCE(doc.document_url, '')), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', '')) = pages.page
      ) newest ON TRUE
      -- The page key as a landing is compared to it (liveLandingKey).
      CROSS JOIN LATERAL (
        SELECT regexp_replace(replace(regexp_replace(pages.page, '#.*$', ''), '%20', ' '), '/+$', '') AS page
      ) landing
      LEFT JOIN LATERAL (
        SELECT last.created_at AS last_at,
               last.outcome AS last_outcome,
               -- Answered (liveSourceAnswer): the page itself answered, its landing compared without
               -- the "#..." fragment, with "%20" read as a space (liveLandingKey); or the answer
               -- matched a cited document's bytes. An answer that landed under another address (a
               -- redirect) is the page moved, and counts as a failed try.
               (last.outcome IN ('ok', 'unchanged') AND (
                 COALESCE(regexp_replace(replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(btrim(last.detail->>'url'), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', '')), '#.*$', ''), '%20', ' '), '/+$', ''), landing.page) = landing.page
                 OR COALESCE(last.detail->'live_document_ids' @> jsonb_build_array(last.source_document_id), FALSE)
               )) AS last_answered,
               (SELECT count(*)::int FROM pipeline_attempts failed
                 WHERE failed.institution_id = pages.institution_id
                   AND failed.stage = 'fetch'
                   AND failed.strategy = ${LIVE_SOURCE_REFETCH_STRATEGY.strategy}
                   AND failed.detail->>'live_page' = pages.page
                   AND NOT (failed.outcome IN ('ok', 'unchanged') AND (
                     COALESCE(regexp_replace(replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(btrim(failed.detail->>'url'), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', '')), '#.*$', ''), '%20', ' '), '/+$', ''), landing.page) = landing.page
                     OR COALESCE(failed.detail->'live_document_ids' @> jsonb_build_array(failed.source_document_id), FALSE)
                   ))
                   AND failed.created_at > last_ok.at) AS failures
          FROM pipeline_attempts last
          CROSS JOIN LATERAL (
            SELECT COALESCE(max(ok.created_at), '-infinity'::timestamptz) AS at
              FROM pipeline_attempts ok
             WHERE ok.institution_id = pages.institution_id
               AND ok.stage = 'fetch'
               AND ok.strategy = ${LIVE_SOURCE_REFETCH_STRATEGY.strategy}
               AND ok.detail->>'live_page' = pages.page
               AND ok.outcome IN ('ok', 'unchanged')
               AND (
                 COALESCE(regexp_replace(replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(btrim(ok.detail->>'url'), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', '')), '#.*$', ''), '%20', ' '), '/+$', ''), landing.page) = landing.page
                 OR COALESCE(ok.detail->'live_document_ids' @> jsonb_build_array(ok.source_document_id), FALSE)
               )
          ) last_ok
         WHERE last.institution_id = pages.institution_id
           AND last.stage = 'fetch'
           AND last.strategy = ${LIVE_SOURCE_REFETCH_STRATEGY.strategy}
           AND last.detail->>'live_page' = pages.page
         ORDER BY last.created_at DESC
         LIMIT 1
      ) tried ON TRUE
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND profile.locked_by_correction IS NOT TRUE
       -- The plain fetch already asks for this address every month; it is left to that fetch
       -- until the fetch has had an answer since the page's newest copy and still stored none
       -- here (the address now redirects elsewhere, so its answer landed under another page). A
       -- failed plain fetch moves only last_crawl_at, not last_success_at, and is left to its
       -- own retries.
       AND (
         pages.page <> lower(regexp_replace(regexp_replace(regexp_replace(btrim(COALESCE(profile.canonical_source_url, inst.fee_schedule_url, '')), '^https?://(www\\.)?', '', 'i'), ':443(/|$)', '\\1'), '/+$', ''))
         OR (inst.last_success_at IS NOT NULL AND (newest.copy_at IS NULL OR inst.last_success_at > newest.copy_at + INTERVAL '1 hour'))
         -- Gap 10: a Knox refetch request (its cited current document unchecked that long).
         OR (${requestDays}::int IS NOT NULL AND pages.oldest_current_check < NOW() - make_interval(days => ${requestDays}::int))
       )
       AND (
         newest.copy_at IS NULL OR newest.copy_at < NOW() - make_interval(days => ${LIVE_SOURCE_REFETCH_DAYS}::int)
         OR (${requestDays}::int IS NOT NULL AND pages.oldest_current_check < NOW() - make_interval(days => ${requestDays}::int))
       )
       AND (
         tried.last_at IS NULL
         OR tried.last_at < NOW() - make_interval(days => CASE
           WHEN tried.last_answered THEN ${LIVE_SOURCE_REFETCH_DAYS}::int
           WHEN tried.failures <= 1 THEN ${first}::int
           WHEN tried.failures = 2 THEN ${second}::int
           WHEN tried.failures = 3 THEN ${third}::int
           ELSE ${later}::int
         END)
       )
     -- Pages live fees cite first; held fees' pages only after them. With Knox's refetch requests on
     -- (gap 10), a page sorts by the older of its newest copy and its oldest current check.
     ORDER BY (pages.live_fees > 0) DESC,
              CASE WHEN ${requestDays}::int IS NULL THEN newest.copy_at ELSE LEAST(newest.copy_at, pages.oldest_current_check) END ASC NULLS FIRST,
              pages.live_fees DESC, pages.held_fees DESC, inst.id ASC
     LIMIT ${limit}
  `;
}

export async function runLiveSourceRefetch(options: {
  db: SqlTag;
  fetchImpl: Fetcher;
  runId: number;
  stepId?: number | null;
  institutionId?: number | null;
  limit?: number;
  vault?: DocumentVault;
  /** Stop starting new requests after this time (ms since epoch). */
  deadline?: number;
  live?: boolean;
  /** Gap 10: take Knox's refetch requests (KNOX_REREAD_BACKLOG_LIVE by default). */
  refetchRequests?: boolean;
}): Promise<RunLiveSourceRefetchResult> {
  const { db } = options;
  const live = options.live ?? LIVE_SOURCE_REFETCH_LIVE;
  const deadline = options.deadline ?? Date.now() + LIVE_SOURCE_BUDGET_MS;
  const result: RunLiveSourceRefetchResult = { live, selected: 0, tried: 0, stored: 0, matched: 0, failed: 0, moved: 0, unreachable: [], results: [], wouldFetch: [] };
  // The retry waits live in the attempt log; without it every step would ask for the same pages.
  if (!(await learningSchemaReady(db))) return result;
  const refetchRequests = options.refetchRequests ?? KNOX_REREAD_BACKLOG_LIVE;
  const rows = await selectStaleLiveSources(db, options.limit ?? LIVE_SOURCE_PAGES_PER_STEP, options.institutionId ?? null, {
    refetchRequestDays: refetchRequests ? KNOX_REREAD_REFETCH_DAYS : null,
  });
  result.selected = rows.length;
  if (!live) {
    result.wouldFetch = rows.map((row) => ({
      institutionId: Number(row.id),
      url: row.fee_schedule_url ?? "",
      liveFees: Number(row.live_fees),
      newestCopyAt: row.newest_copy_at == null ? null : new Date(row.newest_copy_at).toISOString(),
    }));
    return result;
  }
  if (rows.length === 0) return result;
  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;

  for (const row of rows) {
    if (Date.now() > deadline) break;
    const url = row.fee_schedule_url ?? "";
    const documentIds = row.document_ids.map(Number);
    result.tried += 1;
    const fetched = await fetchAndRecordLink(db, { ...row, profile_canonical_source_url: null, profile_last_source_hash: null, profile_last_document_id: null }, options.fetchImpl, {
      learning: true,
      vaultSchema,
      vault,
      vaultOn,
      dryRun: false,
      runId: options.runId,
      stepId: options.stepId ?? null,
      strategy: LIVE_SOURCE_REFETCH_STRATEGY,
      keepRemembered: true,
      note: `${Number(row.live_fees)} live fees cite this page${Number(row.held_fees ?? 0) > 0 ? `, ${Number(row.held_fees)} held fees wait on it` : ""}; newest copy ${row.newest_copy_at == null ? "never" : new Date(row.newest_copy_at).toISOString().slice(0, 10)}`,
      detail: { live_page: row.page, live_document_ids: documentIds, ...(Number(row.held_fees ?? 0) > 0 ? { held_fees: Number(row.held_fees) } : {}) },
      // fee_schedule_url here is the live fees' page, not the bank's saved link (#2055).
      linkIsStandIn: true,
    });
    const outcome = fetched.result.outcome;
    if (outcome === "success") result.stored += 1;
    else if (outcome === "unchanged") result.matched += 1;
    else result.failed += 1;
    // The bank still serves the bytes the live fees were read from: their document is current.
    let confirmed = 0;
    if ((outcome === "success" || outcome === "unchanged") && fetched.result.contentHash) {
      const touched = await db`
        UPDATE source_documents
           SET last_checked_at = NOW()
         WHERE id = ANY(${documentIds}::bigint[])
           AND content_hash = ${fetched.result.contentHash}
        RETURNING id
      `;
      confirmed = touched.length;
    }
    // Not answered by the page itself and not confirmed: one more failed try in a row. After
    // LIVE_SOURCE_UNREACHABLE_TRIES the page is reported so the bank's current page is found again.
    const answer = liveSourceAnswer(fetched.result.attemptOutcome, fetched.result.finalUrl, row.page, confirmed > 0);
    if (answer === "moved") result.moved += 1;
    if (answer !== "answered") {
      const tries = Number(row.failures ?? 0) + 1;
      if (tries >= LIVE_SOURCE_UNREACHABLE_TRIES) {
        result.unreachable.push({
          institutionId: Number(row.id),
          url,
          landedUrl: answer === "moved" ? fetched.result.finalUrl : null,
          lastOutcome: answer === "moved" ? "moved" : String(fetched.result.attemptOutcome ?? "failed"),
          tries,
          liveFees: Number(row.live_fees),
          documentIds,
        });
      }
    }
    result.results.push({
      institutionId: Number(row.id),
      url,
      liveFees: Number(row.live_fees),
      outcome: fetched.result.attemptOutcome ?? "skipped",
      sourceDocumentId: fetched.sourceDocumentId,
      confirmed,
    });
  }
  return result;
}
