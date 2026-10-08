import { REPORT_INCLUDES, REPORT_OFFER } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";

export { isProPlan, type ProPlan } from "@/lib/pro-tiers";
import type { ProPlan } from "@/lib/pro-tiers";

export const REPORT_PRICE_USD = REPORT_OFFER.priceUsd;

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "Monthly" / "Annual" for copy that names the plan. */
export const PLAN_DISPLAY_NAME: Record<ProPlan, string> = { monthly: "Monthly", annual: "Annual" };
/** One subscription covers the whole team (James, 8 Oct 2026): "for up to 5 people". */
export const PLAN_TEAM_LABEL = `for up to ${WORKSPACE_SEAT_LIMIT} people`;
/** "Priced on request" while the report has no list price. */
export const REPORT_PRICE_LABEL = REPORT_PRICE_USD === 0 ? REPORT_OFFER.priceLabel : WHOLE_DOLLARS.format(REPORT_PRICE_USD);

/** Feature list shared by every Pro tier and plan: the tiers differ by price, not features. */
export function proFeatureList(summary: PublicStatsSummary): string[] {
  return [
    `Full dataset: ${summary.categoriesLabel} fee categories, ${summary.institutionsLabel} institutions with verified fees`,
    "Hamilton workspace: This month, My fees, Try a price and Reports",
    "Unlimited peer sets by charter type, asset tier and Fed district",
    "Monitor mode: a watchlist of competitors and their fee changes in one feed",
    "What-if scenario modeling on your own schedule",
    "Board-ready reports, every figure cited to its source document",
    "CSV exports (API access on request)",
    "Fed district economic context, Beige Book summaries, CFPB complaint data",
  ];
}

/** The institution report's contents, worded the same as every other page that lists them. */
export const REPORT_BULLETS: readonly string[] = REPORT_INCLUDES;
