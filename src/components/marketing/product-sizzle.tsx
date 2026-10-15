"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import type { FrameVideo } from "./frame-media";
import { ProgressFill, useInViewChange, useReducedMotion } from "./motion";
import { ProductFrame } from "./product-frame";

export interface SizzleChapter {
  key: string;
  /** The chapter's name for screen readers, e.g. "Every fee". */
  label: string;
  /** What the chapter shows, in plain words, set in the frame's title bar while it plays. */
  caption: string;
  /** The composed scene. Its end state is its default style; motion only plays it in. */
  scene: ReactNode;
}

/** Each chapter's share of the run (brief 06 §4.2, with time to read each end state). */
export const CHAPTER_MS = 6000;
/** Runs before the demo rests on its last chapter with a Replay button. */
export const MAX_LOOPS = 3;
/** The share of the frame that must be on screen to start: its top edge on a phone's first screen. */
const START_THRESHOLD = 0.1;

/**
 * ready: nothing has played yet (the server render, reduced motion, a clip waiting for Play);
 * playing / paused: the run; rest: the run finished its loops.
 */
type Mode = "ready" | "playing" | "paused" | "rest";

const BUTTON =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full border border-border bg-surface-0 px-2.5 text-[12px] font-semibold text-ink hover:border-ink sm:px-3";

/**
 * Where each chapter starts in a recorded clip, in seconds: the clip's own marks, or equal
 * parts of its length.
 */
function chapterStarts(video: FrameVideo | null | undefined, count: number, duration: number): number[] {
  if (video?.chapters && video.chapters.length === count) return video.chapters;
  const part = duration > 0 ? duration / count : 0;
  return Array.from({ length: count }, (_, i) => i * part);
}

/**
 * The homepage product demo (site v3 brief 06 §4.1-4.2): one frame that plays the real
 * components, fed by live data, chapter by chapter, and plays the recorded tour in the same
 * frame once a clip exists. A segmented bar at the top of the frame shows where the run is;
 * each segment jumps to its chapter. The title bar names what is happening. It starts when
 * the frame comes on screen, holds while a mouse is over the scene or a keyboard is on the
 * segments, pauses on a tap or the visible Pause button, and rests after MAX_LOOPS runs.
 * Reduced motion, and the server render, show each chapter's end state with nothing moving
 * and nothing advancing on its own.
 */
