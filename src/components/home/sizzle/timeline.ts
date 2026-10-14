/**
 * The homepage sizzle: from the fee study by hand to the report Hamilton writes, told with the
 * live sample report's real institution. Storyboard: docs/design/site-v3/08-sizzle-and-copy.md.
 * James found the first cut too fast (2026-10-14): each scene now holds 7 to 8 seconds and its
 * parts arrive one at a time, slowly. The closing caption is James's own line.
 */

export type SceneKey = "old-way" | "index" | "markets" | "ask" | "report";

export interface Scene {
  key: SceneKey;
  label: string;
  caption: string;
  durationMs: number;
}

export const SCENES: readonly Scene[] = [
  { key: "old-way", label: "The old way", caption: "Fee studies start one PDF at a time.", durationMs: 8000 },
  { key: "index", label: "Bank Fee Index", caption: "Fee Insight reads the published schedules for you.", durationMs: 7000 },
  { key: "markets", label: "Every market", caption: "Your fee, placed in the market around you.", durationMs: 7000 },
  { key: "ask", label: "Ask Hamilton", caption: "Ask Hamilton. Each answer cites its source.", durationMs: 7500 },
  { key: "report", label: "The report", caption: "The fee study? Done. Created by Hamilton.", durationMs: 8500 },
];

export const SIZZLE_MS = SCENES.reduce((total, scene) => total + scene.durationMs, 0);
/** The sizzle plays at most this many times, then rests on its last scene. */
export const MAX_PLAYS = 2;
/** The rest scene: also the poster, the no-JavaScript frame and the reduced-motion frame. */
export const REST_SCENE_INDEX = SCENES.length - 1;
/** How often the scene clock ticks; reveals are spaced far wider than this. */
export const CLOCK_TICK_MS = 100;
/** Elapsed time that shows every part of a scene at once (paused, picked or at rest). */
export const SHOW_ALL = Number.POSITIVE_INFINITY;

/** What comes after a scene: the next scene, the start of the next play, or rest (null). */
export function nextScene(index: number, playsDone: number): { index: number; playsDone: number } | null {
  if (index < SCENES.length - 1) return { index: index + 1, playsDone };
  const plays = playsDone + 1;
  return plays >= MAX_PLAYS ? null : { index: 0, playsDone: plays };
}

export function sizzleTranscript(institution: string): string {
  return (
    "Fee studies start one PDF at a time: competitors' fee schedules opened one by one, their fees " +
    "typed into a spreadsheet, then a board deck and a consultant's invoice. Fee Insight reads the " +
    `published fee schedules for you. The Bank Fee Index shows ${institution}'s own fees, each with ` +
    "the line of its schedule that states it and the date it was read. Its fee is placed in its local " +
    "market and against the nation, with competitors named. In Hamilton, the Fee Insight Pro workspace, " +
    "you ask how a fee compares and the answer cites its source; you add it to a report, and Hamilton " +
    "writes the Competitive Fee Position Report. The fee study? Done. Created by Hamilton. Every figure " +
    `shown comes from the live sample report for ${institution}.`
  );
}
