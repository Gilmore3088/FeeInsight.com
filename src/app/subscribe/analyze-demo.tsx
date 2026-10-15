"use client";

import { useEffect, useState } from "react";
import { useReducedMotion, useShowcase } from "./showcase";
import { scenarioQuestion, type AnalyzeScenario } from "./scenario";
import { TryAPricePanel } from "./try-a-price-panel";

export type { AnalyzeScenario } from "./scenario";

const TYPE_MS = 32;

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
  const length = scenarioQuestion(scenario).length;
  const [typed, setTyped] = useState(animate ? 0 : length);

  useEffect(() => {
    if (!animate) return;
    const timer = window.setInterval(() => {
      setTyped((n) => {
        if (n >= length) {
          window.clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, TYPE_MS);
    return () => window.clearInterval(timer);
  }, [animate, length]);

  return <TryAPricePanel scenario={scenario} typed={typed} />;
}
