import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import {
  evaluateReferenceEligibility, type ReferenceDiscoveryEvidence, type ReferencePageObservation,
} from "@/lib/data-store/answer-key-eligibility";
import {
  persistReferenceReceipt, readReferenceEligibility, type ReferenceEligibilitySnapshot, type ReferenceInput,
} from "@/lib/data-store/answer-key-reference-store";
import { createFeeSourceFetch } from "./fee-source-fetch";
import { crawlerUserAgent } from "./crawler-identity";
import { feeCandidates, hubPages, pageLinks, sameSite } from "./magellan/finders";
import { isBusinessOnlyLink } from "./magellan/link-coverage";
import { mainContentText } from "./magellan/find-validate";
import { effectiveDate } from "./hamilton/schedule-edition";
import { extractPdfDocumentText } from "./rosetta/pdf-document-text";

export const REFERENCE_CHECK_BUDGET_MS = 120_000;
const MAX_PAGES = 6;
const REQUEST_MS = 8_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;
const safeFetch = createFeeSourceFetch({ timeoutMs: REQUEST_MS, maxBytes: MAX_BYTES });
type SqlTag = typeof sql;
type Fetcher = typeof fetch;
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const urlKey = (value: string) => { const url = new URL(value); url.hash = ""; return url.href; };

