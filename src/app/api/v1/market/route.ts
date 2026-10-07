import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getLocalMarketMembers } from "@/lib/data-store/custom-report-market";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizePaidV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, intParam, withApiHeaders } from "@/lib/api-v1";

const NOTE =
  "Local market: the counties holding most of the institution's deposits (FDIC Summary of Deposits), or its headquarters city's counties when it is not in the SOD (credit unions). Competitors are institutions with branches there, plus institutions headquartered in a market city. Deposit share counts SOD deposits only; credit unions have none, so their share is null.";

async function handleGET(request: NextRequest) {
  const caller = await authorizePaidV1(request, "Local market competitors");
  if (caller instanceof Response) return caller;
  const { organizationId, anonymousId, rateLimit } = caller;

  let institutionId: number;
  try {
    if (!request.nextUrl.searchParams.get("institution_id")) throw new ApiParamError("institution_id is required");
    institutionId = intParam(request.nextUrl.searchParams, "institution_id", { fallback: 0, min: 1, max: 1_000_000_000 });
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const market = await getLocalMarketMembers(institutionId);
  if (!market) {
    return apiError(404, "not_found", "No local market on file for that institution", { rateLimit });
  }

  const totalDeposits = market.members.reduce((sum, m) => sum + (m.market_deposits ?? 0), 0);
  logApiUsage(organizationId, anonymousId, "api.v1.market", { institution_id: institutionId, status: 200 }).catch(() => {});

  return withApiHeaders(
    NextResponse.json({
      institution_id: institutionId,
      basis: market.basis,
      places: market.places,
      sod_year: market.sod_year,
      note: NOTE,
      competitor_count: market.members.filter((m) => !m.is_subject).length,
      total_market_deposits: totalDeposits,
      data: market.members.map((m) => ({
        institution_id: m.institution_id,
        name: m.institution_name,
        city: m.city,
        state: m.state_code,
        charter_type: m.charter_type,
        is_subject: m.is_subject,
        market_deposits: m.market_deposits,
        deposit_share_pct:
          m.market_deposits === null || totalDeposits === 0
            ? null
            : Math.round((m.market_deposits / totalDeposits) * 1000) / 10,
      })),
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  );
}

export const GET = withApiRoutePolicy("api.v1.market", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.market", "OPTIONS", async () => apiOptions());
