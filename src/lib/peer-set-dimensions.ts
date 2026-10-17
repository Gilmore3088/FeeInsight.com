/**
 * The peer-group dimensions and their query parameters, with no database access, so docs,
 * the OpenAPI spec and the connector describe them from one list. Resolution lives in
 * src/lib/data-store/peer-sets.ts.
 */
export const PEER_REGULATORS = { occ: "OCC", fdic: "FDIC", fed: "Federal Reserve", ncua: "NCUA" } as const;
export type PeerRegulator = keyof typeof PEER_REGULATORS;
export const MAX_NEAREST_PEERS = 100;
export const MAX_CHOSEN_PEERS = 25;

/** Query parameters that define a peer group. "same" takes the institution's own value. */
export const PEER_GROUP_PARAMS = [
  { name: "charter", example: "bank", description: "bank, credit_union or same" },
  { name: "asset_tier", example: "community_mid,community_large", description: "Asset-size tiers, comma-separated, or same" },
  { name: "asset_min", example: "500000000", description: "Minimum total assets, in whole dollars" },
  { name: "asset_max", example: "2000000000", description: "Maximum total assets, in whole dollars" },
  { name: "state", example: "TX,OK", description: "Two-letter state codes, comma-separated, or same" },
  { name: "district", example: "11", description: "Fed districts 1-12, comma-separated, or same" },
  { name: "regulator", example: "occ,fed", description: "occ, fdic, fed or ncua, comma-separated, or same" },
  { name: "cu_charter", example: "federal", description: "Credit unions only: federal, state or same" },
  { name: "holding_company", example: "same", description: "Holding company RSSD id, or same for the institution's own" },
  { name: "market", example: "same", description: "Metro (MSA) code, or same for the metro holding most of the institution's branches. Peers are institutions with a branch there." },
  { name: "nearest", example: "20", description: `The N institutions closest in total assets (1-${MAX_NEAREST_PEERS}) among those meeting the other parameters and publishing fees` },
] as const;

/*
 * Saved Hamilton peer groups keep these dimensions beyond charter, asset tier, Fed district,
 * states and hand-picked institutions, in saved_peer_sets.filters (jsonb). The basic dimensions
 * stay in their own columns, so older rows and readers are unchanged. Client-safe, so the
 * Settings form can use it.
 */
export const PEER_REGULATOR_LABELS = PEER_REGULATORS;
export type SavedPeerRegulator = keyof typeof PEER_REGULATOR_LABELS;
export const SAVED_PEER_REGULATORS = Object.keys(PEER_REGULATOR_LABELS) as SavedPeerRegulator[];
export const CU_CHARTERS = ["federal", "state"] as const;
export type CuCharter = (typeof CU_CHARTERS)[number];
/** The most institutions "closest in total assets" may keep. */
export const MAX_NEAREST_PEER_COUNT = MAX_NEAREST_PEERS;

export interface SavedPeerDimensions {
  /** Total assets in whole dollars, inclusive. */
  asset_min?: number;
  asset_max?: number;
  regulators?: SavedPeerRegulator[];
  cu_charter?: CuCharter;
  holding_company_rssd?: string;
  /** Metro (MSA) code. */
  market_code?: number;
  /** The N institutions closest in total assets to the subject institution. */
  nearest?: number;
  /** Display only, looked up when a saved group is loaded; never stored or parsed from storage. */
  market_name?: string;
  /** Display only, looked up when a saved group is loaded; never stored or parsed from storage. */
  holding_company_name?: string;
}

const DIMENSION_KEYS = ["asset_min", "asset_max", "regulators", "cu_charter", "holding_company_rssd", "market_code", "nearest"] as const;

export function hasSavedPeerDimensions(dims: SavedPeerDimensions | null | undefined): boolean {
  return Boolean(dims) && DIMENSION_KEYS.some((key) => dims![key] !== undefined);
}

const asDollars = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/**
 * The stored jsonb read back into dimensions. Anything malformed is left out, never guessed:
 * a value of the wrong type, an unknown regulator, a reversed asset range (both bounds dropped).
 * Null when nothing usable is stored.
 */
export function parseSavedPeerDimensions(raw: unknown): SavedPeerDimensions | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const dims: SavedPeerDimensions = {};
  const min = asDollars(v.asset_min);
  const max = asDollars(v.asset_max);
  if (min === undefined || max === undefined || min <= max) {
    if (min !== undefined) dims.asset_min = min;
    if (max !== undefined) dims.asset_max = max;
  }
  if (Array.isArray(v.regulators)) {
    const regulators = [...new Set(v.regulators.filter((r): r is SavedPeerRegulator =>
      typeof r === "string" && (SAVED_PEER_REGULATORS as string[]).includes(r)))];
    if (regulators.length) dims.regulators = regulators;
  }
  if (v.cu_charter === "federal" || v.cu_charter === "state") dims.cu_charter = v.cu_charter;
  if (typeof v.holding_company_rssd === "string" && /^\d{1,12}$/.test(v.holding_company_rssd.trim())) {
    dims.holding_company_rssd = v.holding_company_rssd.trim();
  }
  if (typeof v.market_code === "number" && Number.isInteger(v.market_code) && v.market_code > 0) dims.market_code = v.market_code;
  if (typeof v.nearest === "number" && Number.isInteger(v.nearest) && v.nearest >= 1 && v.nearest <= MAX_NEAREST_PEER_COUNT) {
    dims.nearest = v.nearest;
  }
  return hasSavedPeerDimensions(dims) ? dims : null;
}

function formatDollars(value: number): string {
  if (value >= 1e9) return `$${+(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${+(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString("en-US")}`;
}

/** Short plain-words parts for a saved group's summary line. Never shows a raw metro code. */
export function describeSavedPeerDimensions(dims: SavedPeerDimensions, marketName?: string | null): string[] {
  const parts: string[] = [];
  if (dims.asset_min !== undefined && dims.asset_max !== undefined) parts.push(`Total assets ${formatDollars(dims.asset_min)} to ${formatDollars(dims.asset_max)}`);
  else if (dims.asset_min !== undefined) parts.push(`Total assets at least ${formatDollars(dims.asset_min)}`);
  else if (dims.asset_max !== undefined) parts.push(`Total assets at most ${formatDollars(dims.asset_max)}`);
  if (dims.regulators?.length) parts.push(`Regulator: ${dims.regulators.map((r) => PEER_REGULATOR_LABELS[r]).join(", ")}`);
  if (dims.cu_charter) parts.push(dims.cu_charter === "federal" ? "Federally chartered credit unions" : "State-chartered credit unions");
  if (dims.holding_company_rssd) {
    parts.push(dims.holding_company_name ? `Same holding company: ${dims.holding_company_name}` : "Same holding company (name not on record)");
  }
  if (dims.market_code !== undefined) {
    const name = marketName || dims.market_name;
    parts.push(name ? `Branches in the ${name} metro` : "Branches in one metro (name not on record)");
  }
  if (dims.nearest !== undefined) parts.push(`The ${dims.nearest} closest in total assets`);
  return parts;
}
