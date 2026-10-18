import { ResearchStage } from "./landing-research";
import { HOME_WRAP, SERIF, SERIF_HEAD } from "./landing-shared";

/** "Ask Hamilton. Every answer shows its sources." (James's example, Oct 17; heading by growth): the heading, then the moving stage. */
export function LandingResearch() {
  return (
    <section id="research" aria-labelledby="research-title" className="border-y border-border bg-surface-0 py-10 sm:py-14">
      <div className={HOME_WRAP}>
        <header className="mb-7 max-w-3xl">
          <h2 id="research-title" className={`${SERIF_HEAD} text-ink`} style={SERIF}>
            {/* Each sentence starts its own line, so the break never splits "Every answer". */}
            <span className="block">Ask Hamilton.</span> <span className="block">Every answer shows its sources.</span>
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft sm:text-[16px]">
            Answers start from published fee schedules. Filings and market data join as each source is connected.
          </p>
        </header>
        <ResearchStage />
      </div>
    </section>
  );
}
