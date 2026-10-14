import { describe, expect, it } from "vitest";
import { MAX_PLAYS, SCENES, SIZZLE_MS, nextScene, sizzleTranscript } from "./timeline";

describe("sizzle timeline", () => {
  it("should_hold_every_scene_long_enough_to_read", () => {
    SCENES.forEach((scene) => expect(scene.durationMs).toBeGreaterThanOrEqual(7000));
    expect(SIZZLE_MS).toBe(SCENES.reduce((total, scene) => total + scene.durationMs, 0));
  });

  it("should_keep_captions_short_enough_to_read_at_a_glance", () => {
    SCENES.forEach((scene) => expect(scene.caption.split(" ").length).toBeLessThanOrEqual(8));
  });

  it("should_reach_the_product_in_the_second_scene", () => {
    expect(SCENES[1].key).toBe("index");
  });

  it("should_stop_after_the_last_play", () => {
    expect(nextScene(0, 0)).toEqual({ index: 1, playsDone: 0 });
    expect(nextScene(SCENES.length - 1, 0)).toEqual({ index: 0, playsDone: 1 });
    expect(nextScene(SCENES.length - 1, MAX_PLAYS - 1)).toBeNull();
  });

  it("should_name_the_sample_institution_in_the_transcript", () => {
    expect(sizzleTranscript("West Shore Bank")).toContain("live sample report for West Shore Bank");
  });
});

describe("tidyScheduleLine", () => {
  it("should_collapse_dot_leaders_to_one_gap", async () => {
    const { tidyScheduleLine } = await import("./scenes");
    expect(tidyScheduleLine("Overdraft (items paid)............ $10.00 | Lost Key")).toBe("Overdraft (items paid) … $10.00 | Lost Key");
  });
});
