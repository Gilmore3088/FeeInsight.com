import { ResearchStage } from "./landing-research";
import { HOME_WRAP, SERIF } from "./landing-shared";

/** "The research, already connected." (James's example, Oct 17): the heading, then the moving stage. */
export function LandingResearch() {
  return (
    <section id="research" aria-labelledby="research-title" className="border-y border-border bg-surface-0 py-10 sm:py-14">
      <div className={HOME_WRAP}>
        <header className="mb-7 max-w-3xl">
          <h2 id="research-title" className="text-[34px] !font-medium leading-[1.06] tracking-[-0.025em] text-ink sm:text-[48px]" style={SERIF}>
            The research, already connected.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:text-[16px]">
            Fee schedules, financial filings and market data in one place.
          </p>
        </header>
        <ResearchStage />
      </div>
    </section>
  );
}
