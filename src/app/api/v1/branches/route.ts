import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getBranchesForInstitution, getBranchesInArea } from "@/lib/data-store/branches";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizePaidV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, intParam, stateParam, withApiHeaders } from "@/lib/api-v1";

const NOTE =
  "Banks from the FDIC Summary of Deposits (latest survey year, deposits in whole US dollars) and credit unions from NCUA's branch file (no deposits; map coordinates are added over time, so some may be null). Each row's source says which.";

async function handleGET(request: NextRequest) {
  const caller = await authorizePaidV1(request, "Branch locations");
  if (caller instanceof Response) return caller;
  const { organizationId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let institutionId: number | null;
  let state: string | null;
  let city: string | null;
  let zip: string | null;
  let page: number;
  let limit: number;
  try {
    const idRaw = searchParams.get("institution_id");
    institutionId = idRaw ? intParam(searchParams, "institution_id", { fallback: 0, min: 1, max: 1_000_000_000 }) : null;
    state = stateParam(searchParams);
    city = searchParams.get("city")?.trim() || null;
    if (city && city.length > 80) throw new ApiParamError("city must be 80 characters or fewer");
    zip = searchParams.get("zip")?.trim() || null;
    if (zip && !/^\d{5}$/.test(zip)) throw new ApiParamError("zip must be a five-digit ZIP code");
    if (institutionId === null && !state) {
      throw new ApiParamError("Give institution_id, or state (optionally with city or zip)");
    }
    if (institutionId !== null && (state || city || zip)) {
      throw new ApiParamError("institution_id can't be combined with state, city or zip");
    }
    page = intParam(searchParams, "page", { fallback: 1, min: 1, max: 10_000 });
    limit = intParam(searchParams, "limit", { fallback: 100, min: 1, max: 500 });
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const opts = { limit, offset: (page - 1) * limit };
  const result =
    institutionId !== null
      ? await getBranchesForInstitution(institutionId, opts)
      : await getBranchesInArea({ state: state as string, city, zip }, opts);

  const pages = Math.ceil(result.total / limit);
  logApiUsage(organizationId, anonymousId, "api.v1.branches", {
    institution_id: institutionId,
    state,
    city,
    zip,
    status: 200,
  }).catch(() => {});

  return withApiHeaders(
    NextResponse.json({
      sod_year: result.sod_year,
      note: NOTE,
      total: result.total,
      page,
      page_size: limit,
      pages,
      has_more: page < pages,
      data: result.rows,
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  );
}

export const GET = withApiRoutePolicy("api.v1.branches", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.branches", "OPTIONS", async () => apiOptions());
