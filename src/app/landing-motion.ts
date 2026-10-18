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
  /** Time spent on the current slide while playing, in ms; kept current only with `tick`. */
  elapsed: number;
  /** The current slide was picked by the visitor (a button), not by the clock: announce it. */
  manual: boolean;
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
 *
 * Without `tick` the clock is one timeout for the slide's remaining time, so the section does
 * not re-render while a slide shows. With `tick` (the research stage, whose phases read the
 * time) `elapsed` updates every TICK_MS. A slide picked while the clock is stopped opens at
 * `settledElapsed`, so a paused visitor sees it finished rather than frozen at its start.
 */
export function useAutoAdvance({
  count,
  duration,
  rootRef,
  initialIndex = 0,
  initialElapsed = 0,
  holdOnInteract = true,
  threshold = 0.2,
  tick = false,
  settledElapsed = 0,
}: {
  count: number;
  duration: number;
  rootRef: RefObject<HTMLElement | null>;
  initialIndex?: number;
  initialElapsed?: number;
  holdOnInteract?: boolean;
  threshold?: number;
  tick?: boolean;
  settledElapsed?: number;
}): AutoAdvance {
  const reduced = useReducedMotion();
  const [{ index, elapsed, manual }, setSlide] = useState({ index: initialIndex, elapsed: initialElapsed, manual: false });
  /** Time already spent on the slide before the current run (timeout mode). */
  const spent = useRef(initialElapsed);
  /** Bumped on every manual pick, so a stopped run does not write over the new slide's time. */
  const generation = useRef(0);
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

  // Tick mode: the time is state, for a section that draws from it.
  useEffect(() => {
    if (!playing || !tick) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const step = Math.min(now - last, 250);
      last = now;
      setSlide((s) =>
        s.elapsed + step >= duration
          ? { index: (s.index + 1) % count, elapsed: 0, manual: false }
          : { index: s.index, elapsed: s.elapsed + step, manual: s.manual },
      );
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, tick, duration, count]);

  // Timeout mode: one timer for the slide's remaining time; a stop keeps the time spent.
  useEffect(() => {
    if (!playing || tick) return;
    const gen = generation.current;
    const base = spent.current;
    const start = performance.now();
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      spent.current = 0;
      setSlide((s) => ({ index: (s.index + 1) % count, elapsed: 0, manual: false }));
    }, Math.max(0, duration - base));
    return () => {
      window.clearTimeout(timer);
      if (!fired && generation.current === gen) spent.current = Math.min(duration, base + performance.now() - start);
    };
  }, [playing, tick, duration, count, index]);

  const go = useCallback(
    (next: number) => {
      const at = playing ? 0 : settledElapsed;
      generation.current += 1;
      spent.current = at;
      setSlide({ index: ((next % count) + count) % count, elapsed: at, manual: true });
    },
    [count, playing, settledElapsed],
  );
  const togglePause = useCallback(() => setPaused((p) => !p), []);

  return { index, elapsed, manual, paused, playing, reduced, go, togglePause };
}

/**
 * A figure that counts up from 0 to `target` once `rootRef` scrolls into view (the homepage's
 * motion, shared with the market report's position split). The server renders the final figure,
 * so print, no-JS and reduced motion all show it as is; with reduced motion it never moves.
 */
export function useCountUp(target: number, rootRef: RefObject<HTMLElement | null>, duration = 700): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  useEffect(() => {
    const root = rootRef.current;
    const still =
      reduced || target <= 0 || !root || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let observer: IntersectionObserver | null = null;
    if (still) {
      frame = requestAnimationFrame(() => setValue(target));
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          observer?.disconnect();
          let start = 0;
          const step = (now: number) => {
            if (!start) start = now;
            const t = Math.min(1, (now - start) / duration);
            setValue(Math.round(target * (1 - (1 - t) ** 3)));
            if (t < 1) frame = requestAnimationFrame(step);
          };
          frame = requestAnimationFrame(step);
        },
        { threshold: 0.4 },
      );
      observer.observe(root);
    }
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, reduced, duration, rootRef]);
  return value;
}
