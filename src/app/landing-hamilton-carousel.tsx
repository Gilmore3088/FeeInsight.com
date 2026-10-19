"use client";

import { Bell, ChartNoAxesColumnIncreasing, ChartNoAxesCombined, FileText } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { SlideControls } from "./landing-controls";
import { useAutoAdvance, type AutoAdvance } from "./landing-motion";

export interface HamiltonSlide {
  key: "benchmark" | "analyze" | "monitor" | "report";
  /** The card's name: "Benchmark". */
  name: string;
  body: ReactNode;
}

const ICONS = {
  benchmark: ChartNoAxesColumnIncreasing,
  analyze: ChartNoAxesCombined,
  monitor: Bell,
  report: FileText,
} as const;

/** How long a stage shows before the next, in ms (the example's 8.5 s). */
const SLIDE_MS = 8500;

/**
 * Hamilton's four stages of one investigation in one frame, with four one-line cards under it.
 * It opens on the first stage (Benchmark) and reads in order. The frame turns to the next stage on
 * its own until the visitor pauses it or picks a stage (a card or an arrow), which pauses it too: a
 * chosen stage stays until the visitor presses play. It also holds while the pointer or focus is in
 * the band, while the band is off screen or the tab is hidden, and always with reduced motion,
 * where the cards and arrows still reach every stage. No timer or progress bar is drawn (James, Oct 17).
 * `subject` names the sample institution once, above every stage.
 */
export function HamiltonCarousel({ intro, slides, subject = null }: { intro: ReactNode; slides: HamiltonSlide[]; subject?: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const auto = useAutoAdvance({ count: slides.length, duration: SLIDE_MS, rootRef: root });
  // A stage the visitor picks stays: the pick also pauses the clock (the play button resumes it).
  const clock: AutoAdvance = {
    ...auto,
    go: (i: number) => {
      auto.go(i);
      if (!auto.paused && !auto.reduced) auto.togglePause();
    },
  };
  const active = slides[clock.index];
  return (
    <div ref={root}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
        <div className="fi-home-intro min-w-0 lg:pt-8">{intro}</div>
        <div className="min-w-0" role="region" aria-roledescription="carousel" aria-label="Hamilton investigation">
          <div className="rounded-[10px] border border-border bg-surface-0 p-4 shadow-[0_6px_24px_rgb(23_42_59/0.03)] sm:p-5">
            {subject ? (
              <p className="mb-3 text-[12px] text-ink-muted" data-hamilton-subject>
                {subject}
              </p>
            ) : null}
            {/* The slide's own question heads it; a visitor's move is announced by name. */}
            <p className="sr-only" aria-live={clock.manual ? "polite" : "off"}>
              {active.name}
            </p>
            <div className="fi-home-stack">
              {slides.map((slide, i) => (
                <div
                  key={slide.key}
                  id={`hamilton-slide-${slide.key}`}
                  className="fi-home-slide min-w-0 rounded-[7px] border border-border bg-paper/40 p-4 sm:p-6"
                  data-active={i === clock.index}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${slides.length}: ${slide.name}`}
                  aria-hidden={i !== clock.index}
                  inert={i !== clock.index}
                  data-hamilton-slide={slide.key}
                >
                  {slide.body}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex justify-center">
            <SlideControls clock={clock} count={slides.length} name="Hamilton investigation" />
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:gap-3 lg:grid-cols-4" role="group" aria-label="Choose a stage">
        {slides.map((slide, i) => {
          const Icon = ICONS[slide.key];
          const on = i === clock.index;
          return (
            <button
              key={slide.key}
              type="button"
              onClick={() => clock.go(i)}
              aria-pressed={on}
              aria-controls={`hamilton-slide-${slide.key}`}
              className={`group flex min-h-11 items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-left transition-[border-color,background-color] duration-200 sm:px-4 sm:py-3 ${
                on ? "border-brick/60 bg-brick-tint" : "border-border bg-surface-0 hover:border-ink-muted/50"
              }`}
              data-hamilton-card={slide.key}
            >
              <Icon aria-hidden="true" strokeWidth={1.5} className="size-5 shrink-0 text-brick" />
              <span className={`text-[16px] font-semibold leading-none tracking-[-0.015em] sm:text-[18px] ${on ? "text-brick-ink" : "text-ink"}`}>
                {slide.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
