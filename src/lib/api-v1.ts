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

export type ApiErrorCode =
  | "api_key_required"
  | "invalid_api_key"
  | "invalid_parameter"
  | "not_found"
  | "plan_required"
  | "rate_limited"
  | "rate_limit_unavailable";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
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

export function planRequiredError(rateLimit: RateLimitResult, what: string): NextResponse {
  return apiError(403, "plan_required", `${what} requires a Pro or Enterprise API key`, {
    rateLimit,
    extra: { upgrade_url: "/subscribe" },
  });
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
