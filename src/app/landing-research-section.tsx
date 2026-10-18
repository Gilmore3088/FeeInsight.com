import { PRO_PLANS_NAV } from "@/components/nav-items";
import { TrackLink } from "@/components/track-link";
import { EvidenceFlow } from "./landing-research";
import { HOME_WRAP, SERIF } from "./landing-shared";

/**
 * "Ask Hamilton. Every answer shows its sources." (heading by growth, Oct 17), now over the
 * evidence flow (James's critique §5): where the evidence comes from and what Hamilton makes of
 * it. One action, the subscription.
 */
export function LandingResearch() {
  return (
    <section id="research" aria-labelledby="research-title" className="border-y border-border bg-surface-0 py-10 sm:py-14">
      <div className={HOME_WRAP}>
        <h2 id="research-title" className="mb-7 max-w-3xl text-[34px] !font-medium leading-[1.06] tracking-[-0.025em] text-ink sm:mb-9 sm:text-[48px]" style={SERIF}>
          {/* Each sentence starts its own line, so the break never splits "Every answer". */}
          <span className="block">Ask Hamilton.</span> <span className="block">Every answer shows its sources.</span>
        </h2>
        <EvidenceFlow />
        <div className="mt-8 flex justify-center lg:justify-start">
          <TrackLink
            event="upgrade_click"
            eventProps={{ placement: "home_research" }}
            href={PRO_PLANS_NAV.href}
            className="fi-btn fi-btn-brick min-h-12 w-full justify-center px-6 text-[15px] sm:w-auto"
          >
            Get Hamilton for your institution
          </TrackLink>
        </div>
      </div>
    </section>
  );
}
