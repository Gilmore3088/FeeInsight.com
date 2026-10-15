"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/**
 * Motion helpers shared by the /subscribe showcase and the homepage product sizzle
 * (site v3 brief 06 §4.1): the reader's reduced-motion setting, an in-view check and the
 * progress fill that runs under a chapter while it plays.
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
 * Calls `onChange(visible)` as at least `threshold` of the element comes on and off screen,
 * while `enabled`. Without IntersectionObserver (old browsers, tests) the element counts as
 * in view, so playback still starts. The callback may set state: it runs from the observer.
 */
export function useInViewChange(
  ref: RefObject<Element | null>,
  onChange: (visible: boolean) => void,
  { enabled = true, threshold = 0.35 }: { enabled?: boolean; threshold?: number } = {},
): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    if (typeof IntersectionObserver === "undefined") {
      callback.current(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => callback.current(entry.isIntersecting), { threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, enabled, threshold]);
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
