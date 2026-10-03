"use server";

import { requireAuth } from "@/lib/auth";
import { getNationalIndex, getPeerIndex } from "@/lib/data-store";
import { getDisplayName, getFeeFamily, getFeeTier } from "@/lib/fee-taxonomy";

export async function exportIndexCsv(
  filters: {
    charter_type?: string;
    asset_tiers?: string[];
    fed_districts?: number[];
  },
  approvedOnly: boolean
): Promise<string> {
  await requireAuth("operate");

  const hasFilters = !!(
    filters.charter_type ||
    (filters.asset_tiers && filters.asset_tiers.length > 0) ||
    (filters.fed_districts && filters.fed_districts.length > 0)
  );

  const entries = hasFilters
    ? await getPeerIndex(filters, approvedOnly)
    : await getNationalIndex(approvedOnly);

  const headers = [
    "Family",
    "Category",
    "Tier",
    "Median",
    "P25",
    "P75",
    "Min",
    "Max",
    "Institutions",
    "Banks",
    "Credit Unions",
    "Observations",
    "Approved",
    "Maturity",
  ];

  const rows = entries.map((e) =>
    [
      getFeeFamily(e.fee_category) ?? "Other",
      getDisplayName(e.fee_category),
      getFeeTier(e.fee_category),
      e.median_amount?.toFixed(2) ?? "",
      e.p25_amount?.toFixed(2) ?? "",
      e.p75_amount?.toFixed(2) ?? "",
      e.min_amount?.toFixed(2) ?? "",
      e.max_amount?.toFixed(2) ?? "",
      e.institution_count,
      e.bank_count,
      e.cu_count,
      e.observation_count,
      e.approved_count,
      e.maturity_tier,
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
