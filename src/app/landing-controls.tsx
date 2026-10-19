"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import type { AutoAdvance } from "./landing-motion";

const two = (n: number) => String(n).padStart(2, "0");

/**
 * Pause, previous, the slide counter and next: buttons a keyboard reaches in that order. The
 * pause button is left out with reduced motion, where nothing advances on its own.
 */
export function SlideControls({
  clock,
  count,
  name,
  small = false,
  children,
}: {
  clock: AutoAdvance;
  count: number;
  /** What the slides are, for the buttons' names: "Hamilton investigation". */
  name: string;
  small?: boolean;
  children?: ReactNode;
}) {
  const round = small ? "size-8" : "size-9";
  const icon = small ? "size-3.5" : "size-4";
  return (
    <div className="flex items-center gap-2" data-slide-controls="">
      {clock.reduced ? null : (
        <button
          type="button"
          onClick={clock.togglePause}
          // One fixed name; the pressed state says whether it is paused.
          aria-label={`Pause ${name}`}
          aria-pressed={clock.paused}
          title={clock.paused ? "Play" : "Pause"}
          className={`${round} inline-flex items-center justify-center rounded-full border border-control-border text-ink transition-colors hover:bg-surface-0`}
        >
          {clock.paused ? <Play aria-hidden="true" className={icon} /> : <Pause aria-hidden="true" className={icon} />}
        </button>
      )}
      <button
        type="button"
        onClick={() => clock.go(clock.index - 1)}
        aria-label={`Previous: ${name}`}
        className="inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-surface-0"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <span className="min-w-[3.25rem] text-center font-mono text-[12px] font-medium tabular-nums text-ink"
        // Announced when the visitor moves a slide, not on every automatic turn.
        aria-live={clock.manual ? "polite" : "off"}
        aria-atomic="true"
      >
        <span className="sr-only">Slide </span>
        {two(clock.index + 1)} / {two(count)}
      </span>
      <button
        type="button"
        onClick={() => clock.go(clock.index + 1)}
        aria-label={`Next: ${name}`}
        className="inline-flex size-9 items-center justify-center rounded-full text-ink hover:bg-surface-0"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
      {children}
    </div>
  );
}
