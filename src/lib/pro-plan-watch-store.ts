import { getStripe } from "@/lib/stripe";
import { isProTier } from "@/lib/pro-tiers";
import {
  getPaidProUsers,
  getProRequestInstitutions,
  getWatchInstitutions,
} from "@/lib/data-store/pro-accounts";
import { planWatchReasons, type WatchInstitution } from "@/lib/pro-plan-watch";

export interface PlanWatchRow {
  userId: number;
  name: string;
  email: string | null;
  paidFor: string;
  reasons: string[];
}

/**
 * Paid Pro plans worth a second look (see pro-plan-watch.ts). The paid tier and bank come from
 * the Stripe subscription's metadata, which checkout sets from the bank the buyer picked.
 * Read-only: it never changes a price.
 */
export async function getPlanWatchList(): Promise<PlanWatchRow[]> {
  const users = await getPaidProUsers();
  if (users.length === 0) return [];
  const stripe = getStripe();

  const plans = await Promise.all(
    users.map(async (user) => {
      const subscriptions = await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: "active", limit: 1 });
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

  const requests = await getProRequestInstitutions(users.map((user) => user.id));
  const institutions = await getWatchInstitutions([
    ...plans.flatMap((plan) => (plan.institutionId ? [plan.institutionId] : [])),
    ...[...requests.values()].flat(),
  ]);
  const lookup = (id: number): WatchInstitution[] => {
    const found = institutions.get(id);
    return found ? [found] : [];
  };

  return plans.flatMap((plan) => {
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
}
