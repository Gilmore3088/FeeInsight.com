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
 * The one plan comparison (James, 2026-10-15: Pro is the goal). One billing toggle, annual
 * first and marked as the recommended plan; right under it the one primary step, the
 * institution search (growth OS review, 15 Oct: one action before a choice); then three
 * compact cards, one per institution size, each priced from PRO_TIERS. Once an institution is
 * chosen the search panel becomes the checkout (two columns on desktop), its card is marked and
 * the others step back.
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
  const monthsFree = sharedMonthsFree();
  // A consultant is priced on the middle tier, which is not their asset size.
  const markLabel = selection?.otherOrganization ? "Consultant price" : "Your price";

  const choose = (next: ProPlan) => {
    if (next === plan) return;
    trackEvent("billing_frequency_selected", { plan: next, ...(selection ? { tier: selection.tier } : {}), entry });
    setPlan(next);
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

      <section
        id={CHECKOUT_ID}
        aria-labelledby="pro-checkout-title"
        className={`mx-auto mt-6 scroll-mt-24 rounded-2xl bg-surface-0 p-5 fi-window-lift sm:p-7 ${
          selection ? "grid gap-6 border border-border md:grid-cols-2 md:gap-10" : "max-w-2xl border-2 border-ink"
        }`}
      >
        <div className="min-w-0">
          <h2 id="pro-checkout-title" className="text-xl font-semibold tracking-tight text-ink" style={DISPLAY}>
            {selection ? "Subscribe to Hamilton Pro" : "Find your price"}
          </h2>
          <div className="mt-4">{chooser}</div>
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
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">{CONSULTANT_PRICE_NOTE}</p>
            )}
          </div>
        )}
      </section>

      <ul id={PLANS_ID} aria-label="Hamilton Pro price by institution size" className="mt-6 grid gap-2 sm:grid-cols-3 sm:gap-4">
        {PRO_TIERS.map((tier) => {
          const mine = selection?.tier === tier.key;
          const stepBack = selection !== null && !mine;
          return (
            <li
              key={tier.key}
              data-tier={tier.key}
              aria-current={mine ? "true" : undefined}
              className={`relative flex flex-col rounded-2xl border bg-surface-0 px-4 py-3 transition-opacity duration-200 sm:p-6 ${
                mine ? "border-ink ring-2 ring-ink fi-window-lift" : "border-border"
              } ${stepBack ? "opacity-60" : ""}`}
            >
              {/* Phone: band and price on one row. From sm up: band, then the price below it. */}
              <div className="flex items-baseline justify-between gap-3 sm:block">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink">{tier.assetsLabel}</p>
                  {mine && (
                    <span className="rounded-full bg-ink px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-ink">
                      {markLabel}
                    </span>
                  )}
                </div>
                <p className="flex shrink-0 items-baseline gap-1 sm:mt-4 sm:gap-1.5">
                  <span
                    className="font-mono text-[1.625rem] font-semibold leading-none tracking-tight text-ink tabular-nums sm:text-[2.5rem]"
                    style={DISPLAY}
                  >
                    {tierAmountLabel(tier.key, plan)}
                  </span>
                  <span className="text-sm text-ink-muted">{annual ? "/ year" : "/ month"}</span>
                </p>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted sm:mt-2">
                {annual
                  ? `${annualPerMonthLabel(tier.key)} a month, billed yearly · save ${annualSavingsLabel(tier.key)}`
                  : `Billed monthly · or ${tierAmountLabel(tier.key, "annual")} a year`}
              </p>
              {mine && selectedName && (
                <p className="mt-3 border-t border-border pt-2 text-[13px] font-medium leading-snug text-ink sm:mt-4 sm:pt-3">
                  {selectedName}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
        The price follows total assets in the latest call report. Every size gets the same workspace.
      </p>
    </div>
  );
}
