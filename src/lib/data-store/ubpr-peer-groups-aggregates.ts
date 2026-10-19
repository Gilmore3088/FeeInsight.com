/**
 * Bank ratio medians over UBPR loader rows (ubpr_bank_peer_groups): our computation from each
 * bank's own UBPR ratio, by UBPR peer group, state, Fed district or asset-size tier. Every median
 * carries its institution count and is null below MIN_UBPR_GROUP. These are labelled computed;
 * the regulator's published peer averages are never mixed in.
 */

export const UBPR_RATIO_KEYS = [
  "noninterest_income_to_avg_assets",
  "service_charges_to_avg_assets",
  "efficiency_ratio",
  "roa",
  "nim",
  "net_charge_offs_to_avg_loans",
] as const;
export type UbprRatioKey = (typeof UBPR_RATIO_KEYS)[number];

export type UbprGroupDimension = "peer_group" | "state" | "fed_district" | "asset_tier";

export interface MedianWithCount {
  median: number | null;
  institution_count: number;
}

/** Below this many institutions a group gets a count but no median. */
export const MIN_UBPR_GROUP = 5;

/** Median of finite values with how many went in; null below `min`. */
export function medianWithCount(values: number[], min = MIN_UBPR_GROUP): MedianWithCount {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length < min || s.length === 0) return { median: null, institution_count: s.length };
  const mid = Math.floor(s.length / 2);
  return { median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, institution_count: s.length };
}

export interface UbprBankRow {
  institution_id: number | string | null;
  peer_group: string | null;
  ratios: Record<string, unknown> | null;
  state_code: string | null;
  fed_district: number | string | null;
  asset_size_tier: string | null;
  charter_type: string | null;
}

export function groupKey(row: UbprBankRow, dimension: UbprGroupDimension): string | null {
  const v =
    dimension === "peer_group" ? row.peer_group
      : dimension === "state" ? row.state_code
        : dimension === "fed_district" ? (row.fed_district == null ? null : String(row.fed_district))
          : row.asset_size_tier;
  return v === null || v === undefined || v === "" ? null : String(v);
}

export interface UbprRatioGroup {
  group: string;
  banks: number;
  ratios: Record<UbprRatioKey, MedianWithCount>;
}

/** Medians of each bank ratio per group. A bank without a value for a ratio adds nothing to it. */
export function ratioMediansBy(rows: UbprBankRow[], dimension: UbprGroupDimension, min = MIN_UBPR_GROUP): UbprRatioGroup[] {
  const groups = new Map<string, UbprBankRow[]>();
  for (const row of rows) {
    const key = groupKey(row, dimension);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .map(([group, members]) => {
      const ratios = {} as Record<UbprRatioKey, MedianWithCount>;
      for (const key of UBPR_RATIO_KEYS) {
        const values = members
          .map((m) => m.ratios?.[key])
          .filter((v) => v !== null && v !== undefined && v !== "")
          .map(Number);
        ratios[key] = medianWithCount(values, min);
      }
      return { group, banks: members.length, ratios };
    })
    .sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));
}

/** Split "peer_group\u0000category" back apart. */
export function splitFeeKey(key: string): { peer_group: string; fee_category: string } {
  const at = key.indexOf("\u0000");
  return { peer_group: key.slice(0, at), fee_category: key.slice(at + 1) };
}
