/** Asset ranges for both tier vocabularies (institution segments and FDIC tiers). Pure, client-safe. */
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
