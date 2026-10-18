import type { sql } from "@/lib/data-store/connection";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { detectFormat } from "@/lib/agents/learning/format";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";

import { fetchWithTimeout, looksLikePdfUrl } from "./find-validate";
import { fetchAndRecordLink, MAGELLAN_FETCH_STRATEGY, MAX_DOCUMENT_BYTES, redirectedToHomepage, type FetchCandidateRow } from "./fetch";
import { isErrorPageLink, onBankDomain } from "./link-coverage";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * A free second route for a known fee link that keeps failing to fetch (#1051). State
 * Department FCU's schedule, https://www.sdfcu.org/.../fees.pdf, failed with a network error
 * on every plain fetch from 3 Oct 2026, while the bank's stored website is
 * http://www.sdfcu.org; Great Oaks Bank's link is on greatoaks.bank and its website on
 * www.greatoaks.bank; Citizens State Bank's link is on a staging host. A new search would
 * only find the same link again. Instead the same address is asked for at the bank's other
 * spellings of it: the website's own host and scheme, the host with or without "www.", and
 * plain http. Each is a normal GET with Magellan's crawler identity (no provider, no budget).
 * The first spelling that answers with the document is stored through the normal fetch path
 * (`fetchAndRecordLink`), which makes it the link the plain fetch uses from then on.
 * Spellings that fail change nothing on the bank: one attempt row records what was tried.
 *
 * A spelling counts only when the whole answer is in hand and is the document (#1306): the
 * final address after redirects is still on the bank's domain, the body was read in full,
 * and a PDF link answered with a PDF (a parked domain or catch-all page answers 200 HTML).
 * Anything else is a failed spelling, so the bank's fetch address and failure count stay as
 * the plain fetch left them. So is a body past the 15 MB document cap (`too_large`), cut off
 * while it is read.
 */
export const ADDRESS_VARIANT_FETCH_STRATEGY = { strategy: "fetch.address_variant", version: 1 } as const;

/** Banks tried per fetch step. */
export const ADDRESS_VARIANT_BANKS_PER_STEP = 3;
/** Spellings tried per bank. */
export const MAX_ADDRESS_VARIANTS = 3;
/** Plain fetch failures in a row before another route is tried (as for the paid fetch). */
export const ADDRESS_VARIANT_MIN_FAILURES = 2;
/** A bank is tried at most once per this many days. */
export const ADDRESS_VARIANT_RETRY_DAYS = 7;
/** Per request: a host that answers at all answers well inside this. */
const VARIANT_REQUEST_TIMEOUT_MS = 10_000;
/** Less time than this left in the pass starts no further spelling: a timer can fire a
 * millisecond before `Date.now()` reaches the deadline, which left a request with 1 ms to run. */
const VARIANT_MIN_REQUEST_MS = 10;
/** The whole pass, so the fetch step's companion pages still get their time. Requests and
 * body reads are cut at this deadline, not only refused a start after it. */
export const ADDRESS_VARIANT_BUDGET_MS = 30_000;
/**
 * The plain fetch outcomes another spelling can fix: the host does not answer (DNS, TLS,
 * refused connection), hangs, or errors. A 403 is a bot wall on every spelling (the paid
 * fetch's case); a 404 or 410 sends the link back to discovery.
 */
const UNREACHABLE_OUTCOMES = ["network_error", "timeout", "http_5xx"] as const;

export interface AddressVariantRow extends FetchCandidateRow {
  website_url: string | null;
  last_plain_outcome: string | null;
}

export interface AddressVariantTry {
  url: string;
  kind: AddressVariantKind;
  verdict: string;
}

export interface AddressVariantResult {
  institutionId: number;
  link: string;
  outcome: AttemptOutcome;
  /** The spelling that answered, when one did. */
  url: string | null;
  tries: AddressVariantTry[];
}

export interface RunAddressVariantFetchResult {
  selected: number;
  tried: number;
  /** Banks whose document was stored (or matched the stored copy) from another spelling. */
  recovered: number;
  failed: number;
  results: AddressVariantResult[];
}

export type AddressVariantKind = "website_host" | "www_toggle" | "plain_http";

function parseHttp(value: string | null | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      continue;
    }
  }
  return null;
}

function toggleWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

/**
 * The other spellings of a fee link on the bank's own site, best first, never the link
 * itself: the same path and query on the website's host and scheme, on the link's host with
 * or without "www.", then over plain http. Only the bank's own domains (the link's host and
 * the stored website's), so nothing is asked of another site.
 */
export function addressVariants(link: string, website: string | null): Array<{ url: string; kind: AddressVariantKind }> {
  const original = parseHttp(link);
  if (!original) return [];
  original.hash = "";
  const site = parseHttp(website);
  const seen = new Set([original.toString()]);
  const variants: Array<{ url: string; kind: AddressVariantKind }> = [];
  const add = (protocol: string, host: string, kind: AddressVariantKind) => {
    const next = new URL(original.toString());
    next.protocol = protocol;
    next.host = host;
    const url = next.toString();
    if (seen.has(url)) return;
    seen.add(url);
    variants.push({ url, kind });
  };
  if (site) add(site.protocol, site.host, "website_host");
  add(original.protocol, toggleWww(original.host), "www_toggle");
  if (original.protocol === "https:") add("http:", original.host, "plain_http");
  return variants.slice(0, MAX_ADDRESS_VARIANTS);
}

/**
 * Banks whose fee link's latest plain fetch could not reach the page (network error,
 * timeout, server error) at least ADDRESS_VARIANT_MIN_FAILURES times in a row, not tried by
 * this route lately. Banks with no live fees go first, then the largest. A person's locked
 * correction is left alone: storing another spelling would not change the link fetched.
 */
