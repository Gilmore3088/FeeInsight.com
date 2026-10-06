import { getPublicStatsSummary } from "@/lib/public-stats";

/**
 * "Data refreshed … · N published fee entries". Uses the same de-duplicated count as every other
 * public stat, so a page never shows two different totals for the same thing.
 */
export async function DataFreshness() {
  const summary = await getPublicStatsSummary();
  if (!summary.refreshedOn) return null;

  return (
    <p className="text-[11px] text-[#6B6255]">
      Data refreshed {summary.refreshedOn} &middot; {summary.observationsLabel} published fee entries nationally
    </p>
  );
}
