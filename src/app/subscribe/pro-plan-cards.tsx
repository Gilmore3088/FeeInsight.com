"use client";

import { useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import {
  CONSULTANT_PRICE_NOTE,
  NON_INSTITUTION_TIER,
  PRO_TIERS,
  annualMonthsFree,
  annualPerMonthLabel,
  annualSavingsLabel,
  proTier,
  tierAmountLabel,
  type ProPlan,
} from "@/lib/pro-tiers";
import { API_INCLUDED_TIERS, API_MONTHLY_CALLS_LABEL, apiIncludedInTier } from "@/lib/api-subscriber-access";
import { PlanCheckout, type ProTierSelection } from "./plan-checkout";
import { PLAN_INCLUDES } from "./plans-exhibit";
import { OPEN_LOOKUP_EVENT } from "./pricing-jump";

export type { ProTierSelection } from "./plan-checkout";

/** The institution search box the page's pricing buttons land on (pro-tier-chooser.tsx). */
export const CHOOSER_INPUT_ID = "pro_tier_institution";
/** The search and checkout panel, where the sticky phone button and closing card go. */
export const CHECKOUT_ID = "pro-heading";
/** The plan cards; the sticky phone button shows once they scroll away. */
export const PLANS_ID = "pro-plans";

/** Annual is the plan we point to: same features, two months free on every tier. */
export const RECOMMENDED_PLAN: ProPlan = "annual";

interface ProPlanBoardProps {
  isLoggedIn: boolean;
  /** The institution search, or what was picked. */
  chooser: ReactNode;
  /** The lookup starts open (an institution was named in the URL, or needs its size picked). */
  lookupOpen?: boolean;
  /** Null until a bank, credit union or "other organization" is chosen and priced. */
  selection: ProTierSelection | null;
  /** The chosen institution's name, shown on its tier's card. */
  selectedName: string | null;
  returnTo?: string;
  /** The Pro page checkout returns to ("Regulatory Wire"), or null for Hamilton. */
  destination: string | null;
  /** Sign-up links per plan for a signed-out buyer. */
  registerHref: Record<ProPlan, string>;
  /** The plan asked for in the URL; annual otherwise. */
  initialPlan: ProPlan | null;
  /** When set (post-signup hand-off), the matching plan starts checkout on mount. */
  autoStartPlan?: ProPlan | null;
  /** Where the buyer came from ("Regulatory Wire", or "direct"), sent with each funnel event. */
  entry: string;
}

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };

/** On the cards whose plan includes the API (api-subscriber-access.ts, PR #1685). */
export const API_CARD_LINE = "API + Claude connector";
/** Each card's one button: it opens the institution lookup, whose assets set the price. */
export const SELECT_INSTITUTION_LABEL = "Select institution";

/** "$500M": where the first plan with the API starts. */
const API_FROM_LABEL = PRO_TIERS.find((tier) => API_INCLUDED_TIERS.includes(tier.key))?.fromLabel ?? null;

/**
 * The API is a secondary inclusion (James, Oct 16 evening: it read as the main difference between
 * plans). One line says who gets it; the limits, key sharing and reset sit in a closed
 * "API access details" (facts from PR #1685: one key per subscription, made by the account holder).
 */
export const API_INCLUDES_LINE = `Included on ${API_FROM_LABEL ?? proTier(API_INCLUDED_TIERS[0]).assetsLabel}+ plans and for consultants`;
export const API_DETAILS_SUMMARY = "API access details";
export const API_DETAILS = [
  "One API key per subscription. The account holder makes it on their account page and can share it with the team.",
  `${API_MONTHLY_CALLS_LABEL} API calls a month, shared by everyone using the key, including calls through the Claude connector.`,
  "At the limit, API calls pause until the 1st of the next month. Hamilton keeps working.",
] as const;
/** After the consultant price: their plan includes the API too. */
export const CONSULTANT_API_NOTE = "Both include the API key and Claude connector.";
/** How the price is set, under the cards. */
export const PRICE_RULE_LINE = "Your institution's total assets in its latest FDIC or NCUA call report set the price.";
/** Renewal and refund terms, shown before a choice as well as at checkout (James, Oct 16). */
export const PLAN_TERMS_LINE =
  "Annual plans renew yearly and are refunded in full if cancelled within 14 days of the first payment. Monthly plans renew monthly. Cancel renewal anytime from your billing page.";

