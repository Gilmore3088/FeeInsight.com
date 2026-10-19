import type { sql } from "@/lib/data-store/connection";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { learningSchemaReady } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";

import { fetchAndRecordLink, samePage, type FetchCandidateRow } from "./fetch";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * The bank's saved fee link, fetched when the plain fetch never has (#1881, Oct 19: James, "why
 * aren't the agents finding these problems?"). The plain fetch asks for the profile's remembered
 * address before the saved link (`fetch.ts`, `profile_canonical_source_url ?? fee_schedule_url`),
 * so a link re-pointed by a person, an answer key or a registry load was never fetched while an
 * older remembered address answered. On prod (read-only, Oct 19) 308 active banks, 204 with live
 * fees, had a saved link that is a different page from the remembered one and was never fetched;
 * 8,385 live fees cite documents that are no longer any of their bank's sources, 220 of those
 * documents at 206 banks because the saved link was never captured.
 *
 * This pass fetches the saved link once, through the normal fetch path, as a copy beside the
 * remembered one (`keepRemembered`): it stores the document (and the vault copy) so Rosetta reads
 * it and Hamilton's current-copy check can judge the older document's fees against it
 * (`hamilton/current-copy.ts`, retired documents). It never changes which address the plain fetch
 * asks for, the bank's failure count, or its saved link, and a failed fetch stores nothing (a newer
 * failed row would hide the current copy from Rosetta). Which page is right is not decided here:
 * some remembered addresses are deliberate (a PDF the page links to), and the current-copy check
 * judges nothing unless the saved link's copy restates most of the older copy's fees.
 *
 * A person's locked correction is left alone. Each bank is tried once per strategy version after a
 * fetch that answered, and at most once per `SAVED_LINK_RETRY_DAYS` after one that did not. Free:
 * a plain GET with Magellan's crawler identity, no provider.
 */
export const SAVED_LINK_FETCH_STRATEGY = { strategy: "fetch.saved_link", version: 1 } as const;
/**
 * The switch. Off, each fetch step selects the banks it would fetch and reports them
 * (`saved_links.would_fetch` in the step detail), fetching and storing nothing. A new document can
 * put new fees live through the normal read, extract, verify and publish steps, so it turns on by
 * PR with James's yes (morning batch, Oct 19).
 */
export const SAVED_LINK_FETCH_LIVE = false;
/** Banks tried per fetch step. */
export const SAVED_LINK_BANKS_PER_STEP = 10;
export const SAVED_LINK_RETRY_DAYS = 7;
/** The whole pass, so the fetch step's other passes still get their time. */
export const SAVED_LINK_BUDGET_MS = 45_000;

export interface SavedLinkRow extends FetchCandidateRow {
  has_live_fees?: boolean | null;
}

export interface SavedLinkFetchResult {
  institutionId: number;
  link: string;
  remembered: string | null;
  outcome: AttemptOutcome | "skipped";
  sourceDocumentId: number | null;
}

export interface RunSavedLinkFetchResult {
  live: boolean;
  selected: number;
  tried: number;
  /** A new document stored from the saved link. */
  stored: number;
  /** The saved link answered with bytes the bank already has stored (it redirects to the remembered page). */
  matched: number;
  failed: number;
  results: SavedLinkFetchResult[];
  /** Switch off: the banks this step would fetch (saved link and remembered address). */
  wouldFetch: Array<{ institutionId: number; link: string; remembered: string | null }>;
}

/** Pure: the saved link is a different page from the remembered address (spelling aside). */
export function savedLinkDiffers(row: Pick<FetchCandidateRow, "fee_schedule_url" | "profile_canonical_source_url">): boolean {
  const saved = row.fee_schedule_url?.trim();
  const remembered = row.profile_canonical_source_url?.trim();
  if (!saved || !remembered) return false;
  try {
    return !samePage(saved, remembered);
  } catch {
    return false;
  }
}

/**
 * Active banks whose saved fee link no stored document carries and that differs from the
 * remembered address, banks with live fees first, then the largest. Links are compared without
 * scheme, "www.", case or trailing slashes.
 */
