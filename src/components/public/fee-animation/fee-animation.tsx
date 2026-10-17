"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SceneDiagram } from "./scene-diagram";
import { TICK_MS, sceneLengthMs, sceneSeconds, stepIndexAt, stepStarts } from "./timeline";
import type { FeeScene, FeeSceneAction } from "./types";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const media = typeof window !== "undefined" ? window.matchMedia?.(REDUCED_QUERY) : undefined;
  if (!media) return () => {};
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the reader has asked for less motion. The server render assumes motion is fine. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia?.(REDUCED_QUERY).matches ?? false,
    () => false,
  );
}

type Mode = "poster" | "playing" | "paused" | "ended" | "stepping";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-paper hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-ink bg-surface-0 px-5 text-[15px] font-semibold text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

/**
 * A fee scene the reader plays. It opens on the finished diagram, still, with a play button
 * that states the scene's real length. Captions are always on screen and announced. Under
 * reduced motion the same steps show one at a time, with previous and next buttons.
 */
export function FeeAnimation({ scene, actions }: { scene: FeeScene; actions: FeeSceneAction[] }) {
  const reduced = useReducedMotion();
  const length = sceneLengthMs(scene);
  const seconds = sceneSeconds(scene);
  const starts = stepStarts(scene);
  const last = scene.steps.length - 1;

  const [mode, setMode] = useState<Mode>("poster");
  const [ms, setMs] = useState(0);
  const [run, setRun] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const msRef = useRef(0);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const replayRef = useRef<HTMLButtonElement>(null);
  /** Set when Replay had focus as the scene ended, so focus moves to the button that remains. */
  const refocus = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (mode !== "playing") return;
    const id = window.setInterval(() => {
      const next = Math.min(msRef.current + TICK_MS, length);
      msRef.current = next;
      setMs(next);
      if (next >= length) {
        refocus.current = replayRef.current !== null && document.activeElement === replayRef.current;
        setMode("ended");
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [mode, length]);

  useEffect(() => {
    if (mode === "ended" && refocus.current) {
      refocus.current = false;
      primaryRef.current?.focus({ preventScroll: true });
    }
  }, [mode]);

  function start() {
    msRef.current = 0;
    setMs(0);
    setRun((r) => r + 1);
    setMode("playing");
  }

  function primary() {
    if (mode === "poster") {
      if (reduced) {
        setStepIdx(0);
        setMode("stepping");
      } else start();
    } else if (mode === "playing") setMode("paused");
    else if (mode === "paused") setMode("playing");
    else if (mode === "ended") start();
    else setStepIdx((i) => (i >= last ? 0 : i + 1));
  }

  const playIdx = stepIndexAt(scene, ms);
  let frameView: { key: string; idx: number; elapsed: number; motion: boolean };
  if (mode === "poster") frameView = { key: "poster", idx: last, elapsed: Infinity, motion: false };
  else if (mode === "stepping") frameView = { key: "steps", idx: stepIdx, elapsed: Infinity, motion: false };
  else frameView = { key: `run-${run}`, idx: playIdx, elapsed: ms - starts[playIdx], motion: true };

  const step = scene.steps[frameView.idx];
  const caption = mode === "poster" ? scene.takeaway : step.caption;
  const endFrame = mode === "ended" || (mode === "stepping" && stepIdx === last);

  const primaryLabel: Record<Mode, string> = {
    poster: reduced ? "See it step by step" : `Watch: ${seconds} seconds`,
    playing: "Pause",
    paused: "Resume",
    ended: "Replay",
    stepping: stepIdx >= last ? "Start again" : "Next",
  };
  const primaryIcon: Record<Mode, ReactNode> = {
    poster: <Play className="h-4 w-4" aria-hidden="true" />,
    playing: <Pause className="h-4 w-4" aria-hidden="true" />,
    paused: <Play className="h-4 w-4" aria-hidden="true" />,
    ended: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
    stepping: stepIdx >= last ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />,
  };

  // Keys keep the primary button the same element in every mode, so focus stays on it.
  const controls: ReactNode[] = [];
  if (mode === "stepping") {
    controls.push(
      <button
        key="prev"
        type="button"
        className={SECONDARY}
        aria-disabled={stepIdx === 0}
        onClick={() => {
          if (stepIdx > 0) setStepIdx(stepIdx - 1);
        }}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Previous
      </button>,
    );
  }
  controls.push(
    <button
      key="primary"
      ref={primaryRef}
      type="button"
      className={mode === "poster" ? PRIMARY : SECONDARY}
      aria-describedby={mode === "poster" ? titleId : undefined}
      onClick={primary}
    >
      {primaryIcon[mode]}
      {primaryLabel[mode]}
    </button>,
  );
  if (mode === "playing" || mode === "paused") {
    controls.push(
      <button key="replay" ref={replayRef} type="button" className={SECONDARY} onClick={start}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Replay
      </button>,
    );
  }

  return (
    <figure
      aria-labelledby={titleId}
      className="mt-6 w-full min-w-0 max-w-xl overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-1"
      data-scene={scene.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <p id={titleId} className="mx-0 text-left text-[15px] font-semibold text-ink">
          {scene.title}
        </p>
        <span className="rounded-full border border-border bg-paper px-2.5 py-0.5 text-[12px] font-medium text-ink-muted">
          Illustrative amounts
        </span>
      </div>

      <div className="px-3 pt-3 sm:px-5">
        <div className="mx-auto max-w-[440px]">
          <SceneDiagram
            key={frameView.key}
            scene={scene}
            frame={step.frame}
            elapsedMs={frameView.elapsed}
            motion={frameView.motion}
          />
        </div>
        <p className="sr-only">
          {scene.describe} Illustrative amounts, not any institution&apos;s prices.
        </p>
      </div>

      {/* Every caption shares one grid cell, so the box keeps the tallest one's height. */}
      <div className="grid px-4 pt-3 text-center text-[19px] font-semibold leading-snug text-ink sm:px-5">
        {[scene.takeaway, ...scene.steps.map((st) => st.caption)].map((text, i) => (
          <p key={i} aria-hidden="true" className="invisible col-start-1 row-start-1 mx-auto">
            {text}
          </p>
        ))}
        <p
          aria-live="polite"
          aria-atomic="true"
          data-testid="fee-animation-caption"
          className="col-start-1 row-start-1 mx-auto self-center"
        >
          {caption}
        </p>
      </div>

      {mode === "stepping" ? (
        <p className="mt-1 text-center text-[13px] text-ink-muted">
          Step {stepIdx + 1} of {scene.steps.length}
        </p>
      ) : mode !== "poster" ? (
        <div className="mx-auto mt-2 flex w-full max-w-[440px] gap-1 px-4" aria-hidden="true">
          {scene.steps.map((s, i) => {
            const done = Math.min(1, Math.max(0, (ms - starts[i]) / s.durationMs));
            return (
              <div key={s.id} className="h-1 overflow-hidden rounded-full bg-surface-200" style={{ flexGrow: s.durationMs }}>
                <div className="h-full bg-brick" style={{ width: `${done * 100}%` }} />
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-4 pt-3">{controls}</div>

      {endFrame && (
        <div className="border-t border-border px-4 py-4 sm:px-5" data-testid="fee-animation-end">
          <p className="text-center text-[14px] leading-relaxed text-ink-soft">{scene.takeaway}</p>
          <div className="mt-3 flex flex-col items-stretch justify-center gap-2 sm:flex-row">
            {actions.map((a, i) => {
              const className = i === 0 ? PRIMARY : SECONDARY;
              return a.href.startsWith("#") ? (
                <a key={a.href} href={a.href} className={className}>
                  {a.label}
                </a>
              ) : (
                <Link key={a.href} href={a.href} className={className}>
                  {a.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </figure>
  );
}
