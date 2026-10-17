import { ApiParamError, assetTierParam, districtParam, intParam } from "@/lib/api-v1";
import type { PeerSetRequest } from "@/lib/data-store/peer-sets";
import { MAX_NEAREST_PEERS, PEER_GROUP_PARAMS, PEER_REGULATORS, type PeerRegulator } from "@/lib/peer-set-dimensions";

/** Query parameters that define a peer group on /api/v1/peers and the connector's get_peer_comparison. */
const GROUP_PARAMS = PEER_GROUP_PARAMS.map((p) => p.name);

/** "same", or the value read by parse. */
function sameOr<T>(params: URLSearchParams, name: string, parse: () => T): T | "same" | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  return raw.trim().toLowerCase() === "same" ? "same" : parse();
}

function dollarsParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) throw new ApiParamError(`${name} must be whole dollars, e.g. 500000000`);
  return Number(raw);
}

/** The peer-group dimensions asked for, or null when none are. */
export function peerSetRequestParams(params: URLSearchParams): PeerSetRequest | null {
  if (!GROUP_PARAMS.some((name) => params.get(name))) return null;
  const request: PeerSetRequest = {};
  const charter = sameOr(params, "charter", () => {
    const raw = params.get("charter");
    if (raw !== "bank" && raw !== "credit_union") throw new ApiParamError("charter must be bank, credit_union or same");
    return raw;
  });
  if (charter) request.charter_type = charter;
  const tiers = sameOr(params, "asset_tier", () => assetTierParam(params) ?? []);
  if (tiers) request.asset_tiers = tiers;
  request.asset_min = dollarsParam(params, "asset_min");
  request.asset_max = dollarsParam(params, "asset_max");
  if (request.asset_min !== undefined && request.asset_max !== undefined && request.asset_min > request.asset_max) {
    throw new ApiParamError("asset_min must not be more than asset_max");
  }
  const states = sameOr(params, "state", () => {
    const parts = (params.get("state") ?? "").split(",").map((part) => part.trim().toUpperCase());
    if (parts.some((part) => !/^[A-Z]{2}$/.test(part))) throw new ApiParamError("state must be two-letter codes, comma-separated, or same");
    return [...new Set(parts)];
  });
  if (states) request.states = states;
  const districts = sameOr(params, "district", () => districtParam(params) ?? []);
  if (districts) request.fed_districts = districts;
  const regulators = sameOr(params, "regulator", () => {
    const parts = (params.get("regulator") ?? "").split(",").map((part) => part.trim().toLowerCase());
    if (parts.some((part) => !(part in PEER_REGULATORS))) throw new ApiParamError("regulator must be occ, fdic, fed, ncua (comma-separated) or same");
    return [...new Set(parts)] as PeerRegulator[];
  });
  if (regulators) request.regulators = regulators;
  const cuCharter = sameOr(params, "cu_charter", () => {
    const raw = params.get("cu_charter");
    if (raw !== "federal" && raw !== "state") throw new ApiParamError("cu_charter must be federal, state or same");
    return raw;
  });
  if (cuCharter) request.cu_charter = cuCharter;
  const holding = sameOr(params, "holding_company", () => {
    const raw = (params.get("holding_company") ?? "").trim();
    if (!/^\d{1,10}$/.test(raw)) throw new ApiParamError("holding_company must be a holding company RSSD id or same");
    return raw;
  });
  if (holding) request.holding_company = holding;
  const market = sameOr(params, "market", () => intParam(params, "market", { fallback: 0, min: 1, max: 99_999 }));
  if (market) request.market = market;
  if (params.get("nearest")) request.nearest = intParam(params, "nearest", { fallback: 0, min: 1, max: MAX_NEAREST_PEERS });
  for (const key of Object.keys(request) as (keyof PeerSetRequest)[]) if (request[key] === undefined) delete request[key];
  return request;
}
