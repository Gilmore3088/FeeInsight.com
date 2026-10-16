import Link from "next/link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE } from "@/lib/constants";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { PlanIncludes } from "./subscribe/plans-exhibit";
import { REPORT_REQUEST_HREF, SECTION_INNER, SectionHeading, TEXT_LINK } from "./landing-shared";

/**
 * Section 5, subscribe (James's homepage reset, Oct 16): what every plan includes, the price by
 * institution size (every price from PRO_TIERS), and the next step; the report as one line under it.
 */
export function LandingPricing() {
  return (
    <section id="plans" aria-label="Plans" className="scroll-mt-24 border-t border-border bg-paper">
      <div className={`${SECTION_INNER} py-16 sm:py-24`}>
        <SectionHeading
          center
          eyebrow="Hamilton Pro"
          title="Priced by your institution's size"
          line={`Hamilton Pro is the plan that includes Hamilton and the full ${PRODUCT_NAME}, for up to ${WORKSPACE_SEAT_LIMIT} people.`}
        />
        <PlanIncludes />
        <ul className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-3 sm:gap-4">
          {PRO_TIERS.map((tier) => (
            <li
              key={tier.key}
              className="fi-window-lift flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface-0 px-5 py-4 sm:block sm:p-6 sm:text-center"
            >
              <p className="text-[13px] font-medium text-ink-muted">{tier.assetsLabel}</p>
              <div className="text-right sm:text-center">
                <p className="font-mono text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink sm:mt-3 sm:text-[32px]">
                  {tierPriceLabel(tier.key, "monthly")}
                </p>
                <p className="mt-1.5 font-mono text-[12px] tabular-nums text-ink-muted sm:mt-2 sm:text-[13px]">
                  or {tierPriceLabel(tier.key, "annual")}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_pricing" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary min-h-11"
          >
            See plans
          </TrackLink>
          <TrackLink
            event="contact_sales"
            eventProps={{ placement: "home_pricing_demo" }}
            href={DEMO_REQUEST_NAV.href}
            className={`text-[14px] ${TEXT_LINK}`}
          >
            {DEMO_REQUEST_NAV.label}
          </TrackLink>
        </div>
        <p className="mx-auto mt-8 text-center text-[14px] text-ink-soft">
          Prefer one document?{" "}
          <Link href={REPORT_REQUEST_HREF} className={TEXT_LINK}>
            {REPORT_OFFER.name}
          </Link>
          , {REPORT_PRICE_INLINE}.
        </p>
      </div>
    </section>
  );
}
