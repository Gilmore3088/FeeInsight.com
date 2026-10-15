import Link from "next/link";
import { REPORT_OFFER, REPORT_OFFER_LINE } from "@/lib/constants";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { CONSULTANT_PRICE_NOTE, PRO_TIERS, tierPriceLabel } from "@/lib/pro-tiers";
import { REPORT_REQUEST_HREF, SECTION_INNER, SectionHeading } from "./landing-shared";

/** The free offer line without its em dash (no em dashes in short copy). */
const FREE_LINE = REPORT_OFFER_LINE.replace(/\s*—\s*/, ": ");
/** Monthly payments an annual plan costs: "Annual is ten monthly payments" (pro-tiers.ts). */
const ANNUAL_PAYMENTS = PRO_TIERS[0].annualUsd / PRO_TIERS[0].monthlyUsd;

const CARD = "flex min-w-0 flex-col rounded-lg border border-border bg-surface-0 p-6";
const CARD_TITLE = "text-[18px] font-bold text-ink";

/** Brief 08 §B.10: prices on the page, every figure from a constant. */
export function LandingPricing() {
  return (
    <section className="border-b border-border bg-surface-0">
      <div className={`${SECTION_INNER} py-14 sm:py-16`}>
        <SectionHeading eyebrow="Prices on the page" title="What it costs" />
        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.8fr)]">
          <div className={CARD}>
            <h3 className={CARD_TITLE}>Free</h3>
            <p className="mt-3 flex-1 text-[14px] leading-6 text-ink-soft">
              {FREE_LINE}. Institution search, and basic fee alerts with a free account.
            </p>
            <Link href="/research/national-fee-index" className="fi-btn fi-btn-secondary mt-6 self-start">
              Read the national report
            </Link>
          </div>

          <div className={CARD}>
            <h3 className={CARD_TITLE}>Hamilton Pro</h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {PRO_TIERS.map((tier) => (
                <li key={tier.key} className="rounded-md border border-border bg-paper p-4">
                  <p className="text-[13px] text-ink-muted">{tier.assetsLabel}</p>
                  <p className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-ink">
                    {tierPriceLabel(tier.key, "monthly")}
                  </p>
                  <p className="font-mono text-[13px] tabular-nums text-ink-muted">{tierPriceLabel(tier.key, "annual")}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[14px] leading-6 text-ink-soft">
              One plan for up to {WORKSPACE_SEAT_LIMIT} people. Annual is {ANNUAL_PAYMENTS} monthly payments.
            </p>
            <p className="mt-2 flex-1 text-[12px] leading-5 text-ink-muted">{CONSULTANT_PRICE_NOTE}</p>
            <Link href="/subscribe" className="fi-btn fi-btn-primary mt-6 self-start">
              See Hamilton plans
            </Link>
          </div>

          <div className={CARD}>
            <h3 className={CARD_TITLE}>One report</h3>
            <p className="mt-3 text-[14px] font-semibold text-ink">{REPORT_OFFER.name}</p>
            <p className="font-mono text-[20px] font-semibold tabular-nums text-ink">{REPORT_OFFER.priceLabel}</p>
            <p className="mt-2 flex-1 text-[14px] leading-6 text-ink-soft">
              Each report is quoted. {REPORT_OFFER.nextStep}.
            </p>
            <Link href={REPORT_REQUEST_HREF} className="fi-btn fi-btn-secondary mt-6 self-start">
              {REPORT_OFFER.institutionCtaLabel}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
