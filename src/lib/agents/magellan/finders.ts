import { htmlToScoringText, scoreFeePage } from "@/lib/agents/learning/fee-page";
import { classifyPage, type PageClassifier } from "@/lib/agents/magellan/page-classifier";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { classifyFetchFailure } from "@/lib/agents/learning/outcomes";

import {
  fetchWithTimeout,
  looksLikePdfUrl,
  validateFeeCandidate,
  type CandidateValidation,
  type FeeCandidate,
} from "./find-validate";
import { isSitemapIndex, robotsAllows, robotsDisallows, robotsSitemaps, sitemapLocations } from "./site-signals";

/**
 * The Magellan find team: one specialist per way of finding a bank's fee schedule.
 * `discovery.ts` runs them in order for one bank and stops at the first validated hit;
 * every specialist that runs is logged as its own attempt (strategy + version).
 *
 * Pass 1 (free): known link, homepage links, site maps, hub pages, platform paths,
 * guessed paths. Pass 2 (free, heavier): peer hint, bounded same-site crawl.
 * Pass 3 (paid) is a separate step (`paid-find.ts`).
 */

type Fetcher = typeof fetch;

export const MIN_LINK_SCORE = 0.72;
const MAX_LINKS_PER_PAGE = 160;
/** Candidate documents a single specialist opens. */
const MAX_CANDIDATES_PER_FINDER = 3;
const MAX_HUB_PAGES = 4;
const MAX_CANDIDATES_PER_HUB = 2;
const MAX_GUESSED_PATHS = 4;
const MAX_PLATFORM_PATHS = 4;
const MAX_PEER_PATHS = 3;
/** Pages the bounded crawl may request in total, candidates included. */
export const CRAWL_PAGE_LIMIT = 40;
const CRAWL_MAX_DEPTH = 3;

const STRONG_LINK_PHRASES = [
  "schedule of fees",
  "fee schedule",
  "fee disclosure",
  "fee disclosures",
  "truth in savings",
  "service charges",
  "consumer fees",
  "business fees",
  "account fees",
  "rates and fees",
  "fee sheet",
  "schedule of charges",
  "schedule of service charges",
  "account fee schedule",
  "deposit account agreement",
];

const MEDIUM_LINK_PHRASES = [
  "fees",
  "disclosures",
  "documents",
  "forms",
  "terms",
  "rates",
  "personal checking",
  "business checking",
];

const NEGATIVE_LINK_PHRASES = [
  "privacy",
  "career",
  "jobs",
  "mortgage",
  "loan rates",
  "donation",
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "complaint",
  "annual report",
  "press release",
  "newsroom",
];

/** Pages that usually link to the fee schedule: worth opening to look one level deeper. */
const HUB_LINK_PHRASES = [
  "disclosure",
  "rates and fees",
  "fees",
  "documents",
  "forms",
  "resources",
  "rates",
  "account agreements",
  "legal",
  "checking",
  "accounts",
  "personal",
];

export const COMMON_PATHS = [
  "/fees",
  "/fee-schedule",
  "/fee-schedule.pdf",
  "/schedule-of-fees",
  "/schedule-of-fees.pdf",
  "/rates-and-fees",
  "/personal/fees",
  "/personal-banking/fees",
  "/personal/checking/fees",
  "/personal/disclosures",
  "/disclosures",
  "/resources/disclosures",
  "/documents/fee-schedule",
  "/wp-content/uploads/fee-schedule.pdf",
];

