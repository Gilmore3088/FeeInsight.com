import { describe, expect, it } from "vitest";
import { CHAPTERS, MAX_PLAYS, SCENES, SIZZLE_MS, firstSceneOf, nextScene } from "./timeline";

describe("sizzle timeline", () => {
  it("should_run_thirty_five_seconds_without_gaps_or_overlaps", () => {
    expect(SIZZLE_MS).toBe(35_000);
    expect(SCENES[0].startMs).toBe(0);
    SCENES.forEach((scene, i) => {
      expect(scene.endMs).toBeGreaterThan(scene.startMs);
      if (i > 0) expect(scene.startMs).toBe(SCENES[i - 1].endMs);
    });
  });

  it("should_reach_the_product_by_six_seconds", () => {
    const index = SCENES.find((scene) => scene.key === "index");
    expect(index?.startMs).toBeLessThanOrEqual(6_000);
  });

  it("should_keep_captions_short_enough_to_read_in_two_seconds", () => {
    SCENES.forEach((scene) => expect(scene.caption.split(" ").length).toBeLessThanOrEqual(8));
  });

  it("should_mark_every_scene_after_the_index_as_an_example", () => {
    const indexAt = SCENES.findIndex((scene) => scene.key === "index");
    SCENES.forEach((scene, i) => expect(scene.example).toBe(i > indexAt));
  });

  it("should_give_every_chapter_a_scene", () => {
    CHAPTERS.forEach((chapter) => expect(firstSceneOf(chapter.key)).toBeGreaterThanOrEqual(0));
  });

  it("should_stop_after_the_last_play", () => {
    expect(nextScene(0, 0)).toEqual({ index: 1, playsDone: 0 });
    expect(nextScene(SCENES.length - 1, 0)).toEqual({ index: 0, playsDone: 1 });
    expect(nextScene(SCENES.length - 1, MAX_PLAYS - 1)).toBeNull();
  });
});
