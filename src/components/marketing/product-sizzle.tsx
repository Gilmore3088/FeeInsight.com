"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FrameMedia, FramePlaceholder, type FrameVideo } from "./frame-media";
import { ProgressFill, useInViewChange, useReducedMotion } from "./motion";
import { ProductFrame } from "./product-frame";

export interface SizzleChapter {
  key: string;
  /** The tab label, e.g. "Every fee". */
  label: string;
  /** The composed scene. Its end state is its default style; motion only plays it in. */
  scene: ReactNode;
}

/** Each chapter's share of the 20-second run (brief 06 §4.2). */
export const CHAPTER_MS = 5000;
/**
 * The frame's floor per breakpoint. The active chapter sets the frame's height (the others sit
 * out of flow), so a short chapter never leaves the tallest one's empty space under it.
 */
export const SCENE_MIN_HEIGHT = "min-h-[25rem] sm:min-h-[30rem] lg:min-h-[32rem]";
/** Runs before the sizzle rests on its end frame with a Replay button. */
export const MAX_LOOPS = 3;

/**
 * ready: the composed end frame (the server render, and reduced motion);
 * playing / paused: the automatic run; chosen: a reader picked a chapter, the run stops;
 * rest: the run finished its loops, or a recorded tour was opened.
 */
type Mode = "ready" | "playing" | "paused" | "chosen" | "rest";

/**
 * The homepage product sizzle (site v3 brief 06 §4.1-4.2): the real components, fed by
 * live data, played chapter by chapter in a product window. It starts only when the frame
 * is on screen, runs at most MAX_LOOPS times, has a visible pause, and a chapter tab jumps
 * there and stops the run. Reduced motion, and the server render, show the composed end
 * frame (the last chapter) with nothing moving.
 */
