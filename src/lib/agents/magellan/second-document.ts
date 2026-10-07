import type { sql } from "@/lib/data-store/connection";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { classifyFetchFailure, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { htmlToScoringText, scoreFeePage } from "@/lib/agents/learning/fee-page";
import { companionStreamsReady } from "@/lib/agents/companion-streams";

import { fetchWithTimeout, looksLikePdfUrl, MAX_PDF_CHECK_BYTES, pdfCheckText, validateFeeCandidate } from "./find-validate";
import {
  BUSINESS_PATH_SQL,
  CONSUMER_PATH_SQL,
  DOCUMENT_YEAR_SQL,
  FEE_NAMED_LINK_SQL,
  HIDDEN_BELOW_CATEGORIES,
  LARGE_BANK_ASSETS,
  OVERDRAFT_PRICE_SQL,
  PRODUCT_LINK_SQL,
  REFERS_ELSEWHERE_SQL,
  STALE_DOCUMENT_YEARS,
} from "./link-coverage";
import {
  cleanText,
  hubPages,
  pageLinks,
  sameSite,
  urlIdentity,
  type LinkSource,
  type PageLink,
  type TrailEntry,
} from "./finders";

type SqlTag = typeof sql;
type Fetcher = typeof fetch;

/**
 * Pass 2, companion finder. Many banks, small credit unions above all, do not publish
 * one fee schedule: each checking account's page lists its own fees (Triangle FCU's
 * Freedom and Value Checking), the overdraft fee sits in a courtesy pay PDF, and
 * wires and cashier's checks are on an "additional services" page. Discovery stops at
 * the first page that passes the fee-page check, so such a bank ends up with a few fees
 * from one page.
 *
 * For live banks with few fee categories (or no monthly fee on an HTML fee link) this
 * reads the homepage, the stored fee page, a few hub pages (Checking, Accounts,
 * Disclosures) and the site's own search (up to MAX_SEARCH_PAGES_PER_BANK queries such as
 * "fee schedule", "truth in savings", "account agreement", "member agreement"), then keeps
 * every page that lists fees: deposit-account pages (named after their account), fee
 * documents (schedules, disclosures, courtesy pay policies, PDFs behind opaque
 * /assets/files links) and account or membership agreements that list at least one fee
 * with a dollar amount. Each page is stored in `institution_additional_sources` (never replacing the
 * bank's fee link); the companion fetch (`companion-fetch.ts`) downloads it as its own
 * document stream. Runs inside the `discover` step after the main search, with whatever
 * time the step has left, and logs every bank it checks.
 */

export const SECOND_DOCUMENT_FINDER = { strategy: "discover.second_document", version: 3 } as const;
/** One `pipeline_attempts` row per site-search query, so each query's hit rate is visible. */
export const SITE_SEARCH_STRATEGY = { strategy: "discover.site_search", version: 1 } as const;
/** Live banks with fewer published fee categories than this are searched. */
export const THIN_BANK_CATEGORY_LIMIT = 8;
export const SECOND_DOCUMENT_BANKS_PER_STEP = 6;
/** Pages kept per bank, account pages and fee documents together. */
export const MAX_COMPANIONS_PER_BANK = 8;
const MAX_ACCOUNT_PAGES_CHECKED = 8;
const MAX_FEE_DOCUMENTS_CHECKED = 5;
const MAX_AGREEMENTS_CHECKED = 3;
/** Agreements put their fee section late; read this many PDF pages for a fee line. */
const AGREEMENT_PDF_PAGES = 12;
/** Site-search result pages requested per bank per run (one per query). */
export const MAX_SEARCH_PAGES_PER_BANK = 4;
const MAX_HUBS = 3;
const RECHECK_DAYS = 30;
/** How much of each stored text the link-coverage checks read (a schedule's fees come early). */
const COVERAGE_TEXT_CHARS = 60_000;
/** Always searched first: it found Triangle FCU's fees. */
const PRIMARY_SEARCH_QUERY = "fee schedule";
/**
 * The other queries, fee and agreement wording interleaved so every run asks for both.
 * Each run takes the next MAX_SEARCH_PAGES_PER_BANK - 1 of them, so a bank searched
 * again a month later gets the rest.
 */
export const ROTATING_SEARCH_QUERIES = [
  "account agreement",
  "schedule of fees",
  "member agreement",
  "truth in savings",
  "deposit agreement",
  "membership agreement",
] as const;
export const SITE_SEARCH_QUERIES = [PRIMARY_SEARCH_QUERY, ...ROTATING_SEARCH_QUERIES] as const;

/** The queries for one run: "fee schedule", then the rotation's slice of the others. */
export function siteSearchQueries(rotation: number, limit = MAX_SEARCH_PAGES_PER_BANK): string[] {
  const count = Math.max(0, Math.min(limit, SITE_SEARCH_QUERIES.length));
  if (count === 0) return [];
  const slots = count - 1;
  const size = ROTATING_SEARCH_QUERIES.length;
  const start = (((Math.trunc(rotation) * slots) % size) + size) % size;
  const rest = Array.from({ length: slots }, (_, index) => ROTATING_SEARCH_QUERIES[(start + index) % size]);
  return [PRIMARY_SEARCH_QUERY, ...rest];
}

/** Changes once per recheck window, so a bank's next search uses the next queries. */
export function currentSearchRotation(now = Date.now()): number {
  return Math.floor(now / (RECHECK_DAYS * 24 * 60 * 60 * 1000));
}

export type AdditionalDocumentRole = "business" | "other_services" | "consumer_supplement" | "account_page";

const BUSINESS = /\b(business|commercial|corporate|treasury management|merchant)\b/;
const OTHER_SERVICES = /\b(other services|other fees|miscellaneous|additional services|general fees|service fees|common fees)\b/;

export function additionalDocumentRole(text: string): AdditionalDocumentRole {
  const lower = text.toLowerCase().replace(/[-_]+/g, " ");
  if (BUSINESS.test(lower)) return "business";
  if (OTHER_SERVICES.test(lower)) return "other_services";
  return "consumer_supplement";
}

const STRONG_FEE_DOCUMENT =
  /\b(fee schedules?|schedules? of (fees|charges)|service charges?|truth in savings|courtesy pay|overdraft (privilege|protection|polic(y|ies)|services?|practices)|bounce (protection|coverage)|fee disclosures?|account fees|other fees|additional services|miscellaneous fees)\b/;
/** Account and membership agreements: often the only place a small bank lists its fees. */
const AGREEMENT =
  /\b((deposit |share |checking |savings |consumer |personal )?account|member(ship)?|deposit|share) agreements?\b|\bterms (and|&) conditions\b|\bagreements? (and|&) disclosures?\b|\bdisclosures? (and|&) agreements?\b/;
const MEDIUM_FEE_DOCUMENT = /\b(fees?|charges|pricing|disclosures?|account agreements?|deposit agreements?|terms and conditions)\b/;
const NOT_A_FEE_DOCUMENT =
  /\b(privacy|careers?|jobs|mortgage|loans?|lending|heloc|home equity|lines? of credit|introductory rate|credit cards?|visa platinum|auto|rates? sheet|annual report|press|news|scholarship|donation|calculator|login|log in|enroll|apply|application|employment|vendor|accessibility|swaps?|derivatives?|cftc|blog|articles?)\b/;
/** Deposit accounts whose pages carry their own fees. Loans and cards are left out. */
const ACCOUNT_PAGE =
  /\b(checking|savings|money market|share drafts?|share accounts?|share savings|christmas club|holiday club|club accounts?|vacation club|kasasa|youth accounts?|student (checking|accounts?)|teen (checking|accounts?)|compare accounts|personal accounts?|deposit accounts?)\b/;
/** Link text that names no account ("Learn more", "Download", "Features and Fees"). */
const GENERIC_LABEL =
  /^(learn more|read more|more|more info(rmation)?|details|view|view details|click here|here|see details|explore|open|open now|open an account|learn how|get started|compare|go|>|»|download|download (the )?pdf|pdf|view pdf|open pdf|view (the )?(document|disclosures?)|disclosures?|fees|features|features (and|&) fees|product details|account details|see rates|view rates|rates)$/i;
/** Path segments that name no account either. */
const GENERIC_SEGMENT = /^(index|default|home|main|page|fees?|pdf|download|documents?|files?|disclosures?|personal|accounts?)$/i;

export type CompanionKind = "account_page" | "fee_document" | "agreement";

export interface CompanionCandidate {
  url: string;
  label: string;
  kind: CompanionKind;
  score: number;
  reasons: string[];
  foundOn: string | null;
  source: LinkSource;
}

function linkText(link: PageLink): string {
  let path = link.url;
  try {
    path = decodeURIComponent(new URL(link.url).pathname);
  } catch {
    // keep the raw URL
  }
  return `${link.label} ${path}`.toLowerCase().replace(/[-_/.]+/g, " ");
}

/**
 * What a link may be: a page about one deposit account, a fee document, or neither.
 * Business and loan links are skipped (their fees are not the consumer schedule).
 */
export function classifyCompanionLink(link: PageLink, site: URL, foundOn: string | null = null): CompanionCandidate | null {
  const lower = linkText(link);
  if (BUSINESS.test(lower) || NOT_A_FEE_DOCUMENT.test(lower)) return null;
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return null;
  }
  const source: LinkSource = "homepage_link";
  const strong = STRONG_FEE_DOCUMENT.exec(lower);
  const medium = MEDIUM_FEE_DOCUMENT.exec(lower);
  const document = looksLikePdfUrl(link.url) || /\/(assets\/files|files|documents?|uploads|media)\//i.test(url.pathname);
  // "Fee Schedule and Account Agreement" stays a fee document; a plain agreement is kept
  // only when it lists a fee (see agreementListsFees).
  const agreement = strong ? null : AGREEMENT.exec(lower);
  if (agreement) {
    const score = 0.78 + (document ? 0.05 : 0);
    return { url: link.url, label: link.label, kind: "agreement", score, reasons: [agreement[0], document ? "document" : ""].filter(Boolean), foundOn, source };
  }
  if (strong || (medium && document)) {
    const reasons = [strong?.[0] ?? medium?.[0] ?? "", document ? "document" : ""].filter(Boolean);
    const score = Math.min(0.98, (strong ? 0.88 : 0.8) + (document ? 0.05 : 0));
    return { url: link.url, label: link.label, kind: "fee_document", score, reasons, foundOn, source };
  }
  const account = ACCOUNT_PAGE.exec(lower);
  if (account && sameSite(url, site) && !document) {
    // A link named after one account ("Freedom Checking") beats a section link ("Checking").
    const named = link.label.trim().split(/\s+/).length >= 2 ? 0.05 : 0;
    const checking = /checking|share draft/.test(account[0]) ? 0.05 : 0;
    return { url: link.url, label: link.label, kind: "account_page", score: 0.75 + named + checking, reasons: [account[0]], foundOn, source };
  }
  return null;
}

