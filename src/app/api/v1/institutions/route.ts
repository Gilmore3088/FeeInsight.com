import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  getInstitutionById,
  getFeesByInstitution,
  getInstitutionsByFilter,
  getFinancialsByInstitution,
  getComplaintsByInstitution,
} from "@/lib/data-store";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";

function getAnonymousId(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// Postgres BIGINT/NUMERIC columns arrive as strings; partners need real numbers.
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function withRateLimitHeaders(
  response: NextResponse,
  rateLimit: { limit: number; remaining: number; reset: Date },
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", rateLimit.reset.toISOString());
  return response;
}

async function handleGET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const organizationId = auth.organizationId;
  const anonymousId = organizationId ? null : getAnonymousId(request);
  const tier = auth.valid ? auth.tier : "free";
  const rateLimit = await checkRateLimitWithTier(
    organizationId,
    anonymousId,
    tier,
    "api.v1.institutions",
  );

  if (!rateLimit.allowed) {
    const response = NextResponse.json(
      {
        error: "Rate limit exceeded",
        limit: rateLimit.limit,
        reset: rateLimit.reset.toISOString(),
      },
      { status: 429 },
    );
    return withRateLimitHeaders(response, rateLimit);
  }

  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const state = searchParams.get("state");
  const charter = searchParams.get("charter");
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const pageSize = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  // Single institution detail
  if (id) {
    const instId = parseInt(id, 10);
    if (isNaN(instId)) {
      const response = NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      return withRateLimitHeaders(response, rateLimit);
    }

    const inst = await getInstitutionById(instId);
    if (!inst) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
        institution_id: instId,
        status: 404,
      }).catch(() => {});
      const response = NextResponse.json({ error: "Institution not found" }, { status: 404 });
      return withRateLimitHeaders(response, rateLimit);
    }

    const fees = (await getFeesByInstitution(instId))
      .filter((f) => f.review_status !== "rejected")
      .map((f) => ({
        fee_name: f.fee_name,
        category: f.fee_category,
        amount: f.amount,
        frequency: f.frequency,
        conditions: f.conditions,
        review_status: f.review_status,
        confidence: f.extraction_confidence,
        source_url: f.source_url ?? null,
        published_at: f.created_at ?? null,
      }));

    // Federal data: FDIC/NCUA call report quarters and CFPB complaint totals.
    const [financials, complaints] = await Promise.all([
      getFinancialsByInstitution(instId, 8),
      getComplaintsByInstitution(instId),
    ]);

    logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
      institution_id: instId,
      status: 200,
    }).catch(() => {});

    const response = NextResponse.json({
      id: Number(inst.id),
      name: inst.institution_name,
      state: inst.state_code,
      city: inst.city,
      charter_type: inst.charter_type,
      asset_size: toNumberOrNull(inst.asset_size),
      asset_tier: inst.asset_size_tier,
      fed_district: inst.fed_district,
      fee_count: fees.length,
      fees,
      call_reports: financials.map((quarter) => {
        const { institution_id, ...fields } = quarter;
        void institution_id;
        return fields;
      }),
      complaints: complaints.map((c) => ({
        product: c.product,
        complaint_count: Number(c.complaint_count),
      })),
      attribution: API_ATTRIBUTION,
    });
    return withRateLimitHeaders(response, rateLimit);
  }

  // List institutions
  const filters: {
    charter_type?: string;
    state_code?: string;
    has_fees?: boolean;
    page: number;
    pageSize: number;
  } = { page, pageSize };

  if (searchParams.get("has_fees") === "true") {
    filters.has_fees = true;
  }

  if (charter === "bank" || charter === "credit_union") {
    filters.charter_type = charter;
  }
  if (state && state.length === 2) {
    filters.state_code = state.toUpperCase();
  }

  const { rows, total } = await getInstitutionsByFilter(filters);

  logApiUsage(organizationId, anonymousId, "api.v1.institutions.list", {
    state: filters.state_code ?? null,
    charter_type: filters.charter_type ?? null,
    has_fees: filters.has_fees ?? false,
    page,
    page_size: pageSize,
    status: 200,
  }).catch(() => {});

  const response = NextResponse.json({
    total,
    page,
    page_size: pageSize,
    pages: Math.ceil(total / pageSize),
    data: rows.map((r) => ({
      id: Number(r.id),
      name: r.institution_name,
      state: r.state_code,
      city: r.city,
      charter_type: r.charter_type,
      asset_size: toNumberOrNull(r.asset_size),
      asset_tier: r.asset_size_tier,
      fed_district: r.fed_district,
      fee_count: Number(r.fee_count ?? 0),
    })),
    attribution: API_ATTRIBUTION,
  });
  return withRateLimitHeaders(response, rateLimit);
}

export const GET = withApiRoutePolicy("api.v1.institutions", "GET", handleGET);
