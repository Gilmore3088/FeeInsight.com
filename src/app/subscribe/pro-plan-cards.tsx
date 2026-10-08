import type { ReactNode } from "react";
import { TrackLink } from "@/components/track-link";
import { SubscribeButton } from "./subscribe-button";
import {
  ANNUAL_PRICE_LABEL,
  ANNUAL_SAVINGS_LABEL,
  MONTHLY_PRICE_LABEL,
  PLAN_TEAM_LABEL,
  type ProPlan,
} from "./pricing";

interface ProPlanCardsProps {
  features: string[];
  isLoggedIn: boolean;
  monthlyPriceId: string;
  annualPriceId: string;
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
 * Two price columns sharing ONE feature list — annual is a discount, not a tier.
 */
export function ProPlanCards({
  features,
  isLoggedIn,
  monthlyPriceId,
  annualPriceId,
  returnTo,
  registerHrefFor,
  highlightedPlan,
  autoStartPlan = null,
}: ProPlanCardsProps) {
  const ctaFor = (plan: ProPlan, priceId: string, label: string, className: string) => {
    const autoStart = autoStartPlan === plan;
    if (isLoggedIn) {
      return (
        <SubscribeButton
          priceId={priceId}
          mode="subscription"
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
        eventProps={{ plan }}
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <PriceColumn
            plan="monthly"
            eyebrow="Monthly"
            priceLabel={MONTHLY_PRICE_LABEL}
            priceSuffix={`/mo ${PLAN_TEAM_LABEL}`}
            note="Cancel at the end of any billing period"
            highlighted={highlightedPlan === "monthly"}
            cta={ctaFor("monthly", monthlyPriceId, "Start monthly", SECONDARY_BUTTON)}
          />
          <PriceColumn
            plan="annual"
            eyebrow="Annual"
            priceLabel={ANNUAL_PRICE_LABEL}
            priceSuffix={`/yr ${PLAN_TEAM_LABEL}`}
            note={`Save ${ANNUAL_SAVINGS_LABEL} vs monthly`}
            badge="Best value"
            highlighted={highlightedPlan === "annual"}
            cta={ctaFor("annual", annualPriceId, "Start annual", PRIMARY_BUTTON)}
          />
        </div>
      </div>
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