export async function selectUnfetchedSavedLinks(db: SqlTag, limit: number, institutionId: number | null = null): Promise<SavedLinkRow[]> {
  if (limit <= 0) return [];
  const rows = await db<SavedLinkRow[]>`
    SELECT inst.id,
           inst.institution_name,
           inst.fee_schedule_url,
           inst.asset_size,
           inst.last_crawl_at,
           inst.consecutive_failures,
           profile.canonical_source_url AS profile_canonical_source_url,
           profile.last_source_hash AS profile_last_source_hash,
           profile.last_successful_source_document_id AS profile_last_document_id,
           EXISTS (SELECT 1 FROM published_fee_catalog live WHERE live.institution_id = inst.id) AS has_live_fees
      FROM institution_sources inst
      JOIN institution_source_profiles profile ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       AND (${institutionId}::bigint IS NULL OR inst.id = ${institutionId}::bigint)
       AND btrim(COALESCE(inst.fee_schedule_url, '')) ~* '^https?://'
       AND btrim(COALESCE(profile.canonical_source_url, '')) <> ''
       AND lower(regexp_replace(regexp_replace(btrim(COALESCE(profile.canonical_source_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', ''))
           <> lower(regexp_replace(regexp_replace(btrim(COALESCE(inst.fee_schedule_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', ''))
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND profile.locked_by_correction IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM source_documents doc
          WHERE doc.institution_id = inst.id
            AND doc.status = 'success'
            AND lower(regexp_replace(regexp_replace(btrim(COALESCE(doc.document_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', ''))
              = lower(regexp_replace(regexp_replace(btrim(COALESCE(inst.fee_schedule_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', ''))
       )
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts tried
          WHERE tried.institution_id = inst.id
            AND tried.stage = 'fetch'
            AND tried.strategy = ${SAVED_LINK_FETCH_STRATEGY.strategy}
            AND tried.strategy_version = ${SAVED_LINK_FETCH_STRATEGY.version}
            AND (tried.outcome IN ('ok', 'unchanged') OR tried.created_at > NOW() - make_interval(days => ${SAVED_LINK_RETRY_DAYS}::int))
       )
     ORDER BY has_live_fees DESC, inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit * 2}
  `;
  // The SQL compares spellings loosely; the page check drops `?print=1`, `:443` and the like.
  return rows.filter(savedLinkDiffers).slice(0, limit);
}

export async function runSavedLinkFetch(options: {
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
}): Promise<RunSavedLinkFetchResult> {
  const { db } = options;
  const live = options.live ?? SAVED_LINK_FETCH_LIVE;
  const deadline = options.deadline ?? Date.now() + SAVED_LINK_BUDGET_MS;
  const result: RunSavedLinkFetchResult = { live, selected: 0, tried: 0, stored: 0, matched: 0, failed: 0, results: [], wouldFetch: [] };
  // Without the attempt log nothing would stop the same bank being fetched every step.
  if (!(await learningSchemaReady(db))) return result;
  const rows = await selectUnfetchedSavedLinks(db, options.limit ?? SAVED_LINK_BANKS_PER_STEP, options.institutionId ?? null);
  result.selected = rows.length;
  if (!live) {
    result.wouldFetch = rows.map((row) => ({ institutionId: Number(row.id), link: (row.fee_schedule_url ?? "").trim(), remembered: row.profile_canonical_source_url?.trim() || null }));
    return result;
  }
  if (rows.length === 0) return result;
  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;

  for (const row of rows) {
    if (Date.now() > deadline) break;
    const link = (row.fee_schedule_url ?? "").trim();
    const remembered = row.profile_canonical_source_url?.trim() || null;
    result.tried += 1;
    const fetched = await fetchAndRecordLink(db, { ...row, profile_canonical_source_url: null }, options.fetchImpl, {
      learning: true,
      vaultSchema,
      vault,
      vaultOn,
      dryRun: false,
      runId: options.runId,
      stepId: options.stepId ?? null,
      strategy: SAVED_LINK_FETCH_STRATEGY,
      keepRemembered: true,
      note: `saved link never fetched; the plain fetch asks for ${remembered ?? "no remembered address"}`,
    });
    const outcome = fetched.result.outcome;
    if (outcome === "success") result.stored += 1;
    else if (outcome === "unchanged") result.matched += 1;
    else result.failed += 1;
    result.results.push({
      institutionId: Number(row.id),
      link,
      remembered,
      outcome: fetched.result.attemptOutcome ?? "skipped",
      sourceDocumentId: fetched.sourceDocumentId,
    });
  }
  return result;
}
