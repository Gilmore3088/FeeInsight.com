import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { KNOWN_GAPS, LOOP_LINKS, PLANTED_ERRORS, walkLoop } from "./planted-errors";

const source = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

// The classes the 2026-10-19 learning audit named (#2065).
const AUDIT_CLASSES = ["wrong_document", "lost_text", "limit_as_fee", "wrong_category", "wrong_audience", "duplicate", "missed_fee"];

describe("the error loop, planted end to end (#2065)", () => {
  it("plants one of each error class the learning audit named", () => {
    expect(PLANTED_ERRORS.map((planted) => planted.key).sort()).toEqual([...AUDIT_CLASSES].sort());
    for (const key of Object.keys(KNOWN_GAPS)) expect(AUDIT_CLASSES).toContain(key);
  });

  it("detects every planted error with the check that runs on live fees", () => {
    for (const planted of PLANTED_ERRORS) expect([planted.key, walkLoop(planted, source).links.detected]).toEqual([planted.key, true]);
  });

  for (const planted of PLANTED_ERRORS) {
    it(`walks ${planted.label} through the loop: every link holds or is a listed gap`, () => {
      const walk = walkLoop(planted, source);
      const gaps = KNOWN_GAPS[planted.key] ?? {};
      for (const link of LOOP_LINKS) {
        const listed = gaps[link];
        if (walk.links[link]) {
          // A gap that now holds: take its line out of KNOWN_GAPS so it cannot open again unseen.
          expect({ link, listedGap: listed ?? null }).toEqual({ link, listedGap: null });
        } else {
          // A broken link nobody listed: fix it, or list it with the issue that owns it.
          expect({ link, why: walk.why[link], listedGap: listed != null }).toEqual({ link, why: walk.why[link], listedGap: true });
        }
      }
    });
  }

  it("proves the full loop for the wrong category and lost text, and knows how many links are still missing", () => {
    for (const key of ["wrong_category", "lost_text"]) {
      const walk = walkLoop(PLANTED_ERRORS.find((planted) => planted.key === key)!, source);
      expect(Object.values(walk.links).every(Boolean)).toBe(true);
    }
    // Lower this when a gap closes; it never goes up without a new class.
    const missing = Object.values(KNOWN_GAPS).reduce((sum, gaps) => sum + Object.keys(gaps).length, 0);
    expect(missing).toBe(12);
  });

  it("fails a link when its reader stops naming the rows it reads", () => {
    const category = PLANTED_ERRORS.find((planted) => planted.key === "wrong_category")!;
    const walk = walkLoop(category, (file) => (file.endsWith("knox/lessons.ts") ? "export const nothing = 1;" : source(file)));
    expect(walk.links.read).toBe(false);
    expect(walk.why.read).toContain("never names f.kind IN");
  });
});
