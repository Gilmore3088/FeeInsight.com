import { registryFetchJson, type RegistryFetchOptions } from "./http";

/**
 * CFPB Consumer Complaint Database client (public search API). Pure: no DB.
 *
 * `size=0` returns only aggregations, so one request lists every company with
 * complaints in a date range, and one request per company returns its product
 * and issue breakdown. Company names are CFPB's (usually the parent company).
 */

export const CFPB_API = "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/";
export const CFPB_FIRST_YEAR = 2012;

/**
 * CFPB answers bursts with HTTP 429 and then, for a while, HTTP 403. During the October 2026
 * re-load (15 years back to back) 9 of 39 runs died on one such answer after 1-7 s of retries.
 * Both are retried with a longer backoff (4, 8, 16, 32 s, or Retry-After) before a run fails.
 */
export const CFPB_FETCH_DEFAULTS: RegistryFetchOptions = { retries: 4, backoffMs: 4_000, retryStatuses: [403] };

interface Bucket {
  key: string;
  doc_count: number;
}

interface CfpbAggResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: Record<string, Record<string, unknown>>;
}

function yearRange(year: number): { min: string; max: string } {
  return { min: `${year}-01-01`, max: `${year}-12-31` };
}

function buildUrl(params: Record<string, string>, repeated: Record<string, readonly string[]> = {}): string {
  const search = new URLSearchParams({ size: "0", ...params });
  for (const [name, values] of Object.entries(repeated)) for (const value of values) search.append(name, value);
  return `${CFPB_API}?${search.toString()}`;
}

/** Buckets live at aggregations.<name>.<name>.buckets in the CFPB response. */
export function aggregationBuckets(body: CfpbAggResponse, name: string): Bucket[] {
  const outer = body.aggregations?.[name] as Record<string, unknown> | undefined;
  const inner = (outer?.[name] ?? outer) as { buckets?: unknown } | undefined;
  const buckets = Array.isArray(inner?.buckets) ? (inner.buckets as Array<Record<string, unknown>>) : [];
  return buckets
    .map((bucket) => ({ key: String(bucket.key ?? ""), doc_count: Number(bucket.doc_count ?? 0) }))
    .filter((bucket) => bucket.key && Number.isFinite(bucket.doc_count) && bucket.doc_count > 0);
}

export interface SubIssueBucket {
  issue: string;
  subIssue: string;
  doc_count: number;
}

/**
 * Sub-issue buckets nested inside each issue bucket ("sub_issue.raw" in the CFPB response).
 * Returns [] when the response carries none, so callers can tell sub-issues were not loaded.
 */
export function subIssueBuckets(body: CfpbAggResponse): SubIssueBucket[] {
  const outer = body.aggregations?.issue as Record<string, unknown> | undefined;
  const inner = (outer?.issue ?? outer) as { buckets?: unknown } | undefined;
  const issues = Array.isArray(inner?.buckets) ? (inner.buckets as Array<Record<string, unknown>>) : [];
  const out: SubIssueBucket[] = [];
  for (const issue of issues) {
    const issueKey = String(issue.key ?? "");
    for (const [name, value] of Object.entries(issue)) {
      if (!name.startsWith("sub_issue") || !value || typeof value !== "object") continue;
      const holder = value as Record<string, unknown>;
      const nested = (Array.isArray(holder.buckets) ? holder : holder[name] ?? holder.sub_issue) as { buckets?: unknown } | undefined;
      const buckets = Array.isArray(nested?.buckets) ? (nested.buckets as Array<Record<string, unknown>>) : [];
      for (const bucket of buckets) {
        const subIssue = String(bucket.key ?? "");
        const count = Number(bucket.doc_count ?? 0);
        if (issueKey && subIssue && Number.isFinite(count) && count > 0) out.push({ issue: issueKey, subIssue, doc_count: count });
      }
    }
  }
  return out;
}

