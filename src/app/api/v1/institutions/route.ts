import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
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
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { API_ATTRIBUTION } from "@/lib/constants";
import {
  API_V1_RATE_LIMIT_ROUTE,
  ApiParamError,
  apiError,
  apiOptions,
  charterParam,
  getAnonymousId,
  intParam,
  isPaidApiKey,
  planRequiredError,
  rateLimitError,
  stateParam,
  withApiHeaders,
} from "@/lib/api-v1";

// Postgres BIGINT/NUMERIC columns arrive as strings; partners need real numbers.
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function handleGET(request: NextRequest) {
  const auth = await validateApiKey(request);
  if (auth.error) {
    return apiError(401, "invalid_api_key", auth.error);
  }

  const organizationId = auth.organizationId;
  const anonymousId = organizationId ? null : getAnonymousId(request);
  const tier = auth.valid ? auth.tier : "free";
  const rateLimit = await checkRateLimitWithTier(
    organizationId,
    anonymousId,
    tier,
    API_V1_RATE_LIMIT_ROUTE,
  );
  if (!rateLimit.allowed) return rateLimitError(rateLimit);

  const { searchParams } = request.nextUrl;
  let id: number | null;
  let state: string | null;
  let charter: "bank" | "credit_union" | null;
  let page: number;
  let pageSize: number;
  let hasFees: boolean;
  try {
    id = searchParams.has("id")
      ? intParam(searchParams, "id", { fallback: 0, min: 1, max: Number.MAX_SAFE_INTEGER })
      : null;
    state = stateParam(searchParams);
    charter = charterParam(searchParams);
    page = intParam(searchParams, "page", { fallback: 1, min: 1, max: 100_000 });
    pageSize = intParam(searchParams, "limit", { fallback: 50, min: 1, max: 200 });
    const hasFeesRaw = searchParams.get("has_fees");
    if (hasFeesRaw !== null && hasFeesRaw !== "" && hasFeesRaw !== "true" && hasFeesRaw !== "false") {
      throw new ApiParamError("has_fees must be true or false");
    }
    hasFees = hasFeesRaw === "true";
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  // Single institution detail (Pro and Enterprise only)
  if (id !== null) {
    const paid = isPaidApiKey(auth) || canAccessPremium(await getCurrentUser());
    if (!paid) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
        institution_id: id,
        status: 403,
      }).catch(() => {});
      return planRequiredError(rateLimit, "Institution detail");
    }

    const inst = await getInstitutionById(id);
    if (!inst) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
        institution_id: id,
        status: 404,
      }).catch(() => {});
      return apiError(404, "not_found", "Institution not found", { rateLimit });
    }

    const fees = (await getFeesByInstitution(id))
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
      getFinancialsByInstitution(id, 8),
      getComplaintsByInstitution(id),
    ]);

    logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
      institution_id: id,
      status: 200,
    }).catch(() => {});

    return withApiHeaders(
      NextResponse.json({
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
      }),
      rateLimit,
    );
  }

  // List institutions
  const filters: {
    charter_type?: string;
    state_code?: string;
    has_fees?: boolean;
    page: number;
    pageSize: number;
  } = { page, pageSize };
  if (hasFees) filters.has_fees = true;
  if (charter) filters.charter_type = charter;
  if (state) filters.state_code = state;

  const { rows, total } = await getInstitutionsByFilter(filters);

  logApiUsage(organizationId, anonymousId, "api.v1.institutions.list", {
    state: filters.state_code ?? null,
    charter_type: filters.charter_type ?? null,
    has_fees: filters.has_fees ?? false,
    page,
    page_size: pageSize,
    status: 200,
  }).catch(() => {});

  const pages = Math.ceil(total / pageSize);
  return withApiHeaders(
    NextResponse.json({
      total,
      page,
      page_size: pageSize,
      pages,
      has_more: page < pages,
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
    }),
    rateLimit,
  );
}

export const GET = withApiRoutePolicy("api.v1.institutions", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.institutions", "OPTIONS", async () => apiOptions());
