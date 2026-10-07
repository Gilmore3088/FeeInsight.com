import { describe, expect, it } from "vitest";
import { buildLocalOfficeMap, LOCAL_MAP_MAX_STATES } from "./local-office-map";

describe("buildLocalOfficeMap", () => {
  it("frames a single state and places an office inside the frame", () => {
    const map = buildLocalOfficeMap(["LA"], [{ latitude: 30.4515, longitude: -91.1871 }]);
    expect(map).not.toBeNull();
    expect(map!.states.find((s) => s.id === "LA")?.own).toBe(true);
    expect(map!.states.some((s) => s.id === "MS" && !s.own)).toBe(true);
    expect(map!.dots).toHaveLength(1);
    const [dot] = map!.dots;
    expect(dot.x).toBeGreaterThan(0);
    expect(dot.x).toBeLessThan(960);
    expect(dot.y).toBeGreaterThan(0);
    expect(dot.y).toBeLessThan(600);
  });

  it("frames the offices when several have coordinates, leaving far states out", () => {
    const points = [
      { latitude: 40.77, longitude: -74.14 },
      { latitude: 40.13, longitude: -74.06 },
      { latitude: 40.59, longitude: -74.09 },
      { latitude: 41.01, longitude: -73.98 },
    ];
    const map = buildLocalOfficeMap(["NJ", "NY"], points)!;
    expect(map.dots).toHaveLength(4);
    const ids = map.states.map((s) => s.id);
    expect(ids).toContain("NJ");
    expect(ids).not.toContain("ME");
  });

  it("leaves wide footprints and territories to the national map", () => {
    expect(buildLocalOfficeMap(["TX", "OK", "LA", "AR"].slice(0, LOCAL_MAP_MAX_STATES + 1), [])).toBeNull();
    expect(buildLocalOfficeMap(["GU"], [])).toBeNull();
    expect(buildLocalOfficeMap([], [])).toBeNull();
  });
});
