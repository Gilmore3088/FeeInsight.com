import Link from "next/link";
import { NATIONAL_INDEX_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { InstitutionSearchForm, SANS, hasFigure } from "./landing-shared";

const MENU_LINK = "block rounded-md px-3 py-2.5 text-left text-[14px] text-ink hover:bg-paper";

/**
 * Brief 06 §4.3 item 1: parchment, one centred column at every width. Brand order: the header
 * names Fee Insight and the line under the search names the Bank Fee Index as its dataset.
 * Short enough for a phone's first screen (James's notes of Oct 16): the promise, one sentence,
 * the search as the one action, live microcopy, and the other starting points folded into a
 * small "Explore the Index" menu.
 */
export function LandingHero({ summary }: { summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel"> }) {
  return (
    <section className="bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-5 pt-6 text-center sm:px-6 sm:pb-6 sm:pt-8 lg:pt-6">
        {/* No eyebrow: the header already names the site, and a product name above the h1 read as the
            site's name. The Bank Fee Index is named where its data is (the line under the search). */}
        <h1
          className="max-w-4xl text-[2.25rem] !font-semibold leading-[1.04] !tracking-[-0.04em] text-ink sm:text-[3rem] lg:text-[3.25rem]"
          style={SANS}
        >
          Know where your fees stand.
        </h1>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-soft sm:mt-3 sm:text-[18px]">
          Compare your institution with competitors, with a source for every figure.
        </p>

        <InstitutionSearchForm id="hero-search" className="mt-5 w-full max-w-2xl [&_.fi-field]:max-w-none [&_label]:sr-only" />
        <p className="mt-2.5 text-[13px] leading-5 text-ink-muted">
          {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions in the ${PRODUCT_NAME} · ` : ""}
          {summary.freshnessLabel}
        </p>

        <details className="group relative mt-2" data-explore-index="">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink [&::-webkit-details-marker]:hidden">
            Explore the Index
            <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-180 motion-reduce:transition-none">
              ▾
            </span>
          </summary>
          <ul className="absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-lg border border-border bg-surface-0 p-1.5 shadow-lg shadow-[#132338]/10">
            {/* The Pro plans link leads, as the chip row's did (re-walk R3). */}
            <li>
              <TrackLink event="upgrade_click" eventProps={{ placement: "home_hero" }} href={PRO_PLANS_NAV.href} className={MENU_LINK}>
                {PRO_PLANS_NAV.label}
              </TrackLink>
            </li>
            <li>
              <Link href="/fees/overdraft" className={MENU_LINK}>
                Overdraft fees nationwide
              </Link>
            </li>
            <li>
              <Link href={NATIONAL_INDEX_NAV.href} className={MENU_LINK}>
                {NATIONAL_INDEX_NAV.label}
              </Link>
            </li>
          </ul>
        </details>
      </div>
    </section>
  );
}
