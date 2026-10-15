"use client";

import { useSyncExternalStore } from "react";

/**
 * Motion helpers for the /subscribe showcase (site v3 brief 06 §4.1): the reader's
 * reduced-motion setting and the progress fill that runs under a chapter while it plays.
 */

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(REDUCED_MOTION).matches === true;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** The reader's reduced-motion setting; the server render assumes it is on (nothing moves). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
}

/**
 * A bar that fills over `durationMs` while `filling`, and shows full otherwise. Remount it
 * (change its key) to restart the fill; `paused` holds it where it is.
 */
export function ProgressFill({
  filling,
  durationMs,
  paused = false,
  className = "bg-ink",
}: {
  filling: boolean;
  durationMs: number;
  paused?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block h-full origin-left ${className}`}
      style={
        filling
          ? {
              animation: `fi-progress-fill ${durationMs}ms linear both`,
              animationPlayState: paused ? "paused" : "running",
            }
          : undefined
      }
    />
  );
}
