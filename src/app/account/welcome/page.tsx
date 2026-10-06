export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { activateIfPaid } from "@/lib/billing/activate-if-paid";
import { redirect } from "next/navigation";
import { canAccessPremium } from "@/lib/access";
import { STATE_TO_DISTRICT, DISTRICT_NAMES } from "@/lib/fed-districts";
import { getSpotlightCategories, getDisplayName } from "@/lib/fee-taxonomy";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import { shouldResumeAfterCheckout } from "./resume";
import {
  getPendingWorkspaceInvitationsForEmail,
  getUserInstitutionMemberships,
} from "@/lib/hamilton/institution-membership";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { WelcomeSteps } from "./welcome-steps";
import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/constants";
import { TrackView } from "@/components/track-view";

export const metadata: Metadata = {
  title: "Welcome",
};

/** True national medians for the spotlight fees (this step was labelled "median" but averaged). */
async function getSpotlightMedians(): Promise<{ category: string; displayName: string; median: number }[]> {
  const spotlight = new Set(getSpotlightCategories());
  try {
    const summaries = await getCachedFeeCategorySummaries();
    return summaries
      .filter((s) => spotlight.has(s.fee_category) && s.median_amount !== null && s.median_amount > 0)
      .map((s) => ({
        category: s.fee_category,
        displayName: getDisplayName(s.fee_category),
        median: Number(s.median_amount),
      }))
      .sort((a, b) => b.median - a.median);
  } catch {
    return [];
  }
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
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-[#C44B2E]" stroke="currentColor" strokeWidth="1.5">
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

      <main id="main-content" className="px-4 py-10">
        {params.success === "true" && <TrackView event="checkout_complete" onceKey={`checkout_complete:${user.id}`} />}
        <WelcomeSteps
          userName={user.display_name}
          user={user}
          feePreview={feePreview}
          districtName={districtName}
          districtId={district}
          isPro={isPro}
          activationPending={params.success === "true" && !isPro}
          pendingWorkspaceInvitations={pendingWorkspaceInvitations}
          workspaceMemberships={workspaceMemberships}
        />
      </main>
    </div>
  );
}