export function ProductSizzle({
  label,
  chapters,
  video,
  placeholder,
  chapterMs = CHAPTER_MS,
  maxLoops = MAX_LOOPS,
  sceneClassName = SCENE_MIN_HEIGHT,
}: {
  label: string;
  chapters: SizzleChapter[];
  video?: FrameVideo | null;
  /** The caption of the tour's placeholder tile, shown by the chapter tabs while there is no clip. */
  placeholder?: string;
  chapterMs?: number;
  maxLoops?: number;
  /** The frame's floor per breakpoint; a taller chapter grows the frame, a shorter one keeps it. */
  sceneClassName?: string;
}) {
  const last = chapters.length - 1;
  const frameRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(last);
  const [mode, setMode] = useState<Mode>("ready");
  const [turn, setTurn] = useState(0);
  const loops = useRef(0);
  const remaining = useRef(chapterMs);
  const pausedByScroll = useRef(false);
  const started = useRef(false);

  const restart = useCallback(
    (index: number, next: Mode) => {
      remaining.current = chapterMs;
      setActive(index);
      setMode(next);
      setTurn((t) => t + 1);
    },
    [chapterMs],
  );

  const modeRef = useRef<Mode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Start from the first chapter the first time the frame comes into view; hold while it is
  // off screen and carry on when it comes back. Under reduced motion nothing is observed.
  useInViewChange(
    frameRef,
    (visible) => {
      const current = modeRef.current;
      if (visible && !started.current && current === "ready") {
        started.current = true;
        loops.current = 0;
        restart(0, "playing");
      } else if (visible && current === "paused" && pausedByScroll.current) {
        pausedByScroll.current = false;
        setMode("playing");
      } else if (!visible && current === "playing") {
        pausedByScroll.current = true;
        setMode("paused");
      }
    },
    { enabled: !reduced },
  );

  // One timer per chapter; pausing keeps what is left of it. Turning reduced motion on
  // mid-run stops the timer, so nothing advances on its own from then on.
  useEffect(() => {
    if (mode !== "playing" || reduced) return;
    const startedAt = Date.now();
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      remaining.current = chapterMs;
      if (active < last) {
        setActive(active + 1);
        setTurn((t) => t + 1);
        return;
      }
      loops.current += 1;
      if (loops.current >= maxLoops) {
        setMode("rest");
      } else {
        setActive(0);
        setTurn((t) => t + 1);
      }
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (!fired) remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [mode, turn, active, last, chapterMs, maxLoops, reduced]);

  const choose = (index: number) => {
    pausedByScroll.current = false;
    restart(index, "chosen");
  };

  const replay = () => {
    loops.current = 0;
    pausedByScroll.current = false;
    restart(0, "playing");
  };

  const running = !reduced && (mode === "playing" || mode === "paused");
  const motion = !reduced && (running || mode === "chosen");

  let control: ReactNode = null;
  if (!reduced) {
    const button = "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-0 px-3 text-[12px] font-semibold text-ink hover:border-ink";
    if (mode === "playing") {
      control = (
        <button type="button" className={button} onClick={() => setMode("paused")} aria-label="Pause the product tour">
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" />
          </svg>
          Pause
        </button>
      );
    } else if (mode === "paused") {
      control = (
        <button
          type="button"
          className={button}
          onClick={() => {
            pausedByScroll.current = false;
            setMode("playing");
          }}
          aria-label="Play the product tour"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
          </svg>
          Play
        </button>
      );
    } else {
      control = (
        <button type="button" className={button} onClick={replay} aria-label="Replay the product tour">
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <path d="M6 2a4 4 0 1 1-3.6 2.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M1.5 1.5v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Replay
        </button>
      );
    }
  }

  return (
    <div
      ref={frameRef}
      className="fi-sizzle"
      data-motion={motion ? "on" : "off"}
      data-paused={mode === "paused" ? "true" : "false"}
      data-mode={mode}
    >
      <ProductFrame label={label} aside={control} className="fi-window-hero">
        <FrameMedia video={video} onOpen={() => setMode("rest")}>
          <div className={`relative flex flex-col ${sceneClassName}`}>
            {chapters.map((chapter, i) => {
              const on = i === active;
              return (
                <div
                  key={on ? `${chapter.key}-${turn}` : chapter.key}
                  id={`sizzle-${chapter.key}`}
                  role="region"
                  aria-label={chapter.label}
                  aria-hidden={!on}
                  inert={!on}
                  data-active={on ? "true" : "false"}
                  className={`fi-sizzle-scene flex flex-col [&>*]:flex-1 transition-opacity duration-500 motion-reduce:transition-none ${
                    on ? "relative flex-1 opacity-100" : "pointer-events-none invisible absolute inset-x-0 top-0 opacity-0"
                  }`}
                >
                  {chapter.scene}
                </div>
              );
            })}
          </div>
        </FrameMedia>
      </ProductFrame>
      <div className="mt-4 flex flex-col items-center gap-4 lg:flex-row lg:justify-center lg:gap-6">
        <div
          role="group"
          aria-label="Chapters"
          className="grid w-full max-w-xl grid-cols-2 gap-1.5 rounded-2xl border border-border bg-surface-0/70 p-1.5 sm:flex sm:rounded-full"
        >
          {chapters.map((chapter, i) => {
            const on = i === active;
            return (
              <button
                key={chapter.key}
                type="button"
                onClick={() => choose(i)}
                aria-pressed={on}
                aria-controls={`sizzle-${chapter.key}`}
                className={`relative flex min-h-10 flex-1 items-center justify-center overflow-hidden rounded-full px-3 text-[13px] font-semibold transition-colors motion-reduce:transition-none ${
                  on ? "bg-ink text-on-ink" : "text-ink-soft hover:bg-surface-200"
                }`}
              >
                {chapter.label}
                {on && running ? (
                  <span className="absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full bg-on-ink/25">
                    <ProgressFill
                      key={turn}
                      filling
                      durationMs={chapterMs}
                      paused={mode === "paused"}
                      className="bg-on-ink"
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {placeholder && !video?.src ? <FramePlaceholder caption={placeholder} className="max-w-[11.5rem] sm:max-w-[15rem] lg:w-48" /> : null}
      </div>
    </div>
  );
}
