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
import { gatedPageLabel, hamiltonFullName, subscribeEntry, subscribeReasonLine } from "@/lib/subscribe-reason";
import type { Metadata } from "next";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { CONTACT_EMAIL, PRODUCT_NAME, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { CHECKOUT_ID, PLANS_ID, ProPlanBoard, type ProTierSelection } from "./pro-plan-cards";
import { ProTierChooser } from "./pro-tier-chooser";
import type { WirePreviewItem, WirePreviewLead } from "./pro-overview";
import { getArticles, TOPIC_LABELS } from "@/lib/data-store/news";
import { getStateNews, STATE_BILL_STAGE_LABELS } from "@/lib/data-store/state-news";
import { getWireFeeIndexes } from "@/lib/data-store/wire-fee-data";
import { buildFeeDataStrips, categoriesForFeeTypes } from "@/lib/regulatory/wire-fee-links";
import { feeTypesOf, type FeeType } from "@/lib/regulatory/wire-fee-types";
import { STATE_NAMES } from "@/lib/us-states";
import { formatAmount } from "@/lib/format";
import { PricingJump } from "./pricing-jump";
import { StickyCta } from "./sticky-cta";
import { TrackView } from "@/components/track-view";
import { getProPricingInstitution } from "@/lib/data-store/pro-accounts";
import { NON_INSTITUTION_TIER, PRO_TIERS, isProTier, proTier, tierAmountLabel, tierForAssets, tierPriceLabel } from "@/lib/pro-tiers";
import { GatedOptions, OtherOptions, PricingFaq } from "./pricing-sections";
import { chosenPriceLine, pricingCtaLabel, type ChosenInstitutionPrice } from "./plan-cta";
import { loadPlansExhibitData } from "./exhibit-data";
import { PlanIncludes, PlansExhibit } from "./plans-exhibit";

import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { isProPlan, type ProPlan } from "./pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    `Pricing for ${hamiltonFullName(SITE_NAME)}: ${tierAmountLabel(PRO_TIERS[0].key, "monthly")} to ` +
    `${tierAmountLabel(PRO_TIERS[PRO_TIERS.length - 1].key, "monthly")} a month by institution size, for up to ` +
    `${WORKSPACE_SEAT_LIMIT} people. Also the free ${PRODUCT_NAME} lookup and the ${REPORT_OFFER.name}.`,
};

const WELCOME_PATH = "/account/welcome";
/** The one report request form, on /reports (site v3 brief 05 §3-4). */
const REPORT_FORM_HREF = "/reports?report=institution&src=subscribe#request";

/** Primary buttons are navy (site v3 brief 04); brick stays for the data. */
const CTA_CLASS =
  "cursor-pointer bg-ink px-5 py-3.5 text-center text-base font-semibold text-on-ink shadow-sm transition-opacity duration-200 hover:opacity-90";

/** The skill's checklist, page-wide: pointer cursors, 200ms hover transitions, visible focus. */
const INTERACTION_CLASS =
  "[&_:is(button,summary):not(:disabled)]:cursor-pointer [&_:is(a,button,summary)]:transition-colors [&_:is(a,button,summary)]:duration-200 [&_:is(a,button,summary,input):focus-visible]:outline-2 [&_:is(a,button,summary,input):focus-visible]:outline-offset-2 [&_:is(a,button,summary,input):focus-visible]:outline-brick";

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };

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

const FEE_TYPE_NOUNS: Record<FeeType, string> = {
  overdraft: "overdraft fees",
  atm: "ATM fees",
  maintenance: "account maintenance fees",
  wire: "wire transfer fees",
  card: "card fees",
  other: "bank fees",
};

/** "Illinois bill on overdraft fees": says only which fee the bill's own title names. */
function billHeading(state: string, title: string): string {
  const type = feeTypesOf(title)[0];
  return type ? `${state} bill on ${FEE_TYPE_NOUNS[type]}` : title;
}

interface WirePreviewData {
  lead: WirePreviewLead | null;
}

/**
 * The Wire preview's one item, read from the Wire's own tables: the newest state fee bill
 * with figures in the fee data (the Wire's "In the fee data" strip), else the newest federal
 * release, fee and rulemaking topics first. A read
 * that fails leaves its part out, and the page falls back to the benchmark preview.
 */
