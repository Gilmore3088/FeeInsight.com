import { lookup as dnsLookup } from "node:dns/promises";

import { sql } from "@/lib/data-store/connection";
import { crawlerUserAgent } from "@/lib/agents/crawler-identity";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { isPublicFeeSourceAddress } from "@/lib/agents/fee-source-fetch";
import { learningSchemaReady } from "@/lib/agents/learning/attempts";

import { fetchAndRecordLink, type FetchCandidateRow } from "./fetch";
import { onBankDomain } from "./link-coverage";

type SqlTag = typeof sql;

/**
 * Browser rendering for fee pages built by JavaScript (James, 2026-10-27: a Vercel function
 * with slim Chromium). Rosetta reads a page whose HTML is an app shell as `js_required`; its
 * free fallbacks look for embedded data, a PDF link or a print version, and before this the
 * bank then waited for the paid finder. Here the bank's own fee link is opened in headless
 * Chromium, the page is given time to draw its fee table, closed "Fees" and "Disclosures"
 * sections are opened, and the rendered HTML is stored through `fetchAndRecordLink` like any
 * fetch: document row, current copy, vault, attempt. Rosetta reads it next with its DOM reader.
 *
 * It renders as FeeInsightBot, never as a person's browser: no proxy, no fingerprint changes,
 * no captcha solving, no form filled in. A bot wall stays a bot wall. Off unless
 * `MAGELLAN_BROWSER=on`; at most `BROWSER_RENDERS_PER_STEP` a step and
 * `MAGELLAN_BROWSER_DAILY_CAP` (default 50) a day, counted from the attempt log.
 */
export const BROWSER_FETCH_STRATEGY = { strategy: "fetch.browser_render", version: 1 } as const;
export const BROWSER_RENDERS_PER_STEP = 5;
export const BROWSER_DAILY_CAP_DEFAULT = 50;
/** A page is rendered again only after this many days, whatever Rosetta made of it. */
export const BROWSER_RETRY_DAYS = 30;
/** Time the page gets to load and settle before its HTML is taken. */
const NAVIGATION_TIMEOUT_MS = 20_000;
const SETTLE_TIMEOUT_MS = 8_000;
/** Closed sections opened per page; only buttons, summaries and accordion headers, never links or forms. */
const MAX_EXPANDS = 6;
const EXPAND_LABEL = /\b(fees?|charges?|disclosures?|schedule|service charges?|truth in savings|account (?:terms|agreement))\b/i;
const MAX_HTML_BYTES = 15 * 1024 * 1024;

export function browserFetchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.MAGELLAN_BROWSER ?? "").trim().toLowerCase() === "on";
}

export function browserDailyCap(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.MAGELLAN_BROWSER_DAILY_CAP ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : BROWSER_DAILY_CAP_DEFAULT;
}

/**
 * Pure: whether the rendering browser may request this address. Only http(s), and never a
 * literal private, loopback or link-local address or a local host name: the page's own scripts
 * choose what the browser loads, and the function must not become a way into its network.
 */
export function browserMayRequest(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return isPublicFeeSourceAddress(host);
  return true;
}

export type ResolveHost = (host: string) => Promise<Array<{ address: string }>>;
const resolveHost: ResolveHost = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * `browserMayRequest` plus DNS: a host name must resolve only to public addresses, so a name
 * that points inward (`127.0.0.1.nip.io`, a rebinding domain) is refused too. Answers are
 * cached per render in `seen`.
 */
export async function browserMayReach(rawUrl: string, resolve: ResolveHost, seen: Map<string, Promise<boolean>>): Promise<boolean> {
  if (!browserMayRequest(rawUrl)) return false;
  const url = new URL(rawUrl);
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":")) return true;
  let answer = seen.get(host);
  if (!answer) {
    answer = resolve(host)
      .then((addresses) => addresses.length > 0 && addresses.every((entry) => isPublicFeeSourceAddress(entry.address)))
      .catch(() => false);
    seen.set(host, answer);
  }
  return answer;
}

/** Resource types the fee table never needs; skipping them keeps a render short and cheap. */
const SKIPPED_RESOURCES = new Set(["image", "media", "font"]);

export type RouteHandler = (route: { request(): { url(): string; resourceType(): string }; abort(): Promise<void>; continue(): Promise<void> }) => Promise<void>;

