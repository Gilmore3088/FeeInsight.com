import Link from "next/link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_TIERS, annualPerMonthLabel, tierAmountLabel } from "@/lib/pro-tiers";
import { HOME_WRAP, SERIF } from "./landing-shared";

/** The billing and data questions live with the plans on /subscribe (James, Oct 18: "put an FAQ link"). */
export const FAQ_HREF = `${PRO_PLANS_NAV.href}#faq`;

/** How pricing works, from the seat limit. Pro is sold annually only (James, Oct 26). */
export function pricingLine(seats: number = WORKSPACE_SEAT_LIMIT): string {
  return `Priced by your institution's total assets, for up to ${seats} people, billed yearly.`;
}

/**
 * Pricing (James's example, Oct 17; heading by growth): "One plan for your whole pricing team." Three tiers by assets,
 * every price from PRO_TIERS (the subhead carries the seat count), then the plan button, the demo link and the FAQ link.
 * No standalone report offer here or anywhere on the homepage (James, Oct 17).
 */
export function LandingPricing() {
  return (
    <section id="plans" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-border bg-paper py-10 sm:py-14">
      <div className={HOME_WRAP}>
        <h2 id="pricing-title" className="text-[35px] !font-medium leading-[1.06] tracking-[-0.025em] text-ink sm:text-[50px]" style={SERIF}>
          One plan for your whole pricing team.
        </h2>
        <p className="mt-3 text-[15px] text-ink-soft sm:text-[16px]">{pricingLine()}</p>
        <ul className="mt-6 grid grid-cols-3 gap-2 sm:gap-3.5">
          {PRO_TIERS.map((tier) => (
            <li key={tier.key} className="rounded-[6px] border border-border bg-surface-0 px-2 py-4 text-center sm:px-4 sm:py-6" data-plan={tier.key}>
              <h3 className="min-h-[2.5em] text-[12px] font-medium leading-tight text-ink sm:min-h-0 sm:text-[14px]">{tier.assetsLabel}</h3>
              <p className="mt-2 text-[24px] font-semibold leading-none tracking-[-0.03em] text-ink sm:mt-3 sm:text-[36px]">
                {tierAmountLabel(tier.key)}
                <span className="block text-[12px] font-normal tracking-normal text-ink-muted sm:ml-1.5 sm:inline sm:text-[13px]">/ year</span>
              </p>
              <p className="mt-1.5 text-[12px] text-ink-muted">{annualPerMonthLabel(tier.key)} a month</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col items-center gap-3.5">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_pricing" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-brick min-h-12 w-full max-w-[19rem] justify-center"
          >
            Choose your plan
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "home_pricing_demo" }}
            href={DEMO_REQUEST_NAV.href}
            className="text-[14px] font-medium text-brick underline decoration-brick/40 underline-offset-4 hover:decoration-brick"
          >
            Ask for a demo
          </TrackLink>
          <Link href={FAQ_HREF} className="text-[14px] text-ink-muted underline decoration-ink-muted/40 underline-offset-4 hover:text-ink">
            Questions? Read the FAQ
          </Link>
        </div>
      </div>
    </section>
  );
}
