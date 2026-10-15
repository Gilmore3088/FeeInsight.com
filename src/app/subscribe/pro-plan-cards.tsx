"use client";

import { useState, type ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";
import {
  CONSULTANT_PRICE_NOTE,
  PRO_TIERS,
  annualMonthsFree,
  annualPerMonthLabel,
  annualSavingsLabel,
  tierAmountLabel,
  type ProPlan,
} from "@/lib/pro-tiers";
import { PlanCheckout, type ProTierSelection } from "./plan-checkout";
import { PricingJump } from "./pricing-jump";

export type { ProTierSelection } from "./plan-checkout";

/** The institution search box the cards' buttons land on (pro-tier-chooser.tsx). */
export const CHOOSER_INPUT_ID = "pro_tier_institution";
/** The checkout panel, where the sticky phone button and the cards' buttons go. */
export const CHECKOUT_ID = "pro-heading";
/** The plan cards; the sticky phone button shows once they scroll away. */
export const PLANS_ID = "pro-plans";

/** Annual is the plan we point to: same features, two months free on every tier. */
export const RECOMMENDED_PLAN: ProPlan = "annual";

interface ProPlanBoardProps {
  isLoggedIn: boolean;
  /** The institution search, or what was picked. */
  chooser: ReactNode;
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
const FIND_BUTTON =
  "mt-5 flex min-h-11 w-full items-center justify-center rounded-lg border border-ink px-4 text-sm font-semibold text-ink hover:bg-ink hover:text-on-ink";

/**
 * The one plan comparison (James, 2026-10-15: Pro is the goal). One billing toggle, annual
 * first and marked as the recommended plan; three cards, one per institution size, each priced
 * from PRO_TIERS; then the one checkout panel: find the institution, see its price, subscribe.
 * Once an institution is chosen its card is marked and the others step back.
 */
export function ProPlanBoard({
  isLoggedIn,
  chooser,
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
  const annual = plan === "annual";
  const monthsFree = annualMonthsFree(PRO_TIERS[0].key);

  const choose = (next: ProPlan) => {
    if (next === plan) return;
    trackEvent("billing_frequency_selected", { plan: next, ...(selection ? { tier: selection.tier } : {}), entry });
    setPlan(next);
  };

  return (
    <div>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Billing" className="relative inline-grid grid-cols-2 gap-1 rounded-full bg-surface-200 p-1 text-sm">
          {(["annual", "monthly"] as const).map((option) => {
            const on = plan === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => choose(option)}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-full px-4 font-medium sm:px-5 ${
                  on ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option === "annual" ? "Annual" : "Monthly"}
                {option === RECOMMENDED_PLAN && (
                  <span className="whitespace-nowrap rounded-full bg-brick/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-brick">
                    Recommended · {monthsFree} months free
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
                    Your price
                  </span>
                )}
              </div>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="font-mono text-[2.5rem] font-semibold leading-none tracking-tight text-ink tabular-nums" style={DISPLAY}>
                  {tierAmountLabel(tier.key, plan)}
                </span>
                <span className="text-sm text-ink-muted">{annual ? "/ year" : "/ month"}</span>
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                {annual
                  ? `${annualPerMonthLabel(tier.key)} a month, billed yearly · save ${annualSavingsLabel(tier.key)}`
                  : `Billed monthly · or ${tierAmountLabel(tier.key, "annual")} a year`}
              </p>
              {mine && selectedName ? (
                <p className="mt-4 border-t border-border pt-3 text-[13px] font-medium leading-snug text-ink">{selectedName}</p>
              ) : selection === null ? (
                <PricingJump inputId={CHOOSER_INPUT_ID} targetId={CHECKOUT_ID} className={`mt-auto ${FIND_BUTTON}`}>
                  Find your institution
                </PricingJump>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
        The price follows total assets in the latest call report. Every size gets the same workspace.
      </p>

      <section
        id={CHECKOUT_ID}
        aria-labelledby="pro-checkout-title"
        className="mt-8 scroll-mt-24 grid gap-6 rounded-2xl border border-border bg-surface-0 p-5 fi-window-lift sm:p-7 md:grid-cols-2 md:gap-10"
      >
        <div className="min-w-0">
          <h2 id="pro-checkout-title" className="text-xl font-semibold tracking-tight text-ink" style={DISPLAY}>
            Subscribe to Hamilton Pro
          </h2>
          <div className="mt-4">{chooser}</div>
        </div>
        <div className="min-w-0 md:border-l md:border-border md:pl-10">
          {selection ? (
            <>
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
                <p className="mt-3 text-xs leading-relaxed text-ink-muted">{CONSULTANT_PRICE_NOTE}</p>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col justify-center rounded-xl bg-surface-200/60 p-5 text-sm leading-relaxed text-ink">
              <p className="font-semibold">Your price and checkout show here.</p>
              <p className="mt-1 text-ink-muted">Pick your bank or credit union and we match it to its size.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
