import type { PeerSetFilterInput } from "@/lib/data-store/saved-peers";
import { STATE_NAMES } from "@/lib/us-states";

export const PEER_SET_ASSET_LABELS: Record<string, string> = {
  community_small: "Under $300M",
  community_mid: "$300M to $1B",
  community_large: "$1B to $10B",
  regional: "$10B to $50B",
  large_regional: "$50B to $250B",
  super_regional: "Over $250B",
};

/** A useful editable name, using only the criteria actually saved with the group. */
export function defaultPeerSetName(filters: PeerSetFilterInput, subjectName?: string): string {
  if (filters.institution_ids?.length) {
    const count = new Set(filters.institution_ids).size;
    return `${count} selected institution${count === 1 ? "" : "s"}${subjectName ? ` for ${subjectName}` : ""}`.slice(0, 100);
  }
  const parts: string[] = [];
  if (filters.states?.length) parts.push([...new Set(filters.states)].map(code => STATE_NAMES[code] ?? code).join(", "));
  if (filters.asset_tiers?.length) parts.push([...new Set(filters.asset_tiers)].map(tier => PEER_SET_ASSET_LABELS[tier] ?? tier).join(", "));
  parts.push(filters.charter_type === "bank" ? "Banks" : filters.charter_type === "credit_union" ? "Credit unions" : "Institutions");
  if (filters.fed_districts?.length) parts.push(`Fed district${filters.fed_districts.length === 1 ? "" : "s"} ${[...new Set(filters.fed_districts)].join(", ")}`);
  return (parts.length === 1 ? `All ${parts[0].toLowerCase()}` : parts.join(" · ")).slice(0, 100);
}