/** Specialist names and versions. Bump a version when that specialist changes. */
export const FINDERS = {
  rejectedPageLinks: { strategy: "discover.rejected_page_links", version: 1, pass: 1 },
  knownLink: { strategy: "discover.known_link", version: 1, pass: 1 },
  homepageLinks: { strategy: "discover.homepage_links", version: 1, pass: 1 },
  // 2: robots.txt Disallow rules respected, /sitemap_index.xml fallback, fee-named PDFs.
  sitemap: { strategy: "discover.sitemap", version: 2, pass: 1 },
  hubPages: { strategy: "discover.hub_pages", version: 1, pass: 1 },
  // 2: learned paths scored by the live fees their links produced (outcome ledger).
  platformPaths: { strategy: "discover.platform_paths", version: 2, pass: 1 },
  commonPaths: { strategy: "discover.common_paths", version: 1, pass: 1 },
  // 2: paths with live fees on the same platform nationwide, not same-state guesses.
  peerHint: { strategy: "discover.peer_hint", version: 2, pass: 2 },
  siteCrawl: { strategy: "discover.site_crawl", version: 1, pass: 2 },
} as const;

export type FinderKey = keyof typeof FINDERS;

/** The code a bank's search ends with when this specialist found the schedule. */
export const FOUND_CODES = {
  rejectedPageLinks: "found_from_rejected_page",
  knownLink: "found_known_link",
  homepageLinks: "found_homepage",
  sitemap: "found_sitemap",
  hubPages: "found_deep",
  platformPaths: "found_platform_path",
  commonPaths: "found_common_path",
  peerHint: "found_peer_hint",
  siteCrawl: "found_crawl",
} as const satisfies Record<FinderKey, string>;

export type LinkSource =
  | "rejected_page_link"
  | "known_link"
  | "homepage_link"
  | "sitemap"
  | "hub_link"
  | "platform_path"
  | "common_path"
  | "peer_hint"
  | "crawl_link"
  | "paid_web_search";

export interface LinkCandidate extends FeeCandidate {
  label: string;
  source: LinkSource;
  /** The page the link was found on (the site map URL for site map entries). */
  foundOn: string | null;
}

export interface TrailEntry {
  url: string;
  source: LinkSource | "homepage" | "robots" | "sitemap_file" | "hub_page" | "crawl_page" | "rejected_page";
  foundOn: string | null;
  label: string;
  score: number;
  verdict: string;
  /** Shadow page classifier: its probability that the page is a fee schedule (decides nothing). */
  page_p?: number;
}

export interface FoundDocument {
  url: string;
  documentType: "html" | "pdf" | null;
  confidence: number;
  reason: string;
}

export interface FinderResult {
  found: FoundDocument | null;
  trail: TrailEntry[];
  /** Requests this specialist made. */
  fetches: number;
  /** False when the specialist had nothing to work with (no known link, no platform, ...). */
  ran: boolean;
  /** True when the bank's time budget ran out inside this specialist. */
  outOfTime: boolean;
  /** Short note for the attempt log (e.g. which platform paths were tried). */
  note?: string;
}

export interface PageLink {
  url: string;
  label: string;
}

/** What the platform learner knows; injected so specialists stay testable. */
export interface PlatformKnowledge {
  platformPaths(platform: string): Promise<string[]>;
  peerPaths(platform: string, stateCode: string | null, institutionId: number): Promise<string[]>;
}

export interface SearchContext {
  institutionId: number;
  stateCode: string | null;
  site: URL;
  fetchImpl: Fetcher;
  /** URL identities already read and found not to be fee schedules: never proposed. */
  rejected: Set<string>;
  /** URL identities opened during this search. */
  tried: Set<string>;
  homepageHtml: string;
  homepageLinks: PageLink[];
  platform: string | null;
  knownUrl: string | null;
  /**
   * Pages Rosetta read and ruled out, newest first. They are never proposed again, but
   * they usually link to the real schedule ("See the Fee Sheet for details").
   */
  rejectedPages?: string[];
  deadline: number;
  politeDelayMs: number;
  knowledge: PlatformKnowledge;
  /** robots.txt text once read (null when the site has none). */
  robots?: string | null;
  /** HTML of same-site pages already opened, so the crawl does not fetch them twice. */
  pages: Map<string, string>;
  /** The learned fee-page classifier, in shadow: scores each opened candidate, decides nothing. */
  pageClassifier?: PageClassifier | null;
}

