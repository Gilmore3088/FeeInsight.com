import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getFeeCategoryDetail } from "@/lib/data-store";
import { getPublicCategorySummaries } from "@/lib/public-stats";
import { getDisplayName, getFeeFamily, getFeeTier, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { canExportData } from "@/lib/access";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizeV1 } from "@/lib/api-v1-auth";
import {
  ApiParamError,
  apiError,
  apiOptions,
  formatParam,
  isPaidApiKey,
  planRequiredError,
  toCsv,
  withApiCaching,
  withApiHeaders,
} from "@/lib/api-v1";
import { countedInstitutionCount } from "@/lib/data-store/fee-stats";

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request);
  if (caller instanceof Response) return caller;
  const { auth, user, organizationId, keyId, anonymousId, rateLimit, paid } = caller;

  const { searchParams } = request.nextUrl;
  const category = searchParams.get("category");
  let format: "json" | "csv";
  try {
    format = formatParam(searchParams);
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, category ? "api.fees.category" : "api.fees.list", { status: 400 }, keyId);
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  // A paid key, or a signed-in Pro session, sees the full catalog.
  const paidKey = isPaidApiKey(auth);

  // Single category detail (Pro and Enterprise only)
  if (category) {
    if (!paid) {
      logApiUsage(organizationId, anonymousId, "api.fees.category", { category, status: 403 }, keyId);
      return planRequiredError(rateLimit, "Category detail");
    }
    const detail = await getFeeCategoryDetail(category);
    if (!detail || detail.fees.length === 0) {
      logApiUsage(organizationId, anonymousId, "api.fees.category", { category, status: 404 }, keyId);
      return apiError(404, "not_found", "Category not found", { rateLimit, extra: { category } });
    }

    logApiUsage(organizationId, anonymousId, "api.fees.category", { category, status: 200 }, keyId);
    return withApiCaching(request, withApiHeaders(
      NextResponse.json({
        category,
        display_name: getDisplayName(category),
        family: getFeeFamily(category),
        tier: getFeeTier(category),
        summary: {
          institution_count: countedInstitutionCount(detail.fees),
          observation_count: detail.fees.length,
        },
        by_charter_type: detail.by_charter_type,
        by_asset_tier: detail.by_asset_tier,
        by_fed_district: detail.by_fed_district,
        by_state: detail.by_state,
        attribution: API_ATTRIBUTION,
      }),
      rateLimit,
    ));
  }

  // All categories summary; the free tier gets the spotlight categories only.
  const spotlight = new Set(getSpotlightCategories());
  const summaries = (await getPublicCategorySummaries()).filter(
    (s) => paid || spotlight.has(s.fee_category),
  );

  const data = summaries.map((s) => ({
    category: s.fee_category,
    display_name: getDisplayName(s.fee_category),
    family: getFeeFamily(s.fee_category),
    tier: getFeeTier(s.fee_category),
    median: s.median_amount,
    p25: s.p25_amount,
    p75: s.p75_amount,
    min: s.min_amount,
    max: s.max_amount,
    institution_count: s.institution_count,
  }));

  if (format === "csv") {
    if (!paidKey && !canExportData(user)) {
      logApiUsage(organizationId, anonymousId, "api.fees.list", { format: "csv", status: 403 }, keyId);
      return planRequiredError(rateLimit, "CSV export");
    }
    const csv = toCsv(
      ["category", "display_name", "family", "tier", "median", "p25", "p75", "min", "max", "institution_count"],
      data.map((d) => [d.category, d.display_name, d.family, d.tier, d.median, d.p25, d.p75, d.min, d.max, d.institution_count]),
    );

    logApiUsage(organizationId, anonymousId, "api.fees.list", {
      format: "csv",
      count: data.length,
      status: 200,
    }, keyId);
    return withApiCaching(request, withApiHeaders(
      new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=fee-insight.csv",
        },
      }),
      rateLimit,
    ));
  }

  logApiUsage(organizationId, anonymousId, "api.fees.list", {
    format: "json",
    count: data.length,
    status: 200,
  }, keyId);
  return withApiCaching(request, withApiHeaders(
    NextResponse.json({
      total: data.length,
      data,
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  ));
}

export const GET = withApiRoutePolicy("api.v1.fees", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.fees", "OPTIONS", async () => apiOptions());
