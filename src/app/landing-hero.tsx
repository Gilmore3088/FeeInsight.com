import Link from "next/link";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { Eyebrow, InstitutionSearchForm, SANS, hasFigure } from "./landing-shared";

const CHIP = "inline-flex min-h-10 items-center rounded-full border border-border bg-surface-0 px-3.5 text-[13px] font-medium text-ink hover:border-ink";

/**
 * Brief 06 §4.3 item 1: parchment, centred, one column. The promise, one sentence, the
 * search, live microcopy and three working chips. Nothing else; the sizzle sits below.
 */
export function LandingHero({ summary }: { summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel"> }) {
  return (
    <section className="bg-paper">
      <div className="mx-auto max-w-4xl px-4 pb-10 pt-12 text-center sm:px-6 sm:pb-12 sm:pt-20">
        <Eyebrow>The {PRODUCT_NAME}</Eyebrow>
        <h1
          className="mt-4 text-[2.6rem] !font-semibold leading-[1.02] !tracking-[-0.045em] text-ink sm:text-[4.25rem]"
          style={SANS}
        >
          Know where your fees stand, with a source for every figure
        </h1>
        <p className="mx-auto mt-5 text-[17px] leading-relaxed text-ink-soft sm:text-[19px]">
          Compare each fee with your market, state, Fed district, peer group and the nation in Hamilton, the{" "}
          {SITE_NAME} Pro workspace.
        </p>

        <InstitutionSearchForm id="hero-search" className="mx-auto mt-8 max-w-2xl [&_.fi-field]:max-w-none" />
        <p className="mt-3 text-[13px] leading-5 text-ink-muted">
          {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions with published fees · ` : ""}
          {summary.freshnessLabel}
        </p>

        <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Or start here">
          <li>
            <Link href="/fees/overdraft" className={CHIP}>
              Overdraft fees nationwide
            </Link>
          </li>
          <li>
            <Link href="/research/national-fee-index" className={CHIP}>
              Read the national report
            </Link>
          </li>
          <li>
            <TrackLink event="upgrade_click" eventProps={{ placement: "home_hero" }} href={PRO_PLANS_NAV.href} className={CHIP}>
              {PRO_PLANS_NAV.label}
            </TrackLink>
          </li>
        </ul>
      </div>
    </section>
  );
}
