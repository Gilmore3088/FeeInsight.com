import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { Eyebrow, SAMPLE_REPORT_HREF, SANS } from "./landing-shared";

/**
 * The promise (James's homepage reset, Oct 16): who it is for, his headline and line, then the two
 * actions, see the plans or open a real report. The institution search lives with the Bank Fee Index below.
 */
export function LandingHero() {
  return (
    <section className="bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-12 pt-10 text-center sm:px-6 sm:pb-16 sm:pt-16">
        <Eyebrow>For banks and credit unions</Eyebrow>
        <h1
          className="mt-4 max-w-4xl text-[2.25rem] !font-semibold leading-[1.04] !tracking-[-0.04em] text-ink sm:text-[3rem] lg:text-[3.5rem]"
          style={SANS}
        >
          Your next fee review doesn&apos;t need to take weeks.
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
      </div>
    </section>
  );
}