export function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameSite(a: URL, b: URL): boolean {
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

function isDocumentPath(url: URL): boolean {
  return /\.(pdf|docx?)$/i.test(url.pathname);
}

export function urlIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

/**
 * A link worth considering: on the bank's own site, or a document (PDF, Word) it links
 * to on another host (a CDN, Contentful). Off-site web pages are skipped.
 */
export function normalizeCandidateUrl(rawHref: string, baseUrl: URL): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!sameSite(url, baseUrl) && !isDocumentPath(url)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function scoreLink(
  url: string,
  label: string,
  source: LinkSource,
  foundOn: string | null = null,
): LinkCandidate {
  const lower = `${label} ${url}`.toLowerCase().replace(/[-_]+/g, " ");
  const guessed = source === "common_path" || source === "platform_path" || source === "peer_hint";
  let score = guessed ? 0.45 : 0.3;
  const reasons: string[] = [];
  for (const phrase of STRONG_LINK_PHRASES) {
    if (lower.includes(phrase)) {
      score += 0.35;
      reasons.push(phrase);
    }
  }
  for (const phrase of MEDIUM_LINK_PHRASES) {
    if (lower.includes(phrase)) {
      score += 0.12;
      reasons.push(phrase);
    }
  }
  for (const phrase of NEGATIVE_LINK_PHRASES) {
    if (lower.includes(phrase)) {
      score -= 0.35;
      reasons.push(`negative:${phrase}`);
    }
  }
  if (looksLikePdfUrl(url)) {
    score += 0.1;
    reasons.push("pdf");
  }
  return { url, label, score: Math.max(0, Math.min(score, 0.98)), source, foundOn, reasons };
}

export function pageLinks(html: string, baseUrl: URL): PageLink[] {
  const links = new Map<string, PageLink>();
  const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null && links.size < MAX_LINKS_PER_PAGE) {
    const url = normalizeCandidateUrl(match[1], baseUrl);
    if (!url || links.has(url)) continue;
    links.set(url, { url, label: cleanText(match[2]).slice(0, 140) });
  }
  return [...links.values()];
}

/** Links that look like the fee schedule itself, best first. */
export function feeCandidates(links: PageLink[], source: LinkSource, foundOn: string | null): LinkCandidate[] {
  return links
    .map((link) => scoreLink(link.url, link.label, source, foundOn))
    .filter((candidate) => candidate.score >= MIN_LINK_SCORE)
    .sort((a, b) => b.score - a.score);
}

function hubWeight(link: PageLink): number {
  const lower = `${link.label} ${new URL(link.url).pathname}`.toLowerCase().replace(/[-_/]+/g, " ");
  if (NEGATIVE_LINK_PHRASES.some((phrase) => lower.includes(phrase))) return 0;
  return HUB_LINK_PHRASES.reduce((weight, phrase, index) => weight + (lower.includes(phrase) ? HUB_LINK_PHRASES.length - index : 0), 0);
}

/** Same-site pages that usually link to the fee schedule (Disclosures, Rates & Fees, Forms). */
export function hubPages(links: PageLink[], site: URL, exclude: Set<string>, limit = MAX_HUB_PAGES): PageLink[] {
  return links
    .filter((link) => {
      const url = new URL(link.url);
      return sameSite(url, site) && !isDocumentPath(url) && !exclude.has(urlIdentity(link.url));
    })
    .map((link) => ({ link, weight: hubWeight(link) }))
    .filter(({ weight }) => weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ link }) => link);
}

function emptyResult(ran: boolean): FinderResult {
  return { found: null, trail: [], fetches: 0, ran, outOfTime: false };
}

function outOfTime(ctx: SearchContext): boolean {
  return Date.now() > ctx.deadline;
}

async function politePause(ctx: SearchContext): Promise<void> {
  if (ctx.politeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, ctx.politeDelayMs));
}

function foundFrom(candidate: LinkCandidate, validation: CandidateValidation): FoundDocument {
  return { url: candidate.url, documentType: validation.documentType, confidence: validation.confidence, reason: validation.reason };
}

/**
 * Opens candidates in order until one passes the fee-page check. Rejected and
 * already-opened URLs are skipped.
 */
