import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/guides";
import { MIN_TEXT, TEXT_BOXES, textWidth } from "../scene-diagram";
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

  it.each(scenes)("%s keeps every label inside its shape, measured", (_id, scene) => {
    const fits = (kind: keyof typeof TEXT_BOXES, text: string | undefined, spacing = 0) => {
      if (!text) return;
      const box = TEXT_BOXES[kind];
      expect(textWidth(text, box.size, box.bold, spacing), `${kind}: "${text}"`).toBeLessThanOrEqual(box.width);
    };
    fits("actor", scene.left.label);
    fits("actor", scene.right.label);
    for (const c of scene.charges) fits("charge", c.label);
    for (const { frame } of scene.steps) {
      fits("item", frame.item?.label);
      fits("status", frame.item?.status);
      fits("total", frame.total?.label);
      fits("totalNote", frame.total?.note);
      fits("fork", frame.fork?.a);
      fits("fork", frame.fork?.b);
      fits("lookForTitle", frame.lookForTitle?.toUpperCase(), 1);
      for (const line of frame.lookFor ?? []) fits("lookFor", line);
      expect((frame.lookFor ?? []).length).toBeLessThanOrEqual(3);
    }
  });

  it.each(scenes)("%s keeps a status on screen once it appears", (_id, scene) => {
    let status: string | undefined;
    for (const { id, frame } of scene.steps) {
      if (status && frame.item) expect(frame.item.status, `${scene.id} ${id}`).toBeTruthy();
      status = frame.item?.status ?? status;
    }
  });

  it("never draws diagram text below the floor", () => {
    expect(MIN_TEXT).toBeGreaterThanOrEqual(16);
    for (const box of Object.values(TEXT_BOXES)) expect(box.size).toBeGreaterThanOrEqual(MIN_TEXT);
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
        expect(a.label, a.label).not.toMatch(/—|–/);
        if (a.href.startsWith("#")) expect(anchors.has(a.href), `${guide.slug} ${a.href}`).toBe(true);
        else expect(a.href, a.label).toMatch(/^\/(check|guides\/[a-z-]+(#[a-z-]+)?)$/);
      }
    }
  });

  it("places each scene beside the section it explains", () => {
    const where = Object.fromEntries(placements.map((p) => [p.block.scene, `${p.guide.slug}#${p.section}`]));
    expect(where).toEqual({
      atm_two_fee: "atm-fees#charged-twice",
      overdraft: "overdraft-fees#what-happened",
      nsf: "nsf-fees#what-it-is",
      wire_transfer: "wire-transfer-fees#what-it-is",
      monthly_maintenance: "monthly-maintenance-fees#what-it-is",
      foreign_transaction: "foreign-transaction-fees#what-it-is",
      check_stop_payment: "check-fees#what-it-costs",
      digital_speed: "digital-banking-fees#speed-costs-money",
      dormant_account: "account-closure-fees#what-it-is",
      safe_deposit: "safe-deposit-fees#what-it-is",
    });
  });

  it("never promises that opting out declines a payment", () => {
    const words = Object.values(FEE_SCENES).flatMap((s) => [
      s.takeaway,
      s.describe,
      ...s.steps.flatMap((st) => [st.caption, ...(st.frame.lookFor ?? [])]),
    ]);
    for (const w of words) expect(w, w).not.toMatch(/\b(will be|is|are) declined\b|\bdeclines? (it|the payment)\b/i);
  });
});
