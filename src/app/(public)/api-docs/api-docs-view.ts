/**
 * Pure (no database imports, so the client sections can import it).
 * Everything /api-docs shows, as data: the endpoint list, the error codes, the key tiers and the
 * page copy. Each entry is checked against the route code in api-docs-view.test.ts (paths exist,
 * parameter bounds match the route's intParam calls, error codes match apiError calls), so the page
 * cannot document something the API does not do.
 */
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { getDisplayName, getFeeFamily, getFeeTier } from "@/lib/fee-taxonomy";

export const API_BASE_PATH = "/api/v1";

/**
 * Where a key request goes: the contact form opened on its "Data licensing / API" option, so the
 * ask lands in /admin/leads. The form accepts only its own option values as ?source=.
 */
export const API_KEY_REQUEST_HREF = "/contact?source=partnership";

/** Who can call an endpoint: any issued key, a Pro or Enterprise key, or anyone. */
export type ApiAccess = "key" | "pro" | "public";

export const ACCESS_LABEL: Record<ApiAccess, string> = {
  key: "Any key",
  pro: "Pro key",
  public: "No key",
};

export interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  note: string;
  /** The route's own intParam bounds; the note then states the default and the maximum. */
  bounds?: { fallback: number; min: number; max: number };
}

export interface ApiField {
  /** Dotted path; `data[].median` is a field of each object in the `data` array. */
  name: string;
  type: string;
}

export interface ApiEndpoint {
  id: string;
  method: "GET" | "POST";
  /** Path under /api/v1, without the query. */
  path: string;
  /** The query that selects this use of the route, e.g. `category={key}`. */
  query?: string;
  summary: string;
  access: ApiAccess;
  params: ApiParam[];
  /** The JSON response's fields, in the order the route writes them. Empty for non-JSON-shape routes. */
  fields: ApiField[];
}

const FORMAT_PARAM: ApiParam = { name: "format", type: "json | csv", note: "csv needs a Pro key" };
const STATE_PARAM: ApiParam = { name: "state", type: "string", note: "Two-letter state code, e.g. TX" };
const CHARTER_PARAM: ApiParam = { name: "charter", type: "bank | credit_union", note: "Charter type" };
const ASSET_TIER_PARAM: ApiParam = {
  name: "asset_tier",
  type: "string",
  note: "Asset-size tiers, comma-separated, e.g. community_mid",
};
const PAGE_PARAM: ApiParam = { name: "page", type: "integer", note: "Page number, from 1" };
const LIMIT_PARAM: ApiParam = {
  name: "limit",
  type: "integer",
  note: "Rows per page",
  bounds: { fallback: 50, min: 1, max: 200 },
};

const SUMMARY_FIELDS: ApiField[] = [
  { name: "data[].category", type: "string" },
  { name: "data[].display_name", type: "string" },
  { name: "data[].family", type: "string" },
  { name: "data[].tier", type: "string" },
  { name: "data[].median", type: "number | null" },
  { name: "data[].p25", type: "number | null" },
  { name: "data[].p75", type: "number | null" },
  { name: "data[].min", type: "number | null" },
  { name: "data[].max", type: "number | null" },
  { name: "data[].institution_count", type: "integer" },
];

const PAGE_FIELDS: ApiField[] = [
  { name: "total", type: "integer" },
  { name: "page", type: "integer" },
  { name: "page_size", type: "integer" },
  { name: "pages", type: "integer" },
  { name: "has_more", type: "boolean" },
];

const ATTRIBUTION_FIELD: ApiField = { name: "attribution", type: "{ text, url }" };

const BREAKDOWN = "{ dimension_value, count, min_amount, max_amount, avg_amount, median_amount }[]";

