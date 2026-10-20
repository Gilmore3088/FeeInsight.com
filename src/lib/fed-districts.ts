export const DISTRICT_NAMES: Record<number, string> = {
  1: "Boston",
  2: "New York",
  3: "Philadelphia",
  4: "Cleveland",
  5: "Richmond",
  6: "Atlanta",
  7: "Chicago",
  8: "St. Louis",
  9: "Minneapolis",
  10: "Kansas City",
  11: "Dallas",
  12: "San Francisco",
};

export const FDIC_TIER_LABELS: Record<string, string> = {
  micro:     "Micro (<$100M)",
  community: "Community ($100M-$1B)",
  midsize:   "Mid-Size ($1B-$10B)",
  regional:  "Regional ($10B-$250B)",
  mega:      "Mega (>$250B)",
};

export const FDIC_TIER_BREAKPOINTS: Record<string, [number, number]> = {
  micro:     [0,                100_000_000],
  community: [100_000_000,      1_000_000_000],
  midsize:   [1_000_000_000,    10_000_000_000],
  regional:  [10_000_000_000,   250_000_000_000],
  mega:      [250_000_000_000,  Infinity],
};

/** Classify an institution by total assets (in dollars) into FDIC tier */
export function getTierForAssets(totalAssets: number): string {
  if (totalAssets < 100_000_000) return "micro";
  if (totalAssets < 1_000_000_000) return "community";
  if (totalAssets < 10_000_000_000) return "midsize";
  if (totalAssets < 250_000_000_000) return "regional";
  return "mega";
}

const OLD_TO_NEW_TIER: Record<string, string> = {
  community_small: "micro",
  community_mid:   "community",
  community_large: "midsize",
  // "regional" stays "regional" (same key)
  large_regional:  "regional",
  super_regional:  "mega",
};

export const STATE_TO_DISTRICT: Record<string, number> = {
  CT: 1, ME: 1, MA: 1, NH: 1, RI: 1, VT: 1,
  NY: 2, NJ: 2, PR: 2, VI: 2,
  PA: 3, DE: 3,
  OH: 4, KY: 4,
  VA: 5, MD: 5, DC: 5, NC: 5, SC: 5, WV: 5,
  GA: 6, FL: 6, AL: 6, TN: 6, MS: 6, LA: 6,
  IL: 7, IN: 7, IA: 7, MI: 7, WI: 7,
  MO: 8, AR: 8,
  MN: 9, MT: 9, ND: 9, SD: 9,
  KS: 10, NE: 10, OK: 10, CO: 10, WY: 10, NM: 10,
  TX: 11,
  CA: 12, WA: 12, OR: 12, NV: 12, UT: 12, ID: 12, AZ: 12, HI: 12, AK: 12, GU: 12, AS: 12,
};

export interface PeerFilters {
  charter?: string;
  tiers?: string[];
  districts?: number[];
  range?: string;
}

export function parsePeerFilters(params: {
  charter?: string;
  tier?: string;
  district?: string;
  range?: string;
}): PeerFilters {
  const filters: PeerFilters = {};

  if (params.charter === "bank" || params.charter === "credit_union") {
    filters.charter = params.charter;
  }

  if (params.tier) {
    const tiers = params.tier
      .split(",")
      .map((t) => OLD_TO_NEW_TIER[t] ?? t)
      .filter((t) => t in FDIC_TIER_LABELS);
    if (tiers.length > 0) {
      filters.tiers = [...new Set(tiers)];
    }
  }

  if (params.district) {
    const districts = params.district
      .split(",")
      .map((d) => parseInt(d, 10))
      .filter((d) => d >= 1 && d <= 12);
    if (districts.length > 0) {
      filters.districts = districts;
    }
  }

  if (params.range && ["7d", "30d", "90d", "all"].includes(params.range)) {
    filters.range = params.range;
  }

  return filters;
}

export function buildFilterDescription(filters: PeerFilters): string {
  const parts: string[] = [];

  if (filters.districts && filters.districts.length > 0) {
    const districtLabels = filters.districts.map(
      (d) => `${d} - ${DISTRICT_NAMES[d] ?? "Unknown"}`
    );
    parts.push(`District ${districtLabels.join(", ")}`);
  }

  if (filters.tiers && filters.tiers.length > 0) {
    const tierLabels = filters.tiers.map((t) => FDIC_TIER_LABELS[t] ?? t);
    parts.push(tierLabels.join(", "));
  }

  if (filters.charter) {
    parts.push(filters.charter === "bank" ? "Banks" : "Credit Unions");
  }

  return parts.length > 0 ? parts.join(" | ") : "All Institutions";
}
