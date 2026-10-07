import { sql } from "@/lib/data-store/connection";
import { EmergencyStopActiveError } from "@/lib/automation-control";
import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import type { Anthropic } from "@/lib/ai-provider";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { learningSchemaReady } from "@/lib/agents/learning/attempts";
import { PAID_PASS_MODELS, paidModelCall, type PaidMessageCreator } from "@/lib/agents/paid-pass";

import { fetchAndRecordLink, MAGELLAN_FETCH_STRATEGY, type FetchCandidateRow } from "./fetch";
import { onBankDomain, websiteHost } from "./link-coverage";

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
export const BLOCKED_FETCH_PER_RUN = 3;
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
  results: Array<{ institution_id: number; outcome: string; url: string | null; cost_microusd: number; reason: string | null; by: "paid_web_fetch" }>;
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
                  WHEN plain.outcome = 'timeout' THEN COALESCE(inst.consecutive_failures, 0) >= ${BLOCKED_TIMEOUT_MIN_FAILURES}
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
  const rows = await selectBlockedLinks(db, Math.max(0, Math.min(options.limit ?? BLOCKED_FETCH_PER_RUN, BLOCKED_FETCH_PER_RUN)));
  result.selected = rows.length;
  if (options.dryRun || rows.length === 0) return result;

  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;
  const model = PAID_PASS_MODELS.find();
  for (const row of rows) {
    const institutionId = Number(row.id);
    const url = (row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim();
    const host = websiteHost(url);
    if (!host) continue;
    let response: Response;
    let costMicrousd = 0;
    try {
      const call = await paidModelCall({
        agent: "magellan",
        operation: "blocked_fetch",
        runId: options.runId,
        create: options.create,
        metadata: { institution_id: institutionId, step_id: options.stepId ?? null, url },
        params: {
          model,
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
      costMicrousd = call.costMicrousd;
      result.costMicrousd += costMicrousd;
      response = responseFromWebFetch(call.message);
    } catch (error) {
      const stopped = budgetStop(error);
      if (stopped) {
        // Nothing was spent on this bank: it stays due for the next paid pass.
        result.budgetStopped = true;
        result.budgetReason = stopped;
        break;
      }
      // The page was never requested: leave the bank's fetch state alone and try it next pass.
      result.processed += 1;
      result.failed += 1;
      result.results.push({
        institution_id: institutionId,
        outcome: "model_error",
        url,
        cost_microusd: 0,
        reason: `Model call failed: ${error instanceof Error ? error.message : String(error)}`,
        by: "paid_web_fetch",
      });
      continue;
    }
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
  return result;
}
