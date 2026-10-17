import { describe, expect, it } from "vitest";
import { pathRings, stateShape, unionBox } from "./district-geo";

describe("district geometry", () => {
  it("reads relative and absolute commands into rings", () => {
    const rings = pathRings("M10,10 l10,0 v10 h-10 z M50,50 L60,50 60,60 Z");
    expect(rings).toHaveLength(2);
    expect(rings[0]).toEqual([[10, 10], [20, 10], [20, 20], [10, 20]]);
    expect(rings[1][2]).toEqual([60, 60]);
  });

  it("puts each state's label inside its own box", () => {
    for (const code of ["GA", "FL", "LA", "MI", "TX", "CA", "NJ"]) {
      const s = stateShape(code)!;
      expect(s.label.x).toBeGreaterThan(s.box.x);
      expect(s.label.x).toBeLessThan(s.box.x + s.box.w);
      expect(s.label.y).toBeGreaterThan(s.box.y);
      expect(s.label.y).toBeLessThan(s.box.y + s.box.h);
    }
    // Florida's label sits on the peninsula, east of its panhandle's middle.
    const fl = stateShape("FL")!;
    expect(fl.label.x).toBeGreaterThan(fl.box.x + fl.box.w * 0.5);
  });

  it("boxes a district inside the 960 by 600 map", () => {
    const b = unionBox(["AL", "FL", "GA", "LA", "MS", "TN"], 0)!;
    expect(b.x).toBeGreaterThan(400);
    expect(b.x + b.w).toBeLessThan(960);
    expect(b.y + b.h).toBeLessThan(600);
  });
});