async function tryCandidates(ctx: SearchContext, result: FinderResult, candidates: LinkCandidate[], limit: number): Promise<boolean> {
  let opened = 0;
  for (const candidate of candidates) {
    if (opened >= limit) break;
    const identity = urlIdentity(candidate.url);
    if (ctx.rejected.has(identity) || ctx.tried.has(identity)) continue;
    if (outOfTime(ctx)) {
      result.outOfTime = true;
      return false;
    }
    ctx.tried.add(identity);
    opened += 1;
    result.fetches += 1;
    const entry: TrailEntry = {
      url: candidate.url,
      source: candidate.source,
      foundOn: candidate.foundOn,
      label: candidate.label,
      score: Math.round(candidate.score * 100) / 100,
      verdict: "",
    };
    result.trail.push(entry);
    try {
      const validation = await validateFeeCandidate({ ...candidate, websiteUrl: ctx.site.toString() }, ctx.fetchImpl);
      entry.verdict = validation.verdict;
      if (ctx.pageClassifier && validation.scoringText) {
        entry.page_p = Math.round(classifyPage(ctx.pageClassifier, validation.scoringText, candidate.url) * 1000) / 1000;
      }
      if (validation.html && sameSite(new URL(candidate.url), ctx.site)) ctx.pages.set(identity, validation.html);
      if (validation.ok) {
        result.found = foundFrom(candidate, validation);
        return true;
      }
    } catch {
      entry.verdict = "fetch_failed";
    }
  }
  return false;
}

/** A same-site HTML page, through the page cache. Null when it is not HTML or fails. */
async function openPage(
  ctx: SearchContext,
  result: FinderResult,
  url: string,
  entry: TrailEntry,
): Promise<string | null> {
  const identity = urlIdentity(url);
  const cached = ctx.pages.get(identity);
  if (cached != null) {
    entry.verdict = "cached";
    return cached;
  }
  result.fetches += 1;
  ctx.tried.add(identity);
  try {
    const response = await fetchWithTimeout(ctx.fetchImpl, url);
    entry.verdict = `http_${response.status}`;
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return null;
    const html = await response.text();
    ctx.pages.set(identity, html);
    return html;
  } catch {
    entry.verdict = "fetch_failed";
    return null;
  }
}

/** A page that itself lists fees (not a hub that merely links to them). */
function pageIsFeeSchedule(html: string): boolean {
  const page = scoreFeePage(htmlToScoringText(html));
  return page.verdict === "fee_page" && !(page.rateTerms >= 4 && page.feeLines < 4);
}

