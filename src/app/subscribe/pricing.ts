import { REPORT_INCLUDES, REPORT_OFFER } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";

export type ProPlan = "monthly" | "annual";

/** Billed prices in USD. Display strings are derived, never hand-typed. */
export const MONTHLY_PRICE_USD = 499.99;
export const ANNUAL_PRICE_USD = 5000;
export const REPORT_PRICE_USD = REPORT_OFFER.priceUsd;
const MONTHS_PER_YEAR = 12;

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const EXACT_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$499.99" — the billed monthly seat price, never floored. */
export const MONTHLY_PRICE_LABEL = EXACT_DOLLARS.format(MONTHLY_PRICE_USD);
/** "Monthly" / "Annual" for copy that names the plan. */
export const PLAN_DISPLAY_NAME: Record<ProPlan, string> = { monthly: "Monthly", annual: "Annual" };
/** "$499.99/mo per seat" / "$5,000/yr per seat". */
export function planPriceLine(plan: ProPlan): string {
  return plan === "monthly"
    ? `${MONTHLY_PRICE_LABEL}/mo per seat`
    : `${ANNUAL_PRICE_LABEL}/yr per seat`;
}
/** "$5,000" */
export const ANNUAL_PRICE_LABEL = WHOLE_DOLLARS.format(ANNUAL_PRICE_USD);
/** "Priced on request" while the report has no list price. */
export const REPORT_PRICE_LABEL = REPORT_PRICE_USD === 0 ? REPORT_OFFER.priceLabel : WHOLE_DOLLARS.format(REPORT_PRICE_USD);
/** Computed from the two billed prices; e.g. "$1,000". */
export const ANNUAL_SAVINGS_LABEL = WHOLE_DOLLARS.format(
  Math.round(MONTHLY_PRICE_USD * MONTHS_PER_YEAR - ANNUAL_PRICE_USD),
);

export function isProPlan(value: string | undefined): value is ProPlan {
  return value === "monthly" || value === "annual";
}

/** Feature list shared by both Pro price columns — annual is a discount, not a tier. */
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
