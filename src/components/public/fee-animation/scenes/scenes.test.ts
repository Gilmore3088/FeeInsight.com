import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/guides";
import { TEXT_LIMITS } from "../scene-diagram";
import { sceneLengthMs, sceneSeconds } from "../timeline";
import { FEE_SCENES } from ".";

const scenes = Object.entries(FEE_SCENES);

/** Every animation block in the guides, with the guide that places it. */
const placements = GUIDES.flatMap((g) =>
  g.sections.flatMap((s) =>
    s.blocks.flatMap((b) => (b.type === "animation" ? [{ guide: g, section: s.id, block: b }] : [])),
  ),
);

describe("fee animation scenes", () => {
  it.each(scenes)("%s runs 20 to 40 seconds in four to six steps, in whole seconds", (_id, scene) => {
    expect(scene.steps.length).toBeGreaterThanOrEqual(4);
    expect(scene.steps.length).toBeLessThanOrEqual(6);
    expect(sceneLengthMs(scene)).toBeGreaterThanOrEqual(20000);
    expect(sceneLengthMs(scene)).toBeLessThanOrEqual(40000);
    expect(sceneLengthMs(scene)).toBe(sceneSeconds(scene) * 1000);
  });

  it.each(scenes)("%s keeps every label inside its shape", (_id, scene) => {
    expect(scene.left.label.length).toBeLessThanOrEqual(TEXT_LIMITS.actor);
    expect(scene.right.label.length).toBeLessThanOrEqual(TEXT_LIMITS.actor);
    for (const c of scene.charges) expect(c.label.length, c.label).toBeLessThanOrEqual(TEXT_LIMITS.charge);
    for (const { frame } of scene.steps) {
      if (frame.item) {
        expect(frame.item.label.length, frame.item.label).toBeLessThanOrEqual(TEXT_LIMITS.item);
        expect((frame.item.status ?? "").length).toBeLessThanOrEqual(TEXT_LIMITS.status);
      }
      if (frame.total) {
        expect(frame.total.label.length).toBeLessThanOrEqual(TEXT_LIMITS.total);
        expect((frame.total.note ?? "").length).toBeLessThanOrEqual(TEXT_LIMITS.totalNote);
      }
      if (frame.fork) {
        expect(frame.fork.a.length, frame.fork.a).toBeLessThanOrEqual(TEXT_LIMITS.fork);
        expect(frame.fork.b.length, frame.fork.b).toBeLessThanOrEqual(TEXT_LIMITS.fork);
      }
      for (const line of frame.lookFor ?? []) expect(line.length, line).toBeLessThanOrEqual(TEXT_LIMITS.lookFor);
      expect((frame.lookFor ?? []).length).toBeLessThanOrEqual(3);
    }
  });

  it.each(scenes)("%s draws only charges it defines, at most one per side, one bottom panel at a time", (_id, scene) => {
    const ids = new Set(scene.charges.map((c) => c.id));
    expect(scene.charges.filter((c) => c.under === "left").length).toBeLessThanOrEqual(1);
    expect(scene.charges.filter((c) => c.under === "right").length).toBeLessThanOrEqual(1);
    for (const { frame } of scene.steps) {
      for (const id of frame.charges) expect(ids.has(id), id).toBe(true);
      expect([frame.total, frame.fork, frame.lookFor].filter(Boolean).length).toBeLessThanOrEqual(1);
      if (frame.intro && !["item", "fork", "total", "lookFor"].includes(frame.intro)) {
        expect(frame.charges).toContain(frame.intro);
      }
    }
  });

  it.each(scenes)("%s uses round amounts and plain words", (_id, scene) => {
    for (const c of scene.charges) expect(Number.isInteger(c.amount), c.label).toBe(true);
    const words = [
      scene.title,
      scene.takeaway,
      scene.describe,
      scene.left.label,
      scene.right.label,
      ...scene.charges.map((c) => c.label),
      ...scene.steps.flatMap((s) => [
        s.caption,
        s.frame.item?.label,
        s.frame.item?.status,
        s.frame.total?.label,
        s.frame.total?.note,
        s.frame.fork?.a,
        s.frame.fork?.b,
        ...(s.frame.lookFor ?? []),
      ]),
    ].filter((t): t is string => Boolean(t));
    for (const w of words) expect(w, w).not.toMatch(/—|–/);
  });

  it("places every scene exactly once, in a consumer guide", () => {
    expect(placements.map((p) => p.block.scene).sort()).toEqual(Object.keys(FEE_SCENES).sort());
    for (const p of placements) expect(p.guide.audience).toBe("consumer");
  });

  it("ends every scene on two actions that lead to the guide's own sections or a site page", () => {
    for (const { guide, block } of placements) {
      expect(block.actions).toHaveLength(2);
      const anchors = new Set(guide.sections.map((s) => `#${s.id}`));
      for (const a of block.actions) {
        if (a.href.startsWith("#")) expect(anchors.has(a.href), `${guide.slug} ${a.href}`).toBe(true);
        else expect(a.href, a.label).toMatch(/^\/(check|guides\/[a-z-]+(#[a-z-]+)?)$/);
      }
    }
  });

  it("places the ATM pilot beside the explanation of being charged twice", () => {
    const atm = placements.find((p) => p.block.scene === "atm_two_fee");
    expect(atm?.guide.slug).toBe("atm-fees");
    expect(atm?.section).toBe("charged-twice");
  });
});
