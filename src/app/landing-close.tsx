import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { DISPLAY_H2, InstitutionSearchForm, SANS, SECTION_INNER, TEXT_LINK } from "./landing-shared";

/**
 * Brief 06 §4.3 item 8: the navy closing band, the promise and the search again.
 * data-theme="dark" flips the brand tokens, so the field and button keep their contrast.
 */
export function LandingClose() {
  return (
    <section data-theme="dark" className="bg-paper text-ink">
      <div className={`${SECTION_INNER} py-16 text-center sm:py-24`}>
        <h2 className={`mx-auto max-w-3xl ${DISPLAY_H2}`} style={SANS}>
          Know where your fees stand, with a source for every figure
        </h2>
        <InstitutionSearchForm id="closing-search" className="mx-auto mt-8 max-w-2xl [&_.fi-field]:max-w-none [&_label]:sr-only" />
        <p className="mt-6 text-[14px]">
          <TrackLink event="upgrade_click" eventProps={{ placement: "home_closing" }} href={PRO_PLANS_NAV.href} className={TEXT_LINK}>
            {PRO_PLANS_NAV.label}
          </TrackLink>
        </p>
      </div>
    </section>
  );
}