interface BrowserPage {
  route(pattern: string, handler: RouteHandler): Promise<void>;
  /** Every request, redirect hops included (`page.route` sees only the first hop). */
  on(event: "request", listener: (request: { url(): string }) => void): void;
  routeWebSocket?(pattern: RegExp, handler: (socket: { close(): Promise<void> | void }) => void): Promise<void>;
  goto(url: string, options: { waitUntil: "domcontentloaded" | "load" | "networkidle"; timeout: number }): Promise<{ status(): number; url(): string; headers(): Record<string, string>; body(): Promise<Buffer> } | null>;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  content(): Promise<string>;
  url(): string;
}

interface Browser {
  newContext(options: { userAgent: string; javaScriptEnabled: boolean; acceptDownloads: boolean; serviceWorkers: "block" }): Promise<{ newPage(): Promise<BrowserPage>; close(): Promise<void> }>;
  close(): Promise<void>;
}

export type LaunchBrowser = () => Promise<Browser>;

/** Slim Chromium for Vercel functions; loaded only when a render runs. */
export const launchSlimChromium: LaunchBrowser = async () => {
  const [{ default: chromium }, { chromium: playwright }] = await Promise.all([import("@sparticuz/chromium"), import("playwright-core")]);
  return (await playwright.launch({
    // No WebRTC: its UDP traffic never passes `page.route`.
    args: [...chromium.args, "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--webrtc-ip-handling-policy=disable_non_proxied_udp"],
    executablePath: await chromium.executablePath(),
    headless: true,
  })) as unknown as Browser;
};

/**
 * Opens closed sections whose label names fees or disclosures: `<details>`, buttons and
 * `[aria-expanded="false"]` headers. Runs in the page; returns how many it opened.
 */
function expandFeeSections(args: { pattern: string; max: number }): number {
  const label = new RegExp(args.pattern, "i");
  let opened = 0;
  const doc = (globalThis as unknown as { document: { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null; tagName: string; open?: boolean; click(): void }> } }).document;
  const items = Array.from(doc.querySelectorAll('details:not([open]) > summary, [aria-expanded="false"], button'));
  for (const item of items) {
    if (opened >= args.max) break;
    const text = (item.textContent ?? "").trim();
    if (!text || text.length > 120 || !label.test(text)) continue;
    item.click();
    opened += 1;
  }
  return opened;
}

/**
 * Renders one address and answers like a fetch: the rendered HTML (or a PDF the address
 * served) with the response's status. A failure to start the browser or load the page throws,
 * so `fetchAndRecordLink` records it as a network failure.
 */
