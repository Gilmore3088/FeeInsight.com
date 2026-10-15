import { PreviewFrame } from "./preview-frame";
import { scenarioAnswer, scenarioMax, scenarioPct as pct, scenarioQuestion, type AnalyzeScenario } from "./scenario";

const DISPLAY = { fontFamily: "var(--fi-font-sans)" };

/**
 * Hamilton's Try a price, drawn from the live national index. No hooks, so a server page can
 * render it still (/for-institutions) and the /subscribe example can type the question in.
 * `typed` is how much of the question shows; the answer appears once it is complete.
 */
export function TryAPricePanel({ scenario, typed }: { scenario: AnalyzeScenario; typed?: number }) {
  const question = scenarioQuestion(scenario);
  const shown = typed ?? question.length;
  const answered = shown >= question.length;
  const max = scenarioMax(scenario);
  return (
    <PreviewFrame label="Hamilton · Try a price" aside="Illustration, live figures">
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2 text-[15px] text-white">
            {question.slice(0, shown)}
            {!answered && <span aria-hidden className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-white" />}
          </p>
        </div>

        <div
          className={`transition-opacity duration-500 motion-reduce:transition-none ${answered ? "opacity-100" : "opacity-0"}`}
          aria-hidden={!answered}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Hamilton</p>
          <p className="mt-1 text-lg leading-snug text-ink font-semibold tracking-tight" style={DISPLAY}>
            {scenarioAnswer(scenario)}
          </p>
          <div className="mt-4">
            <div aria-hidden className="relative h-2.5 rounded-full bg-border">
              {scenario.p25 !== null && scenario.p75 !== null && (
                <div
                  className="absolute inset-y-0 rounded-full bg-border"
                  style={{ left: pct(scenario.p25, max), width: `calc(${pct(scenario.p75, max)} - ${pct(scenario.p25, max)})` }}
                />
              )}
              <div className="absolute -inset-y-1 w-0.5 rounded bg-ink" style={{ left: pct(scenario.median, max) }} />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brick ring-2 ring-white transition-[left] duration-700 ease-out motion-reduce:transition-none"
                style={{ left: answered ? pct(scenario.price, max) : pct(scenario.median, max) }}
              />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span>
                <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-brick align-middle" />
                Scenario price
              </span>
              <span>
                <span aria-hidden className="mr-1.5 inline-block h-3 w-0.5 bg-ink align-middle" />
                National median
              </span>
            </p>
          </div>
        </div>
      </div>
      <p className="mt-auto border-t border-border/80 bg-white/50 px-4 py-2.5 text-xs leading-relaxed text-ink-muted sm:px-5">
        A scenario, not advice. In Pro, ask about any fee against your own peers.
      </p>
    </PreviewFrame>
  );
}
