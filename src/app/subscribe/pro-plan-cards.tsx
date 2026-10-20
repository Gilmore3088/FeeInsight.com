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
  proTier,
  tierAmountLabel,
  type ProPlan,
} from "@/lib/pro-tiers";
import { API_INCLUDED_TIERS, API_MONTHLY_CALLS_LABEL, apiIncludedInTier } from "@/lib/api-subscriber-access";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PlanCheckout, type ProTierSelection } from "./plan-checkout";
import { PLAN_INCLUDES } from "./plans-exhibit";
import { OPEN_LOOKUP_EVENT } from "./pricing-jump";

export type { ProTierSelection } from "./plan-checkout";

import { CHECKOUT_ID, CHOOSER_INPUT_ID, PLANS_ID } from "./plan-ids";

export { CHECKOUT_ID, CHOOSER_INPUT_ID, PLANS_ID } from "./plan-ids";

/** "two months free", the one phrasing every page uses for annual billing (site audit #1952). */
const MONTH_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
export function monthsFreeWords(months: number): string {
  return `${MONTH_WORDS[months] ?? months} ${months === 1 ? "month" : "months"} free`;
}

/** Annual is the plan we point to: same features, two months free on every tier. */
export const RECOMMENDED_PLAN: ProPlan = "annual";

interface ProPlanBoardProps {
  isLoggedIn: boolean;
  /** The institution search, or what was picked. */
  chooser: ReactNode;
  /** Where "Consultant pricing" goes: this page priced for a consultant (?org=other). */
  consultantHref?: string | null;
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
 * "API access details" (facts from #1685 and #1702: every seat makes its own key, and the plan's keys share one monthly allowance).
 */
export const API_INCLUDES_LINE = `Included on ${API_FROM_LABEL ?? proTier(API_INCLUDED_TIERS[0]).assetsLabel}+ plans and for consultants`;
export const API_DETAILS_SUMMARY = "API access details";
export const API_DETAILS = [
  `Everyone on the plan, up to ${WORKSPACE_SEAT_LIMIT} people, makes their own key on their account page.`,
  `The team shares ${API_MONTHLY_CALLS_LABEL} API calls a month, including calls through the Claude connector.`,
  "At the limit, API calls pause until the 1st of the next month, with no overage charge. Hamilton keeps working.",
] as const;
/** After the consultant price: their plan includes the API too. */
export const CONSULTANT_API_NOTE = "Both include API keys and the Claude connector.";
/**
 * Above the cards (James, Oct 17): the three cards are one product at three prices, not three
 * packages, with API access the one stated difference.
 */
export const ONE_SUBSCRIPTION_LINE = "One subscription, priced by institution size.";
export const SAME_WORKSPACE_LINE = `Every plan gets the same Hamilton workspace. The only difference is API access, included from ${API_FROM_LABEL ?? proTier(API_INCLUDED_TIERS[0]).assetsLabel} in assets. Size is total assets in the latest FDIC or NCUA call report.`;
/** Billing terms under the cards, two short lines, shown before a choice as well as at checkout. */
export const BILLING_TERMS_LINE = "Annual plans are billed yearly and refunded in full if cancelled within 14 days of the first payment.";
export const CANCEL_TERMS_LINE = "Monthly plans renew monthly. Cancel renewal anytime from your billing page.";
export const CONSULTANT_PRICING_LABEL = "Consultant pricing";

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
  consultantHref = null,
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

      <div className="mx-auto mt-6 max-w-2xl text-center" data-one-subscription="">
        <p className="text-[15px] font-semibold text-ink">{ONE_SUBSCRIPTION_LINE}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{SAME_WORKSPACE_LINE}</p>
      </div>

      <ul id={PLANS_ID} aria-label="Hamilton price by institution size" className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-4">
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
                  ? `${annualPerMonthLabel(tier.key)} a month, billed yearly: ${monthsFreeWords(annualMonthsFree(tier.key))}`
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
            {selection ? "Subscribe to Hamilton" : "Find your institution"}
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

      <div className="mt-4 flex flex-col gap-3 text-[13px] leading-relaxed text-ink-muted sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 sm:flex-1" data-plan-terms="">
          {/* Wide on purpose (James, Oct 17): the site's paragraph measure made a narrow block under wide cards. */}
          <p className="max-w-none">{BILLING_TERMS_LINE}</p>
          <p className="max-w-none">{CANCEL_TERMS_LINE}</p>
        </div>
        {consultantHref && (
          <a href={consultantHref} className="inline-flex min-h-11 shrink-0 items-center font-medium text-ink underline underline-offset-2 sm:min-h-0">
            {CONSULTANT_PRICING_LABEL}
          </a>
        )}
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
