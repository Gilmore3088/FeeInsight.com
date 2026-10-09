import {
  CONSULTANT_MONTHLY_REPORTS,
  NON_INSTITUTION_TIER,
  PRO_TIERS,
  annualMonthsFree,
  tierAmountLabel,
  tierPriceLabel,
  type ProTier,
} from "@/lib/pro-tiers";
import { PRO_PILLARS, proFeature } from "@/lib/hamilton/pro-features";
import { PLAN_TEAM_LABEL } from "./pricing";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };
const CHECK = "✓";

/**
 * Every Pro price on one row, before the buyer picks anything: three sizes of bank or credit
 * union, plus consultants. The features are the same on every card, so the cards carry price only.
 * `highlighted` is a tier key, or "consultant" once the buyer says they're not a bank or credit union.
 */
export function ProTierCards({ highlighted }: { highlighted: ProTier | "consultant" | null }) {
  const cards = [
    ...PRO_TIERS.map((tier) => ({
      key: tier.key,
      tier: tier.key,
      who: tier.assetsLabel,
      note: null as string | null,
    })),
    {
      key: "consultant",
      tier: NON_INSTITUTION_TIER,
      who: "Consultants and other organizations",
      note: `Includes ${CONSULTANT_MONTHLY_REPORTS} Hamilton reports a month`,
    },
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const on = card.key === highlighted;
        return (
          <li
            key={card.key}
            className={`flex flex-col rounded-lg bg-white p-4 ${on ? "border-2 border-[#C44B2E]" : "border border-[#E0D7C9]"}`}
          >
            <p className="text-sm font-medium text-[#5A5347]">{card.who}</p>
            <p className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-[#1A1815] tabular-nums" style={SERIF}>
                {tierAmountLabel(card.tier, "monthly")}
              </span>
              <span className="text-sm text-[#6B6255]">a month</span>
            </p>
            <p className="mt-1 text-sm text-[#5A5347] tabular-nums">
              or {tierPriceLabel(card.tier, "annual")}, {annualMonthsFree(card.tier)} months free
            </p>
            {card.note && <p className="mt-2 text-xs text-[#6B6255]">{card.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** How a purchase goes, so nobody has to guess what follows the button. */
export function PurchaseSteps({ isLoggedIn, destination }: { isLoggedIn: boolean; destination: string | null }) {
  const steps = [
    "Pick who the plan is for",
    "Choose annual or monthly billing",
    ...(isLoggedIn ? [] : ["Create your account or sign in"]),
    "Pay on Stripe's secure checkout",
    destination ? `Go straight to ${destination}` : "Open Hamilton, the Pro workspace",
  ];
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#5A5347]">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-[#D5CBBF] bg-white text-xs font-semibold text-[#1A1815]">
            {index + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

/** What every plan opens, as four outcomes; `lead` is the pillar listed first. */
export function ProPillars({ lead }: { lead: string | null }) {
  const pillars = [...PRO_PILLARS].sort((a, b) => Number(b.key === lead) - Number(a.key === lead));
  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {pillars.map((pillar) => (
          <li
            key={pillar.key}
            className={`rounded-lg bg-white p-5 ${pillar.key === lead ? "border-2 border-[#C44B2E]" : "border border-[#E0D7C9]"}`}
          >
            <h3 className="text-lg text-[#1A1815]" style={SERIF}>
              {pillar.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[#1A1815]">{pillar.outcome}</p>
            <ul className="mt-3 space-y-2">
              {pillar.features.map((key) => {
                const feature = proFeature(key);
                return (
                  <li key={key} className="flex items-start gap-2 text-sm text-[#5A5347]">
                    <span aria-hidden className="mt-0.5 flex-shrink-0 text-[#A93D25]">
                      {CHECK}
                    </span>
                    <span>
                      <span className="font-medium text-[#1A1815]">{feature.label}:</span> {feature.description}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-[#5A5347]">
        Every plan is {PLAN_TEAM_LABEL}, each with their own login, and every size gets the same full set.
      </p>
    </div>
  );
}
