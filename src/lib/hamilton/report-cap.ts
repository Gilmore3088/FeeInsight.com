import { sql } from "@/lib/data-store/connection";
import { getStripe } from "@/lib/stripe";
import { CONTACT_EMAIL } from "@/lib/constants";
import type { User } from "@/lib/auth";
import { isProTierPrice } from "@/lib/stripe-prices";
import {
  CONSULTANT_MONTHLY_REPORTS,
  CONSULTANT_UPGRADE_TIER,
  tierAmountLabel,
} from "@/lib/pro-tiers";

/**
 * Monthly Hamilton report cap for the consultant plan (src/lib/pro-tiers.ts). Bank and
 * credit union plans are priced by asset size and have no monthly cap. A consultant is a
 * subscription that checkout tagged organization=other; once James moves it onto the upgrade
 * tier's price in Stripe, the cap no longer applies.
 *
 * Like the daily quota, this is a pricing guard, not an outage switch: if Stripe or the
 * count can't be read, the report goes ahead.
 */

export interface ReportCap {
  allowed: boolean;
  used: number;
  limit: number | null;
}

const NO_CAP: ReportCap = { allowed: true, used: 0, limit: null };

/** True when the active subscription is a consultant plan below the upgrade tier. */
export async function isCappedConsultant(user: Pick<User, "stripe_customer_id">): Promise<boolean> {
  if (!user.stripe_customer_id) return false;
  const subscriptions = await getStripe().subscriptions.list({
    customer: user.stripe_customer_id,
    status: "active",
    limit: 1,
  });
  const subscription = subscriptions.data[0];
  if (!subscription || subscription.metadata?.organization !== "other") return false;
  return !subscription.items.data.some((item) => isProTierPrice(item.price, CONSULTANT_UPGRADE_TIER));
}

export async function checkConsultantReportCap(
  user: Pick<User, "id" | "stripe_customer_id">,
): Promise<ReportCap> {
  try {
    if (!(await isCappedConsultant(user))) return NO_CAP;
    const [row] = await sql`
      SELECT COUNT(*)::int AS used
        FROM research_usage
       WHERE user_id = ${user.id}
         AND agent_id = 'hamilton-report'
         AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')
    `;
    const used = Number(row?.used ?? 0);
    return { allowed: used < CONSULTANT_MONTHLY_REPORTS, used, limit: CONSULTANT_MONTHLY_REPORTS };
  } catch {
    return NO_CAP;
  }
}

export function reportCapMessage(cap: ReportCap): string {
  return `Your plan includes ${cap.limit} Hamilton reports a month, and you've used them all. They reset on the 1st. For more, email ${CONTACT_EMAIL} to move to the ${tierAmountLabel(
    CONSULTANT_UPGRADE_TIER,
    "annual",
  )} a year plan, which has no monthly report limit.`;
}