export function ProductSizzle({
  label,
  chapters,
  video,
  chapterMs = CHAPTER_MS,
  maxLoops = MAX_LOOPS,
  sceneClassName = "",
}: {
  /** The workspace's name, shown before the caption on wider screens. */
  label: string;
  chapters: SizzleChapter[];
  /** A recorded tour. With one, the frame plays it in place of the coded chapters. */
  video?: FrameVideo | null;
  chapterMs?: number;
  maxLoops?: number;
  /** Extra classes on the scene area, e.g. a floor height. */
  sceneClassName?: string;
}) {
  const last = chapters.length - 1;
  const hasVideo = Boolean(video?.src);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>("ready");
  const [turn, setTurn] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [clipShare, setClipShare] = useState(0);
  const loops = useRef(0);
  const remaining = useRef(chapterMs);
  // Set when a jump or replay starts a chapter afresh, so the old timer's cleanup does not
  // take the old chapter's elapsed time off the new chapter's full run.
  const resetting = useRef(false);
  const pausedByScroll = useRef(false);
  const started = useRef(false);
  const held = hovered || focused;

  const restart = useCallback(
    (index: number, next: Mode) => {
      remaining.current = chapterMs;
      resetting.current = true;
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

  // Start the first time the frame comes into view; hold while it is off screen and carry on
  // when it comes back. Under reduced motion nothing is observed and nothing starts.
  useInViewChange(
    rootRef,
    (visible) => {
      const current = modeRef.current;
      if (visible && !started.current && current === "ready") {
        started.current = true;
        loops.current = 0;
        if (hasVideo) setMode("playing");
        else restart(0, "playing");
      } else if (visible && current === "paused" && pausedByScroll.current) {
        pausedByScroll.current = false;
        setMode("playing");
      } else if (!visible && current === "playing") {
        pausedByScroll.current = true;
        setMode("paused");
      }
    },
    { enabled: !reduced, threshold: START_THRESHOLD },
  );

  // The coded run: one timer per chapter; a pause or a hold keeps what is left of it. Turning
  // reduced motion on mid-run stops the timer, so nothing advances on its own from then on.
  useEffect(() => {
    resetting.current = false;
    if (hasVideo || mode !== "playing" || held || reduced) return;
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
      if (!fired && !resetting.current) remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [hasVideo, mode, held, turn, active, last, chapterMs, maxLoops, reduced]);

  // The recorded run: the clip plays while the coded run would, and stops when it would.
  useEffect(() => {
    const clip = videoRef.current;
    if (!hasVideo || !clip) return;
    if (mode === "playing" && !held) {
      const played = clip.play?.();
      if (played && typeof played.catch === "function") played.catch(() => setMode("paused"));
    } else {
      clip.pause?.();
    }
  }, [hasVideo, mode, held]);

  const onClipTime = () => {
    const clip = videoRef.current;
    if (!clip) return;
    const starts = chapterStarts(video, chapters.length, clip.duration || 0);
    let index = 0;
    for (let i = 0; i < starts.length; i += 1) if (clip.currentTime >= starts[i]) index = i;
    const end = index < last ? starts[index + 1] : clip.duration || starts[index];
    const span = end - starts[index];
    setActive(index);
    setClipShare(span > 0 ? Math.min(1, (clip.currentTime - starts[index]) / span) : 0);
  };

  const onClipEnded = () => {
    const clip = videoRef.current;
    loops.current += 1;
    if (clip && loops.current < maxLoops) {
      clip.currentTime = 0;
      void clip.play?.()?.catch?.(() => setMode("paused"));
    } else {
      setMode("rest");
    }
  };

  const jump = (index: number) => {
    pausedByScroll.current = false;
    started.current = true;
    if (hasVideo) {
      const clip = videoRef.current;
      if (clip) clip.currentTime = chapterStarts(video, chapters.length, clip.duration || 0)[index] ?? 0;
      setActive(index);
      setClipShare(0);
      if (mode === "rest") setMode("paused");
      return;
    }
    if (reduced) {
      setActive(index);
      return;
    }
    if (mode === "playing" || mode === "paused") {
      restart(index, mode);
      return;
    }
    // From the rest frame (or before the run), play on from that chapter to the end once.
    loops.current = maxLoops - 1;
    restart(index, "playing");
  };

  const replay = () => {
    loops.current = 0;
    pausedByScroll.current = false;
    started.current = true;
    if (hasVideo) {
      const clip = videoRef.current;
      if (clip) clip.currentTime = 0;
      setActive(0);
      setMode("playing");
      return;
    }
    restart(0, "playing");
  };

  const toggle = () => {
    pausedByScroll.current = false;
    started.current = true;
    if (mode === "playing") setMode("paused");
    else if (mode === "paused" || mode === "ready") {
      if (!hasVideo && mode === "ready") restart(active, "playing");
      else setMode("playing");
    }
  };

  // A mouse over the scene holds the run while the reader looks; a tap pauses or plays it.
  const onStageEnter = (event: PointerEvent) => {
    if (event.pointerType === "mouse") setHovered(true);
  };
  const onStageLeave = (event: PointerEvent) => {
    if (event.pointerType === "mouse") setHovered(false);
  };
  const onStageTap = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    if (mode === "playing" || mode === "paused") toggle();
  };
  // A keyboard on the segments holds the run, so a chapter does not move on under the reader.
  // Only keyboard focus holds it: a click also focuses the segment, and must not stop the run.
  const onSegmentsFocus = (event: FocusEvent<HTMLDivElement>) => {
    let keyboard = true;
    try {
      keyboard = (event.target as HTMLElement).matches(":focus-visible");
    } catch {
      // A browser without :focus-visible holds on any focus.
    }
    if (keyboard) setFocused(true);
  };
  const onSegmentsBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  const running = mode === "playing" || mode === "paused";
  const paused = mode === "paused" || (mode === "playing" && held);
  const timed = !hasVideo && !reduced && running;
  const motion = timed;
  const n = chapters.length;

  let control: ReactNode = null;
  if (!reduced || hasVideo) {
    const icon = (path: ReactNode) => (
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
        {path}
      </svg>
    );
    if (mode === "playing") {
      control = (
        <button type="button" className={BUTTON} onClick={toggle} aria-label="Pause the product demo">
          {icon(<path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" />)}
          <span className="hidden sm:inline">Pause</span>
        </button>
      );
    } else if (mode === "paused" || mode === "ready") {
      control = (
        <button type="button" className={BUTTON} onClick={toggle} aria-label="Play the product demo">
          {icon(<path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />)}
          <span className="hidden sm:inline">Play</span>
        </button>
      );
    } else {
      control = (
        <button type="button" className={BUTTON} onClick={replay} aria-label="Replay the product demo">
          {icon(
            <>
              <path d="M6 2a4 4 0 1 1-3.6 2.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M1.5 1.5v3.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </>,
          )}
          <span className="hidden sm:inline">Replay</span>
        </button>
      );
    }
  }

  const caption = (
    <>
      <span className="hidden font-medium text-ink-muted sm:inline">{label} · </span>
      <span key={`${active}-${turn}`} className="fi-sizzle-caption" data-caption="">
        {chapters[active]?.caption}
      </span>
    </>
  );

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Product demo"
      className="fi-sizzle"
      data-motion={motion ? "on" : "off"}
      data-paused={paused ? "true" : "false"}
      data-held={held ? "true" : "false"}
      data-mode={mode}
    >
      <ProductFrame label={caption} aside={control} className="fi-window-hero">
        {/* Story segments: one per chapter, filling as it plays; each one jumps there. */}
        <div
          role="group"
          aria-label="Demo progress"
          data-segments=""
          className="flex gap-1.5 border-b border-border bg-paper/40 px-3 sm:gap-2 sm:px-4"
          onFocus={onSegmentsFocus}
          onBlur={onSegmentsBlur}
        >
          {chapters.map((chapter, i) => {
            const current = i === active;
            const done = mode === "rest" || i < active;
            let fill: ReactNode = null;
            if (current && timed) {
              fill = <ProgressFill key={turn} filling durationMs={chapterMs} paused={paused} className="bg-ink" />;
            } else if (current && hasVideo && mode !== "rest") {
              fill = <span aria-hidden className="block h-full bg-ink" style={{ width: `${clipShare * 100}%` }} />;
            } else if (current || done) {
              fill = <span aria-hidden className="block h-full bg-ink" />;
            }
            return (
              <button
                key={chapter.key}
                type="button"
                onClick={() => jump(i)}
                aria-label={`${chapter.label}, part ${i + 1} of ${n}`}
                aria-current={current ? "step" : undefined}
                aria-controls={`sizzle-${chapter.key}`}
                data-segment={current ? "current" : done ? "done" : "todo"}
                className="group flex h-7 min-w-0 flex-1 items-center"
              >
                <span className="block h-[3px] w-full overflow-hidden rounded-full bg-ink/15 transition-colors group-hover:bg-ink/30 motion-reduce:transition-none">
                  {fill}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="relative"
          data-stage=""
          onPointerEnter={onStageEnter}
          onPointerLeave={onStageLeave}
          onPointerUp={onStageTap}
        >
          {/* Every chapter sits in the same grid cell, so the frame keeps the tallest one's
              height and the page under it never moves as the chapters change. */}
          <div className={`grid ${sceneClassName}`}>
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
                  className={`fi-sizzle-scene flex min-w-0 flex-col [grid-area:1/1] [&>*]:flex-1 transition-opacity duration-500 motion-reduce:transition-none ${
                    on ? "opacity-100" : "pointer-events-none invisible opacity-0"
                  }`}
                >
                  {chapter.scene}
                </div>
              );
            })}
          </div>
          {hasVideo && video ? (
            // The clip plays in the same frame at the same size. Until its first frame loads,
            // the first chapter shows through it as the poster.
            <video
              ref={videoRef}
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              src={video.src}
              poster={video.poster}
              muted
              playsInline
              preload="metadata"
              onTimeUpdate={onClipTime}
              onLoadedMetadata={onClipTime}
              onEnded={onClipEnded}
            />
          ) : null}
        </div>
      </ProductFrame>
    </div>
  );
}