export const API_ENDPOINTS: readonly ApiEndpoint[] = [
  {
    id: "fees",
    method: "GET",
    path: "/fees",
    summary: "National benchmark for every fee category",
    access: "key",
    params: [FORMAT_PARAM],
    fields: [{ name: "total", type: "integer" }, ...SUMMARY_FIELDS, ATTRIBUTION_FIELD],
  },
  {
    id: "fees-category",
    method: "GET",
    path: "/fees",
    query: "category={key}",
    summary: "One fee split by charter, asset size, Fed district and state",
    access: "pro",
    params: [{ name: "category", type: "string", required: true, note: "Category key from /fees, e.g. overdraft" }],
    fields: [
      { name: "category", type: "string" },
      { name: "display_name", type: "string" },
      { name: "family", type: "string" },
      { name: "tier", type: "string" },
      { name: "summary.institution_count", type: "integer" },
      { name: "summary.observation_count", type: "integer" },
      { name: "by_charter_type", type: BREAKDOWN },
      { name: "by_asset_tier", type: BREAKDOWN },
      { name: "by_fed_district", type: BREAKDOWN },
      { name: "by_state", type: BREAKDOWN },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "index",
    method: "GET",
    path: "/index",
    summary: "The fee index, national or for a peer group",
    access: "key",
    params: [
      STATE_PARAM,
      CHARTER_PARAM,
      { name: "district", type: "string", note: "Fed district numbers, comma-separated, e.g. 2,7" },
      ASSET_TIER_PARAM,
      FORMAT_PARAM,
    ],
    fields: [
      { name: "scope", type: "\"national\" | \"filtered\"" },
      { name: "filters.state", type: "string | null" },
      { name: "filters.charter", type: "string | null" },
      { name: "filters.district", type: "string | null" },
      { name: "filters.asset_tier", type: "string | null" },
      { name: "total", type: "integer" },
      ...SUMMARY_FIELDS,
      { name: "data[].bank_count", type: "integer" },
      { name: "data[].cu_count", type: "integer" },
      { name: "data[].maturity", type: "string" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "institutions",
    method: "GET",
    path: "/institutions",
    summary: "Find banks and credit unions by name, place or size",
    access: "key",
    params: [
      { name: "q", type: "string", note: "Name search, 2 to 100 characters" },
      STATE_PARAM,
      CHARTER_PARAM,
      { name: "city", type: "string", note: "City name; not with q or fee_category" },
      { ...ASSET_TIER_PARAM, note: `${ASSET_TIER_PARAM.note}; not with q or fee_category` },
      { name: "has_fees", type: "boolean", note: "true for institutions with published fees only" },
      PAGE_PARAM,
      LIMIT_PARAM,
    ],
    fields: [
      ...PAGE_FIELDS,
      { name: "data[].id", type: "integer" },
      { name: "data[].name", type: "string" },
      { name: "data[].state", type: "string" },
      { name: "data[].city", type: "string" },
      { name: "data[].charter_type", type: "string" },
      { name: "data[].asset_size", type: "number | null" },
      { name: "data[].asset_tier", type: "string" },
      { name: "data[].fed_district", type: "integer | null" },
      { name: "data[].fee_count", type: "integer" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "institutions-rank",
    method: "GET",
    path: "/institutions",
    query: "fee_category={key}",
    summary: "Rank institutions by what they charge for one fee",
    access: "pro",
    params: [
      { name: "fee_category", type: "string", required: true, note: "Category key from /fees" },
      { name: "sort", type: "highest | lowest", note: "Default highest" },
      STATE_PARAM,
      CHARTER_PARAM,
      PAGE_PARAM,
      LIMIT_PARAM,
    ],
    fields: [
      { name: "fee_category", type: "string" },
      { name: "display_name", type: "string" },
      { name: "sort", type: "string" },
      { name: "note", type: "string" },
      ...PAGE_FIELDS,
      { name: "data[].id", type: "integer" },
      { name: "data[].name", type: "string" },
      { name: "data[].state", type: "string" },
      { name: "data[].city", type: "string" },
      { name: "data[].charter_type", type: "string" },
      { name: "data[].asset_size", type: "number | null" },
      { name: "data[].fee_amount", type: "number | null" },
      { name: "data[].fee_count", type: "integer" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "institution-detail",
    method: "GET",
    path: "/institutions",
    query: "id={id}",
    summary: "One institution's fees, each with its source link",
    access: "pro",
    params: [
      { name: "id", type: "integer", required: true, note: "Institution id from /institutions" },
      { name: "view", type: "detail | benchmark | regulatory_watch", note: "Default detail" },
      {
        name: "quarters",
        type: "integer",
        note: "Call report quarters",
        bounds: { fallback: 8, min: 1, max: 66 },
      },
      { name: "format", type: "json | csv", note: "csv with view=benchmark" },
    ],
    fields: [
      { name: "id", type: "integer" },
      { name: "name", type: "string" },
      { name: "fee_count", type: "integer" },
      { name: "fees[].fee_name", type: "string" },
      { name: "fees[].category", type: "string" },
      { name: "fees[].amount", type: "number | null" },
      { name: "fees[].frequency", type: "string | null" },
      { name: "fees[].conditions", type: "string | null" },
      { name: "fees[].source_url", type: "string | null" },
      { name: "rate_fees[].rate_percent", type: "number" },
      { name: "call_reports", type: "object[]" },
      { name: "complaints[].product", type: "string" },
      { name: "complaints[].complaint_count", type: "integer" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "revenue",
    method: "GET",
    path: "/revenue",
    summary: "Service-charge income by quarter, from call reports",
    access: "pro",
    params: [
      { name: "view", type: "national | districts", note: "Default national" },
      { name: "quarters", type: "integer", note: "Quarters back", bounds: { fallback: 8, min: 1, max: 66 } },
    ],
    fields: [
      { name: "view", type: "string" },
      { name: "units", type: "string" },
      { name: "data[].quarter", type: "string" },
      { name: "data[].service_charges", type: "number" },
      { name: "data[].bank_service_charges", type: "number" },
      { name: "data[].credit_union_service_charges", type: "number" },
      { name: "data[].institutions", type: "integer" },
      { name: "data[].yoy_change_pct", type: "number | null" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "fee-changes",
    method: "GET",
    path: "/fee-changes",
    summary: "Fee changes we detected, newest first",
    access: "pro",
    params: [
      { name: "days", type: "integer", note: "Days back", bounds: { fallback: 90, min: 1, max: 365 } },
      { name: "category", type: "string", note: "Category key from /fees" },
    ],
    fields: [
      { name: "days", type: "integer" },
      { name: "category", type: "string | null" },
      { name: "count", type: "integer" },
      { name: "data[].institution_id", type: "integer" },
      { name: "data[].institution_name", type: "string" },
      { name: "data[].category", type: "string" },
      { name: "data[].previous_amount", type: "number | null" },
      { name: "data[].new_amount", type: "number | null" },
      { name: "data[].change", type: "string" },
      { name: "data[].detected_at", type: "string" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "branches",
    method: "GET",
    path: "/branches",
    summary: "Branch addresses and map points, by institution or area",
    access: "pro",
    params: [
      { name: "institution_id", type: "integer", note: "Use this, or state" },
      { name: "state", type: "string", note: "Two-letter code; add city or zip to narrow" },
      { name: "city", type: "string", note: "With state" },
      { name: "zip", type: "string", note: "Five-digit ZIP, with state" },
      PAGE_PARAM,
      { name: "limit", type: "integer", note: "Rows per page", bounds: { fallback: 100, min: 1, max: 500 } },
    ],
    fields: [
      { name: "sod_year", type: "integer | null" },
      ...PAGE_FIELDS,
      { name: "data[].source", type: "\"fdic_sod\" | \"ncua\"" },
      { name: "data[].institution_name", type: "string | null" },
      { name: "data[].address", type: "string | null" },
      { name: "data[].city", type: "string | null" },
      { name: "data[].zip", type: "string | null" },
      { name: "data[].latitude", type: "number | null" },
      { name: "data[].longitude", type: "number | null" },
      { name: "data[].deposits", type: "number | null" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "market",
    method: "GET",
    path: "/market",
    summary: "Who competes in an institution's local market, with deposit share",
    access: "pro",
    params: [{ name: "institution_id", type: "integer", required: true, note: "Institution id from /institutions" }],
    fields: [
      { name: "institution_id", type: "integer" },
      { name: "basis", type: "\"branch_counties\" | \"hq_city\"" },
      { name: "places", type: "string[]" },
      { name: "sod_year", type: "integer" },
      { name: "competitor_count", type: "integer" },
      { name: "total_market_deposits", type: "number" },
      { name: "data[].institution_id", type: "integer" },
      { name: "data[].name", type: "string" },
      { name: "data[].is_subject", type: "boolean" },
      { name: "data[].market_deposits", type: "number | null" },
      { name: "data[].deposit_share_pct", type: "number | null" },
      ATTRIBUTION_FIELD,
    ],
  },
  {
    id: "mcp",
    method: "POST",
    path: "/mcp",
    summary: "MCP server, so an AI assistant can query these endpoints with your key",
    access: "key",
    params: [],
    fields: [],
  },
  {
    id: "openapi",
    method: "GET",
    path: "/openapi.json",
    summary: "OpenAPI spec for code generators and Postman",
    access: "public",
    params: [],
    fields: [],
  },
];

/** Error responses: every one is `{ error, code }` JSON. Checked against apiError calls. */
export const API_ERRORS: readonly { status: number; code: string; when: string }[] = [
  { status: 400, code: "invalid_parameter", when: "A parameter is out of range or malformed" },
  { status: 401, code: "api_key_required", when: "No key sent" },
  { status: 401, code: "invalid_api_key", when: "Key unknown or revoked" },
  { status: 403, code: "plan_required", when: "The endpoint needs a Pro key" },
  { status: 404, code: "not_found", when: "No such category, institution or local market" },
  { status: 429, code: "rate_limited", when: "Monthly allowance used up" },
  { status: 503, code: "rate_limit_unavailable", when: "Usage tracking is down; retry shortly" },
  { status: 503, code: "data_unavailable", when: "Revenue data is down; retry shortly" },
];

export const RATE_LIMIT_HEADERS = ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"] as const;

/** Route file that serves an endpoint, relative to the repo root. */
export function routeFileFor(endpoint: Pick<ApiEndpoint, "path">): string {
  return `src/app/api/v1${endpoint.path}/route.ts`;
}

export function fullPath(endpoint: Pick<ApiEndpoint, "path" | "query">): string {
  return `${API_BASE_PATH}${endpoint.path}${endpoint.query ? `?${endpoint.query}` : ""}`;
}

export function paramNote(param: ApiParam): string {
  if (!param.bounds) return param.note;
  return `${param.note}. Default ${formatInt(param.bounds.fallback)}, up to ${formatInt(param.bounds.max)}`;
}

const INT = new Intl.NumberFormat("en-US");

export function formatInt(n: number): string {
  return INT.format(n);
}

/** A monthly allowance as shown: a count, or "Unlimited" for an enterprise key. */
export function formatAllowance(limit: number): string {
  return Number.isFinite(limit) ? formatInt(limit) : "Unlimited";
}

export interface KeyTier {
  name: string;
  allowance: string;
  categories: string;
  endpoints: string;
}

/**
 * The three key tiers, from the rate-limit constants, the spotlight list and the live category
 * count. A free key reaches the any-key endpoints with spotlight categories only.
 */
export function keyTiers(input: {
  spotlightCount: number;
  categoriesLabel: string;
  /** UNAVAILABLE_LABEL from public-stats: the category count's read failed, so no count is shown. */
  unavailableLabel: string;
  /** API_TIER_LIMITS from api-rate-limit (passed in so this module stays free of database imports). */
  limits: Readonly<Record<"free" | "pro" | "enterprise", number>>;
}): KeyTier[] {
  const { limits } = input;
  const open = distinctPaths(API_ENDPOINTS.filter((e) => e.access !== "pro"));
  const all = distinctPaths(API_ENDPOINTS);
  const allCategories =
    input.categoriesLabel === input.unavailableLabel ? COPY.allCategories : `All ${input.categoriesLabel}`;
  return [
    {
      name: "Free key",
      allowance: formatAllowance(limits.free),
      categories: `${formatInt(input.spotlightCount)} spotlight`,
      endpoints: `${open} of ${all}`,
    },
    {
      name: "Pro key",
      allowance: formatAllowance(limits.pro),
      categories: allCategories,
      endpoints: `All ${all}`,
    },
    {
      name: "Enterprise key",
      allowance: formatAllowance(limits.enterprise),
      categories: allCategories,
      endpoints: `All ${all}`,
    },
  ];
}

/** Endpoints count by route path: /fees and /fees?category= are one endpoint. */
export function distinctPaths(endpoints: readonly Pick<ApiEndpoint, "path">[]): number {
  return new Set(endpoints.map((e) => e.path)).size;
}

export function curlFor(siteUrl: string, path: string): string {
  return `curl -H "Authorization: Bearer bfi_your_key" \\\n  ${siteUrl}${path}`;
}

interface ShapeNode {
  type?: string;
  array?: boolean;
  children: Map<string, ShapeNode>;
}

/**
 * The response skeleton from the field list: `data[].median` nests `median` inside each `data`
 * object. Values are types, so nothing in it reads as a real figure.
 */
export function responseShape(fields: readonly ApiField[]): string {
  const root: ShapeNode = { children: new Map() };
  for (const field of fields) {
    let node = root;
    const parts = field.name.split(".");
    parts.forEach((part, i) => {
      const array = part.endsWith("[]");
      const key = array ? part.slice(0, -2) : part;
      let child = node.children.get(key);
      if (!child) {
        child = { children: new Map() };
        node.children.set(key, child);
      }
      if (array) child.array = true;
      if (i === parts.length - 1) child.type = field.type;
      node = child;
    });
  }
  const render = (node: ShapeNode, depth: number): string => {
    const pad = "  ".repeat(depth + 1);
    const lines = [...node.children.entries()].map(([key, child]) => {
      if (child.children.size === 0) return `${pad}"${key}": ${child.type ?? "unknown"}`;
      const inner = render(child, depth + 1);
      return child.array ? `${pad}"${key}": [${inner}, ...]` : `${pad}"${key}": ${inner}`;
    });
    return `{\n${lines.join(",\n")}\n${"  ".repeat(depth)}}`;
  };
  return render(root, 0);
}

/**
 * The live free-key response to GET /api/v1/fees: the same rows and mapping the route uses, read
 * from the same snapshot, with the first row shown. Null when the read returned nothing.
 */
export function liveFeesSample(
  summaries: readonly FeeCategorySummary[],
  spotlight: readonly string[],
  attribution: { text: string; url: string },
): { total: number; json: string } | null {
  const keep = new Set(spotlight);
  const rows = summaries.filter((s) => keep.has(s.fee_category));
  if (rows.length === 0) return null;
  const first = rows[0];
  const row = {
    category: first.fee_category,
    display_name: getDisplayName(first.fee_category),
    family: getFeeFamily(first.fee_category),
    tier: getFeeTier(first.fee_category),
    median: first.median_amount,
    p25: first.p25_amount,
    p75: first.p75_amount,
    min: first.min_amount,
    max: first.max_amount,
    institution_count: first.institution_count,
  };
  const rowJson = JSON.stringify(row, null, 2).replace(/\n/g, "\n    ");
  const more = rows.length > 1 ? `,\n    ...` : "";
  const json = `{\n  "total": ${rows.length},\n  "data": [\n    ${rowJson}${more}\n  ],\n  "attribution": ${JSON.stringify(
    attribution,
  )}\n}`;
  return { total: rows.length, json };
}

/** The hero's coverage strip: live counts from the public snapshot, under their site-wide names. */
export function coverageStrip(
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "observationsLabel" | "categoriesLabel" | "statesLabel">,
  /** COVERAGE_LABELS from public-stats, passed in so this module stays free of database imports. */
  labels: { institutions: string; observations: string; categories: string },
  /** UNAVAILABLE_LABEL from public-stats: a figure whose read failed is left out, never shown as a dash. */
  unavailableLabel: string,
): { label: string; value: string }[] {
  const strip = [
    { label: labels.institutions, value: summary.institutionsLabel },
    { label: labels.observations, value: summary.observationsLabel },
    { label: labels.categories, value: summary.categoriesLabel },
    { label: COPY.statesLabel, value: summary.statesLabel },
  ];
  return strip.filter((item) => item.value !== unavailableLabel);
}

export function liveResponseNote(total: number): string {
  return `free key, first of ${formatInt(total)} rows`;
}

/** Page copy, kept here so the tests can read every visible string. */
export const COPY = {
  eyebrow: "Developer API",
  title: "The Bank Fee Index, by API",
  lede: "Published fees for U.S. banks and credit unions, as JSON or CSV.",
  quickstartHeading: "One request",
  statesLabel: "States with published fees",
  requestLabel: "Request",
  liveResponseLabel: "Live response",
  shapeResponseLabel: "Response shape",
  endpointsHeading: "Endpoints",
  paramsLabel: "Parameters",
  responseLabel: "Response",
  noParams: "No parameters.",
  required: "required",
  openSpec: "Open the spec",
  accessHeading: "Keys and limits",
  authLine: "Send your key as a Bearer token, or as the api_key query parameter. Keys start with bfi_.",
  limitLine: "Each key has one monthly allowance across all endpoints, reset at the start of each month (UTC). Unlimited keys get Reset only.",
  tierColumns: ["requests a month", "Fee categories", "Endpoints"],
  errorsHeading: "Errors",
  allCategories: "All categories",
  ctaHeading: "Get a key",
  ctaButton: "Ask for a key",
  ctaLine: "We issue keys by hand. Ask and we will set one up.",
  copy: "Copy",
  copied: "Copied",
} as const;
