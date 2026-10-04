import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getNationalIndex, getPeerIndex } from "@/lib/data-store";
import { getDisplayName, getFeeFamily, getFeeTier } from "@/lib/fee-taxonomy";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { logApiUsage } from "@/lib/api-usage";
import { getCurrentUser } from "@/lib/auth";
import { canExportData } from "@/lib/access";
import crypto from "crypto";

async function handleGET(request: NextRequest) {
  // API auth + rate limiting
  const authResult = await validateApiKey(request);
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const anonId = authResult.organizationId ? null : crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const tier = authResult.valid ? authResult.tier : "free";
  const rateResult = await checkRateLimitWithTier(
    authResult.organizationId,
    anonId,
    tier,
    "api.v1.index",
  );
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers: {
      "X-RateLimit-Limit": String(rateResult.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": rateResult.reset.toISOString(),
    }});
  }
  const { searchParams } = request.nextUrl;
  const state = searchParams.get("state");
  const charter = searchParams.get("charter");
  const district = searchParams.get("district");
  const format = searchParams.get("format");

  if (format === "csv") {
    const user = await getCurrentUser();
    if (!canExportData(user)) {
      logApiUsage(authResult.organizationId, anonId, "api.v1.index.csv", {
        status: 403,
      }).catch(() => {});
      return NextResponse.json(
        { error: "CSV export requires a Seat License", upgrade_url: "/subscribe" },
        {
          status: 403,
          headers: {
            "X-RateLimit-Limit": String(rateResult.limit),
            "X-RateLimit-Remaining": String(rateResult.remaining),
            "X-RateLimit-Reset": rateResult.reset.toISOString(),
          },
        },
      );
    }
  }

  const hasFilters = state || charter || district;

  const entries = hasFilters
    ? await getPeerIndex({
        state_code: state?.toUpperCase() ?? undefined,
        charter_type:
          charter === "bank" || charter === "credit_union"
            ? charter
            : undefined,
        fed_districts: district
          ? district
              .split(",")
              .map((d) => parseInt(d, 10))
              .filter((d) => d >= 1 && d <= 12)
          : undefined,
      })
    : await getNationalIndex();

  const data = entries.map((e) => ({
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
    const headers =
      "category,display_name,family,tier,median,p25,p75,min,max,institution_count,bank_count,cu_count,maturity";
    const rows = data.map((d) =>
      [
        d.category,
        `"${d.display_name}"`,
        d.family,
        d.tier,
        d.median,
        d.p25,
        d.p75,
        d.min,
        d.max,
        d.institution_count,
        d.bank_count,
        d.cu_count,
        d.maturity,
      ].join(",")
    );
    const csv = [headers, ...rows].join("\n");

    logApiUsage(authResult.organizationId, anonId, "api.v1.index.csv").catch(() => {});
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=fee-index.csv",
        "X-RateLimit-Limit": String(rateResult.limit),
        "X-RateLimit-Remaining": String(rateResult.remaining),
        "X-RateLimit-Reset": rateResult.reset.toISOString(),
      },
    });
  }

  logApiUsage(authResult.organizationId, anonId, "api.v1.index").catch(() => {});
  return NextResponse.json({
    scope: hasFilters ? "filtered" : "national",
    filters: {
      state: state ?? null,
      charter: charter ?? null,
      district: district ?? null,
    },
    total: data.length,
    data,
  }, {
    headers: {
      "X-RateLimit-Limit": String(rateResult.limit),
      "X-RateLimit-Remaining": String(rateResult.remaining),
      "X-RateLimit-Reset": rateResult.reset.toISOString(),
    },
  });
}

export const GET = withApiRoutePolicy("api.v1.index", "GET", handleGET);
