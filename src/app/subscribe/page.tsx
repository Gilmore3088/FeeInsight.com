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
import { gatedPageLabel, subscribeEntry, subscribeReasonLine } from "@/lib/subscribe-reason";
import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { CONTACT_EMAIL, REPORT_OFFER, SAMPLE_REPORT_LIVE, SITE_NAME } from "@/lib/constants";
import { HamiltonBenchmarkPreview } from "@/app/for-institutions/hamilton-benchmark-preview";
import { PurchaseCard, type ProTierSelection } from "./pro-plan-cards";
import { ProTierChooser } from "./pro-tier-chooser";
import { EverythingInPro, ProBenefits, WirePreview, type WirePreviewItem } from "./pro-overview";
import { getArticles, TOPIC_LABELS } from "@/lib/data-store/news";
import { TrackView } from "@/components/track-view";
import { getProPricingInstitution } from "@/lib/data-store/pro-accounts";
import { NON_INSTITUTION_TIER, PRO_TIERS, isProTier, proTier, tierForAssets, tierPriceLabel } from "@/lib/pro-tiers";
import { AdvisoryLine, FreeTierCard, PricingFaq, ReportCard } from "./pricing-sections";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";

import { PLAN_TEAM_LABEL, REPORT_PRICE_LABEL, isProPlan, type ProPlan } from "./pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Fee Insight Pro pricing and what it includes: $150 to $500 a month by institution size, for up to 5 people. Also the free Bank Fee Index lookup and the Competitive Fee Position Report.",
};

const WELCOME_PATH = "/account/welcome";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

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
  /** The size band the buyer picked when the institution has no asset size on file. */
  band?: string;
  /** "1" when the buyer backed out of Stripe Checkout. */
  canceled?: string;
}

/**
 * The newest federal releases for the Wire preview, fee and rulemaking topics first. The page
 * still renders, with the benchmark preview, if the feed can't be read.
 */