/** Candidate pages from a set of links, best first, minus pages already known. */
export function companionCandidates(links: PageLink[], site: URL, exclude: Set<string>): CompanionCandidate[] {
  const seen = new Set<string>();
  const candidates: CompanionCandidate[] = [];
  for (const link of links) {
    const identity = urlIdentity(link.url);
    if (exclude.has(identity) || seen.has(identity)) continue;
    seen.add(identity);
    const candidate = classifyCompanionLink(link, site);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/** True when a stored account name is link text that names no account ("Download"). */
export function isGenericAccountName(name: string | null | undefined): boolean {
  const cleaned = (name ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length === 0 || GENERIC_LABEL.test(cleaned);
}

/** True when a link points at a loan, HELOC or other page that is not a deposit fee page. */
export function isNonDepositLink(label: string, url: string): boolean {
  return NOT_A_FEE_DOCUMENT.test(linkText({ label, url }));
}

/**
 * The account a page belongs to: its link label, or for "Learn more" / "Download"
 * links the last path segment that reads like a name ("simple-checking-fees.pdf" ->
 * "Simple Checking Fees"; "/checking/index.html" -> "Checking").
 */
export function accountNameFor(label: string, url: string): string {
  const cleaned = cleanText(label).replace(/\s+/g, " ").trim();
  if (cleaned && !GENERIC_LABEL.test(cleaned) && cleaned.length <= 80) return cleaned;
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean).reverse();
    for (const segment of segments) {
      const words = decodeURIComponent(segment).replace(/\.[a-z0-9]+$/i, "").split(/[-_\s]+/).filter(Boolean);
      const name = words.join(" ");
      // Skip "index", "fees", bare numbers and ids: they name no account.
      if (words.length === 0 || GENERIC_SEGMENT.test(name) || !words.some((word) => /^[a-z]{3,}$/i.test(word) && !GENERIC_SEGMENT.test(word))) continue;
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    }
  } catch {
    // fall through
  }
  return cleaned || url;
}

/**
 * The site's own search for `query` (default "fee schedule"), from a GET search form on
 * the page (`<form action="/search"><input name="q">`). Null when the page has none.
 */
export function siteSearchUrl(html: string, site: URL, query: string = PRIMARY_SEARCH_QUERY): string | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  for (const form of forms) {
    const openTag = form.slice(0, form.indexOf(">") + 1);
    const method = /\bmethod\s*=\s*["']?([a-z]+)/i.exec(openTag)?.[1]?.toLowerCase() ?? "get";
    if (method !== "get") continue;
    const inputs = form.match(/<input\b[^>]*>/gi) ?? [];
    const searchInput = inputs.find((input) => {
      const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(input)?.[1] ?? "";
      const type = (/\btype\s*=\s*["']?([a-z]+)/i.exec(input)?.[1] ?? "text").toLowerCase();
      return (type === "search" || type === "text") && /^(q|s|query|search|keys|keywords?|term|searchterm|search_api_fulltext|k)$/i.test(name);
    });
    if (!searchInput) continue;
    const looksLikeSearch = /search/i.test(form) || /\btype\s*=\s*["']?search/i.test(searchInput);
    if (!looksLikeSearch) continue;
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(searchInput)![1];
    const action = /\baction\s*=\s*["']([^"']*)["']/i.exec(openTag)?.[1] ?? "";
    try {
      const target = new URL(action || "/", site);
      if (!sameSite(target, site) || (target.protocol !== "http:" && target.protocol !== "https:")) continue;
      target.hash = "";
      target.searchParams.set(name, query);
      return target.toString();
    } catch {
      continue;
    }
  }
  return null;
}

/** An account page is kept when it lists at least one fee with an amount. */
export function accountPageListsFees(html: string, url: string): { ok: boolean; feeLines: number; reason: string } {
  const page = scoreFeePage(htmlToScoringText(html), url);
  if (page.verdict === "wrong_document" || page.feeLines < 1) {
    return { ok: false, feeLines: page.feeLines, reason: page.reason };
  }
  return { ok: true, feeLines: page.feeLines, reason: `${page.feeLines} fee line${page.feeLines === 1 ? "" : "s"} on the account page` };
}

/** One search URL per query, from the page's search form; empty when it has none. */
export function siteSearchUrls(html: string, site: URL, queries: readonly string[]): { query: string; url: string }[] {
  const urls: { query: string; url: string }[] = [];
  for (const query of queries) {
    const url = siteSearchUrl(html, site, query);
    if (!url) return [];
    urls.push({ query, url });
  }
  return urls;
}

export interface AgreementCheck {
  ok: boolean;
  documentType: "html" | "pdf" | null;
  feeLines: number;
  verdict: string;
  reason: string;
}

/**
 * An agreement is kept only when its text lists at least one fee with a dollar amount
 * (the same check as an account page). PDFs are read up to AGREEMENT_PDF_PAGES pages; a
 * scan with no text is dropped, since nothing shows it lists a fee.
 */
export async function agreementListsFees(url: string, fetchImpl: Fetcher): Promise<AgreementCheck> {
  const response = await fetchWithTimeout(fetchImpl, url);
  if (!response.ok) return { ok: false, documentType: null, feeLines: 0, verdict: `http_${response.status}`, reason: `Agreement HTTP ${response.status}` };
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const noFee = (documentType: "html" | "pdf", feeLines = 0): AgreementCheck => ({
    ok: false,
    documentType,
    feeLines,
    verdict: "no_fee_listed",
    reason: "Agreement lists no fee with an amount",
  });
  const kept = (documentType: "html" | "pdf", feeLines: number): AgreementCheck => ({
    ok: true,
    documentType,
    feeLines,
    verdict: "accepted_agreement",
    reason: `Agreement lists ${feeLines} fee line${feeLines === 1 ? "" : "s"}`,
  });
  if (contentType.includes("application/pdf") || (looksLikePdfUrl(url) && !contentType.includes("text/html"))) {
    const tooLarge: AgreementCheck = { ok: false, documentType: "pdf", feeLines: 0, verdict: "too_large", reason: "Agreement PDF too large to check" };
    if (Number(response.headers.get("content-length") ?? 0) > MAX_PDF_CHECK_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return tooLarge;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_CHECK_BYTES) return tooLarge;
    const text = await pdfCheckText(bytes, AGREEMENT_PDF_PAGES);
    if (!text) return { ok: false, documentType: "pdf", feeLines: 0, verdict: "unreadable_pdf", reason: "Agreement PDF has no readable text" };
    const page = scoreFeePage(text);
    return page.feeLines >= 1 ? kept("pdf", page.feeLines) : noFee("pdf");
  }
  if (!contentType.includes("text/html")) {
    return { ok: false, documentType: null, feeLines: 0, verdict: "unsupported_type", reason: `Unsupported content type ${contentType || "unknown"}` };
  }
  const check = accountPageListsFees(await response.text(), url);
  return check.ok ? kept("html", check.feeLines) : noFee("html", check.feeLines);
}

interface ThinBankRow {
  id: number | string;
  institution_name: string;
  state_code: string | null;
  website_url: string;
  fee_schedule_url: string;
  categories: number | string;
  /** The link is not the consumer schedule yet (link-coverage.ts). */
  incomplete?: boolean | null;
}

export interface CompanionPage {
  url: string;
  role: AdditionalDocumentRole;
  kind: CompanionKind;
  accountName: string;
  documentType: string | null;
  reason: string;
}

export interface SecondDocumentResult {
  institutionId: number;
  categories: number;
  outcome: AttemptOutcome;
  /** The first page found, kept for the run summary. */
  url: string | null;
  role: AdditionalDocumentRole | null;
  documentType: string | null;
  reason: string;
  fetches: number;
  pages: CompanionPage[];
  searches: SiteSearchResult[];
}

/** One query on the bank's own site search. */
export interface SiteSearchResult {
  query: string;
  url: string;
  outcome: AttemptOutcome;
  /** HTTP status of the results page, or null when the request failed. */
  status: number | null;
  /** Fee documents and agreements its results linked to. */
  candidates: number;
  /** Companion pages kept from its results. */
  kept: number;
  durationMs: number;
}

export interface RunSecondDocumentFindResult {
  /** "schema_pending" until the migration is applied; "no_attempt_log" without the learning core. */
  status: "ran" | "schema_pending" | "no_attempt_log" | "out_of_time";
  checked: number;
  /** Companion pages stored this step. */
  found: number;
  results: SecondDocumentResult[];
}

/**
 * Spare slots after the state's own thin banks go to banks the catalog hides (fewer than 3
 * live fee categories) whose link is a product page or prices no overdraft, from any state:
 * a state lane that has checked all its banks this month would otherwise leave the step idle,
 * while most hidden banks sit in states the lane has not reached yet (Knox handoff, Oct 7).
 */
async function selectThinBanks(
  db: SqlTag,
  stateCode: string | null,
  limit: number,
  options: { hiddenOnly?: boolean; excludeIds?: number[] } = {},
): Promise<ThinBankRow[]> {
  const hiddenOnly = options.hiddenOnly ?? false;
  const excludeIds = options.excludeIds ?? [];
  return db<ThinBankRow[]>`
    WITH thin AS (
      -- Every live row, not the catalog: the catalog hides banks with fewer than 3 fees,
      -- which are the banks this finder exists for.
      SELECT c.institution_id,
             count(DISTINCT c.canonical_fee_key)::int AS categories,
             bool_or(c.canonical_fee_key = 'monthly_maintenance') AS has_monthly_fee,
             bool_or(c.canonical_fee_key = 'overdraft') AS has_overdraft
        FROM published_fee_records c
        JOIN institution_sources scoped ON scoped.id = c.institution_id
       WHERE c.rolled_back_at IS NULL
         AND (${stateCode}::text IS NULL OR upper(btrim(scoped.state_code)) = ${stateCode})
       GROUP BY c.institution_id
    ),
    scoped AS (
      SELECT inst.id, inst.institution_name, inst.state_code, inst.website_url, inst.fee_schedule_url, inst.asset_size,
             COALESCE(thin.categories, 0) AS categories,
             COALESCE(thin.has_monthly_fee, FALSE) AS has_monthly_fee,
             COALESCE(thin.has_overdraft, FALSE) AS has_overdraft,
             EXISTS (SELECT 1 FROM leads lead WHERE lead.quote_institution_id = inst.id) AS requested,
             -- The link is not the consumer schedule yet (link-coverage.ts): a business-only
             -- schedule, no stored text that prices an overdraft, a text that sends the
             -- reader to another document for its terms, or a current copy dated years ago.
             (
               lower(regexp_replace(inst.fee_schedule_url, '^https?://[^/]+', '')) ~ ${BUSINESS_PATH_SQL}
               AND lower(regexp_replace(inst.fee_schedule_url, '^https?://[^/]+', '')) !~ ${CONSUMER_PATH_SQL}
             ) AS business_only,
             NOT EXISTS (
               SELECT 1 FROM agent_source_texts text
                WHERE text.institution_id = inst.id
                  AND text.status = 'completed'
                  AND left(text.normalized_text, ${COVERAGE_TEXT_CHARS}) ~* ${OVERDRAFT_PRICE_SQL}
             ) AS no_overdraft_price,
             EXISTS (
               SELECT 1 FROM agent_source_texts text
                WHERE text.institution_id = inst.id
                  AND text.status = 'completed'
                  AND left(text.normalized_text, ${COVERAGE_TEXT_CHARS}) ~* ${REFERS_ELSEWHERE_SQL}
             ) AS refers_elsewhere,
             EXISTS (
               SELECT 1 FROM source_documents doc
                WHERE doc.institution_id = inst.id
                  AND doc.status = 'success'
                  AND doc.duplicate_of_id IS NULL
                  AND doc.superseded_by_id IS NULL
                  AND substring(doc.document_url from ${DOCUMENT_YEAR_SQL})::int
                      <= extract(year from NOW())::int - ${STALE_DOCUMENT_YEARS}
             ) AS stale_copy
        FROM institution_sources inst
        LEFT JOIN thin ON thin.institution_id = inst.id
       WHERE COALESCE(inst.status, 'active') = 'active'
         AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode})
         AND inst.website_url IS NOT NULL AND btrim(inst.website_url) <> ''
         AND inst.fee_schedule_url IS NOT NULL AND btrim(inst.fee_schedule_url) <> ''
         AND inst.id <> ALL(${excludeIds}::bigint[])
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.institution_id = inst.id
              AND pa.stage = 'discover'
              AND pa.strategy = ${SECOND_DOCUMENT_FINDER.strategy}
              AND pa.strategy_version = ${SECOND_DOCUMENT_FINDER.version}
              AND pa.created_at > NOW() - make_interval(days => ${RECHECK_DAYS})
         )
    )
    SELECT id, institution_name, state_code, website_url, fee_schedule_url, categories,
           (business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy) AS incomplete
      FROM scoped
     WHERE (
             categories < ${THIN_BANK_CATEGORY_LIMIT}
             -- An HTML fee link with no monthly fee: the product-page pattern.
             OR (NOT has_monthly_fee AND fee_schedule_url !~* '\\.pdf($|\\?)')
             OR business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy
             -- Near the report bar but missing a headline fee its link does not price: the
             -- monthly maintenance or overdraft item fee often sits in a separate account
             -- disclosure (Coulee Bank, Spencer Savings, Community Bank PA on Oct 7).
             OR NOT has_monthly_fee
             OR NOT has_overdraft
           )
       AND (
             NOT ${hiddenOnly}::boolean
             OR (
               categories < ${HIDDEN_BELOW_CATEGORIES}
               AND (
                 no_overdraft_price
                 OR (lower(fee_schedule_url) ~ ${PRODUCT_LINK_SQL} AND lower(fee_schedule_url) !~ ${FEE_NAMED_LINK_SQL})
               )
             )
           )
     -- Report requesters and $10B+ banks first: the names buyers check.
     ORDER BY requested DESC,
              (asset_size >= ${LARGE_BANK_ASSETS}) IS TRUE DESC,
              (business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy) DESC,
              -- Then banks one headline fee short of a full schedule, before thinner ones.
              (categories >= ${THIN_BANK_CATEGORY_LIMIT} AND (NOT has_monthly_fee OR NOT has_overdraft)) DESC,
              categories ASC,
              asset_size DESC NULLS LAST,
              id ASC
     LIMIT ${limit}
  `;
}

async function knownDocumentUrls(db: SqlTag, institutionId: number): Promise<Set<string>> {
  const rows = await db`
    SELECT document_url AS url FROM source_documents
     WHERE institution_id = ${institutionId} AND document_url IS NOT NULL
    UNION
    SELECT url FROM institution_additional_sources WHERE institution_id = ${institutionId}
  `;
  return new Set(rows.map((row) => urlIdentity(String(row.url))));
}

function normalizeSite(value: string): URL | null {
  for (const candidate of [value.trim(), `https://${value.trim()}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      continue;
    }
  }
  return null;
}

async function searchBank(
  row: ThinBankRow,
  fetchImpl: Fetcher,
  known: Set<string>,
  deadline: number,
  rotation: number,
): Promise<SecondDocumentResult & { trail: TrailEntry[] }> {
  const institutionId = Number(row.id);
  const categories = Number(row.categories);
  const trail: TrailEntry[] = [];
  const pages: CompanionPage[] = [];
  let fetches = 0;
  // Each site search, with the links its results page held; a link is credited to the
  // first query that found it.
  const searchRuns: Array<{ query: string; url: string; status: number | null; ok: boolean; links: PageLink[]; durationMs: number }> = [];
  const foundBySearch = new Map<string, string>();
  let siteRef: URL | null = null;
  let excludeRef = new Set<string>();
  const searchResults = (): SiteSearchResult[] =>
    searchRuns.map((search) => {
      const candidates = siteRef ? companionCandidates(search.links, siteRef, excludeRef).length : 0;
      const kept = pages.filter((page) => foundBySearch.get(urlIdentity(page.url)) === search.query).length;
      let outcome: AttemptOutcome;
      if (!search.ok) outcome = search.status != null && search.status < 400 ? "unsupported_format" : classifyFetchFailure(search.status);
      else if (kept > 0) outcome = "ok";
      else if (candidates === 0) outcome = "no_candidates";
      else outcome = "rejected";
      return { query: search.query, url: search.url, outcome, status: search.status, candidates, kept, durationMs: search.durationMs };
    });
  const done = (fields: Pick<SecondDocumentResult, "outcome" | "reason">) => ({
    institutionId,
    categories,
    url: pages[0]?.url ?? null,
    role: pages[0]?.role ?? null,
    documentType: pages[0]?.documentType ?? null,
    fetches,
    pages,
    searches: searchResults(),
    trail,
    ...fields,
  });

  const site = normalizeSite(row.website_url);
  if (!site) return done({ outcome: "invalid_url", reason: "Invalid website_url" });
  const exclude = new Set([...known, urlIdentity(row.fee_schedule_url)]);
  siteRef = site;
  excludeRef = exclude;

  // Hub pages are often account pages too: each URL is requested once.
  const opened = new Map<string, string | null>();
  const openHtml = async (url: string, source: TrailEntry["source"], label = ""): Promise<string | null> => {
    const identity = urlIdentity(url);
    if (opened.has(identity)) {
      trail.push({ url, source, foundOn: null, label, score: 0, verdict: "cached" });
      return opened.get(identity) ?? null;
    }
    const html = await requestHtml(url, source, label);
    opened.set(identity, html);
    return html;
  };
  const requestHtml = async (url: string, source: TrailEntry["source"], label: string): Promise<string | null> => {
    fetches += 1;
    const entry: TrailEntry = { url, source, foundOn: null, label, score: 0, verdict: "" };
    trail.push(entry);
    try {
      const response = await fetchWithTimeout(fetchImpl, url);
      entry.verdict = `http_${response.status}`;
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return null;
      return await response.text();
    } catch {
      entry.verdict = "fetch_failed";
      return null;
    }
  };

  const homepage = await openHtml(site.toString(), "homepage");
  if (homepage == null) {
    const status = Number(/^http_(\d+)$/.exec(trail[0]?.verdict ?? "")?.[1] ?? 0);
    return done({ outcome: classifyFetchFailure(status || null), reason: `Homepage ${trail[0]?.verdict ?? "failed"}` });
  }
  const links: PageLink[] = [...pageLinks(homepage, site)];
  // The stored fee page often links to the account pages and the full schedule.
  if (!looksLikePdfUrl(row.fee_schedule_url) && Date.now() < deadline) {
    const feePage = await openHtml(row.fee_schedule_url, "known_link");
    if (feePage) links.push(...pageLinks(feePage, site));
  }
  // The site's own search (James found Triangle FCU's fees this way): "fee schedule" plus
  // fee and agreement wording, at most MAX_SEARCH_PAGES_PER_BANK result pages per bank.
  const searches = siteSearchUrls(homepage, site, siteSearchQueries(rotation)).slice(0, MAX_SEARCH_PAGES_PER_BANK);
  for (const search of searches) {
    if (Date.now() > deadline) break;
    const startedAt = Date.now();
    const results = await openHtml(search.url, "crawl_page", `site search: ${search.query}`);
    const verdict = trail[trail.length - 1]?.verdict ?? "";
    const status = Number(/^http_(\d+)$/.exec(verdict)?.[1] ?? 0) || null;
    const found = results ? pageLinks(results, site) : [];
    links.push(...found);
    for (const link of found) {
      const identity = urlIdentity(link.url);
      if (!foundBySearch.has(identity)) foundBySearch.set(identity, search.query);
    }
    searchRuns.push({ query: search.query, url: search.url, status, ok: results != null, links: found, durationMs: Date.now() - startedAt });
  }
  const hubs = hubPages(links.filter((link) => !BUSINESS.test(linkText(link)) && !NOT_A_FEE_DOCUMENT.test(linkText(link))), site, exclude, MAX_HUBS);
  for (const hub of hubs) {
    if (Date.now() > deadline) break;
    const html = await openHtml(hub.url, "hub_page", hub.label);
    if (html) links.push(...pageLinks(html, site));
  }

  const candidates = companionCandidates(links, site, exclude);
  const accountPages = candidates.filter((candidate) => candidate.kind === "account_page").slice(0, MAX_ACCOUNT_PAGES_CHECKED);
  if (candidates.length === 0) return done({ outcome: "no_candidates", reason: "No account pages or fee documents linked" });

  const kept = new Set<string>();
  const keep = (page: CompanionPage) => {
    if (pages.length >= MAX_COMPANIONS_PER_BANK || kept.has(urlIdentity(page.url))) return;
    kept.add(urlIdentity(page.url));
    pages.push(page);
  };

  // Account pages first: each one also links to the documents it relies on ("see the fee schedule").
  const moreLinks: PageLink[] = [];
  for (const candidate of accountPages) {
    if (Date.now() > deadline || pages.length >= MAX_COMPANIONS_PER_BANK) break;
    const html = await openHtml(candidate.url, "crawl_page", candidate.label);
    const entry = trail[trail.length - 1];
    entry.score = Math.round(candidate.score * 100) / 100;
    if (!html) continue;
    moreLinks.push(...pageLinks(html, site));
    const check = accountPageListsFees(html, candidate.url);
    entry.verdict = check.ok ? "accepted_html" : "too_few_fee_words";
    if (check.ok) {
      keep({
        url: candidate.url,
        role: "account_page",
        kind: "account_page",
        accountName: accountNameFor(candidate.label, candidate.url),
        documentType: "html",
        reason: check.reason,
      });
    }
  }

  const checked = new Set(accountPages.map((candidate) => urlIdentity(candidate.url)));
  const documents = companionCandidates([...links, ...moreLinks], site, new Set([...exclude, ...checked]))
    .filter((candidate) => candidate.kind === "fee_document")
    .slice(0, MAX_FEE_DOCUMENTS_CHECKED);
  let rejectedAny = false;
  for (const candidate of documents) {
    if (Date.now() > deadline) break;
    if (pages.length >= MAX_COMPANIONS_PER_BANK) break;
    fetches += 1;
    const entry: TrailEntry = { url: candidate.url, source: candidate.source, foundOn: candidate.foundOn, label: candidate.label, score: Math.round(candidate.score * 100) / 100, verdict: "" };
    trail.push(entry);
    try {
      const validation = await validateFeeCandidate(candidate, fetchImpl);
      entry.verdict = validation.verdict;
      if (validation.ok) {
        keep({
          url: candidate.url,
          role: additionalDocumentRole(`${candidate.label} ${new URL(candidate.url).pathname}`),
          kind: "fee_document",
          accountName: accountNameFor(candidate.label, candidate.url),
          documentType: validation.documentType,
          reason: validation.reason,
        });
      } else {
        rejectedAny = rejectedAny || !validation.verdict.startsWith("http_");
      }
    } catch {
      entry.verdict = "fetch_failed";
    }
  }

  // Account, membership and deposit agreements: kept only when they list a fee with an amount.
  const agreements = companionCandidates([...links, ...moreLinks], site, new Set([...exclude, ...checked, ...kept]))
    .filter((candidate) => candidate.kind === "agreement")
    .slice(0, MAX_AGREEMENTS_CHECKED);
  for (const candidate of agreements) {
    if (Date.now() > deadline) break;
    if (pages.length >= MAX_COMPANIONS_PER_BANK) break;
    fetches += 1;
    const entry: TrailEntry = { url: candidate.url, source: candidate.source, foundOn: candidate.foundOn, label: candidate.label, score: Math.round(candidate.score * 100) / 100, verdict: "" };
    trail.push(entry);
    try {
      const check = await agreementListsFees(candidate.url, fetchImpl);
      entry.verdict = check.verdict;
      if (check.ok) {
        keep({
          url: candidate.url,
          role: "consumer_supplement",
          kind: "agreement",
          accountName: accountNameFor(candidate.label, candidate.url),
          documentType: check.documentType,
          reason: check.reason,
        });
      } else {
        rejectedAny = rejectedAny || !check.verdict.startsWith("http_");
      }
    } catch {
      entry.verdict = "fetch_failed";
    }
  }

  if (pages.length > 0) {
    return done({ outcome: "ok", reason: `${pages.length} companion page${pages.length === 1 ? "" : "s"} list fees` });
  }
  if (Date.now() > deadline) return done({ outcome: "timeout", reason: "Out of time" });
  return done({ outcome: rejectedAny || accountPages.length > 0 ? "wrong_document" : "no_candidates", reason: "No candidate listed fees" });
}

export async function runSecondDocumentFind(options: {
  db: SqlTag;
  fetchImpl: Fetcher;
  runId: number;
  stepId?: number | null;
  stateCode?: string | null;
  limit?: number;
  deadline: number;
  dryRun?: boolean;
  learning: boolean;
  /** Which slice of the site-search queries to run; defaults to the current recheck window. */
  searchRotation?: number;
  /** Fill spare slots with hidden banks from any state (default on). */
  hiddenTopUp?: boolean;
}): Promise<RunSecondDocumentFindResult> {
  const empty = (status: RunSecondDocumentFindResult["status"]): RunSecondDocumentFindResult => ({ status, checked: 0, found: 0, results: [] });
  if (!options.learning) return empty("no_attempt_log");
  if (Date.now() > options.deadline) return empty("out_of_time");
  if (!(await companionStreamsReady(options.db))) return empty("schema_pending");

  const db = options.db;
  const limit = options.limit ?? SECOND_DOCUMENT_BANKS_PER_STEP;
  const stateCode = normalizeStateCode(options.stateCode ?? undefined);
  const rows = await selectThinBanks(db, stateCode, limit);
  if (stateCode && rows.length < limit && options.hiddenTopUp !== false) {
    rows.push(...(await selectThinBanks(db, null, limit - rows.length, { hiddenOnly: true, excludeIds: rows.map((row) => Number(row.id)) })));
  }
  const results: SecondDocumentResult[] = [];
  for (const row of rows) {
    if (Date.now() > options.deadline) break;
    const startedAt = Date.now();
    const institutionId = Number(row.id);
    const known = await knownDocumentUrls(db, institutionId);
    const result = await searchBank(row, options.fetchImpl, known, options.deadline, options.searchRotation ?? currentSearchRotation());
    const { trail, ...summary } = result;
    results.push(summary);
    if (options.dryRun) continue;
    for (const page of result.pages) {
      await db`
        INSERT INTO institution_additional_sources
          (institution_id, url, document_type, document_role, account_name, found_by_strategy, strategy_version, agent_run_id, reason)
        VALUES
          (${institutionId}, ${page.url}, ${page.documentType}, ${page.role}, ${page.accountName}, ${SECOND_DOCUMENT_FINDER.strategy},
           ${SECOND_DOCUMENT_FINDER.version}, ${options.runId}, ${page.reason})
        ON CONFLICT (institution_id, url) DO NOTHING
      `;
    }
    // One row per site-search query, beside the bank's main attempt: the query's own hit rate.
    for (const search of result.searches) {
      await recordAttempt(db, {
        institutionId,
        stage: "discover",
        strategy: SITE_SEARCH_STRATEGY.strategy,
        version: SITE_SEARCH_STRATEGY.version,
        fingerprint: search.url,
        outcome: search.outcome,
        yieldCount: search.kept,
        costMicrousd: 0,
        durationMs: search.durationMs,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: { pass: 2, finder: SECOND_DOCUMENT_FINDER.strategy, query: search.query, url: search.url, status: search.status, candidates: search.candidates, kept: search.kept },
        foldIntoPlaybook: false,
      });
    }
    await recordAttempt(db, {
      institutionId,
      stage: "discover",
      strategy: SECOND_DOCUMENT_FINDER.strategy,
      version: SECOND_DOCUMENT_FINDER.version,
      fingerprint: row.fee_schedule_url,
      outcome: result.outcome,
      yieldCount: result.pages.length,
      costMicrousd: 0,
      durationMs: Date.now() - startedAt,
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: {
        pass: 2,
        url: result.url,
        pages: result.pages.map((page) => ({ url: page.url, kind: page.kind, role: page.role, account: page.accountName, document_type: page.documentType })),
        published_categories: result.categories,
        reason: result.reason,
        pages_fetched: result.fetches,
        searches: result.searches.map((search) => ({ query: search.query, outcome: search.outcome, candidates: search.candidates, kept: search.kept })),
        trail: trail.slice(0, 40),
      },
    });
  }
  return { status: "ran", checked: results.length, found: results.reduce((total, result) => total + result.pages.length, 0), results };
}
