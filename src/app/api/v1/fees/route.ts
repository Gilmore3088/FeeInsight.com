import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getFeeCategoryDetail } from "@/lib/data-store";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import { getDisplayName, getFeeFamily, getFeeTier } from "@/lib/fee-taxonomy";
import { getCurrentUser } from "@/lib/auth";
import { canExportData } from "@/lib/access";
import { apiKeyCanExport, validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";

function getAnonymousId(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function addRateLimitHeaders(
  response: NextResponse,
  rateLimit: { limit: number; remaining: number; reset: Date }
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", rateLimit.reset.toISOString());
  return response;
}

async function handleGET(request: NextRequest) {
  // --- API key validation (optional — free tier works without) ---
  const auth = await validateApiKey(request);

  if (auth.error) {
    return NextResponse.json(
      { error: auth.error },
      { status: 401 }
    );
  }

  const organizationId = auth.organizationId;
  const anonymousId = organizationId ? null : getAnonymousId(request);
  const tier = auth.valid ? auth.tier : "free";

  // --- Rate limit check ---
  const rateLimit = await checkRateLimitWithTier(
    organizationId,
    anonymousId,
    tier,
    "api.v1.fees",
  );

  if (!rateLimit.allowed) {
    const res = NextResponse.json(
      {
        error: "Rate limit exceeded",
        limit: rateLimit.limit,
        reset: rateLimit.reset.toISOString(),
      },
      { status: 429 }
    );
    return addRateLimitHeaders(res, rateLimit);
  }

  // --- Route logic ---
  const { searchParams } = request.nextUrl;
  const category = searchParams.get("category");
  const format = searchParams.get("format");

  // Single category detail
  if (category) {
    const detail = await getFeeCategoryDetail(category);
    if (!detail || detail.fees.length === 0) {
      // Still log the attempt and count it
      logApiUsage(organizationId, anonymousId, "api.fees.category", {
        category,
        status: 404,
      });
      const res = NextResponse.json(
        { error: "Category not found", category },
        { status: 404 }
      );
      return addRateLimitHeaders(res, rateLimit);
    }

    const response = {
      category,
      display_name: getDisplayName(category),
      family: getFeeFamily(category),
      tier: getFeeTier(category),
      summary: {
        institution_count: new Set(detail.fees.map((f) => f.institution_id)).size,
        observation_count: detail.fees.length,
      },
      by_charter_type: detail.by_charter_type,
      by_asset_tier: detail.by_asset_tier,
      by_fed_district: detail.by_fed_district,
      by_state: detail.by_state,
      attribution: API_ATTRIBUTION,
    };

    logApiUsage(organizationId, anonymousId, "api.fees.category", {
      category,
      status: 200,
    });

    const res = NextResponse.json(response);
    return addRateLimitHeaders(res, rateLimit);
  }

  // All categories summary
  const summaries = await getCachedFeeCategorySummaries();

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
    const user = await getCurrentUser();
    if (!apiKeyCanExport(auth) && !canExportData(user)) {
      logApiUsage(organizationId, anonymousId, "api.fees.list", {
        format: "csv",
        status: 403,
      });
      const res = NextResponse.json(
        { error: "CSV export requires a Fee Insight Pro seat", upgrade_url: "/subscribe" },
        { status: 403 }
      );
      return addRateLimitHeaders(res, rateLimit);
    }
    const headers = "category,display_name,family,tier,median,p25,p75,min,max,institution_count";
    const rows = data.map((d) =>
      [d.category, `"${d.display_name}"`, d.family, d.tier, d.median, d.p25, d.p75, d.min, d.max, d.institution_count].join(",")
    );
    const csv = [headers, ...rows].join("\n");

    logApiUsage(organizationId, anonymousId, "api.fees.list", {
      format: "csv",
      count: data.length,
      status: 200,
    });

    const res = new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=fee-insight.csv",
      },
    });
    return addRateLimitHeaders(res as unknown as NextResponse, rateLimit);
  }

  logApiUsage(organizationId, anonymousId, "api.fees.list", {
    format: "json",
    count: data.length,
    status: 200,
  });

  const res = NextResponse.json({
    total: data.length,
    data,
    attribution: API_ATTRIBUTION,
  });
  return addRateLimitHeaders(res, rateLimit);
}

export const GET = withApiRoutePolicy("api.v1.fees", "GET", handleGET);