async function wirePreviewData(): Promise<WirePreviewData> {
  const [articles, bills] = await Promise.all([
    getArticles({ limit: 12 }).catch(() => []),
    getStateNews({ limit: 8 })
      .then((news) => news.bills)
      .catch(() => []),
  ]);
  const ranked = [...articles.filter((a) => a.topic !== "general"), ...articles.filter((a) => a.topic === "general")];
  const releases: WirePreviewItem[] = ranked.map((article) => ({
    source: article.source,
    title: article.title,
    detail: article.topic && article.topic !== "general" ? (TOPIC_LABELS[article.topic] ?? null) : null,
    date: article.published_at,
    url: article.link || null,
  }));

  const bill = bills.find((b) => categoriesForFeeTypes(feeTypesOf(b.title)).length > 0) ?? null;
  if (bill) {
    const key = `${bill.state_code}:${bill.identifier ?? bill.title}`;
    const indexes = await getWireFeeIndexes({ states: [bill.state_code], national: false }).catch(() => null);
    const strip = indexes
      ? buildFeeDataStrips([{ key, title: bill.title, stateCode: bill.state_code }], indexes).get(key) ?? null
      : null;
    if (strip) {
      const state = STATE_NAMES[bill.state_code] ?? bill.state_code;
      const stage = bill.stage ? (STATE_BILL_STAGE_LABELS[bill.stage] ?? null) : null;
      return {
        lead: {
          source: bill.identifier ? `${state} · ${bill.identifier}` : `${state} bill`,
          // A plain heading from the fee the official title names; the title itself stays shown.
          title: billHeading(state, bill.title),
          officialTitle: bill.title,
          detail: stage,
          date: bill.stage_on,
          url: bill.url,
          place: strip.place,
          figures: strip.figures.map((figure) => ({
            label: figure.label,
            text:
              figure.status === "median" && figure.median !== null
                ? `${formatAmount(figure.median)} median · ${figure.institutions.toLocaleString("en-US")} institutions`
                : figure.text,
          })),
        },
      };
    }
  }
  if (releases.length === 0) return { lead: null };
  return { lead: { ...releases[0], officialTitle: null, place: null, figures: [] } };
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

  const [summary, wire, exhibit] = await Promise.all([
    getPublicStatsSummary(),
    wirePreviewData(),
    loadPlansExhibitData().catch((error: unknown) => {
      console.error("[subscribe] exhibit reads failed; Hamilton window hidden", error);
      return null;
    }),
  ]);

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
  // A gated visitor's line is the hero's own eyebrow ("Regulatory Wire is included ..."), not a banner.
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
  // The size band under the name, smaller, so the price stays the anchor.
  let chosenDetail: string | null = null;
  let chooserProblem: string | null = null;
  // No asset size on file: the buyer picks the band (James, 8 Oct 2026).
  let needsBand = false;
  if (pricingInstitution) {
    const tier = tierForAssets(pricingInstitution.assetsThousands);
    const place = [pricingInstitution.city, pricingInstitution.stateCode].filter(Boolean).join(", ");
    chosenLabel = [pricingInstitution.name, place].filter(Boolean).join(", ");
    if (tier) {
      selection = { tier, institutionId: pricingInstitution.id, otherOrganization: false };
      chosenDetail = proTier(tier).assetsLabel;
    } else if (isProTier(params.band)) {
      selection = { tier: params.band, institutionId: pricingInstitution.id, otherOrganization: false, tierPicked: true };
      chosenDetail = `${proTier(params.band).assetsLabel} (your pick)`;
      needsBand = true;
    } else {
      chooserProblem = `We don't have its asset size on file yet. Pick its size, or email ${CONTACT_EMAIL}.`;
      needsBand = true;
    }
  } else if (params.org === "other") {
    selection = { tier: NON_INSTITUTION_TIER, institutionId: null, otherOrganization: true };
    chosenLabel = "A consultant or another organization";
  }

  // The institution the page has priced, named in the closing card and sticky button (review N2).
  const chosenPrice: ChosenInstitutionPrice | null =
    selection?.institutionId && pricingInstitution ? { name: pricingInstitution.name, tier: selection.tier } : null;
  const ctaLabel = pricingCtaLabel(chosenPrice);

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

  // Sent with every funnel event so conversion can be read by entry point (James, 9 Oct 2026).
  const entryPoint = entry.page ?? "direct";

  return (
    <div className={`min-h-screen overflow-x-clip bg-paper ${INTERACTION_CLASS}`} style={DISPLAY}>
      <ConsumerNav />
      <main id="main-content">
        <section id="pro" aria-labelledby="pro-title" className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6 sm:pt-10">
          {entry.page && <TrackView event="subscription_gate_viewed" eventProps={{ page: entry.page, entry: entryPoint }} />}
          {reasonLine && (
            <p role="status" className="mx-auto mb-6 max-w-3xl rounded-2xl border border-border bg-surface-0 px-4 py-3 text-sm text-ink">
              {reasonLine}
            </p>
          )}
          {inviteMode && (
            <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Workspace invitation pending</p>
              <p className="mt-1">
                No seat to buy. Sign in with the invited email and{" "}
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

          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">{entry.page ? entry.context : "Pricing"}</p>
            <h1
              id="pro-title"
              className="mt-3 text-[2.25rem] font-semibold leading-[1.04] tracking-[-0.04em] text-ink sm:text-[3rem]"
              style={DISPLAY}
            >
              Hamilton Pro, priced by your institution&apos;s size
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-soft sm:text-[18px]">
              Your fees against your market, with a source for every figure. One plan covers up to{" "}
              {WORKSPACE_SEAT_LIMIT} people.
            </p>
          </div>

          <div className="mt-8">
            <ProPlanBoard
              isLoggedIn={isLoggedIn}
              chooser={
                <ProTierChooser
                  chosenLabel={chosenLabel}
                  chosenDetail={chosenDetail}
                  problem={chooserProblem}
                  bandChoices={needsBand ? PRO_TIERS.map((t) => ({ key: t.key, label: t.assetsLabel })) : null}
                  pickedBand={selection?.tierPicked ? selection.tier : null}
                  entry={entryPoint}
                />
              }
              selection={selection}
              selectedName={selection?.institutionId ? chosenLabel : null}
              returnTo={returnTo ?? undefined}
              destination={entry.page}
              registerHref={{ annual: registerHrefFor("annual"), monthly: registerHrefFor("monthly") }}
              initialPlan={requestedPlan}
              autoStartPlan={selection ? autoStartPlan : null}
              entry={entryPoint}
            />
            {!isLoggedIn && (
              <p className="mt-4 text-center text-sm text-ink">
                Already have an account?{" "}
                <a href={loginHref} className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2">
                  Sign in
                </a>
              </p>
            )}
          </div>

          <PlanIncludes />
        </section>

        {exhibit && <PlansExhibit data={exhibit} wire={wire.lead} />}

        <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          {gated ? (
            <div className="mt-4">
              <GatedOptions reportHref={REPORT_FORM_HREF} />
            </div>
          ) : (
            <div className="mt-4">
              <OtherOptions />
            </div>
          )}

          <div className="mt-16">
            <PricingFaq summary={summary} />
          </div>

          <section
            aria-labelledby="cta-heading"
            className="mt-16 rounded-2xl border border-border bg-surface-0 px-6 py-10 text-center fi-window-lift sm:px-10"
          >
            <h2 id="cta-heading" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              See where your fees stand
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink">
              {chosenPrice ? chosenPriceLine(chosenPrice) : `From ${tierPriceLabel(PRO_TIERS[0].key, "monthly")}`} for up
              to {WORKSPACE_SEAT_LIMIT} people.
            </p>
            <PricingJump
              inputId="pro_tier_institution"
              targetId={CHECKOUT_ID}
              className={`mt-6 inline-flex min-h-12 items-center justify-center rounded-lg ${CTA_CLASS}`}
            >
              {ctaLabel}
            </PricingJump>
          </section>
        </div>
      </main>
      <StickyCta heroId={PLANS_ID} cardId={CHECKOUT_ID} label={ctaLabel} className={`block rounded-lg ${CTA_CLASS}`} />
      <CustomerFooter />
      <SearchModal />
    </div>
  );
}
