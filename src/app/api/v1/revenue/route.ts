import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getDistrictIncomeTrend, getRevenueTrend } from "@/lib/data-store/call-reports";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizePaidV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, intParam, withApiHeaders } from "@/lib/api-v1";

const UNITS = "Deposit service-charge income from FDIC and NCUA call reports, in thousands of US dollars per quarter.";

async function handleGET(request: NextRequest) {
  const caller = await authorizePaidV1(request, "Revenue trends");
  if (caller instanceof Response) return caller;
  const { organizationId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let view: "national" | "districts";
  let quarters: number;
  try {
    const viewRaw = searchParams.get("view");
    if (viewRaw !== null && viewRaw !== "" && viewRaw !== "national" && viewRaw !== "districts") {
      throw new ApiParamError("view must be national or districts");
    }
    view = viewRaw === "districts" ? "districts" : "national";
    quarters = intParam(searchParams, "quarters", { fallback: 8, min: 1, max: 66 });
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  if (view === "districts") {
    const rows = await getDistrictIncomeTrend(quarters);
    if (rows.length === 0) {
      return apiError(503, "data_unavailable", "Revenue data is temporarily unavailable", { rateLimit });
    }
    logApiUsage(organizationId, anonymousId, "api.v1.revenue", { view, quarters, status: 200 }).catch(() => {});
    return withApiHeaders(
      NextResponse.json({
        view,
        units: UNITS,
        data: rows.map((r) => ({
          quarter: r.quarter,
          fed_district: r.fed_district,
          service_charges: r.total_service_charges,
          institutions: r.institutions,
        })),
        attribution: API_ATTRIBUTION,
      }),
      rateLimit,
    );
  }

  const trend = await getRevenueTrend(quarters);
  if (trend.quarters.length === 0) {
    return apiError(503, "data_unavailable", "Revenue data is temporarily unavailable", { rateLimit });
  }
  logApiUsage(organizationId, anonymousId, "api.v1.revenue", { view, quarters, status: 200 }).catch(() => {});
  return withApiHeaders(
    NextResponse.json({
      view,
      units: UNITS,
      data: trend.quarters.map((q) => ({
        quarter: q.quarter,
        service_charges: q.total_service_charges,
        bank_service_charges: q.bank_service_charges,
        credit_union_service_charges: q.cu_service_charges,
        institutions: q.total_institutions,
        yoy_change_pct: q.yoy_change_pct === null ? null : Math.round(q.yoy_change_pct * 10) / 10,
      })),
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  );
}

export const GET = withApiRoutePolicy("api.v1.revenue", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.revenue", "OPTIONS", async () => apiOptions());
