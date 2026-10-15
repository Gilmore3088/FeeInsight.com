import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { InstitutionSearchForm, SANS, SECTION_INNER, TEXT_LINK } from "./landing-shared";

/**
 * Brief 08 §B.12: the navy closing band. data-theme="dark" flips the brand tokens, so the
 * search field and the primary button keep their contrast on navy.
 */
export function LandingClose() {
  return (
    <section data-theme="dark" className="bg-paper text-ink">
      <div className={`${SECTION_INNER} py-14 sm:py-20`}>
        <div className="max-w-2xl">
          <h2 className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[2.25rem]" style={SANS}>
            See where your fees stand in your market
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-muted">
            Search your bank or credit union. Every figure comes with its source.
          </p>
          <InstitutionSearchForm className="mt-7" />
          <p className="mt-5 text-[14px]">
            <TrackLink event="upgrade_click" eventProps={{ placement: "home_closing" }} href={PRO_PLANS_NAV.href} className={TEXT_LINK}>
              {PRO_PLANS_NAV.label}
            </TrackLink>
          </p>
        </div>
      </div>
    </section>
  );
}
