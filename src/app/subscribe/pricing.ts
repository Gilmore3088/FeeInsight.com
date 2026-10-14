import { REPORT_OFFER } from "@/lib/constants";
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
/** "From $300" while the report is quoted per institution. */
export const REPORT_PRICE_LABEL = REPORT_PRICE_USD === 0 ? REPORT_OFFER.priceLabel : WHOLE_DOLLARS.format(REPORT_PRICE_USD);
