export const dynamic = "force-dynamic";
import { getCurrentUser, type User } from "@/lib/auth";
import { redirect } from "next/navigation";
import { sql } from "@/lib/data-store/connection";
import { canAccessPremium } from "@/lib/access";
import { STATE_TO_DISTRICT, DISTRICT_NAMES } from "@/lib/fed-districts";
import { getSpotlightCategories, getDisplayName } from "@/lib/fee-taxonomy";
import { getNationalIndexCached } from "@/lib/data-store/fee-index";
import {
  acceptPendingWorkspaceInvitationsForUser,
  getPendingWorkspaceInvitationsForEmail,
  getUserInstitutionMemberships,
} from "@/lib/hamilton/institution-membership";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { WelcomeSteps } from "./welcome-steps";
import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Welcome",
};

/** National medians for the spotlight categories under the statistics contract (no median below the minimum sample). */
async function getSpotlightMedians(): Promise<{ category: string; displayName: string; median: number }[]> {
  const spotlight = new Set(getSpotlightCategories());
  try {
    const index = await getNationalIndexCached();
    return index
      .filter((entry) => spotlight.has(entry.fee_category) && entry.median_amount !== null)
      .map((entry) => ({
        category: entry.fee_category,
        displayName: getDisplayName(entry.fee_category),
        median: entry.median_amount as number,
      }))
      .sort((a, b) => b.median - a.median);
  } catch {
    return [];
  }
}

async function activateIfPaid(
  user: Pick<User, "id" | "username" | "email" | "role" | "subscription_status" | "stripe_customer_id">,
): Promise<boolean> {
  if (user.subscription_status === "active") return false;

  if (user.stripe_customer_id) {
    try {
      const { getStripe } = await import("@/lib/stripe");
      const stripe = getStripe();
      const subs = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      if (subs.data.length > 0) {
        await sql`
          UPDATE users SET subscription_status = 'active', past_due_since = NULL, role = 'premium'
          WHERE id = ${user.id} AND role NOT IN ('admin', 'analyst')`;
        await acceptPendingWorkspaceInvitationsForUser({
          userId: user.id,
          email: user.email ?? user.username,
        }).catch(() => []);
        return true;
      }
    } catch (e) {
      console.error("[welcome] Failed to verify subscription:", e);
    }
  }

  return false;
}

function shouldResumeAfterCheckout(destination: string | null): destination is string {
  return !!destination && (
    destination.startsWith("/pro") ||
    destination.startsWith("/workspace-invite")
  );
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; from?: string }>;
}) {
  const params = await searchParams;
  const returnTo = params.from
    ? sanitizeInternalRedirect(params.from, "/account/welcome")
    : null;
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/account/welcome");

  const activatedByFallback = await activateIfPaid(user);
  if (activatedByFallback && user.role !== "admin" && user.role !== "analyst") {
    user.subscription_status = "active";
    user.role = "premium";
  }

  const feePreview = await getSpotlightMedians();
  const district = user.state_code ? STATE_TO_DISTRICT[user.state_code] : null;
  const districtName = district ? DISTRICT_NAMES[district] : null;
  const isPro = canAccessPremium(user);
  if (params.success === "true" && isPro && shouldResumeAfterCheckout(returnTo)) {
    redirect(returnTo);
  }
  const [pendingWorkspaceInvitations, workspaceMemberships] = await Promise.all([
    !isPro
      ? getPendingWorkspaceInvitationsForEmail(user.email ?? user.username, 5).catch(() => [])
      : Promise.resolve([]),
    isPro
      ? getUserInstitutionMemberships(user.id).catch(() => [])
      : Promise.resolve([]),
  ]);

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <header className="border-b border-[#E8DFD1] bg-[#FAF7F2]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-4 flex items-center h-14">
          <div className="flex items-center gap-2 text-[#1A1815]">
            <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-[#C44B2E]" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="13" width="4" height="8" rx="1" />
              <rect x="10" y="8" width="4" height="13" rx="1" />
              <rect x="16" y="3" width="4" height="18" rx="1" />
            </svg>
            <span className="text-[15px] font-medium tracking-tight" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
              {SITE_NAME}
            </span>
          </div>
        </div>
      </header>

      <div className="px-4 py-10">
        <WelcomeSteps
          userName={user.display_name}
          user={user}
          feePreview={feePreview}
          districtName={districtName}
          districtId={district}
          isPro={isPro}
          pendingWorkspaceInvitations={pendingWorkspaceInvitations}
          workspaceMemberships={workspaceMemberships}
        />
      </div>
    </div>
  );
}
