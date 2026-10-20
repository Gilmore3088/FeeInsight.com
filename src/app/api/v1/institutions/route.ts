import { apiFeeName } from "@/lib/fee-display-name";
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
import { listPublishedFeeRows } from "@/lib/data-store/published-fee-rows";
import { logApiUsage } from "@/lib/api-usage";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { API_ATTRIBUTION } from "@/lib/constants";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import {
  ApiParamError,
  apiError,
  apiOptions,
  assetTierParam,
  formatParam,
  toCsv,
  charterParam,
  dateTimeParam,
  intParam,
  planRequiredError,
  stateParam,
  withApiCaching,
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
  const caller = await authorizeV1(request);
  if (caller instanceof Response) return caller;
  const { organizationId, keyId, anonymousId, rateLimit, paid } = caller;

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
  let view: "detail" | "benchmark" | "regulatory_watch" | "fees";
  let format: "json" | "csv";
  let updatedSince: Date | null;
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
    if (viewRaw !== "detail" && viewRaw !== "benchmark" && viewRaw !== "regulatory_watch" && viewRaw !== "fees") {
      throw new ApiParamError("view must be detail, benchmark, regulatory_watch or fees");
    }
    view = viewRaw;
    if ((view === "benchmark" || view === "regulatory_watch") && id === null) throw new ApiParamError(`view=${view} needs id`);
    if (view === "fees" && (query !== null || feeCategory !== null || assetTiers || city || hasFeesRaw === "true")) {
      throw new ApiParamError("view=fees takes id, state, charter, updated_since, page and limit");
    }
    updatedSince = dateTimeParam(searchParams, "updated_since");
    if (updatedSince && view !== "fees" && !(view === "detail" && id !== null)) {
      throw new ApiParamError("updated_since works with view=fees, or with id on the detail view");
    }
    format = formatParam(searchParams);
    if (format === "csv" && view !== "benchmark") throw new ApiParamError("format=csv is available for view=benchmark");
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions", { status: 400 }, keyId).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  // Fee rows across institutions, oldest publish first, for keeping a copy in step (Pro and Enterprise only).
  if (view === "fees") {
    if (!paid) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.fees", { status: 403 }, keyId).catch(() => {});
      return planRequiredError(rateLimit, "Fee rows");
    }
    const { rows, total } = await listPublishedFeeRows(
      { institution_id: id, state_code: state, charter_type: charter, updated_since: updatedSince },
      { limit: pageSize, offset: (page - 1) * pageSize },
    );
    logApiUsage(organizationId, anonymousId, "api.v1.institutions.fees", {
      institution_id: id,
      state,
      charter_type: charter,
      updated_since: updatedSince?.toISOString() ?? null,
      page,
      count: rows.length,
      status: 200,
    }, keyId).catch(() => {});
    const pages = Math.ceil(total / pageSize);
    return withApiCaching(request, withApiHeaders(
      NextResponse.json({
        view: "fees",
        updated_since: updatedSince?.toISOString() ?? null,
        note: "Published dollar fees, oldest publish first, then by fee_id. To stay in step, keep the newest published_at you hold and ask again with updated_since set to it; rows at that exact time come back again, so match on fee_id. A fee taken down drops out of this list rather than appearing as a change. Fees stated as a rate are at /api/v1/rate-fees.",
        total,
        page,
        page_size: pageSize,
        pages,
        has_more: page < pages,
        data: rows.map((r) => ({
          fee_id: r.fee_id,
          institution_id: r.institution_id,
          institution_name: r.institution_name,
          state: r.state,
          charter_type: r.charter_type,
          ...apiFeeName(r.fee_name, r.fee_category),
          category: r.fee_category,
          amount: r.amount,
          frequency: r.frequency,
          conditions: r.conditions,
          source_url: r.source_url,
          published_at: r.published_at,
        })),
        attribution: API_ATTRIBUTION,
      }),
      rateLimit,
    ));
  }

  // Single institution detail (Pro and Enterprise only)
  if (id !== null) {
    if (!paid) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
        institution_id: id,
        status: 403,
      }, keyId).catch(() => {});
      return planRequiredError(rateLimit, "Institution detail");
    }

    const inst = await getInstitutionById(id);
    if (!inst) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
        institution_id: id,
        status: 404,
      }, keyId).catch(() => {});
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
      }, keyId).catch(() => {});
      if (format === "csv") {
        const slug = String(inst.institution_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
        return withApiCaching(request, withApiHeaders(
          new NextResponse(toCsv(BENCHMARK_CSV_HEADER, benchmark ? benchmarkCsvRows(benchmark) : []), {
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": `attachment; filename=${slug || "institution"}-fee-benchmarks.csv`,
            },
          }),
          rateLimit,
        ));
      }
      return withApiCaching(request, withApiHeaders(NextResponse.json({ ...benchmark, attribution: API_ATTRIBUTION }), rateLimit));
    }

    // Regulatory watch: enforcement actions against local competitors and federal rule changes on its fees.
    if (view === "regulatory_watch") {
      const watch = await getRegulatoryWatch(id);
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.regulatory_watch", {
        institution_id: id,
        status: 200,
      }, keyId).catch(() => {});
      return withApiCaching(request, withApiHeaders(
        NextResponse.json({ id: Number(inst.id), name: inst.institution_name, ...watch, attribution: API_ATTRIBUTION }),
        rateLimit,
      ));
    }

    const publishedAt = (value: unknown): string | null =>
      value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);
    // updated_since keeps the fees published at or after it; with no publish date a fee is left out.
    const since = updatedSince?.getTime() ?? null;
    const isRecent = (value: unknown) => {
      if (since === null) return true;
      const at = publishedAt(value);
      return at !== null && new Date(at).getTime() >= since;
    };
    const fees = (await getFeesByInstitution(id))
      .filter((f) => f.review_status !== "rejected" && isRecent(f.created_at))
      .map((f) => ({
        ...apiFeeName(f.fee_name, f.fee_category),
        category: f.fee_category,
        amount: f.amount,
        frequency: f.frequency,
        conditions: f.conditions,
        review_status: f.review_status,
        confidence: f.extraction_confidence,
        source_url: f.source_url ?? null,
        published_at: publishedAt(f.created_at),
      }));

    // Federal data: FDIC/NCUA call report quarters and CFPB complaint totals.
    // Fees stated as a rate ("3% of the transaction") come from the rate catalog and are listed
    // apart from the dollar fees, never pooled with them.
    const [financials, complaints, allRateFees] = await Promise.all([
      getFinancialsByInstitution(id, quarters),
      getComplaintsByInstitution(id),
      getRateFeesByInstitution(id),
    ]);
    const rateFees = allRateFees.filter((f) => isRecent(f.published_at));

    logApiUsage(organizationId, anonymousId, "api.v1.institutions.detail", {
      institution_id: id,
      status: 200,
    }, keyId).catch(() => {});

    return withApiCaching(request, withApiHeaders(
      NextResponse.json({
        id: Number(inst.id),
        name: inst.institution_name,
        state: inst.state_code,
        city: inst.city,
        charter_type: inst.charter_type,
        asset_size: toNumberOrNull(inst.asset_size),
        asset_tier: inst.asset_size_tier,
        fed_district: inst.fed_district,
        ...(updatedSince ? { updated_since: updatedSince.toISOString() } : {}),
        fee_count: fees.length,
        fees,
        rate_fees: rateFees.map((f) => ({
          ...apiFeeName(f.fee_name, f.fee_category),
          category: f.fee_category,
          rate_percent: f.rate_percent,
          rate_min_amount: f.rate_min_amount,
          rate_max_amount: f.rate_max_amount,
          rate_basis: f.rate_basis,
          rate_terms: f.rate_label,
          frequency: f.frequency,
          conditions: f.conditions,
          source_url: f.source_url,
          published_at: f.published_at ?? null,
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
    ));
  }

  // Fee ranking: who charges the most (or least) for one fee (Pro and Enterprise only).
  if (feeCategory !== null) {
    if (!paid) {
      logApiUsage(organizationId, anonymousId, "api.v1.institutions.rank", {
        fee_category: feeCategory,
        status: 403,
      }, keyId).catch(() => {});
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
    }, keyId).catch(() => {});

    const pages = Math.ceil(total / pageSize);
    return withApiCaching(request, withApiHeaders(
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
    ));
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
    }, keyId).catch(() => {});

    const pages = Math.ceil(total / pageSize);
    return withApiCaching(request, withApiHeaders(
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
    ));
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
  }, keyId).catch(() => {});

  const pages = Math.ceil(total / pageSize);
  return withApiCaching(request, withApiHeaders(
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
  ));
}

export const GET = withApiRoutePolicy("api.v1.institutions", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.institutions", "OPTIONS", async () => apiOptions());