/**
 * The "N months free" on the toggle. Every tier gives the same months free today
 * (pro-tiers.test.ts); if one ever differs the toggle says only "Recommended" rather than a
 * figure that is wrong for some tier.
 */
function sharedMonthsFree(): number | null {
  const counts = new Set(PRO_TIERS.map((tier) => annualMonthsFree(tier.key)));
  return counts.size === 1 ? annualMonthsFree(PRO_TIERS[0].key) : null;
}

/**
 * The one plan comparison (James, Oct 16 evening: prices first, then the work). One billing
 * toggle, annual first and marked as recommended; then three cards, one per institution size,
 * each priced from PRO_TIERS with a "Select institution" button that opens the lookup below them.
 * Once an institution is chosen the lookup becomes the checkout (two columns on desktop), its card
 * is marked and the others step back.
 */
export function ProPlanBoard({
  isLoggedIn,
  chooser,
  lookupOpen = false,
  selection,
  selectedName,
  returnTo,
  destination,
  registerHref,
  initialPlan,
  autoStartPlan = null,
  entry,
}: ProPlanBoardProps) {
  const [plan, setPlan] = useState<ProPlan>(autoStartPlan ?? initialPlan ?? RECOMMENDED_PLAN);
  const [opened, setOpened] = useState(false);
  const open = opened || lookupOpen || selection !== null;
  const annual = plan === "annual";
  const monthsFree = sharedMonthsFree();
  // A consultant is priced on the middle tier, which is not their asset size.
  const markLabel = selection?.otherOrganization ? "Consultant price" : "Your price";

  // The closing card and sticky phone button open the lookup too (pricing-jump.tsx).
  useEffect(() => {
    const onOpen = () => flushSync(() => setOpened(true));
    window.addEventListener(OPEN_LOOKUP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_LOOKUP_EVENT, onOpen);
  }, []);

  const choose = (next: ProPlan) => {
    if (next === plan) return;
    trackEvent("billing_frequency_selected", { plan: next, ...(selection ? { tier: selection.tier } : {}), entry });
    setPlan(next);
  };

  const selectInstitution = (tier: string) => {
    trackEvent("pricing_lookup_opened", { tier, entry });
    flushSync(() => setOpened(true));
    const input = document.getElementById(CHOOSER_INPUT_ID);
    const target = input ?? document.getElementById(CHECKOUT_ID);
    target?.scrollIntoView({ behavior: "smooth", block: input ? "center" : "start" });
    if (input instanceof HTMLInputElement) input.focus({ preventScroll: true });
  };

  return (
    <div>
      <div className="flex justify-center">
        {/* Two toggle buttons (aria-pressed): each is its own Tab stop and works with Enter and Space. */}
        <div role="group" aria-label="Billing" className="inline-flex max-w-full gap-1 rounded-full bg-surface-200 p-1 text-sm">
          {(["annual", "monthly"] as const).map((option) => {
            const on = plan === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => choose(option)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-full px-4 font-medium sm:px-5 ${
                  on ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option === "annual" ? "Annual" : "Monthly"}
                {option === RECOMMENDED_PLAN && (
                  <span className="whitespace-nowrap rounded-full bg-ink/[0.07] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink">
                    Recommended
                    {monthsFree !== null && <span className="max-sm:hidden"> · {monthsFree} months free</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ul id={PLANS_ID} aria-label="Hamilton Pro price by institution size" className="mt-6 grid gap-3 sm:grid-cols-3 sm:gap-4">
        {PRO_TIERS.map((tier) => {
          const mine = selection?.tier === tier.key;
          const stepBack = selection !== null && !mine;
          return (
            <li
              key={tier.key}
              data-tier={tier.key}
              aria-current={mine ? "true" : undefined}
              className={`relative flex flex-col rounded-2xl border bg-surface-0 p-5 transition-opacity duration-200 sm:p-6 ${
                mine ? "border-ink ring-2 ring-ink fi-window-lift" : "border-border"
              } ${stepBack ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">{tier.assetsLabel}</p>
                {mine && (
                  <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-ink">
                    {markLabel}
                  </span>
                )}
              </div>
              <p className="mt-3 flex items-baseline gap-1.5 sm:mt-4">
                <span
                  className="font-mono text-[2.25rem] font-semibold leading-none tracking-tight text-ink tabular-nums sm:text-[2.5rem]"
                  style={DISPLAY}
                >
                  {tierAmountLabel(tier.key, plan)}
                </span>
                <span className="text-sm text-ink-muted">{annual ? "/ year" : "/ month"}</span>
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                {annual
                  ? `${annualPerMonthLabel(tier.key)} a month, billed yearly · save ${annualSavingsLabel(tier.key)}`
                  : `Billed monthly · or ${tierAmountLabel(tier.key, "annual")} a year`}
              </p>
              {apiIncludedInTier(tier.key) && (
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted" data-api-included="">
                  {`Includes ${API_CARD_LINE}`}
                </p>
              )}
              <div className="mt-auto pt-5">
                {mine && selectedName ? (
                  <p className="border-t border-border pt-3 text-[13px] font-medium leading-snug text-ink">{selectedName}</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => selectInstitution(tier.key)}
                    className={`fi-btn min-h-11 w-full ${selection ? "fi-btn-secondary" : "fi-btn-primary"}`}
                  >
                    {SELECT_INSTITUTION_LABEL}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section
        id={CHECKOUT_ID}
        aria-labelledby="pro-checkout-title"
        hidden={!open}
        className={`mx-auto mt-6 scroll-mt-24 rounded-2xl border border-border bg-surface-0 p-5 fi-window-lift sm:p-7 ${
          selection ? "grid gap-6 md:grid-cols-2 md:items-center md:gap-10" : "max-w-xl"
        }`}
      >
        <div className="min-w-0">
          <h2 id="pro-checkout-title" className="text-lg font-semibold tracking-tight text-ink" style={DISPLAY}>
            {selection ? "Subscribe to Hamilton Pro" : "Find your institution"}
          </h2>
          <div className="mt-3">{chooser}</div>
        </div>
        {selection && (
          <div className="min-w-0 md:border-l md:border-border md:pl-10">
            <PlanCheckout
              selection={selection}
              plan={plan}
              isLoggedIn={isLoggedIn}
              returnTo={returnTo}
              registerHref={registerHref}
              autoStartPlan={autoStartPlan}
              entry={entry}
              destination={destination}
            />
            {selection.otherOrganization && (
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                {CONSULTANT_PRICE_NOTE}
                {apiIncludedInTier(NON_INSTITUTION_TIER) && ` ${CONSULTANT_API_NOTE}`}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="mx-auto mt-4 max-w-3xl space-y-1 text-center text-xs leading-relaxed text-ink-muted">
        <p data-price-rule="">{PRICE_RULE_LINE}</p>
        <p data-plan-terms="">{PLAN_TERMS_LINE}</p>
      </div>
    </div>
  );
}

/**
 * What every plan includes, in one compact block under the cards (James, Oct 16 evening), with
 * the API as a secondary line and its limits in a closed "API access details".
 */
export function PlanBenefits() {
  return (
    <section aria-labelledby="plan-benefits-heading" className="mx-auto mt-10 max-w-5xl border-t border-border pt-8">
      <h2 id="plan-benefits-heading" className="text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Every plan includes
      </h2>
      <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_INCLUDES.map(({ label, line }) => (
          <li key={label} className="flex min-w-0 gap-2.5 text-[14px] leading-snug">
            <Check aria-hidden size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-ink" />
            <span className="min-w-0">
              <span className="font-semibold text-ink">{label}</span>
              <span className="text-ink-muted"> · {line}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-border pt-4 text-[14px]" data-api-includes="">
        <p className="text-ink">
          <span className="font-semibold">{API_CARD_LINE}</span>
          <span className="text-ink-muted"> · {API_INCLUDES_LINE}</span>
        </p>
        <details className="group mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-ink underline underline-offset-2 marker:content-none">
            {API_DETAILS_SUMMARY}
            <ChevronDown aria-hidden size={14} className="group-open:rotate-180" />
          </summary>
          <ul className="mt-1 max-w-2xl list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-muted" data-api-details="">
            {API_DETAILS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
