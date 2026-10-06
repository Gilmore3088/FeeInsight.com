import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getNationalIndex, getPeerIndex } from "@/lib/data-store";
import { getDisplayName, getFeeFamily, getFeeTier, getSpotlightCategories } from "@/lib/fee-taxonomy";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { logApiUsage } from "@/lib/api-usage";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, canExportData } from "@/lib/access";
import { API_ATTRIBUTION } from "@/lib/constants";
import {
  API_V1_RATE_LIMIT_ROUTE,
  ApiParamError,
  apiError,
  apiKeyRequiredError,
  apiOptions,
  assetTierParam,
  charterParam,
  districtParam,
  formatParam,
  getAnonymousId,
  isPaidApiKey,
  planRequiredError,
  rateLimitError,
  stateParam,
  toCsv,
  withApiHeaders,
} from "@/lib/api-v1";

async function handleGET(request: NextRequest) {
  // API auth + rate limiting
  const auth = await validateApiKey(request);
  if (auth.error) {
    return apiError(401, "invalid_api_key", auth.error);
  }
  // The API is for partners we have issued a key to; the site's own signed-in
  // download buttons still work without one.
  const user = auth.valid ? null : await getCurrentUser();
  if (!auth.valid && !user) return apiKeyRequiredError();
  const anonId = auth.organizationId ? null : getAnonymousId(request);
  const tier = auth.valid ? auth.tier : "free";
  const rateLimit = await checkRateLimitWithTier(
    auth.organizationId,
    anonId,
    tier,
    API_V1_RATE_LIMIT_ROUTE,
  );
  if (!rateLimit.allowed) return rateLimitError(rateLimit);

  const { searchParams } = request.nextUrl;
  let state: string | null;
  let charter: "bank" | "credit_union" | null;
  let districts: number[] | null;
  let format: "json" | "csv";
  let assetTiers: string[] | null;
  try {
    assetTiers = assetTierParam(searchParams);
    state = stateParam(searchParams);
    charter = charterParam(searchParams);
    districts = districtParam(searchParams);
    format = formatParam(searchParams);
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const paidKey = isPaidApiKey(auth);

  if (format === "csv" && !paidKey && !canExportData(user)) {
    logApiUsage(auth.organizationId, anonId, "api.v1.index.csv", { status: 403 }).catch(() => {});
    return planRequiredError(rateLimit, "CSV export");
  }

  const hasFilters = Boolean(state || charter || districts || assetTiers);
  const entries = hasFilters
    ? await getPeerIndex({
        state_code: state ?? undefined,
        charter_type: charter ?? undefined,
        fed_districts: districts ?? undefined,
        asset_tiers: assetTiers ?? undefined,
      })
    : await getNationalIndex();

  // The free tier gets the spotlight categories only, matching /fees.
  const paid = paidKey || canAccessPremium(user);
  const spotlight = new Set(getSpotlightCategories());

  const data = entries
    .filter((e) => paid || spotlight.has(e.fee_category))
    .map((e) => ({
      category: e.fee_category,
      display_name: getDisplayName(e.fee_category),
      family: getFeeFamily(e.fee_category),
      tier: getFeeTier(e.fee_category),
      median: e.median_amount,
      p25: e.p25_amount,
      p75: e.p75_amount,
      min: e.min_amount,
      max: e.max_amount,
      institution_count: e.institution_count,
      bank_count: e.bank_count,
      cu_count: e.cu_count,
      maturity: e.maturity_tier,
    }));

  if (format === "csv") {
    const csv = toCsv(
      [
        "category", "display_name", "family", "tier", "median", "p25", "p75", "min", "max",
        "institution_count", "bank_count", "cu_count", "maturity",
      ],
      data.map((d) => [
        d.category, d.display_name, d.family, d.tier, d.median, d.p25, d.p75, d.min, d.max,
        d.institution_count, d.bank_count, d.cu_count, d.maturity,
      ]),
    );

    logApiUsage(auth.organizationId, anonId, "api.v1.index.csv").catch(() => {});
    return withApiHeaders(
      new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=fee-index.csv",
        },
      }),
      rateLimit,
    );
  }

  logApiUsage(auth.organizationId, anonId, "api.v1.index").catch(() => {});
  return withApiHeaders(
    NextResponse.json({
      scope: hasFilters ? "filtered" : "national",
      filters: {
        state,
        charter,
        district: districts ? districts.join(",") : null,
        asset_tier: assetTiers ? assetTiers.join(",") : null,
      },
      total: data.length,
      data,
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  );
}

export const GET = withApiRoutePolicy("api.v1.index", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.index", "OPTIONS", async () => apiOptions());
