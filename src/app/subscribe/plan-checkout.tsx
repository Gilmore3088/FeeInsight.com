"use client";

import Link from "next/link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { TrackLink } from "@/components/track-link";
import { annualPerMonthLabel, tierAmountLabel, type ProPlan, type ProTier } from "@/lib/pro-tiers";
import { SubscribeButton } from "./subscribe-button";

/** Who the plan covers, once the buyer has chosen; the server worked out the tier. */
export interface ProTierSelection {
  tier: ProTier;
  institutionId: number | null;
  otherOrganization: boolean;
  /** The buyer picked the size band because the institution has no asset size on file. */
  tierPicked?: boolean;
}

export interface PlanCheckoutProps {
  selection: ProTierSelection;
  /** The one plan on sale: annual. */
  plan: ProPlan;
  isLoggedIn: boolean;
  returnTo?: string;
  /** Sign-up links per plan for a signed-out buyer. */
  registerHref: Record<ProPlan, string>;
  /** When set (post-signup hand-off), checkout starts on mount. */
  autoStartPlan: ProPlan | null;
  /** Where the buyer came from ("Regulatory Wire", or "direct"), sent with each funnel event. */
  entry: string;
  /** The Pro page checkout returns to ("Regulatory Wire"), or null for Hamilton. */
  destination: string | null;
}

const BUTTON =
  "block w-full rounded-lg cursor-pointer bg-ink px-4 py-3.5 text-center text-base font-semibold text-on-ink shadow-sm hover:opacity-90 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
const DISPLAY = { fontFamily: "var(--fi-font-sans)" };

/** "Subscribe annually · $1,500/year" */
export function subscribeLabel(tier: ProTier): string {
  return `Subscribe annually · ${tierAmountLabel(tier)}/year`;
}

/**
 * The chosen institution's one price and one button. Pro is sold annually only (James, 26 Oct
 * 2026). The headline figure is what the card is charged (James, 9 Oct 2026): $1,500 a year, not $125.
 */
export function PlanCheckout({ selection, plan, isLoggedIn, returnTo, registerHref, autoStartPlan, entry, destination }: PlanCheckoutProps) {
  const tier = selection.tier;
  const buttonLabel = subscribeLabel(tier);

  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight text-ink tabular-nums" style={DISPLAY}>
          {tierAmountLabel(tier)}
        </span>
        <span className="text-base text-ink">/ year</span>
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink">{`${annualPerMonthLabel(tier)} a month, billed yearly`}</p>

      <div className="mt-4">
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

      <p className="mt-3 text-center text-sm text-ink">
        {WORKSPACE_SEAT_LIMIT} team members · Secure Stripe checkout
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
        Renews yearly. Cancel renewal anytime. First year refundable within 14 days.{" "}
        {destination ? `Then straight back to ${destination}. ` : ""}
        <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
          Terms
        </Link>
      </p>
    </div>
  );
}