export async function fetchCfpbCompanyCounts(
  year: number,
  options: RegistryFetchOptions = {},
): Promise<{ companies: Bucket[]; url: string }> {
  const { min, max } = yearRange(year);
  const url = buildUrl({ date_received_min: min, date_received_max: max });
  const body = await registryFetchJson<CfpbAggResponse>(url, { ...CFPB_FETCH_DEFAULTS, timeoutMs: 120_000, ...options });
  return { companies: aggregationBuckets(body, "company"), url };
}

export interface CfpbCompanyBreakdown {
  company: string;
  total: number;
  products: Bucket[];
  issues: Bucket[];
  url: string;
}

export async function fetchCfpbCompanyBreakdown(
  company: string,
  year: number,
  options: RegistryFetchOptions = {},
): Promise<CfpbCompanyBreakdown> {
  const { min, max } = yearRange(year);
  const url = buildUrl({ company, date_received_min: min, date_received_max: max });
  const body = await registryFetchJson<CfpbAggResponse>(url, { ...CFPB_FETCH_DEFAULTS, ...options });
  const total = typeof body.hits?.total === "number" ? body.hits.total : Number(body.hits?.total?.value ?? 0);
  return {
    company,
    total,
    products: aggregationBuckets(body, "product"),
    issues: aggregationBuckets(body, "issue"),
    url,
  };
}

export interface CfpbProductIssues {
  company: string;
  total: number;
  issues: Bucket[];
  subIssues: SubIssueBucket[];
  url: string;
}

/** One company-year's issues (and sub-issues, when returned) within the given products only. */
export async function fetchCfpbCompanyProductIssues(
  company: string,
  year: number,
  products: readonly string[],
  options: RegistryFetchOptions = {},
): Promise<CfpbProductIssues> {
  const { min, max } = yearRange(year);
  const url = buildUrl({ company, date_received_min: min, date_received_max: max }, { product: products });
  const body = await registryFetchJson<CfpbAggResponse>(url, { ...CFPB_FETCH_DEFAULTS, ...options });
  const total = typeof body.hits?.total === "number" ? body.hits.total : Number(body.hits?.total?.value ?? 0);
  return { company, total, issues: aggregationBuckets(body, "issue"), subIssues: subIssueBuckets(body), url };
}

const NAME_NOISE = new Set([
  "THE",
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "LLC",
  "LTD",
  "NA",
  "N",
  "A",
  "NATIONAL",
  "ASSOCIATION",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "FINANCIAL",
  "SERVICES",
  "BANCORP",
  "BANCORPORATION",
  "BANCSHARES",
  "BCORP",
  "FINL",
  "PLC",
  "BANK",
  "FSB",
  "SSB",
  "USA",
  "US",
  "OF",
]);

/**
 * Comparable company key: upper case, punctuation and corporate/bank noise
 * removed. "JPMORGAN CHASE & CO." and "JPMorgan Chase Bank, National
 * Association" both become "JPMORGAN CHASE". Credit-union words are kept so
 * "Navy Federal Credit Union" never collapses to "NAVY".
 */
const LEGAL_SUFFIXES = new Set(["THE", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LLC", "LTD", "PLC"]);
const ABBREVIATIONS: Record<string, string> = { BCORP: "BANCORP", FINL: "FINANCIAL", ASSN: "ASSOCIATION", BANCSHS: "BANCSHARES" };

/**
 * Full company key: only legal suffixes dropped and FFIEC abbreviations expanded, so
 * "CITIZENS FINANCIAL GROUP, INC." (CFPB) and "CITIZENS FINANCIAL GROUP INC" (FFIEC holding
 * company) agree while plain "Citizens Bank" stays distinct.
 */
export function fullCompanyKey(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .replace(/&/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ABBREVIATIONS[token] ?? token)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .join(" ");
}

export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return "";
  const tokens = name
    .toUpperCase()
    .replace(/&/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = tokens.filter((token) => !NAME_NOISE.has(token));
  return (kept.length > 0 ? kept : tokens).join(" ");
}
