export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { activateIfPaid } from "@/lib/subscription-activation";
import { redirect } from "next/navigation";
import { ConsumerNav } from "@/components/consumer-nav";
import { CustomerFooter } from "@/components/customer-footer";
import { SearchModal } from "@/components/public/search-modal";
import { getPendingWorkspaceInvitationsForEmail } from "@/lib/hamilton/institution-membership";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { subscribeReasonLine } from "@/lib/subscribe-reason";
import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { HamiltonBenchmarkPreview } from "@/app/for-institutions/hamilton-benchmark-preview";
import { HAMILTON_CANONICAL, PRO_SECTION_TITLE, PRO_SUBHEAD } from "@/app/for-institutions/hamilton-copy";
import { ProPlanCards, type ProTierSelection } from "./pro-plan-cards";
import { ProTierChooser } from "./pro-tier-chooser";
import { getProPricingInstitution } from "@/lib/data-store/pro-accounts";
import { NON_INSTITUTION_TIER, PRO_ANNUAL_RANGE_LABEL, proTier, tierForAssets } from "@/lib/pro-tiers";
import { AdvisoryCard, FreeTierCard, PricingFaq, ReportCard } from "./pricing-sections";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import {
  PLAN_TEAM_LABEL,
  isProPlan,
  proFeatureList,
  type ProPlan,
} from "./pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Fee Insight pricing: free Bank Fee Index lookup, Fee Insight Pro priced by institution size (monthly or annual, for up to 5 people), and the Competitive Fee Position Report.",
};

const WELCOME_PATH = "/account/welcome";

interface SubscribeSearchParams {
  success?: string;
  invite?: string;
  from?: string;
  plan?: string;
  /** "1" right after signup: start checkout for ?plan= without another click. */
  checkout?: string;
  /** Why /pro sent the reader here (src/lib/subscribe-reason.ts). */
  reason?: string;
  /** The bank or credit union the plan covers; its assets set the price tier. */
  inst?: string;
  /** "other": a consultant or other organization (NON_INSTITUTION_TIER). */
  org?: string;
}

