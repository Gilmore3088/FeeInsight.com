"use client";

import { useState } from "react";
import { TrackLink } from "@/components/track-link";
import { trackEvent } from "@/lib/analytics";
import {
  annualMonthsFree,
  annualPerMonthLabel,
  annualSavingsLabel,
  tierAmountLabel,
  type ProPlan,
  type ProTier,
} from "@/lib/pro-tiers";
import { SubscribeButton } from "./subscribe-button";

/** Who the plan covers, once the buyer has chosen; the server worked out the tier. */
export interface ProTierSelection {
  tier: ProTier;
  institutionId: number | null;
  otherOrganization: boolean;
  /** The buyer picked the size band because the institution has no asset size on file. */
  tierPicked?: boolean;
}

interface PlanCheckoutProps {
  selection: ProTierSelection;
  isLoggedIn: boolean;
  returnTo?: string;
  /** Sign-up links per plan for a signed-out buyer. */
  registerHref: Record<ProPlan, string>;
  /** The plan asked for in the URL; annual otherwise. */
  initialPlan: ProPlan | null;
  /** When set (post-signup hand-off), checkout starts on mount. */
  autoStartPlan: ProPlan | null;
  /** Where the buyer came from ("Regulatory Wire", or "direct"), sent with each funnel event. */
  entry: string;
}

const BUTTON =
  "block w-full rounded-lg bg-[#C44B2E] px-4 py-3.5 text-center text-base font-semibold text-white shadow-sm hover:bg-[#A93D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/**
 * The price for the chosen institution, one billing toggle (annual first), one button. The
 * headline figure is what the card is charged (James, 9 Oct 2026): $1,500 a year, not $125.
 */
export function PlanCheckout({ selection, isLoggedIn, returnTo, registerHref, initialPlan, autoStartPlan, entry }: PlanCheckoutProps) {
  const [plan, setPlan] = useState<ProPlan>(autoStartPlan ?? initialPlan ?? "annual");
  const tier = selection.tier;
  const annual = plan === "annual";
  const buttonLabel = annual
    ? `Subscribe annually · ${tierAmountLabel(tier, "annual")}/year`
    : `Subscribe monthly · ${tierAmountLabel(tier, "monthly")}/month`;

  const choose = (next: ProPlan) => {
    if (next === plan) return;
    trackEvent("billing_frequency_selected", { plan: next, tier, entry });
    setPlan(next);
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Billing" className="grid grid-cols-2 gap-1 rounded-lg bg-[#F1ECE4] p-1 text-sm">
        {(["annual", "monthly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={plan === option}
            onClick={() => choose(option)}
            className={`min-h-10 rounded-md px-3 font-medium transition-colors ${
              plan === option ? "bg-white text-[#1A1815] shadow-sm" : "text-[#5A5347] hover:text-[#1A1815]"
            }`}
          >
            {option === "annual" ? `Annual · ${annualMonthsFree(tier)} months free` : "Monthly"}
          </button>
        ))}
      </div>

      <p className="mt-5 flex items-baseline gap-1.5">
        <span className="text-5xl font-semibold tracking-tight text-[#1A1815] tabular-nums" style={SERIF}>
          {tierAmountLabel(tier, plan)}
        </span>
        <span className="text-base text-[#3D3833]">{annual ? "/ year" : "/ month"}</span>
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[#3D3833]">
        {annual
          ? `Equivalent to ${annualPerMonthLabel(tier)} a month. Save ${annualSavingsLabel(tier)} compared with monthly billing.`
          : `Billed monthly. Annual billing is ${tierAmountLabel(tier, "annual")} a year and saves ${annualSavingsLabel(tier)}.`}
      </p>

      <div className="mt-5">
        {isLoggedIn ? (
          <SubscribeButton
            key={plan}
            plan={plan}
            institutionId={selection.institutionId}
            otherOrganization={selection.otherOrganization}
            pickedTier={selection.tierPicked ? tier : null}
            returnTo={returnTo}
            label={autoStartPlan === plan ? "Continue to checkout" : buttonLabel}
            className={BUTTON}
            autoStart={autoStartPlan === plan}
            tier={tier}
            entry={entry}
          />
        ) : (
          <TrackLink event="checkout_start" eventProps={{ plan, tier, entry }} href={registerHref[plan]} className={BUTTON}>
            {buttonLabel}
          </TrackLink>
        )}
      </div>
    </div>
  );
}
