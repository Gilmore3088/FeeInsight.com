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
import { CONTACT_EMAIL, REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import { PurchaseCard, type ProTierSelection } from "./pro-plan-cards";
import { ProTierChooser } from "./pro-tier-chooser";
import { WirePreview, type WirePreviewItem, type WirePreviewLead } from "./pro-overview";
import { getArticles, TOPIC_LABELS } from "@/lib/data-store/news";
import { getStateNews, STATE_BILL_STAGE_LABELS } from "@/lib/data-store/state-news";
import { getWireFeeIndexes } from "@/lib/data-store/wire-fee-data";
import { buildFeeDataStrips, categoriesForFeeTypes, categoryLabel } from "@/lib/regulatory/wire-fee-links";
import { feeTypesOf, type FeeType } from "@/lib/regulatory/wire-fee-types";
import { STATE_NAMES } from "@/lib/us-states";
import { formatAmount } from "@/lib/format";
import { getCategoryChargeBases, getNationalIndexCached } from "@/lib/data-store/fee-index";
import { getInstitutionFees } from "@/lib/data-store/institution";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { compareSelectedInstitutionFees } from "@/lib/hamilton/report-evidence";
import { BenchmarkPreview, type BenchmarkRow } from "./benchmark-preview";
import { PricingJump } from "./pricing-jump";
import { StickyCta } from "./sticky-cta";
import localFont from "next/font/local";
import { ShowcasePillars, ShowcaseProvider, ShowcaseStage } from "./showcase";
import { AnalyzeDemo, type AnalyzeScenario } from "./analyze-demo";
import { MonitorPreview, ReportPreview, type MonitorChange } from "./example-panels";
import { getFeeChangeEvents } from "@/lib/data-store/fee-changes";
import { TrackView } from "@/components/track-view";
import { getProPricingInstitution } from "@/lib/data-store/pro-accounts";
import { NON_INSTITUTION_TIER, PRO_TIERS, isProTier, proTier, tierForAssets, tierPriceLabel } from "@/lib/pro-tiers";
import { OtherOptions, PricingFaq } from "./pricing-sections";

import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { isProPlan, type ProPlan } from "./pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Fee Insight Pro pricing and what it includes: $150 to $500 a month by institution size, for up to 5 people. Also the free Bank Fee Index lookup and the Competitive Fee Position Report.",
};

const WELCOME_PATH = "/account/welcome";
/**
 * /subscribe follows the ui-ux-pro-max design system James asked for (9 Oct 2026): Plus Jakarta
 * Sans, in Fee Insight colours (James, 11:08: keep the layout, on-brand colour), glass over warm light.
 */
const jakarta = localFont({
  src: [{ path: "../../../public/fonts/plus-jakarta-sans-variable.ttf", weight: "400 700", style: "normal" }],
  variable: "--font-jakarta",
  display: "swap",
});

const CTA_CLASS =
  "cursor-pointer bg-[#C44B2E] px-5 py-3.5 text-center text-base font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#A93D25]";

/** The skill's checklist, page-wide: pointer cursors, 200ms hover transitions, visible focus. */
const INTERACTION_CLASS =
  "[&_:is(button,summary):not(:disabled)]:cursor-pointer [&_:is(a,button,summary)]:transition-colors [&_:is(a,button,summary)]:duration-200 [&_:is(a,button,summary,input):focus-visible]:outline-2 [&_:is(a,button,summary,input):focus-visible]:outline-offset-2 [&_:is(a,button,summary,input):focus-visible]:outline-[#A93D25]";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

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

/** The fees the benchmark preview shows first, in banker words. */
const BENCHMARK_FEES: { category: string; label: string }[] = [
  { category: "overdraft", label: "Overdraft" },
  { category: "nsf", label: "NSF / returned item" },
  { category: "monthly_maintenance", label: "Monthly maintenance" },
  { category: "stop_payment", label: "Stop payment" },
  { category: "wire_domestic_outgoing", label: "Domestic wire, outgoing" },
];
const BENCHMARK_ROWS = 5;

