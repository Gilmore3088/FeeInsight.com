"use client";

import { Bell, ChartNoAxesColumnIncreasing, ChartNoAxesCombined, FileText } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { SlideControls } from "./landing-controls";
import { useAutoAdvance } from "./landing-motion";

export interface HamiltonSlide {
  key: "benchmark" | "analyze" | "monitor" | "report";
  /** The card's name: "Benchmark". */
  name: string;
  /** The card's one line. */
  line: string;
  /** The frame's heading while this slide shows: "Analyze your options". */
  heading: string;
  body: ReactNode;
}

const ICONS = {
  benchmark: ChartNoAxesColumnIncreasing,
  analyze: ChartNoAxesCombined,
  monitor: Bell,
  report: FileText,
} as const;

/** How long a slide shows before the next, in ms (the example's 8.5 s). */
const SLIDE_MS = 8500;
/** The band opens on Analyze, as James's example does. */
const FIRST = 1;

/**
 * Hamilton's four examples in one frame, with the four cards under it: the frame turns to the
 * next example on its own, the cards and arrows pick one, and the pause button stops it. It also
 * holds while the pointer or focus is in the band, while the band is off screen or the tab is
 * hidden, and always with reduced motion. No timer or progress bar is drawn (James, Oct 17).
 */
export function HamiltonCarousel({ intro, slides }: { intro: ReactNode; slides: HamiltonSlide[] }) {
  const root = useRef<HTMLDivElement>(null);
  const clock = useAutoAdvance({ count: slides.length, duration: SLIDE_MS, rootRef: root, initialIndex: Math.min(FIRST, slides.length - 1) });
  const active = slides[clock.index];
  return (
    <div ref={root}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
        <div className="fi-home-intro min-w-0 lg:pt-8">{intro}</div>
        <div className="min-w-0" role="region" aria-roledescription="carousel" aria-label="Hamilton examples">
          <div className="rounded-[10px] border border-border bg-surface-0 p-4 shadow-[0_6px_24px_rgb(23_42_59/0.03)] sm:p-5">
            <p className="mb-3 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[22px]" aria-live={clock.manual ? "polite" : "off"}>
              {active.heading}
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
            <SlideControls clock={clock} count={slides.length} name="Hamilton examples" />
          </div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4 lg:grid-cols-4" role="group" aria-label="Choose a Hamilton example">
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
              className={`group flex min-h-[10.5rem] flex-col items-start rounded-[8px] border p-4 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 sm:min-h-[12.5rem] sm:p-6 ${
                on ? "border-brick/60 bg-brick-tint" : "border-border bg-surface-0 hover:border-ink-muted/50"
              }`}
              data-hamilton-card={slide.key}
            >
              <Icon aria-hidden="true" strokeWidth={1.4} className="size-7 text-brick sm:size-9" />
              <span className={`mt-3 text-[20px] font-semibold leading-none tracking-[-0.025em] sm:mt-4 sm:text-[26px] ${on ? "text-brick-ink" : "text-ink"}`}>
                {slide.name}
              </span>
              <span className="mt-2 max-w-[13rem] text-[13px] leading-snug text-ink-muted sm:text-[14px]">{slide.line}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
