"use client";

import { useEffect, useState } from "react";
import { formatAmount } from "@/lib/format";
import { useReducedMotion, useShowcase } from "./showcase";
import { PreviewFrame } from "./preview-frame";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

/** A Try a price question worked from the live national index (built on the server). */
export interface AnalyzeScenario {
  feeLabel: string;
  price: number;
  median: number;
  p25: number | null;
  p75: number | null;
  institutions: number;
}

const TYPE_MS = 32;

/** Where the price sits, in plain words. Describes the market; never advises a price. */
export function scenarioAnswer(s: AnalyzeScenario): string {
  const vsMedian = s.price < s.median ? "below" : s.price > s.median ? "above" : "at";
  const range = s.p25 !== null && s.p75 !== null ? ` (${formatAmount(s.p25)}–${formatAmount(s.p75)})` : "";
  let band = "";
  if (s.p25 !== null && s.p75 !== null) {
    if (s.price < s.p25) band = `, below the middle half of the market${range}`;
    else if (s.price > s.p75) band = `, above the middle half of the market${range}`;
    else band = `, inside the middle half of the market${range}`;
  }
  const median = vsMedian === "at" ? "at" : `${vsMedian} the`;
  return `A ${formatAmount(s.price)} ${s.feeLabel.toLowerCase()} fee would sit ${median} national median of ${formatAmount(
    s.median,
  )}${band}, across ${s.institutions.toLocaleString("en-US")} institutions.`;
}

function pct(amount: number, max: number): string {
  return `${Math.max(0, Math.min(100, (amount / max) * 100)).toFixed(1)}%`;
}

/**
 * The Analyze example: a question typed into Hamilton's Try a price and the answer it gives,
 * played each time the example comes up. The figures are the live national index; the
 * wording is fixed, so it is labelled as an illustration, not a recorded Hamilton answer.
 */
export function AnalyzeDemo({ scenario }: { scenario: AnalyzeScenario }) {
  const { active, turn } = useShowcase();
  const reduced = useReducedMotion();
  const animate = active === 1 && !reduced;
  // A fresh run each time the example comes up; still and complete otherwise.
  return <AnalyzeRun key={animate ? `run-${turn}` : "still"} scenario={scenario} animate={animate} />;
}

function AnalyzeRun({ scenario, animate }: { scenario: AnalyzeScenario; animate: boolean }) {
  const question = `Where would a ${formatAmount(scenario.price)} ${scenario.feeLabel.toLowerCase()} fee sit nationally?`;
  const [typed, setTyped] = useState(animate ? 0 : question.length);

  useEffect(() => {
    if (!animate) return;
    const timer = window.setInterval(() => {
      setTyped((n) => {
        if (n >= question.length) {
          window.clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [animate, question.length]);

  const answered = typed >= question.length;
  const max = Math.max(scenario.p75 ?? scenario.median, scenario.price, scenario.median) * 1.25 || 1;

  return (
    <PreviewFrame label="Hamilton · Try a price" aside="Illustration, live figures">
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#1E293B] px-3.5 py-2 text-[15px] text-white">
            {question.slice(0, typed)}
            {!answered && <span aria-hidden className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-white" />}
          </p>
        </div>

        <div
          className={`transition-opacity duration-500 motion-reduce:transition-none ${answered ? "opacity-100" : "opacity-0"}`}
          aria-hidden={!answered}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#556377]">Hamilton</p>
          <p className="mt-1 text-lg leading-snug text-[#1E293B] font-semibold tracking-tight" style={DISPLAY}>
            {scenarioAnswer(scenario)}
          </p>
          <div className="mt-4">
            <div aria-hidden className="relative h-2.5 rounded-full bg-[#E2E8F0]">
              {scenario.p25 !== null && scenario.p75 !== null && (
                <div
                  className="absolute inset-y-0 rounded-full bg-[#BFDBFE]"
                  style={{ left: pct(scenario.p25, max), width: `calc(${pct(scenario.p75, max)} - ${pct(scenario.p25, max)})` }}
                />
              )}
              <div className="absolute -inset-y-1 w-0.5 rounded bg-[#1E293B]" style={{ left: pct(scenario.median, max) }} />
              <div
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2563EB] ring-2 ring-white transition-[left] duration-700 ease-out motion-reduce:transition-none"
                style={{ left: answered ? pct(scenario.price, max) : pct(scenario.median, max) }}
              />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#556377]">
              <span>
                <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-[#2563EB] align-middle" />
                Scenario price
              </span>
              <span>
                <span aria-hidden className="mr-1.5 inline-block h-3 w-0.5 bg-[#1E293B] align-middle" />
                National median
              </span>
            </p>
          </div>
        </div>
      </div>
      <p className="mt-auto border-t border-[#E2E8F0]/80 bg-white/50 px-4 py-2.5 text-xs leading-relaxed text-[#556377] sm:px-5">
        A scenario, not a recommendation. In Pro, ask about any fee against your own peers.
      </p>
    </PreviewFrame>
  );
}
