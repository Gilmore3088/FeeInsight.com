"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * GeneratingState — what the user sees while Hamilton drafts the report.
 *
 * Several model-written sections plus a figure check run server-side; a large report
 * can take a few minutes. Pure-client elapsed timer; the progress steps are heuristic
 * (we don't stream server progress yet), so the screen never looks frozen.
 */

const STEPS: { atSeconds: number; label: string }[] = [
  { atSeconds: 0, label: "Gathering your published fees and your peer group's" },
  { atSeconds: 3, label: "Writing the summary and the sections that follow" },
  { atSeconds: 20, label: "Checking every figure in the draft against the data" },
  { atSeconds: 45, label: "Nearly done: putting the report together" },
];

export function GeneratingState() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, []);

  const currentStep = STEPS.filter((s) => elapsed >= s.atSeconds).slice(-1)[0] ?? STEPS[0];

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center rounded-lg border border-warm-300 bg-warm-50 px-6 py-14 text-center"
    >
      <Loader2 size={28} className="mb-5 animate-spin text-terra" aria-hidden="true" />
      <p className="mb-2 max-w-md text-base leading-relaxed text-warm-800">{currentStep.label}…</p>
      <p className="text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
        {elapsed}s so far. A larger report can take a few minutes.
      </p>
    </div>
  );
}