function buildSubscribeReturnPath(options: {
  inviteMode: boolean;
  returnTo: string | null;
  plan: ProPlan | null;
  selection: ProTierSelection | null;
}): string {
  const params = new URLSearchParams();
  if (options.inviteMode) params.set("invite", "workspace");
  if (options.returnTo && options.returnTo !== WELCOME_PATH) params.set("from", options.returnTo);
  if (options.plan) params.set("plan", options.plan);
  if (options.selection?.institutionId) params.set("inst", String(options.selection.institutionId));
  else if (options.selection?.otherOrganization) params.set("org", "other");
  const query = params.toString();
  return query ? `/subscribe?${query}` : "/subscribe";
}

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<SubscribeSearchParams>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const [summary, sampleLive] = await Promise.all([getPublicStatsSummary(), sampleReportAvailable()]);
  const features = proFeatureList(summary);
  const returnTo = params.from ? sanitizeInternalRedirect(params.from, WELCOME_PATH) : null;
  const requestedPlan: ProPlan | null = isProPlan(params.plan) ? params.plan : null;
  const checkoutRequested = params.checkout === "1";

  if (user && canAccessPremium(user)) {
    redirect(returnTo && returnTo !== WELCOME_PATH ? returnTo : "/account");
  }
  // Paid but the webhook hasn't landed (e.g. /pro redirected here): activate from Stripe
  // and send them on, rather than offering checkout a second time.
  if (user && (await activateIfPaid(user))) {
    redirect(returnTo && returnTo !== WELCOME_PATH ? returnTo : WELCOME_PATH);
  }

  const isLoggedIn = !!user;
  const reasonLine = subscribeReasonLine(params.reason, SITE_NAME);
  // Only a signed-in, non-premium user with a chosen plan can be handed straight to Stripe.
  const autoStartPlan = isLoggedIn && checkoutRequested ? requestedPlan : null;
  const pendingInvitations =
    user && !canAccessPremium(user)
      ? await getPendingWorkspaceInvitationsForEmail(user.email ?? user.username, 5).catch(() => [])
      : [];
  const inviteMode = params.invite === "workspace" || pendingInvitations.length > 0;

  // Who the plan covers sets the tier; checkout works it out again from the same id.
  const institutionId = Number(params.inst);
  const pricingInstitution =
    Number.isSafeInteger(institutionId) && institutionId > 0
      ? await getProPricingInstitution(institutionId).catch(() => null)
      : null;
  let selection: ProTierSelection | null = null;
  let chosenLabel: string | null = null;
  let chooserProblem: string | null = null;
  if (pricingInstitution) {
    const tier = tierForAssets(pricingInstitution.assetsThousands);
    const place = [pricingInstitution.city, pricingInstitution.stateCode].filter(Boolean).join(", ");
    chosenLabel = [pricingInstitution.name, place].filter(Boolean).join(", ");
    if (tier) {
      selection = { tier, institutionId: pricingInstitution.id, otherOrganization: false };
      chosenLabel = `${chosenLabel} · ${proTier(tier).assetsLabel}`;
    } else {
      chooserProblem = `We don't have its asset size on file yet. Email ${CONTACT_EMAIL} and we'll set up your plan.`;
    }
  } else if (params.org === "other") {
    selection = { tier: NON_INSTITUTION_TIER, institutionId: null, otherOrganization: true };
    chosenLabel = "A consultant or another organization";
  }

  const registerHrefFor = (plan: ProPlan) => {
    const back = buildSubscribeReturnPath({ inviteMode, returnTo, plan, selection });
    return `/register?plan=${plan}&from=${encodeURIComponent(back)}`;
  };
  const loginHref = `/login?from=${encodeURIComponent(
    buildSubscribeReturnPath({ inviteMode, returnTo, plan: requestedPlan, selection }),
  )}`;

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content">

      <div className="mx-auto max-w-5xl px-6 py-14">
        {reasonLine && (
          <p role="status" className="mb-6 rounded-xl border border-[#E8DFD1] bg-white px-4 py-3 text-sm text-[#1A1815]">
            {reasonLine}
          </p>
        )}
        {inviteMode && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Workspace invitation pending</p>
            <p className="mt-1">
              You don&apos;t need to buy a seat to accept it: an institution account includes up to
              five teammates. Sign in with the invited email and{" "}
              <Link href="/workspace-invite" className="font-semibold underline">
                accept the invitation
              </Link>
              .
            </p>
            {pendingInvitations.length > 0 && (
              <div className="mt-3 grid gap-2">
                {pendingInvitations.map((invitation) => (
                  <div key={invitation.id} className="rounded-md border border-amber-200 bg-white/60 px-3 py-2">
                    <span className="font-semibold">{invitation.institutionName}</span>
                    <span className="text-amber-800"> · {invitation.role} access</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mb-10 text-center">
          <h1
            className="mb-3 text-3xl font-normal tracking-tight text-[#1A1815]"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Simple, transparent pricing
          </h1>
          <p className="mx-auto max-w-2xl text-base text-[#5A5347]">
            Free lookup and national reports → Institution report (priced on request) → {SITE_NAME} Pro ({PRO_ANNUAL_RANGE_LABEL} by
            institution size, {PLAN_TEAM_LABEL}) → {SITE_NAME} Advisory (custom)
          </p>
        </div>

        <div className="space-y-8">
          <FreeTierCard summary={summary} />
          <ReportCard sampleLive={sampleLive} />

          <section id="pro" aria-labelledby="pro-heading" className="scroll-mt-20">
            <div className="mb-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
                {SITE_NAME} Pro
              </p>
              <h2
                id="pro-heading"
                className="mt-1 text-xl text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {PRO_SECTION_TITLE}
              </h2>
              <p className="mt-2 text-base leading-relaxed text-[#1A1815]">{HAMILTON_CANONICAL}</p>
              <p className="mt-2 text-sm leading-relaxed text-[#5A5347]">{PRO_SUBHEAD}</p>
            </div>
            <HamiltonBenchmarkPreview className="mb-5" />
            <ProPlanCards
              features={features}
              isLoggedIn={isLoggedIn}
              chooser={<ProTierChooser chosenLabel={chosenLabel} problem={chooserProblem} />}
              selection={selection}
              returnTo={returnTo ?? undefined}
              registerHrefFor={registerHrefFor}
              highlightedPlan={requestedPlan}
              autoStartPlan={selection ? autoStartPlan : null}
            />
          </section>

          <AdvisoryCard />
          <PricingFaq summary={summary} />
        </div>

        {!isLoggedIn && (
          <p className="mt-8 text-center text-xs text-[#6B6255]">
            Already have an account?{" "}
            <a href={loginHref} className="text-[#5A5347] underline underline-offset-2 hover:text-[#1A1815]">
              Sign in
            </a>
          </p>
        )}
      </div>
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
