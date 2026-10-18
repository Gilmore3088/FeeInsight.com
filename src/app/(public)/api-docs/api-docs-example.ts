import type { FeeCategorySummary } from "@/lib/data-store/fees";

/**
 * The worked example's institution: Capital City Bank, from the standard demo cast. Facts as its
 * profile showed them on Oct 18, 2026 (/institution/323): Tallahassee, Florida; bank charter;
 * $4.4B in assets (rounded here, in thousands as the API returns it); Atlanta Fed district;
 * 25 published fees.
 */
export const DEMO = {
  id: 323,
  name: "Capital City Bank",
  state: "FL",
  city: "Tallahassee",
  assetThousands: 4_400_000,
  assetTier: "community_large",
  fedDistrict: 6,
  feeCount: 25,
} as const;

/** A dollar figure as the API writes it, or null when the live read has none. */
function money(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "null" : value.toFixed(2);
}

/**
 * The overdraft example uses the live national figures (#1953: a fixed $35 across 842
 * institutions sat beside a live $30 elsewhere on the site).
 */
export function overdraftExample(row: FeeCategorySummary | undefined) {
  return {
    median: money(row?.median_amount),
    p25: money(row?.p25_amount),
    p75: money(row?.p75_amount),
    min: money(row?.min_amount),
    max: money(row?.max_amount),
    institutions: row ? String(row.institution_count) : "null",
    observations: row ? String(row.total_observations) : "null",
    bankMedian: money(row?.bank_median_amount),
    bankCount: row ? String(row.bank_count) : "null",
    cuMedian: money(row?.cu_median_amount),
    cuCount: row ? String(row.cu_count) : "null",
  };
}