/**
 * The benchmark preview's rows, all read live: the national index, and for a chosen
 * institution its own published fees compared like for like (compareSelectedInstitutionFees,
 * the same comparison Pro reports use). Empty if the index can't be read.
 */
async function benchmarkRows(institutionId: number | null): Promise<BenchmarkRow[]> {
  const national = await getNationalIndexCached().catch(() => []);
  const usable = new Map(
    national
      .filter((e) => e.median_amount !== null && e.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN)
      .map((e) => [e.fee_category, e]),
  );
  const row = (category: string, label: string): BenchmarkRow | null => {
    const entry = usable.get(category);
    if (!entry || entry.median_amount === null) return null;
    return {
      category,
      label,
      median: Number(entry.median_amount),
      p25: entry.p25_amount === null ? null : Number(entry.p25_amount),
      p75: entry.p75_amount === null ? null : Number(entry.p75_amount),
      institutions: entry.institution_count,
      value: null,
      position: null,
    };
  };
  const base = BENCHMARK_FEES.map((f) => row(f.category, f.label)).filter((r): r is BenchmarkRow => r !== null);
  if (!institutionId || base.length === 0) return base.slice(0, BENCHMARK_ROWS);

  const [fees, bases] = await Promise.all([
    getInstitutionFees(institutionId).catch(() => []),
    getCategoryChargeBases().catch(() => null),
  ]);
  const { deltas } = compareSelectedInstitutionFees({
    selectedFees: fees,
    indexEntries: [...usable.values()],
    chargeBases: bases,
    evidencePolicy: "verified-only",
  });
  const byCategory = new Map(deltas.map((d) => [d.fee_category, d]));
  const withValue = (r: BenchmarkRow): BenchmarkRow => {
    const d = byCategory.get(r.category);
    if (!d) return r;
    const position = d.position === "above_peer_median" ? "above" : d.position === "below_peer_median" ? "below" : "at";
    return { ...r, value: d.institution_amount, position };
  };
  // The institution's own compared fees first (headline fees, then the most common), then the rest.
  const headline = base.map(withValue).filter((r) => r.value !== null);
  const more = deltas
    .filter((d) => !BENCHMARK_FEES.some((f) => f.category === d.fee_category))
    .sort((a, b) => b.institution_count - a.institution_count)
    .map((d) => row(d.fee_category, categoryLabel(d.fee_category)))
    .filter((r): r is BenchmarkRow => r !== null)
    .map(withValue);
  const rest = base.filter((r) => !byCategory.has(r.category));
  return [...headline, ...more, ...rest].slice(0, BENCHMARK_ROWS);
}

