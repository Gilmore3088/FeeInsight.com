/**
 * Asset-size slices a Research reader can pick on the page. Bounds are total assets in thousands,
 * half-open like getSegmentFeeValues: at least `minAssets`, under `maxAssets`. `tiers` are the
 * matching `asset_size_tier` values (src/lib/fed-districts.ts), so the fee index, the state map and
 * the institution table all read the same slice.
 */
export const ASSET_SIZES = [
  { id: "all", label: "All sizes", minAssets: null, maxAssets: null, tiers: null },
  { id: "under-1b", label: "Under $1B", minAssets: null, maxAssets: 1_000_000, tiers: ["micro", "community"] },
  { id: "1b-10b", label: "$1B to $10B", minAssets: 1_000_000, maxAssets: 10_000_000, tiers: ["midsize"] },
  { id: "10b-plus", label: "$10B and up", minAssets: 10_000_000, maxAssets: null, tiers: ["regional", "mega"] },
] as const;

export type AssetSize = (typeof ASSET_SIZES)[number];

export function assetSizeFor(id: string | null | undefined): AssetSize {
  return ASSET_SIZES.find(s => s.id === id) ?? ASSET_SIZES[0];
}
