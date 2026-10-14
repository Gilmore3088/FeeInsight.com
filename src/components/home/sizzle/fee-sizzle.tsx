"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "@/app/subscribe/showcase";
import type { NationalFee } from "../home-data";
import type { SampleStory } from "../sample-story";
import { AskScene, IndexScene, MarketsScene, OldWayScene, ReportScene } from "./scenes";
import { CLOCK_TICK_MS, REST_SCENE_INDEX, SCENES, SHOW_ALL, nextScene, sizzleTranscript } from "./timeline";

const TRANSCRIPT_ID = "fee-sizzle-transcript";
/** How much of the frame must be on screen before the sizzle starts. */
const IN_VIEW_RATIO = 0.5;

interface PlayState {
  index: number;
  playsDone: number;
  playing: boolean;
  /** Milliseconds into the current scene; SHOW_ALL when paused, picked or at rest. */
  t: number;
}

const REST: PlayState = { index: REST_SCENE_INDEX, playsDone: 0, playing: false, t: SHOW_ALL };

/**
 * The walk from the fee study by hand to the report Hamilton writes, on one clock. The server
 * renders the finished last scene; playback starts once the frame is half on screen, never
 * under reduced motion, plays twice at most, and stops when a reader pauses or picks a scene.
 * A stopped scene always shows all its parts.
 */
export function FeeSizzle({ sample, nation, footnote }: { sample: SampleStory; nation: NationalFee | undefined; footnote: string }) {
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<PlayState>(REST);
  const frameRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const playFrom = useCallback((index: number, playsDone: number) => {
    startedRef.current = true;
    setState({ index, playsDone, playing: true, t: 0 });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (reducedMotion || !frame || startedRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= IN_VIEW_RATIO && !startedRef.current) playFrom(0, 0);
      },
      { threshold: IN_VIEW_RATIO },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [reducedMotion, playFrom]);

  const { playing, index, playsDone } = state;
  useEffect(() => {
    if (!playing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const t = Date.now() - startedAt;
      if (t < SCENES[index].durationMs) {
        setState((prev) => (prev.playing && prev.index === index ? { ...prev, t } : prev));
        return;
      }
      window.clearInterval(timer);
      const next = nextScene(index, playsDone);
      setState(next ? { index: next.index, playsDone: next.playsDone, playing: true, t: 0 } : REST);
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, index, playsDone]);

  const pause = () => setState((prev) => ({ ...prev, playing: false, t: SHOW_ALL }));
  const play = () => playFrom(index === REST_SCENE_INDEX ? 0 : index, 0);
  const choose = (picked: number) => {
    startedRef.current = true;
    setState((prev) => ({ ...prev, index: picked, playing: false, t: SHOW_ALL }));
  };

  const scene = SCENES[index];
  const t = reducedMotion ? SHOW_ALL : state.t;

  return (
    <figure className="mx-auto grid w-full max-w-[1040px] gap-3 text-left">
      <div
        ref={frameRef}
        role="img"
        aria-label={`A short walk through Fee Insight, using the live sample report for ${sample.name}`}
        aria-describedby={TRANSCRIPT_ID}
        className="flex h-[480px] flex-col overflow-hidden rounded-xl border border-border bg-surface-0 shadow-fi-2 sm:h-[440px] lg:h-[470px]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-200 px-4 py-2.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-control-border/50" />
          <span className="h-2 w-2 rounded-full bg-control-border/50" />
          <span className="h-2 w-2 rounded-full bg-control-border/50" />
          <span className="ml-2 truncate font-mono text-[12px] text-ink-muted">Live sample · {sample.name}</span>
        </div>
        <div key={index} className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-700 motion-reduce:animate-none" aria-hidden="true">
          <p className="shrink-0 px-5 pb-2 pt-5 text-[clamp(18px,2.4vw,24px)] font-bold leading-tight tracking-[-0.015em] text-ink sm:px-6">
            {scene.caption}
          </p>
          <div className="min-h-0 flex-1 overflow-hidden px-5 pb-5 pt-2 sm:px-6">
            <SceneBody sceneKey={scene.key} sample={sample} nation={nation} footnote={footnote} t={t} />
          </div>
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scenes">
          {SCENES.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onClick={() => choose(i)}
              aria-pressed={i === index}
              className={`relative overflow-hidden rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200 ${
                i === index ? "bg-ink text-on-ink" : "bg-surface-0 text-ink hover:bg-surface-200"
              }`}
            >
              {item.label}
              {i === index && playing ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 h-0.5 bg-on-ink/60"
                  style={{ width: `${Math.min(100, (state.t / item.durationMs) * 100)}%` }}
                />
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={playing ? pause : play}
          className="rounded-md border border-control-border bg-surface-0 px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-200"
        >
          {playing ? "Pause" : "Play"}
        </button>
      </figcaption>
      <div className="flex flex-wrap items-baseline justify-between gap-3 text-[13px] text-ink-muted">
        <details>
          <summary className="cursor-pointer">Read the transcript</summary>
          <p id={TRANSCRIPT_ID} className="mt-2 max-w-[70ch]">
            {sizzleTranscript(sample.name)}
          </p>
        </details>
        <Link href="/reports/sample-competitive-fee-position" className="font-semibold text-ink underline underline-offset-4">
          Read the full live sample report
        </Link>
      </div>
    </figure>
  );
}

function SceneBody({ sceneKey, sample, nation, footnote, t }: {
  sceneKey: string;
  sample: SampleStory;
  nation: NationalFee | undefined;
  footnote: string;
  t: number;
}) {
  switch (sceneKey) {
    case "old-way":
      return <OldWayScene sample={sample} t={t} />;
    case "index":
      return <IndexScene sample={sample} t={t} footnote={footnote} />;
    case "markets":
      return <MarketsScene sample={sample} nation={nation} t={t} />;
    case "ask":
      return <AskScene sample={sample} t={t} />;
    default:
      return <ReportScene sample={sample} t={t} />;
  }
}
