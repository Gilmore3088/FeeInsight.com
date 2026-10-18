import { createHash } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ApiKeyValidation } from "@/lib/api-auth";
import type { RateLimitResult } from "@/lib/api-rate-limit";

/**
 * Shared plumbing for the public /api/v1 routes: one error shape, one set of
 * response headers, and the same input checks on every endpoint.
 */

/** One monthly allowance per key (or anonymous caller) across all v1 endpoints. */
export const API_V1_RATE_LIMIT_ROUTE = "api.v1";

/** Every stable machine code a v1 error carries; openapi.json lists the same set. */
/**
 * The API's version, shown in /api/v1/openapi.json and the connector's serverInfo. Bump it in any PR
 * that changes the API; scripts/ci-guards.sh api-docs-kill enforces that (James, 2026-10-17).
 */
export const API_VERSION = "1.11.0";

export const API_ERROR_CODES = [
  "api_key_required",
  "burst_limited",
  "data_unavailable",
  "invalid_api_key",
  "invalid_parameter",
  "key_revoked",
  "not_found",
  "plan_required",
  "rate_limited",
  "rate_limit_unavailable",
  "seat_removed",
  "subscription_inactive",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** How long a client may reuse a successful data response before asking again. */
export const API_V1_CACHE_CONTROL = "private, max-age=300";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, ETag",
};

export function getAnonymousId(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/** Paid keys (pro, enterprise) see the full catalog and per-institution detail. */
export function isPaidApiKey(auth: ApiKeyValidation): boolean {
  return auth.valid && (auth.tier === "pro" || auth.tier === "enterprise");
}

/**
 * CORS plus rate-limit headers. Unlimited keys get no X-RateLimit-Limit or
 * X-RateLimit-Remaining, since "Infinity" is not a valid header count.
 */
export function withApiHeaders<T extends Response>(response: T, rateLimit?: RateLimitResult): T {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  if (rateLimit) {
    if (Number.isFinite(rateLimit.limit)) {
      response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
      response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
    }
    response.headers.set("X-RateLimit-Reset", rateLimit.reset.toISOString());
  }
  return response;
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  options: { rateLimit?: RateLimitResult; extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
): NextResponse {
  const response = NextResponse.json(
    { error: message, code, ...options.extra },
    { status, headers: options.headers },
  );
  // Errors are never cached: a retry should reach the server.
  response.headers.set("Cache-Control", "no-store");
  return withApiHeaders(response, options.rateLimit);
}

export function apiKeyRequiredError(): NextResponse {
  return apiError(401, "api_key_required", "An API key is required. Ask hello@bankfeeindex.com for access.", {
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

/** The response for a failed or exhausted rate-limit reservation. */
export function rateLimitError(rateLimit: RateLimitResult): NextResponse {
  if (rateLimit.unavailable) {
    return apiError(503, "rate_limit_unavailable", "Usage tracking is temporarily unavailable. Please retry shortly.", {
      headers: { "Retry-After": "60" },
    });
  }
  return apiError(429, "rate_limited", "Monthly request allowance used up", {
    rateLimit,
    extra: { limit: rateLimit.limit, reset: rateLimit.reset.toISOString() },
  });
}

/** The response when a plan has made more than its per-minute calls. */
export function burstLimitError(burst: RateLimitResult, now: Date = new Date()): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((burst.reset.getTime() - now.getTime()) / 1000));
  return apiError(429, "burst_limited", `Too many requests this minute. Each plan can make ${burst.limit} calls a minute, so retry after ${retryAfter} seconds.`, {
    headers: { "Retry-After": String(retryAfter) },
    extra: { limit: burst.limit, reset: burst.reset.toISOString() },
  });
}

export function planRequiredError(rateLimit: RateLimitResult, what: string): NextResponse {
  return apiError(403, "plan_required", `${what} requires a Pro or Enterprise API key`, {
    rateLimit,
    extra: { upgrade_url: "/subscribe" },
  });
}

function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === bare);
}

/**
 * Caching for a successful v1 data response (JSON or CSV): a short private max-age, a weak
 * ETag over the body, and a 304 with the same headers when the client already holds that
 * body. The call still counts against the burst and monthly allowances.
 */
export async function withApiCaching(request: Request, response: Response): Promise<Response> {
  if (response.status !== 200) return response;
  const body = Buffer.from(await response.clone().arrayBuffer());
  const etag = `W/"${createHash("sha1").update(body).digest("hex")}"`;
  response.headers.set("ETag", etag);
  response.headers.set("Cache-Control", API_V1_CACHE_CONTROL);
  response.headers.set("Vary", "Authorization, Cookie");
  if (!ifNoneMatchHits(request.headers.get("if-none-match"), etag)) return response;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new NextResponse(null, { status: 304, headers });
}

export function apiOptions(): Response {
  return withApiHeaders(new Response(null, { status: 204 }));
}

export class ApiParamError extends Error {}

/** Positive integer query param within [min, max]; missing returns the fallback. */
export function intParam(
  params: URLSearchParams,
  name: string,
  { fallback, min, max }: { fallback: number; min: number; max: number },
): number {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new ApiParamError(`${name} must be a whole number`);
  const value = Number(raw);
  if (value < min || value > max) throw new ApiParamError(`${name} must be between ${min} and ${max}`);
  return value;
}

/** Two-letter state code, upper-cased, or null when absent. */
export function stateParam(params: URLSearchParams): string | null {
  const raw = params.get("state");
  if (raw === null || raw === "") return null;
  if (!/^[A-Za-z]{2}$/.test(raw)) throw new ApiParamError("state must be a two-letter code such as TX");
  return raw.toUpperCase();
}

export function charterParam(params: URLSearchParams): "bank" | "credit_union" | null {
  const raw = params.get("charter");
  if (raw === null || raw === "") return null;
  if (raw !== "bank" && raw !== "credit_union") throw new ApiParamError("charter must be bank or credit_union");
  return raw;
}

/** Comma-separated Fed districts 1-12, or null when absent. */
export function districtParam(params: URLSearchParams): number[] | null {
  const raw = params.get("district");
  if (raw === null || raw === "") return null;
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part) || Number(part) < 1 || Number(part) > 12)) {
    throw new ApiParamError("district must be Fed district numbers 1-12, comma-separated");
  }
  return [...new Set(parts.map(Number))];
}

