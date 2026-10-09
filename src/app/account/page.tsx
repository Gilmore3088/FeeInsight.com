export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium, isInPaymentGrace } from "@/lib/access";
import { redirect } from "next/navigation";
import { getBillingSummary } from "@/lib/billing-summary";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getAlertSubscriptions } from "@/lib/data-store/alerts";
import { getHamiltonWorkspaceContext } from "@/lib/hamilton/workspace-context";
import { buildHamiltonAccountHref } from "@/lib/hamilton/account-actions";
import {
  getInstitutionWorkspaceSeatUsage,
  getPendingWorkspaceInvitationsForEmail,
  getUserInstitutionMemberships,
} from "@/lib/hamilton/institution-membership";
import { PRO_TIERS } from "@/lib/pro-tiers";
import { getAccountEmails } from "./account-emails";
import { getAccountReports, getOwnInstitution, getPaidReports } from "./account-data";
import { isEmailConfirmed } from "@/lib/email/email-confirm";
import { AccountView, type AccountPlan } from "./account-view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/account");

  const params = await searchParams;
  // Fallback: if webhook missed, verify payment directly with Stripe
  if (user.subscription_status !== "active" && user.stripe_customer_id) {
    try {
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      const subs = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) {
        const { sql: sqlConn } = await import("@/lib/data-store/connection");
        await sqlConn`
          UPDATE users SET subscription_status = 'active', past_due_since = NULL, role = 'premium'
          WHERE id = ${user.id} AND role NOT IN ('admin', 'analyst')`;
        user.subscription_status = "active";
        if (user.role !== "admin" && user.role !== "analyst") {
          user.role = "premium";
        }
      }
    } catch {
      // Stripe not configured or error -- continue with current status
    }
  }

  const isPro = canAccessPremium(user);
  const isStaff = user.role === "admin" || user.role === "analyst";
  const paysForPro = user.subscription_status === "active" || isInPaymentGrace(user);

  const [subscriptions, invitations, memberships, emails, billing, workspaceContext] = await Promise.all([
    getAlertSubscriptions(user.id).catch(() => []),
    isPro ? Promise.resolve([]) : getPendingWorkspaceInvitationsForEmail(user.email ?? user.username, 5).catch(() => []),
    isPro ? getUserInstitutionMemberships(user.id).catch(() => []) : Promise.resolve([]),
    isPro ? getAccountEmails(user.id) : Promise.resolve(null),
    isPro && paysForPro ? getBillingSummary(user.stripe_customer_id) : Promise.resolve(null),
    isPro ? getHamiltonWorkspaceContext(user.id).catch(() => null) : Promise.resolve(null),
  ]);

  // The team the user can add people to: the workspace they own, else one they administer.
  const managed =
    memberships.find((membership) => membership.role === "owner") ??
    memberships.find((membership) => membership.role === "admin") ??
    null;
  const seatUsage = managed
    ? await getInstitutionWorkspaceSeatUsage({ institutionId: managed.institutionId }).catch(() => null)
    : null;

  const emailConfirmed = await isEmailConfirmed(user.id);
  const [reports, ownInstitution, paidReports] = await Promise.all([
    isPro ? getAccountReports(user.id) : Promise.resolve(null),
    getOwnInstitution({
      institutionId: workspaceContext?.selectedInstitutionId ?? managed?.institutionId ?? null,
      profileName: user.institution_name,
      profileState: user.state_code,
    }),
    emailConfirmed && user.email ? getPaidReports(user.email) : Promise.resolve([]),
  ]);

  const plan: AccountPlan = isPro
    ? {
        kind: "pro",
        access: isStaff ? "staff" : paysForPro ? "subscription" : "seat",
        billing,
        canManageBilling: !isStaff && paysForPro && Boolean(user.stripe_customer_id),
        seatInstitutionName: memberships[0]?.institutionName ?? null,
        team:
          managed && seatUsage
            ? { institutionName: managed.institutionName, used: seatUsage.used, limit: seatUsage.limit }
            : null,
        hamiltonHref: buildHamiltonAccountHref({
          isPro: true,
          path: "/pro/hamilton",
          selectedInstitutionId: workspaceContext?.selectedInstitutionId ?? null,
        }),
      }
    : { kind: "free", fromMonthlyUsd: Math.min(...PRO_TIERS.map((tier) => tier.monthlyUsd)) };

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content">
        <AccountView
          data={{
            heading: user.institution_name || user.display_name || "Your account",
            email: user.email || user.username,
            justSubscribed: Boolean(params.success) && isPro,
            statusUser: user,
            invitations: invitations.map((invitation) => ({
              id: invitation.id,
              institutionName: invitation.institutionName,
              role: invitation.role,
            })),
            plan,
            subscriptions,
            reports,
            emailConfirmed,
            paidReports,
            ownInstitution,
            emails,
            profile: {
              institution_name: user.institution_name,
              institution_type: user.institution_type,
              asset_tier: user.asset_tier,
              state_code: user.state_code,
              job_role: user.job_role,
            },
          }}
        />
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
