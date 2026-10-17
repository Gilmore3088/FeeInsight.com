import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { MAX_CHOSEN_PEERS, getPeerComparison } from "@/lib/data-store/peer-comparison";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, idListParam, intParam, withApiCaching, withApiHeaders } from "@/lib/api-v1";

const NOTE =
  "Each row compares the institution's published dollar amount for a fee with the same fee at its peers. " +
  "One value per institution, from sourced consumer-facing rows. percentile is the share of peers whose amount is lower, " +
  "counting half of those with the same amount (0 to 100). Median, percentiles and placement are left out when fewer than " +
  "min_peers peers publish the fee. Fees stated as a rate are listed in rate_fees and are not compared with dollar amounts.";

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request, { paidOnly: "Peer comparison", usageEvent: "api.v1.peers" });
  if (caller instanceof Response) return caller;
  const { organizationId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let institutionId: number;
  let peerIds: number[] | null;
  try {
    if (!searchParams.get("institution_id")) throw new ApiParamError("institution_id is required");
    institutionId = intParam(searchParams, "institution_id", { fallback: 0, min: 1, max: 1_000_000_000 });
    peerIds = idListParam(searchParams, "peer_ids", MAX_CHOSEN_PEERS);
    if (peerIds && peerIds.every((id) => id === institutionId)) {
      throw new ApiParamError("peer_ids must name at least one institution other than institution_id");
    }
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, "api.v1.peers", { status: 400 }).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const comparison = await getPeerComparison(institutionId, peerIds);
  if (!comparison) {
    logApiUsage(organizationId, anonymousId, "api.v1.peers", { institution_id: institutionId, status: 404 }).catch(() => {});
    return apiError(404, "not_found", "Institution not found", { rateLimit });
  }

  logApiUsage(organizationId, anonymousId, "api.v1.peers", {
    institution_id: institutionId,
    peer_basis: comparison.peer_group.basis,
    peer_ids: peerIds?.length ?? 0,
    count: comparison.categories.length,
    status: 200,
  }).catch(() => {});

  return withApiCaching(request, withApiHeaders(
    NextResponse.json({ ...comparison, note: NOTE, attribution: API_ATTRIBUTION }),
    rateLimit,
  ));
}

export const GET = withApiRoutePolicy("api.v1.peers", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.peers", "OPTIONS", async () => apiOptions());