/** The Analyze example's question: overdraft a few dollars under the live national median. */
async function analyzeScenario(): Promise<AnalyzeScenario | null> {
  const national = await getNationalIndexCached().catch(() => []);
  const entry = national.find((e) => e.fee_category === "overdraft");
  if (!entry || entry.median_amount === null || entry.institution_count < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
  const median = Number(entry.median_amount);
  if (!(median > 0)) return null;
  const price = median >= 10 ? Math.round(median) - 5 : Math.round(median * 80) / 100;
  return {
    feeLabel: "Overdraft",
    price,
    median,
    p25: entry.p25_amount === null ? null : Number(entry.p25_amount),
    p75: entry.p75_amount === null ? null : Number(entry.p75_amount),
    institutions: entry.institution_count,
  };
}

/** The Monitor example's rows: the newest like-for-like published fee changes. */
async function monitorChanges(): Promise<MonitorChange[]> {
  const events = await getFeeChangeEvents({ limit: 3 }).catch(() => []);
  return events.map((e) => ({
    id: e.id,
    institution: e.institution_name,
    feeLabel: categoryLabel(e.fee_category),
    oldAmount: e.old_amount,
    newAmount: e.new_amount,
    changedAt: e.changed_at,
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
  const [summary, wire, changes, scenario] = await Promise.all([
    getPublicStatsSummary(),
    wirePreviewData(),
    monitorChanges(),
    analyzeScenario(),
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
  // The size band under the name, smaller, so the price stays the card's anchor.
  let chosenDetail: string | null = null;
  let chooserProblem: string | null = null;
  // No asset size on file: the buyer picks the band (James, 8 Oct 2026); "Plans to check" lists it.
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

  const benchmark = await benchmarkRows(pricingInstitution ? pricingInstitution.id : null);

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

  const wirePreview = wire.lead ? <WirePreview lead={wire.lead} /> : null;
  // Sent with every funnel event so conversion can be read by entry point (James, 9 Oct 2026).
  const entryPoint = entry.page ?? "direct";
  const benchmarkInstitution = selection?.institutionId && pricingInstitution ? chosenLabel : null;

  // The hero image steps through one example per capability (James, 9 Oct 2026).
  const showcase =
    benchmark.length > 0 && scenario ? (
      <ShowcaseStage
        panels={[
          <BenchmarkPreview key="benchmark" institution={benchmarkInstitution} rows={benchmark} totalInstitutions={summary.institutions} />,
          <AnalyzeDemo key="analyze" scenario={scenario} />,
          <MonitorPreview
            key="monitor"
            changes={changes}
            wire={wire.lead ? { source: wire.lead.source, title: wire.lead.title, detail: wire.lead.detail } : null}
          />,
          <ReportPreview key="report" />,
        ]}
      />
    ) : null;

  return (
    <ShowcaseProvider autoCycle={benchmarkInstitution === null} entry={entryPoint}>
    <div
      className={`${jakarta.variable} relative isolate min-h-screen overflow-x-clip bg-[#FAF7F2] ${INTERACTION_CLASS}`}
      style={DISPLAY}
    >
      {/* The glass surfaces need colour behind them: two soft light sources, no motion. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px]">
        <div className="absolute -left-40 -top-32 h-[560px] w-[560px] rounded-full bg-[#E3C9A8]/45 blur-3xl" />
        <div className="absolute -right-32 top-24 h-[480px] w-[480px] rounded-full bg-[#C44B2E]/10 blur-3xl" />
        <div className="absolute left-1/3 top-[620px] h-[420px] w-[520px] rounded-full bg-[#E3C9A8]/35 blur-3xl" />
      </div>
      <ConsumerNav />
      <main id="main-content">

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {reasonLine && (
          <p role="status" className="mb-6 rounded-2xl border border-[#E8E1D6] bg-white px-4 py-3 text-sm text-[#1A1815]">
            {reasonLine}
          </p>
        )}
        {inviteMode && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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

        <section id="pro" aria-labelledby="pro-title" className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-x-12 lg:gap-y-10">
          {entry.page && <TrackView event="subscription_gate_viewed" eventProps={{ page: entry.page, entry: entryPoint }} />}
          {/* The headline spans both columns; the example and the card start on one line below it. */}
          <div className="min-w-0 lg:col-span-2 lg:row-start-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">{entry.context}</p>
            <h1
              id="pro-title"
              className="mt-3 text-4xl font-bold leading-[1.08] tracking-tight text-[#1A1815] sm:text-5xl" style={DISPLAY}
            >
              Understand your fees. Know your market.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#3D3833]">
              Benchmark, analyze and monitor bank and credit union fees.
            </p>
            <div className="mt-6 lg:hidden">
              <p className="text-sm text-[#3D3833]">
                <span className="font-semibold text-[#1A1815]">From {tierPriceLabel(PRO_TIERS[0].key, "monthly")}</span> · Up to{" "}
                {WORKSPACE_SEAT_LIMIT} people
              </p>
              <PricingJump
                inputId="pro_tier_institution"
                targetId="pro-heading"
                id="pro-hero-cta"
                className={`mt-3 block rounded-lg ${CTA_CLASS}`}
              >
                Find your institution &amp; see pricing
              </PricingJump>
            </div>
          </div>

          {showcase && <div className="min-w-0 lg:col-start-1 lg:row-start-2">{showcase}</div>}

          {/* Same size as the example beside it (James, 9 Oct 2026): both stretch to the row, each
              with one 44px line under it (the example dots; the sign-in line). */}
          <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-start-2">
            <div className="flex-1">
            <PurchaseCard
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
              returnTo={returnTo ?? undefined}
              destination={entry.page}
              registerHrefFor={registerHrefFor}
              initialPlan={requestedPlan}
              autoStartPlan={selection ? autoStartPlan : null}
              entry={entryPoint}
            />
            </div>
            <div className="mt-1 flex h-11 items-center justify-center text-sm text-[#3D3833]">
              {!isLoggedIn && (
                <p>
                  Already have an account?{" "}
                  <a href={loginHref} className="font-medium text-[#1A1815] underline underline-offset-2">
                    Sign in
                  </a>
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      <section
        aria-labelledby="capabilities-heading"
        className="mt-14 border-y border-white/60 bg-[#F3EEE6]/70 backdrop-blur-md lg:mt-16"
      >
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 id="capabilities-heading" className="text-2xl text-[#1A1815] sm:text-3xl font-semibold tracking-tight" style={DISPLAY}>
            One platform. Four ways to understand your market.
          </h2>
          <div className="mt-8 sm:mt-10">
            <ShowcasePillars interactive={showcase !== null} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-6 sm:px-6 sm:pb-10">

        {wirePreview && (
          <section
            aria-labelledby="wire-heading"
            className="mt-12 grid grid-cols-1 gap-8 sm:mt-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14"
          >
            <div>
              <h2 id="wire-heading" className="mt-2 text-2xl text-[#1A1815] font-semibold tracking-tight" style={DISPLAY}>
                Regulatory Wire, with the fee data
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-[#3D3833]">
                Fee rules and bills, each beside what institutions charge. Included in Pro.
              </p>
            </div>
            {wirePreview}
          </section>
        )}

        <section
          aria-labelledby="cta-heading"
          className="mt-16 rounded-2xl bg-white/70 px-6 py-10 text-center ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl sm:px-10"
        >
          <h2 id="cta-heading" className="text-2xl font-semibold tracking-tight text-[#1A1815] sm:text-3xl">
            See where your fees stand.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[#3D3833]">
            From {tierPriceLabel(PRO_TIERS[0].key, "monthly")} for up to {WORKSPACE_SEAT_LIMIT} people. Same features at every
            institution size.
          </p>
          <PricingJump
            inputId="pro_tier_institution"
            targetId="pro-heading"
            className={`mt-6 inline-flex min-h-12 items-center justify-center rounded-lg ${CTA_CLASS}`}
          >
            Find your institution &amp; see pricing
          </PricingJump>
        </section>

        {gated ? (
          <p className="mt-14 text-[15px] leading-relaxed text-[#3D3833]">
            Need research for one institution instead?{" "}
            <Link href="/for-institutions?report=institution#report" className="font-medium text-[#1A1815] underline underline-offset-2">
              Explore the {REPORT_OFFER.name}
            </Link>
          </p>
        ) : (
          <div className="mt-20">
            <OtherOptions />
          </div>
        )}

        <div className="mt-20">
          <PricingFaq summary={summary} />
        </div>
      </div>
      </main>
      <StickyCta
        heroId="pro-hero-cta"
        cardId="pro-heading"
        label="Find your institution & see pricing"
        className={`block rounded-lg ${CTA_CLASS}`}
      />
      <CustomerFooter />
      <SearchModal />
    </div>
    </ShowcaseProvider>
  );
}
