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

function buildUrl(params: Record<string, string>): string {
  const search = new URLSearchParams({ size: "0", ...params });
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

export async function fetchCfpbCompanyCounts(
  year: number,
  options: RegistryFetchOptions = {},
): Promise<{ companies: Bucket[]; url: string }> {
  const { min, max } = yearRange(year);
  const url = buildUrl({ date_received_min: min, date_received_max: max });
  const body = await registryFetchJson<CfpbAggResponse>(url, { timeoutMs: 120_000, ...options });
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
  const body = await registryFetchJson<CfpbAggResponse>(url, options);
  const total = typeof body.hits?.total === "number" ? body.hits.total : Number(body.hits?.total?.value ?? 0);
  return {
    company,
    total,
    products: aggregationBuckets(body, "product"),
    issues: aggregationBuckets(body, "issue"),
    url,
  };
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
