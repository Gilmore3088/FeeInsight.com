import { TrackLink } from "@/components/track-link";
import { SITE_NAME } from "@/lib/constants";
import { BAND, CTA_PRIMARY, H2, BODY } from "@/components/public/site-look";

/**
 * Secondary homepage path for institutional buyers. The homepage introduces Pro;
 * detailed product, pricing and report choices live on their dedicated pages.
 */
export function LandingBankOffer() {
  return (
    <section id="for-banks" aria-labelledby="for-banks-title" className={BAND}>
      <div className="mx-auto flex max-w-page flex-col gap-5 px-4 py-10 sm:px-6 sm:py-12 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            For banking teams
          </p>
          <h2 id="for-banks-title" className={`mt-2 ${H2}`}>
            Compare your fees with the market.
          </h2>
          <p className={`mt-2 ${BODY}`}>
            Hamilton brings named peers, fee evidence and market context into one workspace, then turns the research into a board-ready brief.
          </p>
        </div>
        <TrackLink
          event="upgrade_click"
          eventProps={{ placement: "homepage_banking_teams" }}
          href="/subscribe"
          className={`${CTA_PRIMARY} shrink-0`}
        >
          See {SITE_NAME} Pro
        </TrackLink>
      </div>
    </section>
  );
}
