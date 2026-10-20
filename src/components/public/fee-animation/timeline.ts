import type { FeeScene } from "./types";

/** How often the player advances its clock. */
export const TICK_MS = 100;

/** Within a step, when the moving part starts and how long a number takes to count up. */
export const INTRO_DELAY_MS = 400;
export const COUNT_MS = 1200;

/** The scene's real length; the play button's "Watch: N seconds" is read from this. */
export function sceneLengthMs(scene: FeeScene): number {
  return scene.steps.reduce((sum, s) => sum + s.durationMs, 0);
}

export function sceneSeconds(scene: FeeScene): number {
  return Math.round(sceneLengthMs(scene) / 1000);
}

/** When each step starts, in milliseconds from the start of the scene. */
export function stepStarts(scene: FeeScene): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const step of scene.steps) {
    starts.push(at);
    at += step.durationMs;
  }
  return starts;
}

/** The step playing at `ms`; the last step holds once the scene has ended. */
export function stepIndexAt(scene: FeeScene, ms: number): number {
  const starts = stepStarts(scene);
  for (let i = starts.length - 1; i >= 0; i--) {
    if (ms >= starts[i]) return i;
  }
  return 0;
}

/** A number counting up from zero to `target` once `elapsedMs` passes `delayMs`. */
export function countUp(target: number, elapsedMs: number, delayMs = INTRO_DELAY_MS): number {
  const run = elapsedMs - delayMs;
  if (run <= 0) return 0;
  if (run >= COUNT_MS) return target;
  return Math.round((target * run) / COUNT_MS);
}

/** "$3", "$1,000": scenes use round, illustrative amounts. */
export function dollars(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
