/**
 * The peer-group dimensions and their query parameters, with no database access, so docs,
 * the OpenAPI spec and the connector describe them from one list. Resolution lives in
 * src/lib/data-store/peer-sets.ts.
 */
export const PEER_REGULATORS = { occ: "OCC", fdic: "FDIC", fed: "Federal Reserve", ncua: "NCUA" } as const;
export type PeerRegulator = keyof typeof PEER_REGULATORS;
export const MAX_NEAREST_PEERS = 100;

/** Query parameters that define a peer group. "same" takes the institution's own value. */
export const PEER_GROUP_PARAMS = [
  { name: "charter", example: "bank", description: "bank, credit_union or same" },
  { name: "asset_tier", example: "community_mid,community_large", description: "Asset-size tiers, comma-separated, or same" },
  { name: "asset_min", example: "500000000", description: "Least total assets in whole dollars" },
  { name: "asset_max", example: "2000000000", description: "Most total assets in whole dollars" },
  { name: "state", example: "TX,OK", description: "Two-letter state codes, comma-separated, or same" },
  { name: "district", example: "11", description: "Fed districts 1-12, comma-separated, or same" },
  { name: "regulator", example: "occ,fed", description: "occ, fdic, fed or ncua, comma-separated, or same" },
  { name: "cu_charter", example: "federal", description: "Credit unions only: federal, state or same" },
  { name: "holding_company", example: "same", description: "Holding company RSSD id, or same for the institution's own" },
  { name: "market", example: "same", description: "Metro (MSA) code, or same for the metro holding most of the institution's branches. Peers are institutions with a branch there" },
  { name: "nearest", example: "20", description: `The N institutions closest in total assets (1-${MAX_NEAREST_PEERS}) among those meeting the other parameters and publishing fees` },
] as const;
