export const dynamic = "force-dynamic";
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
import { SITE_NAME } from "@/lib/constants";
import { HamiltonBenchmarkPreview } from "@/app/for-institutions/hamilton-benchmark-preview";
import { HAMILTON_CANONICAL, PRO_SECTION_TITLE, PRO_SUBHEAD } from "@/app/for-institutions/hamilton-copy";
import { ProPlanCards } from "./pro-plan-cards";
import { AdvisoryCard, FreeTierCard, PricingFaq, ReportCard } from "./pricing-sections";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import {
  ANNUAL_PRICE_LABEL,
  MONTHLY_PRICE_LABEL,
  isProPlan,
  proFeatureList,
  type ProPlan,
} from "./pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Fee Insight pricing: free Bank Fee Index lookup, Fee Insight Pro seats (monthly or annual), and the Competitive Fee Position Report.",
};

const MONTHLY_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || "";
const ANNUAL_PRICE_ID = process.env.STRIPE_ANNUAL_PRICE_ID || "";
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
}

function buildSubscribeReturnPath(options: {
  inviteMode: boolean;
  returnTo: string | null;
  plan: ProPlan | null;
}): string {
  const params = new URLSearchParams();
  if (options.inviteMode) params.set("invite", "workspace");
  if (options.returnTo && options.returnTo !== WELCOME_PATH) params.set("from", options.returnTo);
  if (options.plan) params.set("plan", options.plan);
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

  const registerHrefFor = (plan: ProPlan) => {
    const back = buildSubscribeReturnPath({ inviteMode, returnTo, plan });
    return `/register?plan=${plan}&from=${encodeURIComponent(back)}`;
  };
  const loginHref = `/login?from=${encodeURIComponent(
    buildSubscribeReturnPath({ inviteMode, returnTo, plan: requestedPlan }),
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
              Activate a Pro seat with the invited email and Hamilton will attach the delegated
              institution workspace automatically.
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
            Free lookup and national reports → Institution report (priced on request) → {SITE_NAME} Pro ({MONTHLY_PRICE_LABEL}/mo
            per seat, or {ANNUAL_PRICE_LABEL}/yr) → {SITE_NAME} Advisory (custom)
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
              monthlyPriceId={MONTHLY_PRICE_ID}
              annualPriceId={ANNUAL_PRICE_ID}
              returnTo={returnTo ?? undefined}
              registerHrefFor={registerHrefFor}
              highlightedPlan={requestedPlan}
              autoStartPlan={autoStartPlan}
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
