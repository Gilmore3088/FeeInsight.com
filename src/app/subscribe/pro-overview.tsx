import {
  CONSULTANT_MONTHLY_REPORTS,
  NON_INSTITUTION_TIER,
  PRO_TIERS,
  annualMonthsFree,
  tierAmountLabel,
  tierPriceLabel,
  type ProTier,
} from "@/lib/pro-tiers";
import { PRO_EXTRA_FEATURES, PRO_WORKSPACE_FEATURES } from "@/lib/hamilton/pro-features";
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

/** What every plan opens, named as the workspace names it. */
export function ProIncludes() {
  const items = [
    ...PRO_WORKSPACE_FEATURES,
    ...PRO_EXTRA_FEATURES,
    {
      key: "team",
      label: "Your team",
      href: "",
      description: `One plan is ${PLAN_TEAM_LABEL}, each with their own login.`,
    },
  ];
  return (
    <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-2.5">
          <span aria-hidden className="mt-0.5 flex-shrink-0 text-[#A93D25]">
            {CHECK}
          </span>
          <span>
            <span className="block text-base text-[#1A1815]" style={SERIF}>
              {item.label}
            </span>
            <span className="mt-0.5 block text-sm leading-relaxed text-[#5A5347]">{item.description}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