function pathCandidates(ctx: SearchContext, paths: string[], source: LinkSource): LinkCandidate[] {
  const seen = new Set<string>();
  const candidates: LinkCandidate[] = [];
  for (const path of paths) {
    let url: string;
    try {
      url = new URL(path, ctx.site.origin).toString();
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push(scoreLink(url, path, source, source));
  }
  return candidates;
}

// --- Pass 1 ------------------------------------------------------------------------

const MAX_REJECTED_PAGES = 2;
const FEE_LINK_WORD = /\b(fees?|charges?|pricing)\b/;

/**
 * Fee links on a page the bank itself presents as being about fees: any link naming a
 * fee is worth opening, so it gets a boost the homepage's links do not.
 */
export function rejectedPageCandidates(links: PageLink[], foundOn: string): LinkCandidate[] {
  return links
    .filter((link) => FEE_LINK_WORD.test(`${link.label} ${link.url}`.toLowerCase().replace(/[-_/.]+/g, " ")))
    .map((link) => {
      const scored = scoreLink(link.url, link.label, "rejected_page_link", foundOn);
      return { ...scored, score: Math.min(0.98, scored.score + 0.3) };
    })
    .filter((candidate) => candidate.score >= MIN_LINK_SCORE)
    .sort((a, b) => b.score - a.score);
}

/**
 * The pages Rosetta ruled out (a marketing "no fees" page, an account overview) often
 * link to the real fee schedule, sometimes a PDF on a CDN. Runs before the homepage is
 * read, so a bank whose homepage blocks bots can still be found.
 */
export async function findFromRejectedPages(ctx: SearchContext): Promise<FinderResult> {
  // A rejected PDF has no links to follow.
  const pages = (ctx.rejectedPages ?? []).filter((url) => !looksLikePdfUrl(url)).slice(0, MAX_REJECTED_PAGES);
  if (pages.length === 0) return emptyResult(false);
  const result = emptyResult(true);
  for (const pageUrl of pages) {
    if (outOfTime(ctx)) {
      result.outOfTime = true;
      return result;
    }
    const entry: TrailEntry = { url: pageUrl, source: "rejected_page", foundOn: null, label: "", score: 0, verdict: "" };
    result.trail.push(entry);
    const html = await openPage(ctx, result, pageUrl, entry);
    if (!html) continue;
    let base: URL;
    try {
      base = new URL(pageUrl);
    } catch {
      continue;
    }
    if (await tryCandidates(ctx, result, rejectedPageCandidates(pageLinks(html, base), pageUrl), MAX_CANDIDATES_PER_FINDER)) return result;
    await politePause(ctx);
  }
  return result;
}

/** The link this bank had before (not a person's locked correction): is it still there? */
export async function findKnownLink(ctx: SearchContext): Promise<FinderResult> {
  if (!ctx.knownUrl || ctx.rejected.has(urlIdentity(ctx.knownUrl))) return emptyResult(false);
  const result = emptyResult(true);
  const candidate = { ...scoreLink(ctx.knownUrl, "previously found link", "known_link"), score: 0.9 };
  await tryCandidates(ctx, result, [candidate], 1);
  return result;
}

export async function findHomepageLinks(ctx: SearchContext): Promise<FinderResult> {
  const result = emptyResult(true);
  await tryCandidates(ctx, result, feeCandidates(ctx.homepageLinks, "homepage_link", ctx.site.toString()), MAX_CANDIDATES_PER_FINDER);
  return result;
}

async function readRobots(ctx: SearchContext, result: FinderResult): Promise<string | null> {
  if (ctx.robots !== undefined) return ctx.robots;
  const url = new URL("/robots.txt", ctx.site.origin).toString();
  result.fetches += 1;
  try {
    const response = await fetchWithTimeout(ctx.fetchImpl, url);
    result.trail.push({ url, source: "robots", foundOn: null, label: "", score: 0, verdict: `http_${response.status}` });
    ctx.robots = response.ok ? await response.text() : null;
  } catch {
    result.trail.push({ url, source: "robots", foundOn: null, label: "", score: 0, verdict: "fetch_failed" });
    ctx.robots = null;
  }
  return ctx.robots;
}

/** The robots.txt Disallow rules for our crawler on this site (none when it has no robots.txt). */
async function robotsRules(ctx: SearchContext, result: FinderResult): Promise<string[]> {
  const robots = await readRobots(ctx, result);
  return robots ? robotsDisallows(robots) : [];
}

/** True when robots.txt lets our crawler open this URL. Off-site documents (a CDN) are not ruled by the bank's robots.txt. */
function robotsLetUs(ctx: SearchContext, disallows: string[], url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!sameSite(parsed, ctx.site)) return true;
    return robotsAllows(`${parsed.pathname}${parsed.search}`, disallows);
  } catch {
    return false;
  }
}

/** A document URL whose name says it is a fee schedule or account disclosure. */
const FEE_DOCUMENT_NAME = /fee|schedule|disclosure|truth[\s_-]*in[\s_-]*savings/;

/**
 * Site map entries worth opening: links that score as fee links, plus PDFs whose name
 * looks like a fee schedule or disclosure ("tis-disclosure.pdf", "consumer-schedule.pdf").
 * A site map gives no link text, so such a PDF often scores below the bar on its name
 * alone; the fee-page check reads it before it is accepted, and a scan with a weak name
 * is never accepted unread.
 */
