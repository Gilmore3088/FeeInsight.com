import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { InstitutionSearchForm, SAMPLE_REPORT_HREF, SANS, hasFigure } from "./landing-shared";

/**
 * Section 1, the promise (James's homepage reset, Oct 16): who it is for and what they get, in
 * his words, then the two actions: see the plans, or open a real report. The institution search
 * stays, as a secondary way in, with the live count of what the index holds under it.
 */
export function LandingHero({ summary }: { summary: Pick<PublicStatsSummary, "institutionsLabel" | "freshnessLabel"> }) {
  return (
    <section className="bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-10 pt-8 text-center sm:px-6 sm:pb-14 sm:pt-14">
        <h1
          className="max-w-4xl text-[2.25rem] !font-semibold leading-[1.04] !tracking-[-0.04em] text-ink sm:text-[3rem] lg:text-[3.5rem]"
          style={SANS}
        >
          Your next fee review doesn&apos;t need to take weeks, or cost thousands.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-ink-soft sm:text-[19px]">
          {SITE_NAME} helps you compare competitors with the {PRODUCT_NAME}. Turn the evidence into analysis and board
          reports with Hamilton.
        </p>
        <div className="mt-7 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-4">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_hero" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-primary min-h-11 w-full justify-center sm:w-auto"
          >
            See plans
          </TrackLink>
          <a href={SAMPLE_REPORT_HREF} className="fi-btn fi-btn-secondary min-h-11 w-full justify-center sm:w-auto">
            Explore a sample report
          </a>
        </div>

        <div className="mt-10 w-full max-w-2xl border-t border-border pt-6" data-hero-search="">
          <p className="text-[14px] font-semibold text-ink">Or look up any bank or credit union</p>
          <InstitutionSearchForm id="hero-search" secondary className="mt-3 w-full [&_.fi-field]:max-w-none [&_label]:sr-only" />
          <p className="mt-2.5 text-[13px] leading-5 text-ink-muted">
            {hasFigure(summary.institutionsLabel) ? `${summary.institutionsLabel} institutions in the ${PRODUCT_NAME} · ` : ""}
            {summary.freshnessLabel}
          </p>
        </div>
      </div>
    </section>
  );
}
