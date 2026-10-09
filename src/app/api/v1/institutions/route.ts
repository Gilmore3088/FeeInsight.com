import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import {
  getInstitutionById,
  getFeesByInstitution,
  getInstitutionsByFilter,
  getFinancialsByInstitution,
  getComplaintsByInstitution,
} from "@/lib/data-store";
import { searchInstitutions } from "@/lib/data-store/search";
import { BENCHMARK_CSV_HEADER, benchmarkCsvRows, getInstitutionBenchmark } from "@/lib/data-store/benchmark-export";
import { getRegulatoryWatch } from "@/lib/data-store/regulatory-watch";
import { getRateFeesByInstitution } from "@/lib/data-store/rate-fees";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { logApiUsage } from "@/lib/api-usage";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { API_ATTRIBUTION } from "@/lib/constants";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import {
  API_V1_RATE_LIMIT_ROUTE,
  ApiParamError,
  apiError,
  apiKeyRequiredError,
  apiOptions,
  assetTierParam,
  formatParam,
  toCsv,
  charterParam,
  getAnonymousId,
  intParam,
  isPaidApiKey,
  planRequiredError,
  rateLimitError,
  stateParam,
  withApiHeaders,
} from "@/lib/api-v1";

const KNOWN_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());

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
  // The API is for partners we have issued a key to; the site's own signed-in
  // download buttons still work without one.
  const user = auth.valid ? null : await getCurrentUser();
  if (!auth.valid && !user) return apiKeyRequiredError();

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
  let query: string | null;
  let feeCategory: string | null;
  let sort: "highest" | "lowest";
  let assetTiers: string[] | null;
  let city: string | null;
  let quarters: number;
  let view: "detail" | "benchmark" | "regulatory_watch";
  let format: "json" | "csv";
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
    query = searchParams.get("q")?.trim() || null;
    if (query !== null && (query.length < 2 || query.length > 100)) {
      throw new ApiParamError("q must be 2 to 100 characters");
    }
    feeCategory = searchParams.get("fee_category")?.trim() || null;
    if (feeCategory !== null && !KNOWN_CATEGORIES.has(feeCategory)) {
      throw new ApiParamError("fee_category must be a category key from /api/v1/fees, e.g. overdraft");
    }
    const sortRaw = searchParams.get("sort");
    if (sortRaw !== null && sortRaw !== "" && sortRaw !== "highest" && sortRaw !== "lowest") {
      throw new ApiParamError("sort must be highest or lowest");
    }
    sort = sortRaw === "lowest" ? "lowest" : "highest";
    assetTiers = assetTierParam(searchParams);
    city = searchParams.get("city")?.trim() || null;
    if (city !== null && city.length > 80) throw new ApiParamError("city must be at most 80 characters");
    if ((assetTiers || city) && (query !== null || feeCategory !== null)) {
      throw new ApiParamError("asset_tier and city work on the plain list, not with q or fee_category");
    }
    quarters = intParam(searchParams, "quarters", { fallback: 8, min: 1, max: 66 });
    const viewRaw = searchParams.get("view")?.trim() || "detail";
    if (viewRaw !== "detail" && viewRaw !== "benchmark" && viewRaw !== "regulatory_watch") {
      throw new ApiParamError("view must be detail, benchmark or regulatory_watch");
    }
    view = viewRaw;
    if (view !== "detail" && id === null) throw new ApiParamError(`view=${view} needs id`);
    format = formatParam(searchParams);
    if (format === "csv" && view !== "benchmark") throw new ApiParamError("format=csv is available for view=benchmark");
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  // Single institution detail (Pro and Enterprise only)
  if (id !== null) {
    const paid = isPaidApiKey(auth) || canAccessPremium(user);
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

    // Analyst export: each published fee against national, state, asset-size and local market benchmarks.
    if (view === "benchmark") {
      const benchmark = await getInstitutionBenchmark(id);
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.benchmark", {
        institution_id: id,
        format,
        count: benchmark?.rows.length ?? 0,
        status: 200,
      }).catch(() => {});
      if (format === "csv") {
        const slug = String(inst.institution_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
        return withApiHeaders(
          new NextResponse(toCsv(BENCHMARK_CSV_HEADER, benchmark ? benchmarkCsvRows(benchmark) : []), {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename=${slug || "institution"}-fee-benchmarks.csv`,
            },
          }),
          rateLimit,
        );
      }
      return withApiHeaders(NextResponse.json({ ...benchmark, attribution: API_ATTRIBUTION }), rateLimit);
    }

    // Regulatory watch: enforcement actions against local competitors and federal rule changes on its fees.
    if (view === "regulatory_watch") {
      const watch = await getRegulatoryWatch(id);
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.regulatory_watch", {
        institution_id: id,
        status: 200,
      }).catch(() => {});
      return withApiHeaders(
        NextResponse.json({ id: Number(inst.id), name: inst.institution_name, ...watch, attribution: API_ATTRIBUTION }),
        rateLimit,
      );
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
    // Fees stated as a rate ("3% of the transaction") come from the rate catalog and are listed
    // apart from the dollar fees, never pooled with them.
    const [financials, complaints, rateFees] = await Promise.all([
      getFinancialsByInstitution(id, quarters),
      getComplaintsByInstitution(id),
      getRateFeesByInstitution(id),
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
        rate_fees: rateFees.map((f) => ({
          fee_name: f.fee_name,
          category: f.fee_category,
          rate_percent: f.rate_percent,
          rate_min_amount: f.rate_min_amount,
          rate_max_amount: f.rate_max_amount,
          rate_basis: f.rate_basis,
          rate_terms: f.rate_label,
          frequency: f.frequency,
          conditions: f.conditions,
          source_url: f.source_url,
        })),
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

  // Fee ranking: who charges the most (or least) for one fee (Pro and Enterprise only).
  if (feeCategory !== null) {
    if (!(isPaidApiKey(auth) || canAccessPremium(user))) {
      return planRequiredError(rateLimit, "Fee ranking");
    }
    const { rows, total } = await searchInstitutions({
      query: query ?? undefined,
      state_code: state ?? undefined,
      charter_type: charter ?? undefined,
      fee_category: feeCategory,
      fee_sort: sort === "lowest" ? "asc" : "desc",
      page,
      pageSize,
    });

    logApiUsage(organizationId, anonymousId, "api.v1.institutions.rank", {
      fee_category: feeCategory,
      sort,
      state,
      charter_type: charter,
      page,
      status: 200,
    }).catch(() => {});

    const pages = Math.ceil(total / pageSize);
    return withApiHeaders(
      NextResponse.json({
        fee_category: feeCategory,
        display_name: getDisplayName(feeCategory),
        sort,
        note: "fee_amount is the institution's lowest published amount for this fee. null means no published amount (never $0); those sort last.",
        total,
        page,
        page_size: pageSize,
        pages,
        has_more: page < pages,
        data: rows.map((r) => ({
          id: r.id,
          name: r.institution_name,
          state: r.state_code,
          city: r.city,
          charter_type: r.charter_type,
          asset_size: r.asset_size,
          asset_tier: r.asset_size_tier,
          fee_amount: r.focus_fee_amount ?? null,
          fee_count: r.published_fee_count,
        })),
        attribution: API_ATTRIBUTION,
      }),
      rateLimit,
    );
  }

  // Name search: banks with published fees sort first; has_fees does not apply.
  if (query !== null) {
    const { rows, total } = await searchInstitutions({
      query,
      state_code: state ?? undefined,
      charter_type: charter ?? undefined,
      page,
      pageSize,
    });

    logApiUsage(organizationId, anonymousId, "api.v1.institutions.search", {
      state,
      charter_type: charter,
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
          id: r.id,
          name: r.institution_name,
          state: r.state_code,
          city: r.city,
          charter_type: r.charter_type,
          asset_size: r.asset_size,
          asset_tier: r.asset_size_tier,
          fed_district: null,
          fee_count: r.published_fee_count,
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
    asset_tiers?: string[];
    city?: string;
    has_fees?: boolean;
    page: number;
    pageSize: number;
  } = { page, pageSize };
  if (hasFees) filters.has_fees = true;
  if (charter) filters.charter_type = charter;
  if (state) filters.state_code = state;
  if (assetTiers) filters.asset_tiers = assetTiers;
  if (city) filters.city = city;

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
