import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import type { Anthropic } from "@/lib/ai-provider";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { learningSchemaReady } from "@/lib/agents/learning/attempts";
import { PAID_PASS_MODELS, paidModelCall, type PaidMessageCreator } from "@/lib/agents/paid-pass";

import { COMPANION_FETCH_STRATEGY, fetchAndRecordCompanion, type CompanionRow } from "./companion-fetch";
import { fetchAndRecordLink, MAGELLAN_FETCH_STRATEGY, type FetchCandidateRow } from "./fetch";
import { onBankDomain, websiteHost } from "./link-coverage";
import { OPERATOR_SCHEDULE_STRATEGY } from "./operator-schedules";

type SqlTag = typeof sql;

/**
 * The paid fallback for fee links that refuse our fetcher (HTTP 403: Pinnacle's
 * pnfp.com) or never answer it (repeated timeouts: First Horizon), 7 Oct 2026. Anthropic's server-side web fetch requests the exact address
 * from Anthropic's network; the page text or PDF it returns is stored as the bank's
 * document like any fetch, and Rosetta reads it next. One call per bank, only the link's
 * own host is allowed, a few banks per paid step, largest first, and a bank is tried at
 * most once per BLOCKED_FETCH_RETRY_DAYS. It runs inside Magellan's paid step, so every
 * call is budget-checked against Magellan's cap before anything is spent.
 */
/** 2: room for the tool call (version 1 never fetched; its tries don't count toward the wait). */
export const BLOCKED_FETCH_STRATEGY = { strategy: "fetch.paid_web_fetch", version: 2 } as const;
/** Companion pages (a bank's other fee PDFs) blocked the same way: Fifth Third's 53.com, 7 Oct 2026. */
export const BLOCKED_COMPANION_FETCH_STRATEGY = { strategy: "fetch.paid_web_fetch_companion", version: 1 } as const;
/**
 * Main links and companion pages together, per paid step (two slots kept for companions).
 * Was 3: on 8 Oct only about nine paid steps ran a day, 24 blocked pages waited and the
 * refused paid answers (refused-answers.ts) were adding 72 more. Six fetches use 6 of the
 * run's 30 provider calls, at about a cent each.
 */
export const BLOCKED_FETCH_PER_RUN = 6;
const COMPANION_SLOTS = 2;
export const BLOCKED_FETCH_RETRY_DAYS = 7;
/** Caps the fetched page's tokens (the main cost of the call). */
const MAX_CONTENT_TOKENS = 60_000;
/**
 * Room for the tool call itself (the long address) plus the one-word reply; only tokens
 * used are billed. At 64 the first prod run (08:03, 7 Oct) stopped while writing the call,
 * so nothing was fetched.
 */
const MAX_OUTPUT_TOKENS = 1024;

export interface BlockedFetchRow extends FetchCandidateRow {
  state_code: string | null;
  website_url: string | null;
}

export interface BlockedFetchResult {
  selected: number;
  processed: number;
  stored: number;
  failed: number;
  costMicrousd: number;
  budgetStopped: boolean;
  budgetReason: string | null;
  results: Array<{ institution_id: number; outcome: string; url: string | null; cost_microusd: number; reason: string | null; by: "paid_web_fetch"; companion_source_id?: number }>;
}

/**
 * A bank's site that hangs on our fetcher (First Horizon, 7 Oct 2026) counts once its
 * link has timed out this many fetches in a row; a single timeout is just a slow night.
 */
export const BLOCKED_TIMEOUT_MIN_FAILURES = 2;

/**
 * Links whose last fetch was refused (HTTP 403) or that keep timing out (the bot wall
 * that never answers), and that the paid fetch has not tried
 * lately. Only links on the bank's own website: a refused link elsewhere (an LPL
 * disclosure, a car-price site, 7 Oct 2026) is the wrong link, not a blocked one.
 */
