/**
 * The homepage sizzle: 35 seconds from the fee study by hand to the report Hamilton writes.
 * Storyboard: docs/design/site-v3/08-sizzle-and-copy.md (DRAPER with NORMAN, 2026-10-14).
 * The closing caption is James's own line. James found 20 seconds too fast (2026-10-14), so each
 * scene holds long enough to read its caption and watch the product work.
 */

export type SceneKey = "collect" | "cost" | "index" | "markets" | "ask" | "report" | "done";

export interface Scene {
  key: SceneKey;
  /** The chapter tab this scene belongs to. */
  chapter: ChapterKey;
  startMs: number;
  endMs: number;
  caption: string;
  /** Scenes after the index draw example content and say so on screen. */
  example: boolean;
}

export type ChapterKey = "old-way" | "index" | "markets" | "hamilton" | "report";

export const CHAPTERS: readonly { key: ChapterKey; label: string }[] = [
  { key: "old-way", label: "The old way" },
  { key: "index", label: "Bank Fee Index" },
  { key: "markets", label: "Every market" },
  { key: "hamilton", label: "Ask Hamilton" },
  { key: "report", label: "The report" },
];

export const SCENES: readonly Scene[] = [
  { key: "collect", chapter: "old-way", startMs: 0, endMs: 3000, caption: "Fee studies start one PDF at a time.", example: false },
  { key: "cost", chapter: "old-way", startMs: 3000, endMs: 5500, caption: "Then a spreadsheet, a deck, an invoice.", example: false },
  { key: "index", chapter: "index", startMs: 5500, endMs: 11000, caption: "Fee Insight reads the published schedules for you.", example: false },
  { key: "markets", chapter: "markets", startMs: 11000, endMs: 17000, caption: "Your fee, placed in every market around you.", example: true },
  { key: "ask", chapter: "hamilton", startMs: 17000, endMs: 24000, caption: "Ask Hamilton. Each answer cites its source.", example: true },
  { key: "report", chapter: "report", startMs: 24000, endMs: 30000, caption: "Add findings. Hamilton writes the report.", example: true },
  { key: "done", chapter: "report", startMs: 30000, endMs: 35000, caption: "The fee study? Done. Created by Hamilton.", example: true },
];

export const SIZZLE_MS = SCENES[SCENES.length - 1].endMs;
/** The sizzle plays at most this many times, then rests on its last frame. */
export const MAX_PLAYS = 3;
/** The rest frame: also the poster, the no-JavaScript frame and the reduced-motion frame. */
export const REST_SCENE_INDEX = SCENES.length - 1;

export function sceneDurationMs(index: number): number {
  const scene = SCENES[index];
  return scene.endMs - scene.startMs;
}

/** The first scene of a chapter, for the tabs. */
export function firstSceneOf(chapter: ChapterKey): number {
  return SCENES.findIndex((scene) => scene.chapter === chapter);
}

/** What comes after a scene: the next scene, the start of the next play, or rest (null). */
export function nextScene(index: number, playsDone: number): { index: number; playsDone: number } | null {
  if (index < SCENES.length - 1) return { index: index + 1, playsDone };
  const plays = playsDone + 1;
  return plays >= MAX_PLAYS ? null : { index: 0, playsDone: plays };
}

export const SIZZLE_TRANSCRIPT =
  "Fee studies start one PDF at a time: competitors' fee schedules opened one by one and copied " +
  "into a spreadsheet, then a deck, then an invoice. Fee Insight reads the published fee schedules " +
  "for you, and the Bank Fee Index shows each fee's national median with its source and date. Your " +
  "fee is placed in every market around you: your market, your state, your Fed district, your peer " +
  "group and the nation, marked above, inside or below the range. In Hamilton, the Fee Insight Pro " +
  "workspace, you ask a question and each answer cites its source. Add a finding and Hamilton writes " +
  "the report: a Peer Brief with your findings and their sources, ready to turn into a CEO one-pager, " +
  "a board memo or a pricing committee packet. The fee study? Done. Created by Hamilton. Scenes after " +
  "the Bank Fee Index use example figures.";

/** Inner motion (each element's delay and duration) runs this much slower than the storyboard drafts. */
export const MOTION_SCALE = 1.6;
