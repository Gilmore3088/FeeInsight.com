import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { MAX_CHOSEN_PEERS, getPeerComparison } from "@/lib/data-store/peer-comparison";
import { PeerSetError, type PeerSetRequest } from "@/lib/data-store/peer-sets";
import { peerSetRequestParams } from "@/lib/api-v1-peer-params";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { getV1HamiltonInstitution, getV1SavedPeerSet, requireV1ContextUserId, v1ContextUserId, v1SavedPeerSetFilters, V1ContextError, withPrivateV1Context } from "@/lib/api-v1-hamilton-context";
import {
  ApiParamError,
  apiError,
  apiOptions,
  idListParam,
  intParam,
  withApiCaching,
  withApiHeaders,
} from "@/lib/api-v1";

const NOTE =
  "Each row compares the institution's published dollar amount for a fee with the same fee at its peers. " +
  "One value per institution, from sourced consumer-facing rows. percentile is the share of peers whose amount is lower, " +
  "counting half of those with the same amount (0 to 100). Median, percentiles and placement are left out when fewer than " +
  "min_peers peers publish the fee. Fees stated as a rate are listed in rate_fees and are not compared with dollar amounts.";

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request, { paidOnly: "Peer comparison", usageEvent: "api.v1.peers" });
  if (caller instanceof Response) return caller;
  const { organizationId, keyId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let institutionId: number;
  let savedSetId: number | null;
  let useSavedContext: boolean;
  let institutionSource: "explicit" | "saved" | "account" | "none" = "explicit";
  let peerIds: number[] | null;
  let peerSet: PeerSetRequest | null;
  try {
    const useSaved = searchParams.get("use_saved_context");
    if (useSaved !== null && useSaved !== "true" && useSaved !== "false") throw new ApiParamError("use_saved_context must be true or false");
    useSavedContext = useSaved !== "false";
    savedSetId = searchParams.get("saved_peer_set_id") ? intParam(searchParams, "saved_peer_set_id", { fallback: 0, min: 1, max: Number.MAX_SAFE_INTEGER }) : null;
    institutionId = intParam(searchParams, "institution_id", { fallback: 0, min: 1, max: 1_000_000_000 });
    peerIds = idListParam(searchParams, "peer_ids", MAX_CHOSEN_PEERS);
    if (peerIds && peerIds.every((id) => id === institutionId)) {
      throw new ApiParamError("peer_ids must name at least one institution other than institution_id");
    }
    peerSet = peerSetRequestParams(searchParams);
    if (peerIds && peerSet) throw new ApiParamError("peer_ids cannot be combined with other peer-group parameters");
    if (savedSetId !== null && (peerIds || peerSet)) throw new ApiParamError("saved_peer_set_id cannot be combined with peer_ids or other peer-group parameters");
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, "api.v1.peers", { status: 400 }, keyId).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  let comparison;
  let savedSet: Awaited<ReturnType<typeof getV1SavedPeerSet>> = null;
  const holderId = v1ContextUserId(caller);
  try {
    if (!institutionId && useSavedContext && holderId !== null) {
      const selected = await getV1HamiltonInstitution(holderId);
      institutionId = selected.institution?.id ?? 0;
      institutionSource = selected.source === "account" ? "account" : selected.institution ? "saved" : "none";
    }
    if (!institutionId) throw new ApiParamError("institution_id is required when no saved Hamilton institution is available");
    if (peerIds && peerIds.every((id) => id === institutionId)) throw new ApiParamError("peer_ids must name at least one institution other than institution_id");
    if (savedSetId !== null) {
      savedSet = await getV1SavedPeerSet(requireV1ContextUserId(caller), institutionId, savedSetId);
    } else if (useSavedContext && holderId !== null && !peerIds && !peerSet) {
      savedSet = await getV1SavedPeerSet(holderId, institutionId);
    }
    if (savedSet) {
      const filters = v1SavedPeerSetFilters(savedSet);
      // Saved website groups can contain 50 peers. Keep all of them; the 25-peer cap
      // applies only to the public peer_ids input, not an authorized saved selection.
      peerIds = filters.institution_ids ?? null;
      const { institution_ids: chosen, ...dimensions } = filters;
      void chosen;
      peerSet = peerIds ? null : dimensions as PeerSetRequest;
    }
    comparison = await getPeerComparison(institutionId, peerIds, peerSet);
  } catch (error) {
    if (error instanceof V1ContextError) {
      logApiUsage(organizationId, anonymousId, "api.v1.peers", { status: error.status }, keyId).catch(() => {});
      return withPrivateV1Context(apiError(error.status, error.code, error.message, { rateLimit }));
    }
    if (error instanceof ApiParamError || error instanceof PeerSetError) {
      logApiUsage(organizationId, anonymousId, "api.v1.peers", { institution_id: institutionId, status: 400 }, keyId).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }
  if (!comparison) {
    logApiUsage(organizationId, anonymousId, "api.v1.peers", { institution_id: institutionId, status: 404 }, keyId).catch(() => {});
    return apiError(404, "not_found", "Institution not found", { rateLimit });
  }

  logApiUsage(organizationId, anonymousId, "api.v1.peers", {
    institution_id: institutionId,
    peer_basis: comparison.peer_group.basis,
    peer_ids: peerIds?.length ?? 0,
    peer_set: peerSet,
    count: comparison.categories.length,
    status: 200,
  }, keyId).catch(() => {});

  const response = withApiHeaders(NextResponse.json({
    ...comparison,
    peer_group: { ...comparison.peer_group, ...(savedSet ? { label: savedSet.name } : {}) },
    context: {
      institution_source: institutionSource,
      peer_source: savedSet ? "saved" : peerIds || peerSet ? "explicit" : "default",
      saved_peer_set_id: savedSet?.id ?? null,
      saved_peer_set_name: savedSet?.name ?? null,
    },
    note: NOTE,
    attribution: API_ATTRIBUTION,
  }), rateLimit);
  return (holderId !== null && useSavedContext) || savedSet !== null
    ? withPrivateV1Context(response)
    : withApiCaching(request, response);
}

export const GET = withApiRoutePolicy("api.v1.peers", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.peers", "OPTIONS", async () => apiOptions());
