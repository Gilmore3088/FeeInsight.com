import Link from "next/link";
import { NATIONAL_INDEX_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { Eyebrow, InstitutionSearchForm, SANS, hasFigure } from "./landing-shared";

const CHIP =
  "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-surface-0 px-3.5 text-[13px] font-medium text-ink hover:border-ink";

/**
 * Brief 06 §4.3 item 1: parchment, one centred column at every width. The promise, one
 * sentence, the search, live microcopy and three working chips. It stays short so the
 * product frame under it, centred at the full container width, shows in the first screen.
 */
export function LandingHero({ summary }: { summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel"> }) {
  return (
    <section className="bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-5 pt-5 text-center sm:px-6 sm:pb-6 sm:pt-8 lg:pt-6">
        <Eyebrow>The {PRODUCT_NAME}</Eyebrow>
        <h1
          className="mt-3 max-w-4xl text-[2.25rem] !font-semibold leading-[1.04] !tracking-[-0.04em] text-ink sm:text-[3rem] lg:text-[3.25rem]"
          style={SANS}
        >
          Know where your fees stand, with a source for every figure
        </h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-soft sm:mt-3 sm:text-[18px]">
          Compare each fee with your market, state, Fed district, peer group and the nation in Hamilton, the{" "}
          {SITE_NAME} Pro workspace.
        </p>

        <InstitutionSearchForm id="hero-search" className="mt-4 w-full max-w-2xl [&_.fi-field]:max-w-none [&_label]:sr-only sm:mt-4" />
        <p className="mt-2.5 text-[13px] leading-5 text-ink-muted">
          {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions with published fees · ` : ""}
          {summary.freshnessLabel}
        </p>

        <ul
          className="-mx-4 mt-3 flex w-[calc(100%+2rem)] min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:mt-3 sm:w-auto sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
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
            <Link href={NATIONAL_INDEX_NAV.href} className={CHIP}>
              {NATIONAL_INDEX_NAV.label}
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