async function latestWireItems(): Promise<WirePreviewItem[]> {
  const articles = await getArticles({ limit: 12 }).catch(() => []);
  const ranked = [...articles.filter((a) => a.topic !== "general"), ...articles.filter((a) => a.topic === "general")];
  return ranked.slice(0, 4).map((article) => ({
    source: article.source,
    title: article.title,
    topic: article.topic && article.topic !== "general" ? (TOPIC_LABELS[article.topic] ?? null) : null,
    date: article.published_at,
  }));
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
  if (options.selection?.tierPicked) params.set("band", options.selection.tier);
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
  const [summary, sampleLive, wireItems] = await Promise.all([
    getPublicStatsSummary(),
    sampleReportAvailable(),
    latestWireItems(),
  ]);
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
  // /pro says "activating" for anyone with a Stripe customer, and that customer is now made
  // when checkout opens. activateIfPaid just asked Stripe and found no live subscription, so
  // "if you've just paid" would only tell someone who backed out of checkout to wait.
  const entry = subscribeEntry(returnTo, SITE_NAME);
  // A Pro page that sent no reason (e.g. the Wire digest) still counts as a gate.
  const reason =
    (params.reason === "activating" && user) || (!params.reason && gatedPageLabel(returnTo))
      ? "pro_required"
      : params.reason;
  // A gated visitor's line is the hero's own ("One step away from ..."), not a banner.
  const gated = reason === "pro_required" && entry.page !== null && params.canceled !== "1";
  const reasonLine =
    params.canceled === "1"
      ? "Checkout was canceled. Nothing was charged."
      : gated
        ? null
        : subscribeReasonLine(reason, SITE_NAME, returnTo);
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
  // No asset size on file: the buyer picks the band (James, 8 Oct 2026); "Plans to check" lists it.
  let needsBand = false;
  if (pricingInstitution) {
    const tier = tierForAssets(pricingInstitution.assetsThousands);
    const place = [pricingInstitution.city, pricingInstitution.stateCode].filter(Boolean).join(", ");
    chosenLabel = [pricingInstitution.name, place].filter(Boolean).join(", ");
    if (tier) {
      selection = { tier, institutionId: pricingInstitution.id, otherOrganization: false };
      chosenLabel = `${chosenLabel} · ${proTier(tier).assetsLabel}`;
    } else if (isProTier(params.band)) {
      selection = { tier: params.band, institutionId: pricingInstitution.id, otherOrganization: false, tierPicked: true };
      chosenLabel = `${chosenLabel} · ${proTier(params.band).assetsLabel} (your pick)`;
      needsBand = true;
    } else {
      chooserProblem = `We don't have its asset size on file yet. Pick its size, or email ${CONTACT_EMAIL}.`;
      needsBand = true;
    }
  } else if (params.org === "other") {
    selection = { tier: NON_INSTITUTION_TIER, institutionId: null, otherOrganization: true };
    chosenLabel = "A consultant or another organization";
  }

  const registerHrefFor = (plan: ProPlan) => {
    const back = buildSubscribeReturnPath({ inviteMode, returnTo, plan, selection });
    return `/register?plan=${plan}&from=${encodeURIComponent(back)}`;
  };
  // A returning subscriber who already picked a plan goes straight on to Stripe after
  // signing in, the same hand-off a new signup gets.
  const loginBack = buildSubscribeReturnPath({ inviteMode, returnTo, plan: requestedPlan, selection });
  const loginHref = `/login?from=${encodeURIComponent(
    requestedPlan && selection ? `${loginBack}&checkout=1` : loginBack,
  )}`;

  // A Wire visitor sees the Wire; everyone else sees the benchmark from the sample report.
  const wirePreview = wireItems.length > 0 ? <WirePreview items={wireItems} /> : null;
  const preview =
    entry.pillar === "wire" || !SAMPLE_REPORT_LIVE ? (wirePreview ?? <HamiltonBenchmarkPreview />) : <HamiltonBenchmarkPreview />;

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <ConsumerNav />
      <main id="main-content">

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
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

        <section id="pro" aria-labelledby="pro-title" className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
          {entry.page && <TrackView event="subscription_gate_viewed" eventProps={{ page: entry.page }} />}
          <div className="lg:col-start-1 lg:row-start-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
              {gated ? `One step away from ${entry.page}` : `${SITE_NAME} Pro`}
            </p>
            <h1
              id="pro-title"
              className="mt-3 text-4xl font-normal leading-[1.08] tracking-tight text-[#1A1815] sm:text-5xl"
              style={SERIF}
            >
              {entry.headline}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#3D3833]">
              Regulatory intelligence and competitive fee research for banks and credit unions, in Hamilton, the{" "}
              {SITE_NAME} Pro workspace.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 lg:hidden">
              <a
                href="#pro-heading"
                className="rounded-lg bg-[#C44B2E] px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#A93D25]"
              >
                Find your institution
              </a>
              <span className="text-sm text-[#3D3833]">From {tierPriceLabel(PRO_TIERS[0].key, "monthly")} {PLAN_TEAM_LABEL}</span>
            </div>
            <div className="mt-8">{preview}</div>
          </div>

          <div className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
            <PurchaseCard
              isLoggedIn={isLoggedIn}
              chooser={
                <ProTierChooser
                  chosenLabel={chosenLabel}
                  problem={chooserProblem}
                  bandChoices={needsBand ? PRO_TIERS.map((t) => ({ key: t.key, label: t.assetsLabel })) : null}
                  pickedBand={selection?.tierPicked ? selection.tier : null}
                />
              }
              selection={selection}
              returnTo={returnTo ?? undefined}
              destination={entry.page}
              registerHrefFor={registerHrefFor}
              initialPlan={requestedPlan}
              autoStartPlan={selection ? autoStartPlan : null}
            />
            {!isLoggedIn && (
              <p className="mt-4 text-center text-sm text-[#3D3833]">
                Already have an account?{" "}
                <a href={loginHref} className="font-medium text-[#1A1815] underline underline-offset-2">
                  Sign in
                </a>
              </p>
            )}
          </div>

          <div className="lg:col-start-1 lg:row-start-2">
            <ProBenefits lead={entry.pillar} />
          </div>
        </section>

        <div className="mt-20 border-t border-[#E8E1D6] pt-14">
          <EverythingInPro />
        </div>

        {gated ? (
          <p className="mt-14 text-[15px] leading-relaxed text-[#3D3833]">
            <span className="font-semibold text-[#1A1815]">Not ready for a subscription?</span> A one-time{" "}
            {REPORT_OFFER.name} for one institution, {REPORT_PRICE_LABEL.toLowerCase()}.{" "}
            <Link href="/for-institutions?report=institution#report" className="font-medium text-[#1A1815] underline underline-offset-2">
              Request a report
            </Link>
          </p>
        ) : (
          <section aria-labelledby="other-options-heading" className="mt-20 space-y-6">
            <h2 id="other-options-heading" className="text-2xl text-[#1A1815]" style={SERIF}>
              Not ready for a subscription?
            </h2>
            <ReportCard sampleLive={sampleLive} />
            <FreeTierCard summary={summary} />
          </section>
        )}

        <div className="mt-20">
          <PricingFaq summary={summary} />
          {!gated && <AdvisoryLine />}
        </div>
      </div>
      </main>
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