/** Bound even injected transports/parsers that fail to settle after cancellation. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let onAbort: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Reference operation cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function observeReferenceDocument(input: ReferenceInput, options: {
  signal: AbortSignal; fetchImpl?: Fetcher; now?: () => Date;
  pdfText?: typeof extractPdfDocumentText;
}): Promise<{ pages: ReferencePageObservation[]; discovery: ReferenceDiscoveryEvidence }> {
  const { key } = input;
  const fetchImpl = options.fetchImpl ?? safeFetch;
  const now = options.now ?? (() => new Date());
  const pdfText = options.pdfText ?? extractPdfDocumentText;
  const pages: ReferencePageObservation[] = [];
  const discovery: ReferenceDiscoveryEvidence = { entryUrls: [], examinedUrls: [], candidateUrls: [],
    completeWithinProtocol: true, linkedFromOfficialSite: false, limitReason: null };
  const incomplete = (reason: string) => { discovery.completeWithinProtocol = false; discovery.limitReason ??= reason; };
  let website: URL, target: string;
  try { website = new URL(key.websiteUrl ?? ""); target = urlKey(key.documentUrl); }
  catch { incomplete("invalid_reference_url"); return { pages, discovery }; }
  discovery.entryUrls.push(website.href);
  // A hub is navigation that may lead to a schedule; every other entry could be one.
  const queue: Array<{ url: string; official: boolean; hub: boolean }> = [
    { url: website.href, official: true, hub: false }, { url: target, official: false, hub: false }];
  const seen = new Set<string>();
  const officialPaths = new Set<string>([urlKey(website.href)]);
  while (queue.length > 0 && pages.length < MAX_PAGES && !options.signal.aborted) {
    // Fee-schedule-like links are observed before navigation hubs within the page cap.
    const nextIndex = queue.findIndex((item) => !item.hub);
    const next = queue.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0];
    const requested = urlKey(next.url);
    if (seen.has(requested)) continue;
    seen.add(requested);
    discovery.examinedUrls.push(requested);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Reference request timed out")), REQUEST_MS);
    const signal = AbortSignal.any([options.signal, controller.signal]);
    try {
      const response = await abortable(fetchImpl(requested, { signal, headers: { "User-Agent": crawlerUserAgent("Magellan"), Accept: "text/html,application/pdf,text/plain" } }), signal);
      if (signal.aborted) throw signal.reason;
      const bytes = new Uint8Array(await abortable(response.arrayBuffer(), signal));
      if (signal.aborted || bytes.length > MAX_BYTES) throw new Error("Reference response incomplete");
      const finalUrl = urlKey(response.url || requested);
      const contentType = response.headers.get("content-type");
      const isPdf = Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-";
      const raw = isPdf ? null : new TextDecoder().decode(bytes);
      const isHtml = !isPdf && (/html/i.test(contentType ?? "") || /^\s*<!doctype html|^\s*<html\b/i.test(raw ?? ""));
      let text = "";
      if (response.status === 200) {
        if (isPdf) text = (await abortable(pdfText(bytes, { signal, timeoutMs: REQUEST_MS, maxPages: 30, maxTextChars: MAX_TEXT_CHARS, maxItems: 100_000 }), signal)).text;
        else if (isHtml) text = mainContentText(raw!);
        else if (/^text\/plain\b/i.test(contentType ?? "")) text = raw!;
        else incomplete("unsupported_reference_type");
      } else incomplete("reference_http_failure");
      if (text.length > MAX_TEXT_CHARS) { text = ""; incomplete("text_limit"); }
      if (signal.aborted) throw signal.reason;
      const links = isHtml ? pageLinks(raw!, new URL(finalUrl)) : [];
      // pageLinks deliberately caps at160: reaching that cap cannot attest an exhaustive pass.
      if (links.length >= 160) incomplete("link_limit");
      const source = input.sources.find((row) => row.documentUrl === requested && row.contentHash === digest(bytes));
      const observation: ReferencePageObservation = {
        requestedUrl: requested, finalUrl, contentHash: digest(bytes), contentType: contentType?.slice(0, 500) ?? null,
        etag: response.headers.get("etag")?.slice(0, 500) ?? null,
        lastModified: response.headers.get("last-modified")?.slice(0, 500) ?? null,
        checkedAt: now().toISOString(), effectiveDate: effectiveDate(text), sourceDocumentId: source?.id ?? null,
        sourceTextId: source?.textId ?? null, textHash: digest(text), status: response.status, text,
        links: links.map((link) => link.url),
      };
      pages.push(observation);
      const fromOfficial = next.official || officialPaths.has(requested);
      if (fromOfficial) officialPaths.add(finalUrl);
      const candidates = feeCandidates(links, "homepage_link", finalUrl).filter((candidate) => !isBusinessOnlyLink(candidate.url));
      for (const candidate of candidates) {
        if (!discovery.candidateUrls.includes(candidate.url)) discovery.candidateUrls.push(candidate.url);
        if (fromOfficial) officialPaths.add(candidate.url);
        if (!seen.has(candidate.url)) queue.push({ url: candidate.url, official: fromOfficial, hub: false });
      }
      // Same-site hubs are observed when the page cap allows. A hub left unvisited is not
      // evidence of a newer schedule (#2466); a fee-schedule-like link left unvisited is.
      // No guessed paths or provider search is used.
      for (const hub of hubPages(links, website, seen, 160)) {
        if (!seen.has(hub.url)) queue.push({ url: hub.url, official: fromOfficial && sameSite(new URL(finalUrl), website), hub: true });
      }
      if (fromOfficial && (requested === target || finalUrl === target)) discovery.linkedFromOfficialSite = true;
      if (officialPaths.has(target)) discovery.linkedFromOfficialSite = true;
    } catch {
      incomplete(signal.aborted ? "reference_timeout_or_cancelled" : "reference_fetch_or_parse_failed");
      pages.push({ requestedUrl: requested, finalUrl: requested, contentHash: digest(""), contentType: null,
        etag: null, lastModified: null, checkedAt: now().toISOString(), effectiveDate: null,
        sourceDocumentId: null, sourceTextId: null, textHash: null, status: 0, text: "", links: [] });
    } finally { clearTimeout(timer); }
  }
  const skippedHubs = new Set(queue.filter((item) => item.hub && !seen.has(urlKey(item.url))).map((item) => urlKey(item.url)));
  discovery.skippedHubCount = skippedHubs.size;
  if (queue.some((item) => !item.hub && !seen.has(urlKey(item.url)))) incomplete(options.signal.aborted ? "total_budget" : "page_limit");
  if (options.signal.aborted) incomplete("total_budget");
  discovery.candidateUrls = [...new Set(discovery.candidateUrls)];
  if (discovery.candidateUrls.length > 160) { discovery.candidateUrls = discovery.candidateUrls.slice(0, 160); incomplete("candidate_limit"); }
  return { pages, discovery };
}

/** Observe under the existing score run only; every other consumer is read-only. */
export async function refreshReferenceEligibility(options: {
  db: SqlTag; runId: number | null; stepId: number | null; dryRun: boolean;
  snapshot: ReferenceEligibilitySnapshot; fetchImpl?: Fetcher; budgetMs?: number; now?: () => Date;
}): Promise<{ snapshot: ReferenceEligibilitySnapshot; attempted: number; persisted: number; failed: number }> {
  const result = { snapshot: options.snapshot, attempted: 0, persisted: 0, failed: 0 };
  if (options.dryRun || !options.runId || !options.stepId || options.snapshot.readError) return result;
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Reference-check total budget")), Math.min(REFERENCE_CHECK_BUDGET_MS, options.budgetMs ?? REFERENCE_CHECK_BUDGET_MS));
  const queue = [...options.snapshot.keys].sort((a, b) =>
    Date.parse(a.receipt?.checkedAt ?? "1970-01-01") - Date.parse(b.receipt?.checkedAt ?? "1970-01-01") || a.input.key.answerKeyId - b.input.key.answerKeyId);
  try {
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length > 0 && !controller.signal.aborted) {
        const decision = queue.shift()!;
        // A current durable pass/fail is reused for its stated window; unknowns rotate
        // by last attempt, not by institution id. Identity changes never hit this cache.
        if (decision.status !== "unknown" && decision.receipt) continue;
        result.attempted += 1;
        const asOf = now().toISOString();
        const observed = await observeReferenceDocument(decision.input, { signal: controller.signal, fetchImpl: options.fetchImpl, now });
        const receipt = evaluateReferenceEligibility({ key: decision.input.key, sources: decision.input.sources, ...observed, asOf });
        try {
          const id = await persistReferenceReceipt(options.db, decision.input, receipt, options.runId!, options.stepId!);
          if (id) result.persisted += 1;
          else result.failed += 1;
        } catch { result.failed += 1; }
      }
    }));
  } finally { clearTimeout(timer); }
  result.snapshot = await readReferenceEligibility(options.db, now());
  return result;
}