export async function renderedResponse(url: string, launch: LaunchBrowser = launchSlimChromium, resolve: ResolveHost = resolveHost): Promise<Response> {
  const seen = new Map<string, Promise<boolean>>();
  const refused = () => new Response("address refused", { status: 400, statusText: "browser refused address" });
  if (!(await browserMayReach(url, resolve, seen))) return refused();
  const browser = await launch();
  try {
    const context = await browser.newContext({ userAgent: crawlerUserAgent("Magellan"), javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (SKIPPED_RESOURCES.has(request.resourceType()) || !(await browserMayReach(request.url(), resolve, seen))) await route.abort();
        else await route.continue();
      });
      // Redirect hops skip `page.route`; any hop that points inward throws the render away.
      const hops: Promise<boolean>[] = [];
      page.on("request", (request) => {
        hops.push(browserMayReach(request.url(), resolve, seen));
      });
      await page.routeWebSocket?.(/.*/, (socket) => void socket.close());
      const reachedOnlyPublic = async () => (await Promise.all(hops)).every(Boolean) && (await browserMayReach(page.url(), resolve, seen));
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      if (!(await reachedOnlyPublic())) return refused();
      const status = response?.status() ?? 0;
      const contentType = response?.headers()["content-type"] ?? "";
      // The address served a document, not a page: keep its bytes as the fetcher would.
      if (response && /pdf|octet-stream/i.test(contentType)) {
        return new Response(new Uint8Array(await response.body()), { status, headers: { "content-type": contentType } });
      }
      await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
      const expanded = await page.evaluate(expandFeeSections, { pattern: EXPAND_LABEL.source, max: MAX_EXPANDS }).catch(() => 0);
      if (expanded > 0) await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);
      const html = await page.content();
      if (!(await reachedOnlyPublic())) return refused();
      if (Buffer.byteLength(html) > MAX_HTML_BYTES) return new Response("rendered page too large", { status: 413, statusText: "rendered page too large" });
      return new Response(html, {
        status: status || 200,
        statusText: `rendered${expanded > 0 ? `, ${expanded} sections opened` : ""}`,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export interface BrowserFetchRow extends FetchCandidateRow {
  website_url: string | null;
}

/**
 * Banks whose current main document Rosetta read as a JavaScript page (`js_required`), on
 * the bank's own site, not rendered in the last `BROWSER_RETRY_DAYS`. Largest first.
 */
export async function selectScriptBuiltLinks(db: SqlTag, limit: number): Promise<BrowserFetchRow[]> {
  if (limit <= 0) return [];
  const rows = await db<BrowserFetchRow[]>`
    SELECT inst.id,
           inst.institution_name,
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
       AND COALESCE(btrim(COALESCE(profile.canonical_source_url, inst.fee_schedule_url)), '') <> ''
       AND COALESCE(profile.read_strategy, '') <> 'manual_review'
       AND EXISTS (
         SELECT 1
           FROM source_documents doc
           JOIN pipeline_attempts readout ON readout.source_document_id = doc.id
          WHERE doc.institution_id = inst.id
            AND doc.status = 'success'
            AND doc.duplicate_of_id IS NULL
            AND doc.superseded_by_id IS NULL
            AND doc.companion_source_id IS NULL
            AND readout.stage = 'read'
            AND readout.outcome = 'js_required'
       )
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.institution_id = inst.id
            AND pa.stage = 'fetch'
            AND pa.strategy = ${BROWSER_FETCH_STRATEGY.strategy}
            AND pa.created_at > NOW() - make_interval(days => ${BROWSER_RETRY_DAYS}::int)
       )
     ORDER BY inst.asset_size DESC NULLS LAST, inst.id ASC
     LIMIT ${limit * 4}
  `;
  return rows
    .filter((row) => row.website_url && onBankDomain((row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim(), row.website_url))
    .slice(0, limit);
}

/** Renders started today (UTC), from the attempt log: the daily cap holds across steps and lanes. */
export async function rendersToday(db: SqlTag): Promise<number> {
  const [row] = await db<Array<{ count: number | string }>>`
    SELECT COUNT(*) AS count FROM pipeline_attempts
     WHERE stage = 'fetch' AND strategy = ${BROWSER_FETCH_STRATEGY.strategy}
       AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  `;
  return Number(row?.count ?? 0);
}

export interface BrowserFetchResult {
  enabled: boolean;
  dailyCap: number;
  renderedToday: number;
  selected: number;
  stored: number;
  failed: number;
  results: Array<{ institution_id: number; outcome: string; url: string; reason: string | null }>;
}

export async function runBrowserFetch(options: {
  runId: number;
  stepId?: number | null;
  db?: SqlTag;
  limit?: number;
  launch?: LaunchBrowser;
  vault?: DocumentVault;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
}): Promise<BrowserFetchResult> {
  const db = options.db ?? sql;
  const env = options.env ?? process.env;
  const dailyCap = browserDailyCap(env);
  const result: BrowserFetchResult = { enabled: browserFetchEnabled(env), dailyCap, renderedToday: 0, selected: 0, stored: 0, failed: 0, results: [] };
  if (!result.enabled || !(await learningSchemaReady(db))) return result;
  result.renderedToday = await rendersToday(db);
  const room = Math.max(0, Math.min(options.limit ?? BROWSER_RENDERS_PER_STEP, BROWSER_RENDERS_PER_STEP, dailyCap - result.renderedToday));
  const rows = await selectScriptBuiltLinks(db, room);
  result.selected = rows.length;
  if (options.dryRun || rows.length === 0) return result;

  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;
  for (const [index, row] of rows.entries()) {
    // Another lane may have rendered since the count above: re-count before each later render.
    if (index > 0 && (await rendersToday(db)) >= dailyCap) break;
    const url = (row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim();
    let note: string | null = null;
    const fetched = await fetchAndRecordLink(db, row, async () => {
      const response = await renderedResponse(url, options.launch);
      note = response.statusText || null;
      return response;
    }, {
      learning: true,
      vaultSchema,
      vault,
      vaultOn,
      dryRun: false,
      runId: options.runId,
      stepId: options.stepId ?? null,
      strategy: BROWSER_FETCH_STRATEGY,
      costMicrousd: 0,
      note: "browser render",
    });
    const stored = fetched.result.outcome === "success" || fetched.result.outcome === "unchanged";
    if (stored) result.stored += 1;
    else result.failed += 1;
    result.results.push({
      institution_id: Number(row.id),
      outcome: fetched.result.attemptOutcome ?? fetched.result.outcome,
      url,
      reason: [fetched.result.reason, note].filter(Boolean).join("; ") || null,
    });
  }
  return result;
}
