/**
 * Plain words for a peer group's filters. Pure and client-safe: no database imports, so the
 * index readers (data-store/fee-index.ts, for dataset stamps) and Hamilton's chart labels
 * (hamilton/peer-index.ts describePeerFilters) share one wording without an import cycle.
 */

/** Asset ranges for both tier vocabularies (institution segments and FDIC tiers). */
export const ASSET_TIER_RANGES: Record<string, string> = {
  community_small: "under $300M",
  community_mid: "$300M to $1B",
  community_large: "$1B to $10B",
  regional: "$10B to $50B",
  large_regional: "$50B to $250B",
  super_regional: "over $250B",
  micro: "under $100M",
  community: "$100M to $1B",
  midsize: "$1B to $10B",
  mega: "over $250B",
};

/** The filter fields of a peer group (the shape of PeerFilterSet and HamiltonPeerFilters). */
export interface PeerFilterFields {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
  state_code?: string;
  states?: string[];
  institutionIds?: number[];
}

/** "5 chosen institutions": a hand-picked peer group. */
export function chosenInstitutionsLabel(n: number): string {
  return `${n} chosen ${n === 1 ? "institution" : "institutions"}`;
}

/**
 * One entry per filter that applies, in the order describePeerFilters joins them. `key` holds
 * the filter's values, so a changed value reads as a different filter. Hand-picked peers are
 * exactly those institutions; the other filters do not apply then.
 */
export function peerFilterParts(filters: PeerFilterFields): { key: string; label: string }[] {
  const ids = [...new Set((filters.institutionIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length > 0) {
    return [{
      key: `peers:institutions:${[...ids].sort((a, b) => a - b).join(",")}`,
      label: chosenInstitutionsLabel(ids.length),
    }];
  }
  const parts: { key: string; label: string }[] = [];
  if (filters.state_code) parts.push({ key: `peers:state:${filters.state_code}`, label: filters.state_code });
  if (filters.states?.length) {
    parts.push({ key: `peers:states:${[...filters.states].sort().join(",")}`, label: filters.states.join("/") });
  }
  if (filters.charter_type) {
    parts.push({ key: `peers:charter:${filters.charter_type}`, label: filters.charter_type.replace(/_/g, " ") });
  }
  if (filters.asset_tiers?.length) {
    parts.push({
      key: `peers:asset_tiers:${[...filters.asset_tiers].sort().join(",")}`,
      label: filters.asset_tiers.map((tier) => ASSET_TIER_RANGES[tier] ?? tier.replace(/_/g, " ")).join(" or "),
    });
  }
  if (filters.fed_districts?.length) {
    parts.push({
      key: `peers:fed_districts:${[...filters.fed_districts].sort((a, b) => a - b).join(",")}`,
      label: `Fed district ${filters.fed_districts.join("/")}`,
    });
  }
  return parts;
}