export function sitemapCandidates(links: PageLink[]): LinkCandidate[] {
  return links
    .map((link) => scoreLink(link.url, link.label, "sitemap", "sitemap"))
    .flatMap((candidate): LinkCandidate[] => {
      if (candidate.score >= MIN_LINK_SCORE) return [candidate];
      if (!looksLikePdfUrl(candidate.url) || candidate.reasons.some((reason) => reason.startsWith("negative:"))) return [];
      if (!FEE_DOCUMENT_NAME.test(`${candidate.label} ${candidate.url}`.toLowerCase())) return [];
      return [{ ...candidate, score: MIN_LINK_SCORE, reasons: [...candidate.reasons, "fee_document_name"] }];
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * robots.txt's site maps, else /sitemap.xml, then /sitemap_index.xml; an index opens its
 * page/document children. Every same-site request follows robots.txt Disallow rules for
 * our crawler. Needs no homepage, so it also runs when the homepage blocks bots.
 */
export async function findInSitemap(ctx: SearchContext): Promise<FinderResult> {
  const result = emptyResult(true);
  const disallows = await robotsRules(ctx, result);
  const getText = async (url: string): Promise<string | null> => {
    if (!robotsLetUs(ctx, disallows, url)) {
      result.trail.push({ url, source: "sitemap_file", foundOn: null, label: "", score: 0, verdict: "robots_disallow" });
      return null;
    }
    result.fetches += 1;
    try {
      const response = await fetchWithTimeout(ctx.fetchImpl, url);
      result.trail.push({ url, source: "sitemap_file", foundOn: null, label: "", score: 0, verdict: response.ok ? "read" : `http_${response.status}` });
      return response.ok ? await response.text() : null;
    } catch {
      result.trail.push({ url, source: "sitemap_file", foundOn: null, label: "", score: 0, verdict: "fetch_failed" });
      return null;
    }
  };

  const declared = ctx.robots ? robotsSitemaps(ctx.robots) : [];
  const roots = declared.length > 0
    ? declared.slice(0, 2)
    : ["/sitemap.xml", "/sitemap_index.xml"].map((path) => new URL(path, ctx.site.origin).toString());
  const urls: string[] = [];
  for (const root of roots) {
    if (outOfTime(ctx)) break;
    // The guessed roots are alternatives: stop at the first that answers.
    if (declared.length === 0 && urls.length > 0) break;
    const xml = await getText(root);
    if (!xml) continue;
    if (!isSitemapIndex(xml)) {
      urls.push(...sitemapLocations(xml));
      continue;
    }
    // Page and document sitemaps are where disclosures are listed.
    const children = sitemapLocations(xml);
    const preferred = children.filter((url) => /page|post|document|media|attachment|file/i.test(url));
    for (const child of (preferred.length > 0 ? preferred : children).slice(0, 2)) {
      const childXml = await getText(child);
      if (childXml) urls.push(...sitemapLocations(childXml));
    }
  }
  const links = urls
    .map((url) => normalizeCandidateUrl(url, ctx.site))
    .filter((url): url is string => Boolean(url))
    .map((url) => {
      const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      let label = last;
      try {
        label = decodeURIComponent(last);
      } catch {
        // keep the raw segment
      }
      return { url, label };
    });
  const candidates = sitemapCandidates(links).filter((candidate) => {
    if (robotsLetUs(ctx, disallows, candidate.url)) return true;
    result.trail.push({ url: candidate.url, source: "sitemap", foundOn: "sitemap", label: candidate.label, score: Math.round(candidate.score * 100) / 100, verdict: "robots_disallow" });
    return false;
  });
  await tryCandidates(ctx, result, candidates, MAX_CANDIDATES_PER_FINDER);
  return result;
}

/** One hop: open Disclosures / Rates & Fees / Documents / Forms pages and try their fee links. */
export async function findViaHubPages(ctx: SearchContext): Promise<FinderResult> {
  const hubs = hubPages(ctx.homepageLinks, ctx.site, ctx.tried);
  if (hubs.length === 0) return emptyResult(false);
  const result = emptyResult(true);
  for (const hub of hubs) {
    if (outOfTime(ctx)) {
      result.outOfTime = true;
      break;
    }
    const entry: TrailEntry = { url: hub.url, source: "hub_page", foundOn: ctx.site.toString(), label: hub.label, score: 0, verdict: "" };
    result.trail.push(entry);
    const html = await openPage(ctx, result, hub.url, entry);
    if (html == null) continue;
    // The hub itself may be the fee page.
    if (!ctx.rejected.has(urlIdentity(hub.url)) && pageIsFeeSchedule(html)) {
      entry.verdict = "accepted_html";
      result.found = {
        url: hub.url,
        documentType: "html",
        confidence: 0.86,
        reason: `Fee page found one click from the homepage (${hub.label || hub.url})`,
      };
      return result;
    }
    const hubCandidates = feeCandidates(pageLinks(html, ctx.site), "hub_link", hub.url);
    if (await tryCandidates(ctx, result, hubCandidates, MAX_CANDIDATES_PER_HUB)) return result;
  }
  return result;
}

/** Paths that worked for other banks on the same website platform (`platform_registry` + learned). */
export async function findPlatformPaths(ctx: SearchContext): Promise<FinderResult> {
  if (!ctx.platform) return emptyResult(false);
  const paths = await ctx.knowledge.platformPaths(ctx.platform);
  const candidates = pathCandidates(ctx, paths, "platform_path").filter((candidate) => !ctx.tried.has(urlIdentity(candidate.url)));
  if (candidates.length === 0) return emptyResult(false);
  const result = { ...emptyResult(true), note: `platform ${ctx.platform}` };
  await tryCandidates(ctx, result, candidates, MAX_PLATFORM_PATHS);
  return result;
}

/** Last pass-1 resort: the paths banks most often use. */
export async function findCommonPaths(ctx: SearchContext): Promise<FinderResult> {
  const result = emptyResult(true);
  const guessed = pathCandidates(ctx, COMMON_PATHS, "common_path")
    .filter((candidate) => candidate.score >= MIN_LINK_SCORE)
    .sort((a, b) => b.score - a.score);
  await tryCandidates(ctx, result, guessed, MAX_GUESSED_PATHS);
  return result;
}

// --- Pass 2 ------------------------------------------------------------------------

/** Paths that produced live fees for banks on the same platform, nationwide. */
export async function findPeerHint(ctx: SearchContext): Promise<FinderResult> {
  if (!ctx.platform) return emptyResult(false);
  const paths = await ctx.knowledge.peerPaths(ctx.platform, ctx.stateCode, ctx.institutionId);
  const candidates = pathCandidates(ctx, paths, "peer_hint").filter((candidate) => !ctx.tried.has(urlIdentity(candidate.url)));
  if (candidates.length === 0) return emptyResult(false);
  const result = { ...emptyResult(true), note: `platform ${ctx.platform}, nationwide` };
  await tryCandidates(ctx, result, candidates, MAX_PEER_PATHS);
  return result;
}

/**
 * A bounded, polite crawl of the bank's own site: at most CRAWL_PAGE_LIMIT requests,
 * one at a time with a pause, same host only, following robots.txt Disallow rules for
 * our crawler. Hub-like pages are visited first.
 */
export async function findBySiteCrawl(ctx: SearchContext): Promise<FinderResult> {
  const result = emptyResult(true);
  const disallows = await robotsRules(ctx, result);
  const allowed = (url: string) => {
    const parsed = new URL(url);
    return robotsAllows(`${parsed.pathname}${parsed.search}`, disallows);
  };

  const queued = new Set<string>([urlIdentity(ctx.site.toString())]);
  const queue: Array<{ link: PageLink; depth: number; weight: number }> = [];
  const enqueue = (links: PageLink[], depth: number) => {
    for (const link of links) {
      const url = new URL(link.url);
      const identity = urlIdentity(link.url);
      if (!sameSite(url, ctx.site) || isDocumentPath(url) || queued.has(identity)) continue;
      if (/\.(jpe?g|png|gif|svg|css|js|zip|xml|ico|mp4)$/i.test(url.pathname)) continue;
      const lower = `${link.label} ${url.pathname}`.toLowerCase().replace(/[-_/]+/g, " ");
      if (NEGATIVE_LINK_PHRASES.some((phrase) => lower.includes(phrase))) continue;
      queued.add(identity);
      queue.push({ link, depth, weight: hubWeight(link) });
    }
    queue.sort((a, b) => b.weight - a.weight || a.depth - b.depth);
  };
  enqueue(ctx.homepageLinks, 1);

  const budgetLeft = () => CRAWL_PAGE_LIMIT - result.fetches;
  while (queue.length > 0 && budgetLeft() > 0) {
    if (outOfTime(ctx)) {
      result.outOfTime = true;
      break;
    }
    const next = queue.shift()!;
    const identity = urlIdentity(next.link.url);
    if (ctx.rejected.has(identity)) continue;
    if (!allowed(next.link.url)) {
      result.trail.push({ url: next.link.url, source: "crawl_page", foundOn: null, label: next.link.label, score: 0, verdict: "robots_disallow" });
      continue;
    }
    const cached = ctx.pages.has(identity);
    if (!cached) await politePause(ctx);
    const entry: TrailEntry = { url: next.link.url, source: "crawl_page", foundOn: null, label: next.link.label, score: 0, verdict: "" };
    result.trail.push(entry);
    const html = await openPage(ctx, result, next.link.url, entry);
    if (html == null) continue;
    if (pageIsFeeSchedule(html)) {
      entry.verdict = "accepted_html";
      result.found = { url: next.link.url, documentType: "html", confidence: 0.84, reason: `Fee page found by crawling the site (depth ${next.depth})` };
      return result;
    }
    const links = pageLinks(html, ctx.site);
    const candidates = feeCandidates(links, "crawl_link", next.link.url).filter((candidate) => allowed(candidate.url) || !sameSite(new URL(candidate.url), ctx.site));
    if (candidates.length > 0 && budgetLeft() > 0) {
      await politePause(ctx);
      if (await tryCandidates(ctx, result, candidates, Math.min(2, budgetLeft()))) return result;
    }
    if (next.depth < CRAWL_MAX_DEPTH) enqueue(links, next.depth + 1);
  }
  return result;
}

export const FINDER_ORDER: Array<{ key: FinderKey; run: (ctx: SearchContext) => Promise<FinderResult> }> = [
  { key: "knownLink", run: findKnownLink },
  { key: "homepageLinks", run: findHomepageLinks },
  { key: "sitemap", run: findInSitemap },
  { key: "hubPages", run: findViaHubPages },
  { key: "platformPaths", run: findPlatformPaths },
  { key: "commonPaths", run: findCommonPaths },
  { key: "peerHint", run: findPeerHint },
  { key: "siteCrawl", run: findBySiteCrawl },
];

const REJECTION_VERDICTS = new Set([
  "not_fee_page",
  "rate_page",
  "too_few_fee_words",
  "product_page",
  "unreadable_pdf_weak_label",
  "not_a_pdf",
  "unsupported_type",
]);

/** The attempt-log outcome for one specialist's run. */
export function finderOutcome(result: FinderResult): AttemptOutcome {
  if (result.found) return "ok";
  const candidates = result.trail.filter((entry) => !["robots", "sitemap_file"].includes(entry.source));
  if (candidates.some((entry) => REJECTION_VERDICTS.has(entry.verdict))) return "wrong_document";
  const statuses = candidates
    .map((entry) => /^http_(\d+)$/.exec(entry.verdict)?.[1])
    .filter((status): status is string => Boolean(status))
    .map(Number)
    .filter((status) => status >= 400);
  if (candidates.length > 0 && statuses.length === candidates.length) return classifyFetchFailure(statuses[statuses.length - 1]);
  if (candidates.length > 0 && candidates.every((entry) => entry.verdict === "fetch_failed")) return "network_error";
  if (result.outOfTime && candidates.length === 0) return "timeout";
  return "no_candidates";
}
