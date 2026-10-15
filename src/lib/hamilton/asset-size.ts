/**
 * Asset-size slices a Research reader can pick on the page. Bounds are total assets in thousands,
 * half-open like getSegmentFeeValues: at least `minAssets`, under `maxAssets`.
 */
export const ASSET_SIZES = [
  { id: "all", label: "All sizes", minAssets: null, maxAssets: null },
  { id: "under-1b", label: "Under $1B", minAssets: null, maxAssets: 1_000_000 },
  { id: "1b-10b", label: "$1B to $10B", minAssets: 1_000_000, maxAssets: 10_000_000 },
  { id: "10b-plus", label: "$10B and up", minAssets: 10_000_000, maxAssets: null },
] as const;

export type AssetSize = (typeof ASSET_SIZES)[number];
export type AssetSizeId = AssetSize["id"];

export function assetSizeFor(id: string | null | undefined): AssetSize {
  return ASSET_SIZES.find(s => s.id === id) ?? ASSET_SIZES[0];
}
