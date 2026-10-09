import type { ReactNode } from "react";
import { TrackLink } from "@/components/track-link";
import {
  CONSULTANT_PRICE_NOTE,
  PRO_TIERS,
  annualMonthsFree,
  tierAmountLabel,
  tierPriceLabel,
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
  features: string[];
  isLoggedIn: boolean;
  /** The institution picker, or what was picked. */
  chooser: ReactNode;
  /** Null until a bank, credit union or "other organization" is chosen and priced. */
  selection: ProTierSelection | null;
  returnTo?: string;
  registerHrefFor: (plan: ProPlan) => string;
  highlightedPlan: ProPlan | null;
  /** When set (post-signup hand-off), the matching plan starts checkout on mount. */
  autoStartPlan?: ProPlan | null;
}

const CHECK = "✓";
const PRIMARY_BUTTON =
  "block w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#A93D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const SECONDARY_BUTTON =
  "block w-full rounded-md border border-[#D5CBBF] px-4 py-2.5 text-center text-sm font-medium text-[#1A1815] hover:border-[#1A1815] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

/**
 * Pro priced by institution size: the three tiers sit under ONE feature list (the tiers
 * differ by price, not features). Once the buyer picks who the plan covers, the two price
 * columns show that tier's monthly and annual price.
 */
export function ProPlanCards({
  features,
  isLoggedIn,
  chooser,
  selection,
  returnTo,
  registerHrefFor,
  highlightedPlan,
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
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            Included for everyone on the plan
          </p>
          <ul className="mt-3 space-y-2 text-sm text-[#5A5347]">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 text-[#A93D25]">{CHECK}</span>
                {feature}
              </li>
            ))}
          </ul>
          <TierTable highlighted={selection?.tier ?? null} />
        </div>

        <div className="grid content-start gap-4">
          {chooser}
          {selection ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <PriceColumn
                plan="monthly"
                eyebrow="Monthly"
                priceLabel={tierAmountLabel(selection.tier, "monthly")}
                priceSuffix={`/mo ${PLAN_TEAM_LABEL}`}
                note="Renews monthly until you cancel; cancel at the end of any billing period"
                highlighted={highlightedPlan === "monthly"}
                cta={ctaFor("monthly", selection, "Start monthly", SECONDARY_BUTTON)}
              />
              <PriceColumn
                plan="annual"
                eyebrow="Annual"
                priceLabel={tierAmountLabel(selection.tier, "annual")}
                priceSuffix={`/yr ${PLAN_TEAM_LABEL}`}
                note={`${annualMonthsFree(selection.tier)} months free against paying monthly; renews yearly until you cancel`}
                badge="Best value"
                highlighted={highlightedPlan === "annual"}
                cta={ctaFor("annual", selection, "Start annual", PRIMARY_BUTTON)}
              />
            </div>
          ) : (
            <p className="text-sm text-[#6B6255]">
              Pick who the plan is for to see your price and start. Plans renew monthly or yearly
              until you cancel, and you can cancel at the end of any billing period.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** All three tiers, so the price is on the page before anyone picks an institution. */
function TierTable({ highlighted }: { highlighted: ProTier | null }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-[#E0D7C9] bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Pro price by institution size</caption>
        <thead className="text-[11px] uppercase tracking-[0.12em] text-[#6B6255]">
          <tr>
            <th scope="col" className="px-3 py-2 font-bold">Institution size</th>
            <th scope="col" className="px-3 py-2 font-bold">Monthly</th>
            <th scope="col" className="px-3 py-2 font-bold">Annual</th>
          </tr>
        </thead>
        <tbody>
          {PRO_TIERS.map((tier) => (
            <tr
              key={tier.key}
              className={`border-t border-[#E0D7C9] ${tier.key === highlighted ? "bg-[#FBEFEA] font-semibold text-[#1A1815]" : "text-[#5A5347]"}`}
            >
              <th scope="row" className="px-3 py-2 font-medium">{tier.assetsLabel}</th>
              <td className="px-3 py-2 tabular-nums">{tierPriceLabel(tier.key, "monthly")}</td>
              <td className="px-3 py-2 tabular-nums">{tierPriceLabel(tier.key, "annual")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[#E0D7C9] px-3 py-2 text-xs text-[#6B6255]">
        Every tier is {PLAN_TEAM_LABEL}. {CONSULTANT_PRICE_NOTE}
      </p>
    </div>
  );
}

interface PriceColumnProps {
  plan: ProPlan;
  eyebrow: string;
  priceLabel: string;
  priceSuffix: string;
  note: string;
  badge?: string;
  highlighted: boolean;
  cta: ReactNode;
}

function PriceColumn({ plan, eyebrow, priceLabel, priceSuffix, note, badge, highlighted, cta }: PriceColumnProps) {
  const border = plan === "annual" ? "border-2 border-[#C44B2E]" : "border border-[#E0D7C9]";
  const ring = highlighted ? " ring-2 ring-[#C44B2E]/30 ring-offset-2 ring-offset-[#FDFBF8]" : "";
  return (
    <div id={`plan-${plan}`} className={`relative flex flex-col rounded-lg bg-white p-5 ${border}${ring}`}>
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-[#C44B2E] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
            {badge}
          </span>
        </div>
      )}
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">{eyebrow}</div>
      <div className="flex items-baseline gap-1">
        <span
          className="text-3xl font-bold text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {priceLabel}
        </span>
        <span className="text-sm text-[#6B6255]">{priceSuffix}</span>
      </div>
      <p className={`mt-1 mb-5 flex-1 text-xs font-medium ${plan === "annual" ? "text-[#A93D25]" : "text-[#6B6255]"}`}>
        {note}
      </p>
      {cta}
    </div>
  );
}