export async function selectUnreachableLinks(
  db: SqlTag,
  limit: number,
  institutionId: number | null = null,
): Promise<AddressVariantRow[]> {
  if (limit <= 0) return [];
  const rows = await db<AddressVariantRow[]>`
    -- fee links the plain fetch cannot reach
    SELECT * FROM (
      SELECT inst.id,
             inst.institution_name,
             inst.website_url,
             inst.fee_schedule_url,
             inst.asset_size,
             inst.last_crawl_at,
             inst.consecutive_failures,
             profile.canonical_source_url AS profile_canonical_source_url,
             profile.last_source_hash AS profile_last_source_hash,
             profile.last_successful_source_document_id AS profile_last_document_id,
             (
               SELECT plain.outcome FROM pipeline_attempts plain
                WHERE plain.institution_id = inst.id
                  AND plain.stage = 'fetch'
                  AND plain.strategy = ${MAGELLAN_FETCH_STRATEGY.strategy}
                ORDER BY plain.id DESC
                LIMIT 1
             ) AS last_plain_outcome,
             EXISTS (SELECT 1 FROM published_fee_catalog live WHERE live.institution_id = inst.id) AS has_live_fees
        FROM institution_sources inst
        LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND (${institutionId}::bigint IS NULL OR inst.id = ${institutionId}::bigint)
         AND inst.failure_reason LIKE 'magellan_fetch_%'
         AND COALESCE(inst.consecutive_failures, 0) >= ${ADDRESS_VARIANT_MIN_FAILURES}
         AND COALESCE(btrim(COALESCE(profile.canonical_source_url, inst.fee_schedule_url)), '') <> ''
         AND COALESCE(profile.source_kind, 'unknown') <> 'offline'
         AND COALESCE(profile.read_strategy, '') <> 'manual_review'
         AND profile.locked_by_correction IS NOT TRUE
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts tried
            WHERE tried.institution_id = inst.id
              AND tried.stage = 'fetch'
              AND tried.strategy = ${ADDRESS_VARIANT_FETCH_STRATEGY.strategy}
              AND tried.strategy_version = ${ADDRESS_VARIANT_FETCH_STRATEGY.version}
              AND tried.created_at > NOW() - make_interval(days => ${ADDRESS_VARIANT_RETRY_DAYS}::int)
         )
    ) due
     WHERE due.last_plain_outcome = ANY(${[...UNREACHABLE_OUTCOMES]}::text[])
     ORDER BY due.has_live_fees ASC, due.asset_size DESC NULLS LAST, due.id ASC
     LIMIT ${limit * 4}
  `;
  return rows
    .filter((row) => {
      const link = (row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim();
      // Another site's page is a wrong link, not an unreachable one: discovery's job.
      return Boolean(row.website_url) && onBankDomain(link, row.website_url ?? "");
    })
    .slice(0, limit);
}

export async function runAddressVariantFetch(options: {
  db: SqlTag;
  fetchImpl: Fetcher;
  runId: number;
  stepId?: number | null;
  institutionId?: number | null;
  limit?: number;
  vault?: DocumentVault;
  /** Stop starting new requests after this time (ms since epoch). */
  deadline?: number;
}): Promise<RunAddressVariantFetchResult> {
  const { db } = options;
  const deadline = options.deadline ?? Date.now() + ADDRESS_VARIANT_BUDGET_MS;
  const result: RunAddressVariantFetchResult = { selected: 0, tried: 0, recovered: 0, failed: 0, results: [] };
  // Without the attempt log nothing would show what was tried, or stop a retry tomorrow.
  if (!(await learningSchemaReady(db))) return result;
  const rows = await selectUnreachableLinks(db, options.limit ?? ADDRESS_VARIANT_BANKS_PER_STEP, options.institutionId ?? null);
  result.selected = rows.length;
  if (rows.length === 0) return result;
  const vaultSchema = await documentVaultSchemaReady(db);
  const vault = options.vault ?? getDocumentVault();
  const vaultOn = vaultSchema && vault.configured;

  for (const row of rows) {
    if (Date.now() > deadline) break;
    const institutionId = Number(row.id);
    const link = (row.profile_canonical_source_url ?? row.fee_schedule_url ?? "").trim();
    const startedAt = Date.now();
    const tries: AddressVariantTry[] = [];
    let answered: { url: string; kind: AddressVariantKind; response: Response } | null = null;
    let lastOutcome: AttemptOutcome = "network_error";

    for (const variant of addressVariants(link, row.website_url)) {
      const remaining = deadline - Date.now();
      if (remaining < VARIANT_MIN_REQUEST_MS) break;
      const entry: AddressVariantTry = { url: variant.url, kind: variant.kind, verdict: "" };
      tries.push(entry);
      const checked = await checkVariant(options.fetchImpl, variant.url, link, row.website_url ?? "", Math.min(VARIANT_REQUEST_TIMEOUT_MS, remaining));
      entry.verdict = checked.verdict;
      if (!checked.response) {
        lastOutcome = checked.outcome;
        continue;
      }
      answered = { url: variant.url, kind: variant.kind, response: checked.response };
      break;
    }
    if (tries.length === 0) continue;
    result.tried += 1;

    if (answered) {
      const { response } = answered;
      const fetched = await fetchAndRecordLink(db, { ...row, profile_canonical_source_url: answered.url }, async () => response, {
        learning: true,
        vaultSchema,
        vault,
        vaultOn,
        dryRun: false,
        runId: options.runId,
        stepId: options.stepId ?? null,
        strategy: ADDRESS_VARIANT_FETCH_STRATEGY,
        note: `${answered.kind} spelling of ${link} (plain fetch: ${row.last_plain_outcome ?? "unknown"}); tried ${tries.map((entry) => `${entry.url} ${entry.verdict}`).join(", ")}`,
      });
      const stored = fetched.result.outcome === "success" || fetched.result.outcome === "unchanged";
      if (stored) result.recovered += 1;
      else result.failed += 1;
      result.results.push({ institutionId, link, outcome: fetched.result.attemptOutcome ?? "network_error", url: answered.url, tries });
      continue;
    }

    // Nothing answered: the bank's fetch state is left as the plain fetch set it.
    result.failed += 1;
    result.results.push({ institutionId, link, outcome: lastOutcome, url: null, tries });
    await recordAttempt(db, {
      institutionId,
      stage: "fetch",
      strategy: ADDRESS_VARIANT_FETCH_STRATEGY.strategy,
      version: ADDRESS_VARIANT_FETCH_STRATEGY.version,
      fingerprint: link,
      outcome: lastOutcome,
      yieldCount: 0,
      costMicrousd: 0,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: { url: link, plain_outcome: row.last_plain_outcome, tries },
      foldIntoPlaybook: false,
    });
  }
  return result;
}

type VariantCheck =
  | { response: Response; verdict: string }
  | { response: null; verdict: string; outcome: AttemptOutcome };

/** The whole body, or word that it passed the cap (the stream is cancelled then). */
type CappedRead = { bytes: Uint8Array<ArrayBuffer> } | { tooLarge: true };

/**
 * Reads the body up to `maxBytes`. Past the cap it stops and cancels the stream; when
 * `signal` aborts (the request's time is up) the pending read is cancelled and this throws.
 */
async function readCapped(response: Response, maxBytes: number, signal: AbortSignal): Promise<CappedRead> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0) };
  const stop = () => void reader.cancel(signal.reason).catch(() => undefined);
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Body read timed out");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

