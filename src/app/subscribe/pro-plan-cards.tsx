import type { ReactNode } from "react";
import { TrackLink } from "@/components/track-link";
import {
  CONSULTANT_PRICE_NOTE,
  annualPerMonthLabel,
  annualSavingsLabel,
  tierAmountLabel,
  type ProTier,
} from "@/lib/pro-tiers";
import { SubscribeButton } from "./subscribe-button";
import { PLAN_TEAM_LABEL, type ProPlan } from "./pricing";

/** Who the plan covers, once the buyer has chosen; the server worked out the tier. */
export interface ProTierSelection {
  tier: ProTier;
  institutionId: number | null;
  otherOrganization: boolean;
  /** The buyer picked the size band because the institution has no asset size on file. */
  tierPicked?: boolean;
}

interface ProPlanCardsProps {
  isLoggedIn: boolean;
  /** The institution picker, or what was picked. */
  chooser: ReactNode;
  /** Null until a bank, credit union or "other organization" is chosen and priced. */
  selection: ProTierSelection | null;
  returnTo?: string;
  /** The Pro page checkout returns to ("Regulatory Wire"), or null for Hamilton. */
  destination: string | null;
  registerHrefFor: (plan: ProPlan) => string;
  /** When set (post-signup hand-off), the matching plan starts checkout on mount. */
  autoStartPlan?: ProPlan | null;
}

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const PRIMARY_BUTTON =
  "block w-full rounded-md bg-[#C44B2E] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#A93D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const SECONDARY_BUTTON =
  "block w-full rounded-md border border-[#D5CBBF] px-4 py-2.5 text-center text-sm font-medium text-[#1A1815] hover:border-[#1A1815] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

/**
 * Starts Pro (James, 9 Oct 2026): the buyer says who the plan covers, then ONE plan card
 * offers annual first, with monthly as the plain alternative, and says before Stripe what
 * the buyer is agreeing to and what happens after paying.
 */
export function ProPlanCards({
  isLoggedIn,
  chooser,
  selection,
  returnTo,
  destination,
  registerHrefFor,
  autoStartPlan = null,
}: ProPlanCardsProps) {
  const ctaFor = (plan: ProPlan, chosen: ProTierSelection, label: string, className: string) => {
    const autoStart = autoStartPlan === plan;
    if (isLoggedIn) {
      return (
        <SubscribeButton
          plan={plan}
          institutionId={chosen.institutionId}
          otherOrganization={chosen.otherOrganization}
          pickedTier={chosen.tierPicked ? chosen.tier : null}
          returnTo={returnTo}
          label={autoStart ? "Continue to checkout" : label}
          className={className}
          autoStart={autoStart}
        />
      );
    }
    return (
      <TrackLink
        event="checkout_start"
        eventProps={{ plan, tier: chosen.tier }}
        href={registerHrefFor(plan)}
        className={className}
      >
        {label}
      </TrackLink>
    );
  };

  return (
    <div className="rounded-xl border border-[#E0D7C9] bg-[#FDFBF8] p-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-4">{chooser}</div>
        {selection ? (
          <PlanCard selection={selection} isLoggedIn={isLoggedIn} destination={destination} ctaFor={ctaFor} />
        ) : (
          <div className="rounded-lg border border-dashed border-[#D5CBBF] p-5 text-sm leading-relaxed text-[#6B6255]">
            Pick your bank or credit union and its price appears here, with annual and monthly
            billing. Every size gets the same full plan, {PLAN_TEAM_LABEL}.
          </div>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  selection,
  isLoggedIn,
  destination,
  ctaFor,
}: {
  selection: ProTierSelection;
  isLoggedIn: boolean;
  destination: string | null;
  ctaFor: (plan: ProPlan, chosen: ProTierSelection, label: string, className: string) => ReactNode;
}) {
  const tier = selection.tier;
  return (
    <div className="rounded-lg border-2 border-[#C44B2E] bg-white p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">Your Fee Insight Pro plan</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-3xl font-bold text-[#1A1815] tabular-nums" style={SERIF}>
          {annualPerMonthLabel(tier)}
        </span>
        <span className="text-sm text-[#5A5347]">a month, billed {tierAmountLabel(tier, "annual")} a year</span>
      </p>
      <p className="mt-1 text-sm font-medium text-[#A93D25]">
        Save {annualSavingsLabel(tier)} compared with monthly billing.
      </p>
      <div className="mt-4">{ctaFor("annual", selection, "Subscribe annually", PRIMARY_BUTTON)}</div>
      <p className="mt-4 text-sm text-[#5A5347]">Prefer monthly? {tierAmountLabel(tier, "monthly")} a month.</p>
      <div className="mt-2">{ctaFor("monthly", selection, "Subscribe monthly", SECONDARY_BUTTON)}</div>

      <h3 className="mt-5 text-sm font-semibold text-[#1A1815]">What you&apos;re agreeing to</h3>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-[#5A5347]">
        <li>One plan {PLAN_TEAM_LABEL}, each with their own login.</li>
        {selection.otherOrganization && <li>{CONSULTANT_PRICE_NOTE}</li>}
        <li>
          Annual renews each year and monthly each month, until you cancel. Cancel from your account; the
          plan runs to the end of the period you paid for. An annual plan cancelled within 14 days of its
          first payment is refunded in full.
        </li>
        <li>
          {isLoggedIn ? "" : "You create your account or sign in first. "}
          You pay on Stripe&apos;s secure checkout, then go straight to {destination ?? "Hamilton, the Pro workspace"}.
        </li>
      </ul>
    </div>
  );
}
