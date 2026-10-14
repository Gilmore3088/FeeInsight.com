import { BUTTON_GREEN, BUTTON_OUTLINE, CONTAINER, H1, LEAD, OVERLINE } from "./look";
import { HeroVideo } from "./hero-video";
import { WALKTHROUGH_HREF } from "./home-header";

export const SAMPLE_REPORT_SECTION_HREF = "#sample-report";

/** One headline, one sentence, two buttons, the walkthrough on the right. */
export function HomeHero() {
  return (
    <section aria-labelledby="home-title" className="bg-white">
      <div className={`${CONTAINER} grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14 lg:py-20`}>
        <div className="min-w-0">
          <p className={OVERLINE}>Fee intelligence for banks and credit unions</p>
          <h1 id="home-title" className={`mt-4 ${H1}`}>
            See where your fees sit against your competitors.
          </h1>
          <p className={`mt-5 max-w-xl ${LEAD}`}>
            Published overdraft, ATM, wire and monthly fees for U.S. banks and credit unions, each
            read from the institution&apos;s own schedule and compared with named peers in your market.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={WALKTHROUGH_HREF} className={BUTTON_GREEN}>
              Request a free walkthrough
            </a>
            <a href={SAMPLE_REPORT_SECTION_HREF} className={BUTTON_OUTLINE}>
              See the sample report
            </a>
          </div>
        </div>
        <div className="min-w-0">
          <HeroVideo />
        </div>
      </div>
    </section>
  );
}
