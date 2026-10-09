import { getStripe } from "@/lib/stripe";
import { isProTier } from "@/lib/pro-tiers";
import {
  getPaidProUsers,
  getProRequestInstitutions,
  getWatchInstitutions,
} from "@/lib/data-store/pro-accounts";
import { planWatchReasons, type WatchInstitution } from "@/lib/pro-plan-watch";
import { errorCode } from "@/lib/admin-read-failure";

export interface PlanWatchRow {
  userId: number;
  name: string;
  email: string | null;
  paidFor: string;
  reasons: string[];
}

/** A paid plan whose Stripe subscription could not be read, with Stripe's error code. */
export interface PlanWatchUnread {
  userId: number;
  name: string;
  code: string;
}

export interface PlanWatchList {
  rows: PlanWatchRow[];
  /** Plans skipped because Stripe refused the read (e.g. a customer id the configured key doesn't know). */
  unread: PlanWatchUnread[];
}

/**
 * Paid Pro plans worth a second look (see pro-plan-watch.ts). The paid tier and bank come from
 * the Stripe subscription's metadata, which checkout sets from the bank the buyer picked.
 * Read-only: it never changes a price. A plan Stripe can't read is listed in `unread` instead of
 * failing every other plan's check.
 */
export async function getPlanWatchList(): Promise<PlanWatchList> {
  const users = await getPaidProUsers();
  if (users.length === 0) return { rows: [], unread: [] };
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (error) {
    throw Object.assign(new Error("Stripe is not configured", { cause: error }), { code: "stripe_not_configured" });
  }

  const unread: PlanWatchUnread[] = [];
  const read = await Promise.all(
    users.map(async (user) => {
      let subscriptions;
      try {
        subscriptions = await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: "active", limit: 1 });
      } catch (error) {
        console.error(`Plan watch: Stripe subscription read failed for user ${user.id}`, error);
        unread.push({ userId: user.id, name: user.name, code: errorCode(error) });
        return null;
      }
      const metadata = subscriptions.data[0]?.metadata ?? {};
      const tier = isProTier(metadata.pro_tier) ? metadata.pro_tier : null;
      const institutionId = Number(metadata.institution_id);
      return {
        user,
        tier,
        otherOrganization: metadata.organization === "other",
        tierPickedByBuyer: metadata.tier_picked_by_buyer === "true",
        institutionId: Number.isSafeInteger(institutionId) && institutionId > 0 ? institutionId : null,
      };
    }),
  );
  const plans = read.flatMap((plan) => (plan ? [plan] : []));

  const requests = await getProRequestInstitutions(plans.map((plan) => plan.user.id));
  const institutions = await getWatchInstitutions([
    ...plans.flatMap((plan) => (plan.institutionId ? [plan.institutionId] : [])),
    ...[...requests.values()].flat(),
  ]);
  const lookup = (id: number): WatchInstitution[] => {
    const found = institutions.get(id);
    return found ? [found] : [];
  };

  const rows = plans.flatMap((plan) => {
    const paidInstitution = plan.institutionId ? institutions.get(plan.institutionId) ?? null : null;
    const reasons = planWatchReasons({
      email: plan.user.email,
      paidTier: plan.tier,
      otherOrganization: plan.otherOrganization,
      tierPickedByBuyer: plan.tierPickedByBuyer,
      paidInstitution,
      requestedInstitutions: (requests.get(plan.user.id) ?? []).flatMap(lookup),
    });
    if (reasons.length === 0) return [];
    return [
      {
        userId: plan.user.id,
        name: plan.user.name,
        email: plan.user.email,
        paidFor: paidInstitution ? `${paidInstitution.name} (${plan.tier} tier)` : `${plan.tier ?? "unknown"} tier`,
        reasons,
      },
    ];
  });
  return { rows, unread };
}
