"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** True when the visitor asked for reduced motion. False on the server and before mount. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Ticks the clock this often while a section is playing. */
const TICK_MS = 100;

export interface AutoAdvance {
  index: number;
  /** Time spent on the current slide while playing, in ms. */
  elapsed: number;
  /** The visitor paused with the pause button. */
  paused: boolean;
  /** The clock is running: not paused, on screen, tab visible, motion allowed, not hovered or focused. */
  playing: boolean;
  reduced: boolean;
  go: (index: number) => void;
  togglePause: () => void;
}

/**
 * The homepage's slide clock, shared by the Hamilton examples and the research panel. It moves
 * to the next slide after `duration`, and stops whenever the section is off screen
 * (IntersectionObserver), the tab is hidden, the visitor paused it, or the pointer or keyboard
 * focus is inside the section (`holdOnInteract`). With reduced motion it never advances on its own.
 * There is no progress bar: the clock is never drawn (James, Oct 17).
 */
export function useAutoAdvance({
  count,
  duration,
  rootRef,
  initialIndex = 0,
  initialElapsed = 0,
  holdOnInteract = true,
  threshold = 0.2,
}: {
  count: number;
  duration: number;
  rootRef: RefObject<HTMLElement | null>;
  initialIndex?: number;
  initialElapsed?: number;
  holdOnInteract?: boolean;
  threshold?: number;
}): AutoAdvance {
  const reduced = useReducedMotion();
  const [{ index, elapsed }, setSlide] = useState({ index: initialIndex, elapsed: initialElapsed });
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [held, setHeld] = useState(false);
  const hover = useRef(false);
  const focus = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? false), { threshold });
    observer.observe(root);
    const sync = () => setHeld(hover.current || focus.current);
    const enter = () => ((hover.current = true), sync());
    const leave = () => ((hover.current = false), sync());
    const focusIn = () => ((focus.current = true), sync());
    const focusOut = (e: FocusEvent) => ((focus.current = root.contains(e.relatedTarget as Node | null)), sync());
    if (holdOnInteract) {
      root.addEventListener("pointerenter", enter);
      root.addEventListener("pointerleave", leave);
      root.addEventListener("focusin", focusIn);
      root.addEventListener("focusout", focusOut);
    }
    return () => {
      observer.disconnect();
      root.removeEventListener("pointerenter", enter);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
    };
  }, [rootRef, holdOnInteract, threshold]);

  useEffect(() => {
    const update = () => setTabVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const playing = !reduced && !paused && visible && tabVisible && !held;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const step = Math.min(now - last, 250);
      last = now;
      setSlide((s) => (s.elapsed + step >= duration ? { index: (s.index + 1) % count, elapsed: 0 } : { index: s.index, elapsed: s.elapsed + step }));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, duration, count]);

  const go = useCallback((next: number) => setSlide({ index: ((next % count) + count) % count, elapsed: 0 }), [count]);
  const togglePause = useCallback(() => setPaused((p) => !p), []);

  return { index, elapsed, paused, playing, reduced, go, togglePause };
}
