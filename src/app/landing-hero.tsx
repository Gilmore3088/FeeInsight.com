import Link from "next/link";
import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { Eyebrow, InstitutionSearchForm, SANS, hasFigure } from "./landing-shared";

const CHIP =
  "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-surface-0 px-3.5 text-[13px] font-medium text-ink hover:border-ink";

/**
 * Brief 06 §4.3 item 1: parchment, one column on a phone. The promise, one sentence, the
 * search, live microcopy and three working chips. It stays short so the product frame under
 * it shows in the first screen: on a phone its top edge, on a desktop most of it, where the
 * headline sits left and the sentence and search sit right.
 */
export function LandingHero({ summary }: { summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel"> }) {
  return (
    <section className="bg-paper">
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-x-14 px-4 pb-5 pt-5 text-center sm:px-6 sm:pb-10 sm:pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pt-14 lg:text-left">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <Eyebrow>The {PRODUCT_NAME}</Eyebrow>
          <h1
            className="mt-3 text-[2.25rem] !font-semibold leading-[1.04] !tracking-[-0.04em] text-ink sm:text-[3.5rem] lg:text-[3.6rem]"
            style={SANS}
          >
            Know where your fees stand, with a source for every figure
          </h1>
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-end lg:pb-1">
          <p className="mx-auto mt-3 text-[16px] leading-relaxed text-ink-soft sm:text-[18px] lg:mx-0 lg:mt-0">
            Compare each fee with your market, state, Fed district, peer group and the nation in Hamilton, the{" "}
            {SITE_NAME} Pro workspace.
          </p>

          <InstitutionSearchForm id="hero-search" className="mx-auto mt-4 max-w-2xl [&_.fi-field]:max-w-none lg:mx-0 lg:mt-5" />
          <p className="mt-2.5 text-[13px] leading-5 text-ink-muted">
            {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions with published fees · ` : ""}
            {summary.freshnessLabel}
          </p>
        </div>

        <ul
            className="-mx-4 mt-3 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 lg:col-start-1 lg:row-start-2 lg:mt-6 lg:justify-start"
            aria-label="Or start here"
          >
            {/* The Pro plans chip leads, so a phone shows it whole in the first screen (re-walk R3). */}
            <li>
              <TrackLink event="upgrade_click" eventProps={{ placement: "home_hero" }} href={PRO_PLANS_NAV.href} className={CHIP}>
                {PRO_PLANS_NAV.label}
              </TrackLink>
            </li>
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
          </ul>
      </div>
    </section>
  );
}
