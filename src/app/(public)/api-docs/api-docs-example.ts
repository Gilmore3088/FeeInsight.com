/**
 * The worked example's institution: Capital City Bank, from the standard demo cast. Facts as its
 * live profile showed them on Oct 19, 2026 (/institution/323, Oct 17 data snapshot): Tallahassee,
 * Florida; bank charter; $4.4B in assets (rounded here, in thousands as the API returns it);
 * Atlanta Fed district; 37 published fees; Overdraft Item Fee $35; Paper statements $2.
 */
export const DEMO = {
  id: 323,
  name: "Capital City Bank",
  state: "FL",
  city: "Tallahassee",
  assetThousands: 4_400_000,
  assetTier: "community_large",
  fedDistrict: 6,
  feeCount: 37,
} as const;
