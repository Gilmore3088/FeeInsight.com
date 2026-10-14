"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/app/subscribe/showcase";
import type { HomeData } from "../home-data";
import { ExampleTag } from "./scene-parts";
import { CollectScene, CostScene, IndexScene, MarketsScene } from "./scenes-data";
import { AskScene, ReportScene } from "./scenes-hamilton";
import styles from "./sizzle.module.css";
import {
  CHAPTERS,
  REST_SCENE_INDEX,
  SCENES,
  SIZZLE_TRANSCRIPT,
  firstSceneOf,
  nextScene,
  sceneDurationMs,
  type ChapterKey,
} from "./timeline";

const TRANSCRIPT_ID = "fee-sizzle-transcript";
/** Scenes are drawn on a fixed canvas and scaled to the frame, so they fill it at any desktop width. */
const CANVAS_W = 640;
const CANVAS_H = 330;
const MAX_SCALE = 1.6;
/** How much of the frame must be on screen before the sizzle starts. */
const IN_VIEW_RATIO = 0.4;

interface PlayState {
  index: number;
  playsDone: number;
  playing: boolean;
  /** Bumped on every scene change so each scene's animations restart. */
  run: number;
}

/**
 * The 20-second walk from the fee study by hand to the report Hamilton writes. The server
 * renders the rest frame (the poster); playback starts only when the frame is on screen,
 * never under reduced motion, stops after three plays, and stops for good when a reader
 * picks a chapter or presses pause.
 */
export function FeeSizzle({ data }: { data: HomeData }) {
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<PlayState>({ index: REST_SCENE_INDEX, playsDone: 0, playing: false, run: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const remainingRef = useRef(0);
  const sceneStartRef = useRef(0);
  const [measureStage, canvasScale] = useCanvasScale();

  const play = useCallback((index: number, playsDone: number) => {
    remainingRef.current = sceneDurationMs(index);
    sceneStartRef.current = Date.now();
    setState((prev) => ({ index, playsDone, playing: true, run: prev.run + 1 }));
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (reducedMotion || !frame || startedRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= IN_VIEW_RATIO && !startedRef.current) {
          startedRef.current = true;
          play(0, 0);
        }
      },
      { threshold: IN_VIEW_RATIO },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [reducedMotion, play]);

  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setTimeout(() => {
      const next = nextScene(state.index, state.playsDone);
      if (next) play(next.index, next.playsDone);
      else setState((prev) => ({ ...prev, playing: false }));
    }, remainingRef.current);
    sceneStartRef.current = Date.now();
    return () => window.clearTimeout(timer);
  }, [state.playing, state.index, state.playsDone, state.run, play]);

  const pause = () => {
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - sceneStartRef.current));
    setState((prev) => ({ ...prev, playing: false }));
  };

  const resume = () => {
    if (state.index === REST_SCENE_INDEX && !state.playing) {
      startedRef.current = true;
      play(0, 0);
      return;
    }
    setState((prev) => ({ ...prev, playing: true }));
  };

  const choose = (chapter: ChapterKey) => {
    startedRef.current = true;
    const index = firstSceneOf(chapter);
    remainingRef.current = sceneDurationMs(index);
    setState((prev) => ({ index, playsDone: prev.playsDone, playing: false, run: prev.run + 1 }));
  };

  const scene = SCENES[state.index];
  const atRest = !state.playing && state.index === REST_SCENE_INDEX;
  const frameClass = [styles.frame, state.playing ? "" : styles.paused, atRest || reducedMotion ? styles.still : ""].join(" ");

  return (
    <figure className="mx-auto grid w-full max-w-[1040px] gap-3 text-left">
      <div ref={frameRef} className={frameClass} aria-describedby={TRANSCRIPT_ID} role="img" aria-label="A 20-second walk through Fee Insight">
        <div className={styles.chrome} aria-hidden="true">
          <i />
          <i />
          <i />
          <span className={styles.chromeTitle}>feeinsight.com</span>
          {scene.example ? <span className={styles.example}><ExampleTag /></span> : null}
        </div>
        <p key={`c-${state.run}`} className={styles.caption} aria-hidden="true">
          {scene.caption}
        </p>
        <div ref={measureStage} className={styles.stage} style={canvasScale ? { height: CANVAS_H * canvasScale } : undefined} aria-hidden="true">
          <div
            key={`s-${state.run}`}
            className={canvasScale ? styles.canvas : styles.canvasNarrow}
            style={canvasScale ? { width: CANVAS_W, height: CANVAS_H, transform: `scale(${canvasScale})` } : undefined}
          >
            <SceneBody sceneKey={scene.key} data={data} settled={atRest} />
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chapters">
          {CHAPTERS.map((chapter) => (
            <button
              key={chapter.key}
              type="button"
              onClick={() => choose(chapter.key)}
              aria-pressed={scene.chapter === chapter.key}
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
                scene.chapter === chapter.key ? "bg-ink text-on-ink" : "bg-surface-0 text-ink hover:bg-surface-200"
              }`}
            >
              {chapter.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={state.playing ? pause : resume}
          className="rounded-md border border-control-border bg-surface-0 px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-200"
        >
          {state.playing ? "Pause" : atRest ? "Play" : "Resume"}
        </button>
      </figcaption>
      <details className="text-[13px] text-ink-muted">
        <summary className="cursor-pointer">Read the transcript</summary>
        <p id={TRANSCRIPT_ID} className="mt-2 max-w-[70ch]">
          {SIZZLE_TRANSCRIPT}
        </p>
      </details>
    </figure>
  );
}

/** Scale for the scene canvas: null below the canvas width, where scenes lay out at their natural size. */
function useCanvasScale(): [(node: HTMLDivElement | null) => void, number | null] {
  const [k, setK] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureStage = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      setK(width >= CANVAS_W ? Math.min(width / CANVAS_W, MAX_SCALE) : null);
    };
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(node);
    measure();
  }, []);
  return [measureStage, k];
}

function SceneBody({ sceneKey, data, settled }: { sceneKey: string; data: HomeData; settled: boolean }) {
  switch (sceneKey) {
    case "collect":
      return <CollectScene />;
    case "cost":
      return <CostScene />;
    case "index":
      return <IndexScene data={data} />;
    case "markets":
      return <MarketsScene fee={data.nationalFees.find((fee) => fee.key === "overdraft")} />;
    case "ask":
      return <AskScene />;
    default:
      return <ReportScene settled={settled || sceneKey === "done"} />;
  }
}