/**
 * Asks one spelling for the document and returns it only when it is the document: a 2xx on
 * the bank's own domain, not the homepage or an error page, a body read in full within the
 * time and the 15 MB document cap, and a PDF for a PDF link. The body is read here and
 * handed on as a fresh response, so the normal fetch path never sees a read that failed, or
 * a body too large to store, after the spelling answered. One timer bounds headers and body:
 * when it fires, or the body passes the cap, the request is aborted, so the download stops.
 */
async function checkVariant(fetchImpl: Fetcher, url: string, link: string, website: string, timeoutMs: number): Promise<VariantCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Body read timed out")), timeoutMs);
  try {
    return await checkVariantWithin(fetchImpl, url, link, website, timeoutMs, controller.signal);
  } finally {
    clearTimeout(timer);
    // Nothing more is read from this request: the body was copied, refused or cut off.
    controller.abort();
  }
}

async function checkVariantWithin(fetchImpl: Fetcher, url: string, link: string, website: string, timeoutMs: number, signal: AbortSignal): Promise<VariantCheck> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, timeoutMs, signal);
  } catch (error) {
    const outcome = classifyFetchFailure(null, error);
    return { response: null, verdict: outcome, outcome };
  }
  const finalUrl = response.url || url;
  const refuse = async (verdict: string, outcome: AttemptOutcome): Promise<VariantCheck> => {
    await response.body?.cancel().catch(() => undefined);
    return { response: null, verdict, outcome };
  };
  if (!response.ok) return refuse(`http_${response.status}`, classifyFetchFailure(response.status));
  // Another spelling that lands on the homepage or an error page is not the document, and
  // must never be stored as one (the normal path would clear the bank's link).
  if (redirectedToHomepage(url, finalUrl) || isErrorPageLink(finalUrl)) return refuse("redirected_away", "wrong_document");
  // A redirect to another site would make that site the bank's fetch address.
  if (!onBankDomain(finalUrl, website)) return refuse("redirected_off_domain", "wrong_document");
  // Too large to store: a failed spelling, so it never becomes the bank's fetch address.
  if (Number(response.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES) return refuse("too_large", "too_large");

  let read: CappedRead;
  try {
    read = await readCapped(response, MAX_DOCUMENT_BYTES, signal);
  } catch (error) {
    const outcome = classifyFetchFailure(null, error);
    return { response: null, verdict: `body_${outcome}`, outcome };
  }
  if ("tooLarge" in read) return { response: null, verdict: "too_large", outcome: "too_large" };
  const { bytes } = read;
  if (bytes.byteLength === 0) return { response: null, verdict: "empty_body", outcome: "wrong_document" };
  // A parked domain or catch-all page answers a .pdf link with 200 HTML.
  if (looksLikePdfUrl(link) && detectFormat(bytes, response.headers.get("content-type"), finalUrl) !== "pdf") {
    return { response: null, verdict: "not_pdf", outcome: "wrong_document" };
  }
  const copy = new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  Object.defineProperty(copy, "url", { value: finalUrl });
  return { response: copy, verdict: `http_${response.status}` };
}
