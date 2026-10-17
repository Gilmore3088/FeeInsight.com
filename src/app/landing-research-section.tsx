import { ResearchStage } from "./landing-research";
import { HOME_WRAP, SANS } from "./landing-shared";

/** "The research, already connected." (James's example, Oct 17): the heading, then the moving stage. */
export function LandingResearch() {
  return (
    <section id="research" aria-labelledby="research-title" className="border-y border-border bg-surface-0 py-10 sm:py-14">
      <div className={HOME_WRAP}>
        <header className="mb-7 max-w-3xl">
          <h2 id="research-title" className="text-[31px] !font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[43px]" style={SANS}>
            The research, already connected.
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:text-[16px]">
            We bring fee schedules, financial filings and market context together, so you don&apos;t have to search.
          </p>
        </header>
        <ResearchStage />
      </div>
    </section>
  );
}
