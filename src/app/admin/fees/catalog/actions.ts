"use server";

import { requireAuth } from "@/lib/auth";
import { getFeeCategorySummaries } from "@/lib/data-store";
import { getDisplayName, getFeeFamily, getFeeTier } from "@/lib/fee-taxonomy";

export async function exportCatalogCsv(): Promise<string> {
  await requireAuth("operate");

  const summaries = await getFeeCategorySummaries();

  const headers = [
    "Fee Category",
    "Family",
    "Tier",
    "Institutions",
    "Min",
    "P25",
    "Median",
    "P75",
    "Max",
    "Average",
    "Spread",
    "Banks",
    "Credit Unions",
  ];

  const rows = summaries.map((s) => {
    const spread =
      s.max_amount !== null && s.min_amount !== null
        ? (s.max_amount - s.min_amount).toFixed(2)
        : "";
    return [
      getDisplayName(s.fee_category),
      getFeeFamily(s.fee_category) ?? "Other",
      getFeeTier(s.fee_category),
      s.institution_count,
      s.min_amount?.toFixed(2) ?? "",
      s.p25_amount?.toFixed(2) ?? "",
      s.median_amount?.toFixed(2) ?? "",
      s.p75_amount?.toFixed(2) ?? "",
      s.max_amount?.toFixed(2) ?? "",
      s.avg_amount?.toFixed(2) ?? "",
      spread,
      s.bank_count,
      s.cu_count,
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}