export function formatParam(params: URLSearchParams): "json" | "csv" {
  const raw = params.get("format");
  if (raw === null || raw === "" || raw === "json") return "json";
  if (raw === "csv") return "csv";
  throw new ApiParamError("format must be json or csv");
}

/** RFC 4180 field quoting, plus a leading quote on values a spreadsheet would run as a formula. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((row) => row.map(csvField).join(","))].join("\n");
}

/** Asset-size tiers as stored on institution_sources, smallest first. */
export const ASSET_TIERS = [
  "community_small",
  "community_mid",
  "community_large",
  "regional",
  "large_regional",
  "super_regional",
] as const;

/** Comma-separated asset tiers, or null when absent. */
export function assetTierParam(params: URLSearchParams): string[] | null {
  const raw = params.get("asset_tier");
  if (raw === null || raw === "") return null;
  const parts = raw.split(",").map((part) => part.trim());
  const allowed = new Set<string>(ASSET_TIERS);
  if (parts.some((part) => !allowed.has(part))) {
    throw new ApiParamError(`asset_tier must be one or more of ${ASSET_TIERS.join(", ")}`);
  }
  return [...new Set(parts)];
}

const ISO_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * An ISO 8601 date (2026-10-01) or date-time (2026-10-01T12:00:00Z, or with an offset), or
 * null when absent. A date, or a time with no zone, is read as UTC. Calendar-impossible dates
 * such as 2026-02-30 are refused rather than rolled into the next month.
 */
export function dateTimeParam(params: URLSearchParams, name: string): Date | null {
  const raw = params.get(name)?.trim();
  if (raw === undefined || raw === "") return null;
  const message = `${name} must be an ISO 8601 date or date-time, e.g. 2026-10-01 or 2026-10-01T00:00:00Z`;
  const match = ISO_DATE_TIME_RE.exec(raw);
  if (!match) throw new ApiParamError(message);
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) ||
    (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59))
  ) {
    throw new ApiParamError(message);
  }
  const value = new Date(hour === undefined ? `${raw}T00:00:00Z` : zone ? raw : `${raw}Z`);
  if (Number.isNaN(value.getTime())) throw new ApiParamError(message);
  return value;
}

/** Comma-separated institution ids (positive whole numbers), at most `max` distinct, or null when absent. */
export function idListParam(params: URLSearchParams, name: string, max: number): number[] | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return null;
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0 || parts.some((part) => !/^\d{1,10}$/.test(part) || Number(part) < 1)) {
    throw new ApiParamError(`${name} must be institution ids, comma-separated, e.g. 12,48,301`);
  }
  const ids = [...new Set(parts.map(Number))];
  if (ids.length > max) throw new ApiParamError(`${name} takes at most ${max} institutions`);
  return ids;
}