export async function selectBlockedLinks(db: SqlTag, limit: number): Promise<BlockedFetchRow[]> {
  if (limit <= 0) return [];
  const rows = await db<BlockedFetchRow[]>`
    -- fee links refused by the bank's site
    SELECT inst.id,
           inst.institution_name,
           inst.state_code,
           inst.website_url,
           inst.fee_schedule_url,
           inst.asset_size,
           inst.last_crawl_at,
           inst.consecutive_failures,
           profile.canonical_source_url AS profile_canonical_source_url,
           profile.last_source_hash AS profile_last_source_hash,
           profile.last_successful_source_document_id AS profile_last_document_id
      FROM institution_sources inst
      LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
     WHERE COALESCE(inst.status, 'active') = 'active'
       -- Judged by the plain fetch's last outcome: a failed paid try rewrites failure_reason
       -- (to http_5xx on 7 Oct) and must not drop the bank from the list.
       AND inst.failure_reason LIKE 'magellan_fetch_%'
       AND (
         SELECT CASE
                  WHEN plain.outcome = 'http_403' THEN TRUE
                  -- A refused connection is the same wall as a timeout: Centennial Bank's
                  -- schedule ($24.6B) failed with network_error four times from 3 to 7 Oct
                  -- 2026 and never reached the paid fetch (19 such banks, none with live fees).
                  WHEN plain.outcome IN ('timeout', 'network_error') THEN COALESCE(inst.consecutive_failures, 0) >= ${BLOCKED_TIMEOUT_MIN_FAILURES}
                  ELSE FALSE
                END
           FROM pipeline_attempts plain
          WHERE plain.institution_id = inst.id
            AND plain.stage = 'fetch'
            AND plain.strategy = ${MAGELLAN_FETCH_STRATEGY.strategy}
          ORDER BY plain.id DESC
          LIMIT 1
       ) IS TRUE
       AND COALESCE(btrim(COALESCE(profile.canonical_source_url, inst.fee_schedule_url)), '') <> ''
       AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'fetch'
            AND pa.strategy = ${BLOCKED_FETCH_STRATEGY.strategy}
            AND pa.strategy_version = ${BLOCKED_FETCH_STRATEGY.version}
            -- A try where the model never called the fetch learned nothing about the site.
            AND COALESCE(pa.detail->>'note', '') NOT LIKE 'no web fetch%'
            AND pa.created_at > NOW() - make_interval(days => ${BLOCKED_FETCH_RETRY_DAYS}::int)
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit * 4}
  `;
  return rows
    .filter((row) => row.website_url && onBankDomain((row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim(), row.website_url))
    .slice(0, limit);
}

/** Rosetta's reasons for setting aside a copy that read blank. */
const BLANK_READ_REASON_SQL = "(only 0 dollar amounts|no fee lines|built by javascript)";

export interface BlockedCompanionRow extends CompanionRow {
  website_url: string | null;
  found_by_strategy?: string | null;
}


/**
 * Companion pages the bank's site keeps from us: a PDF link answered with a web page (the
 * bot wall that says the page doesn't exist), a refusal, or repeated timeouts. Same rules
 * as main links: the bank's own site, once per BLOCKED_FETCH_RETRY_DAYS per page.
 */
export async function selectBlockedCompanions(db: SqlTag, limit: number): Promise<BlockedCompanionRow[]> {
  if (limit <= 0) return [];
  const rows = await db<BlockedCompanionRow[]>`
    -- companion pages blocked by the bank's site
    SELECT ias.id, ias.institution_id, ias.url, ias.document_role, ias.account_name, ias.fetch_failures,
           ias.last_source_document_id, latest.content_hash AS last_hash, inst.website_url, ias.found_by_strategy
      FROM institution_additional_sources ias
      JOIN institution_sources inst ON inst.id = ias.institution_id
      LEFT JOIN source_documents latest ON latest.id = ias.last_source_document_id
     WHERE ias.document_role <> 'business'
       AND (
         COALESCE(inst.status, 'active') = 'active'
         -- As in companion fetch: a hand-found schedule is fetched for a dormant bank (Stock
         -- Yards' syb.com page answered 403 on 8 Oct 2026), never for a closed charter.
         OR (inst.status = 'dormant' AND ias.found_by_strategy = 'discover.operator_schedule')
       )
       AND (
         -- Stored before the bot-wall check existed: a PDF link whose copy is a web page.
         -- Rosetta then set it aside for reading blank (Fifth Third's two PDFs), which
         -- judged the error page, not the PDF.
         (ias.url ~* ${"\\.pdf($|[?#])"}
           AND COALESCE(latest.content_type, '') ILIKE 'text/html%'
           AND (ias.status IN ('found', 'fetched')
             OR (ias.status = 'rejected' AND lower(COALESCE(ias.reason, '')) ~ ${BLANK_READ_REASON_SQL})))
         -- A page a person found that Rosetta read blank as "built by JavaScript": Arvest's
         -- fee page answered our fetcher with a 928-byte bot challenge (8 Oct 2026), while
         -- the paid web search read the real schedule. The paid fetch asks from that network.
         OR (ias.status = 'rejected'
           AND ias.found_by_strategy = ${OPERATOR_SCHEDULE_STRATEGY.strategy}
           AND lower(COALESCE(ias.reason, '')) ~ 'built by javascript')
         OR (ias.status IN ('found', 'fetched') AND (
           SELECT CASE
                    WHEN plain.outcome IN ('http_403', 'blocked_bot') THEN TRUE
                    -- One timeout is enough for a page a person found: Northern Trust's deposit
                    -- fee PDF times out on this network every time (2026-10-07 and 2026-10-09),
                    -- and a plain retry waits a day.
                    WHEN plain.outcome = 'timeout' AND ias.found_by_strategy = ${OPERATOR_SCHEDULE_STRATEGY.strategy} THEN TRUE
                    WHEN plain.outcome = 'timeout' THEN COALESCE(ias.fetch_failures, 0) >= ${BLOCKED_TIMEOUT_MIN_FAILURES}
                    ELSE FALSE
                  END
             FROM pipeline_attempts plain
            WHERE plain.institution_id = ias.institution_id
              AND plain.stage = 'fetch'
              AND plain.strategy = ${COMPANION_FETCH_STRATEGY.strategy}
              AND plain.detail->>'companion_source_id' = ias.id::text
            ORDER BY plain.id DESC
            LIMIT 1
         ) IS TRUE)
       )
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = ias.institution_id
            AND pa.stage = 'fetch'
            AND pa.strategy = ${BLOCKED_COMPANION_FETCH_STRATEGY.strategy}
            AND pa.strategy_version = ${BLOCKED_COMPANION_FETCH_STRATEGY.version}
            AND pa.input_fingerprint = ias.url
            AND COALESCE(pa.detail->>'note', '') NOT LIKE 'no web fetch%'
            AND pa.created_at > NOW() - make_interval(days => ${BLOCKED_FETCH_RETRY_DAYS}::int)
       )
     -- A page a person found and checked goes first: by asset size alone, Bridgewater's and
     -- Dacotah's hand-found pages (9 Oct 2026) sat behind 6-9 larger banks' pages with two
     -- slots per paid step, so they waited most of a day.
     ORDER BY (ias.found_by_strategy = ${OPERATOR_SCHEDULE_STRATEGY.strategy}) DESC NULLS LAST,
              inst.asset_size DESC NULLS LAST, ias.id ASC
     LIMIT ${limit * 4}
  `;
  // A schedule given by hand was checked by a person, so a sister brand's site counts: Zions'
  // consumer schedule is on amegybank.com (8 Oct 2026), not zionsbancorporation.com.
  return rows
    .filter((row) => row.found_by_strategy === OPERATOR_SCHEDULE_STRATEGY.strategy || (row.website_url && onBankDomain(row.url.trim(), row.website_url)))
    .slice(0, limit);
}

function decodeBase64(data: string): ArrayBuffer {
  const bytes = Buffer.from(data, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * The fetched document as an HTTP response, so the normal fetch path stores it: a PDF as
 * PDF bytes, a page as its text. A web-fetch error becomes the status it stands for.
 */
export function responseFromWebFetch(message: Pick<Anthropic.Message, "content"> & { stop_reason?: string | null }): Response {
  const block = message.content.find((item): item is Anthropic.WebFetchToolResultBlock => item.type === "web_fetch_tool_result");
  if (!block) {
    return new Response("The model did not fetch the page", { status: 502, statusText: `no web fetch (stop: ${message.stop_reason ?? "unknown"})` });
  }
  const content = block.content;
  if (content.type !== "web_fetch_result") {
    const code = "error_code" in content ? String(content.error_code) : "unknown";
    const status = code === "url_not_accessible" ? 403 : code === "too_many_requests" ? 429 : code === "unsupported_content_type" ? 415 : 502;
    return new Response(`web fetch error: ${code}`, { status, statusText: `web fetch error: ${code}` });
  }
  const source = content.content.source;
  if (source.type === "base64") {
    return new Response(decodeBase64(source.data), { status: 200, headers: { "content-type": source.media_type || "application/pdf" } });
  }
  return new Response(source.data, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function budgetStop(error: unknown): string | null {
  if (error instanceof ProviderBudgetBlockedError) return error.message || error.reasonCode;
  if (error instanceof EmergencyStopActiveError) return error.message;
  return null;
}

type PaidFetch = { response: Response; costMicrousd: number } | { stopped: string } | { error: string };

async function paidFetch(
  url: string,
  options: { runId: number; stepId?: number | null; create?: PaidMessageCreator },
  metadata: Record<string, unknown>,
): Promise<PaidFetch> {
  const host = websiteHost(url);
  if (!host) return { error: "No host in the link" };
  try {
    const call = await paidModelCall({
      agent: "magellan",
      operation: "blocked_fetch",
      runId: options.runId,
      create: options.create,
      metadata: { ...metadata, step_id: options.stepId ?? null, url },
      params: {
        model: PAID_PASS_MODELS.find(),
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [{
          type: "web_fetch_20250910",
          name: "web_fetch",
          max_uses: 1,
          allowed_domains: [host],
          max_content_tokens: MAX_CONTENT_TOKENS,
        }],
        messages: [{
          role: "user",
          content: `Fetch this exact address once with the web_fetch tool, then reply with the single word done. Do not summarize it.\n${url}`,
        }],
      },
    });
    return { response: responseFromWebFetch(call.message), costMicrousd: call.costMicrousd };
  } catch (error) {
    const stopped = budgetStop(error);
    if (stopped) return { stopped };
    return { error: `Model call failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function runBlockedFetch(options: {
  runId: number;
  stepId?: number | null;
  dryRun?: boolean;
  db?: SqlTag;
  limit?: number;
  create?: PaidMessageCreator;
  vault?: DocumentVault;
}): Promise<BlockedFetchResult> {
  const db = options.db ?? sql;
  const result: BlockedFetchResult = { selected: 0, processed: 0, stored: 0, failed: 0, costMicrousd: 0, budgetStopped: false, budgetReason: null, results: [] };
  if (!(await learningSchemaReady(db))) return result;
  const limit = Math.max(0, Math.min(options.limit ?? BLOCKED_FETCH_PER_RUN, BLOCKED_FETCH_PER_RUN));
  // Slots are kept for companion pages (57 main links were due on 7 Oct, which would
  // hold every companion back for weeks); companions also fill any slot main links leave.
  const reserved = await selectBlockedCompanions(db, limit > COMPANION_SLOTS ? COMPANION_SLOTS : limit > 1 ? 1 : 0);
  const rows = await selectBlockedLinks(db, limit - reserved.length);
  const companions = rows.length + reserved.length < limit
    ? await selectBlockedCompanions(db, limit - rows.length)
    : reserved;
  result.selected = rows.length + companions.length;
  if (options.dryRun || result.selected === 0) return result;

  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;
  const modelError = (institutionId: number, url: string, reason: string, companionId?: number) => {
    // The page was never requested: leave its fetch state alone and try it next pass.
    result.processed += 1;
    result.failed += 1;
    result.results.push({ institution_id: institutionId, outcome: "model_error", url, cost_microusd: 0, reason, by: "paid_web_fetch", ...(companionId ? { companion_source_id: companionId } : {}) });
  };

  for (const row of rows) {
    const institutionId = Number(row.id);
    const url = (row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim();
    const paid = await paidFetch(url, options, { institution_id: institutionId });
    if ("stopped" in paid) {
      // Nothing was spent on this bank: it stays due for the next paid pass.
      result.budgetStopped = true;
      result.budgetReason = paid.stopped;
      return result;
    }
    if ("error" in paid) {
      modelError(institutionId, url, paid.error);
      continue;
    }
    const { response, costMicrousd } = paid;
    result.costMicrousd += costMicrousd;
    const fetched = await fetchAndRecordLink(db, row, async () => response, {
      learning: true,
      vaultSchema,
      vault,
      vaultOn,
      dryRun: false,
      runId: options.runId,
      stepId: options.stepId ?? null,
      strategy: BLOCKED_FETCH_STRATEGY,
      costMicrousd,
      note: response.statusText || null,
    });
    result.processed += 1;
    const stored = fetched.result.outcome === "success" || fetched.result.outcome === "unchanged";
    if (stored) result.stored += 1;
    else result.failed += 1;
    result.results.push({
      institution_id: institutionId,
      outcome: fetched.result.attemptOutcome ?? fetched.result.outcome,
      url,
      cost_microusd: costMicrousd,
      reason: [fetched.result.reason, response.statusText].filter(Boolean).join("; ") || null,
      by: "paid_web_fetch",
    });
  }

  for (const row of companions) {
    const institutionId = Number(row.institution_id);
    const companionId = Number(row.id);
    const url = row.url.trim();
    const paid = await paidFetch(url, options, { institution_id: institutionId, companion_source_id: companionId });
    if ("stopped" in paid) {
      result.budgetStopped = true;
      result.budgetReason = paid.stopped;
      return result;
    }
    if ("error" in paid) {
      modelError(institutionId, url, paid.error, companionId);
      continue;
    }
    const { response, costMicrousd } = paid;
    result.costMicrousd += costMicrousd;
    const fetched = await fetchAndRecordCompanion(db, row, (async () => response) as unknown as typeof fetch, vaultOn ? vault : null, {
      runId: options.runId,
      stepId: options.stepId ?? null,
      strategy: BLOCKED_COMPANION_FETCH_STRATEGY,
      costMicrousd,
      note: response.statusText || null,
    });
    result.processed += 1;
    if (fetched.outcome === "failed") result.failed += 1;
    else result.stored += 1;
    result.results.push({
      institution_id: institutionId,
      outcome: fetched.attemptOutcome,
      url,
      cost_microusd: costMicrousd,
      reason: [fetched.reason, response.statusText].filter(Boolean).join("; ") || null,
      by: "paid_web_fetch",
      companion_source_id: companionId,
    });
  }
  return result;
}
