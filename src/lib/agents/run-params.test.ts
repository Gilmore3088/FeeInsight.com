import { describe, expect, it } from "vitest";
import { laneRecheckParam, numericRunParam, stringRunParam } from "./run-params";
import { laneRecheckParam as legacyLaneRecheckParam } from "./run-store";

describe("agent run parameter parsing (R05 extraction)", () => {
  it("uses the first finite numeric parameter without losing an explicit zero", () => {
    expect(numericRunParam({ limit: 0, size: 99 }, ["limit", "size"])).toBe(0);
    expect(numericRunParam({ limit: "6", size: 99 }, ["limit", "size"])).toBe(6);
  });

  it("preserves fallback ordering for absent, empty, invalid or nonfinite numbers", () => {
    expect(numericRunParam({ limit: null, size: 12 }, ["limit", "size"])).toBe(12);
    expect(numericRunParam({ limit: "", size: "7" }, ["limit", "size"])).toBe(7);
    expect(numericRunParam({ limit: "unknown", size: 4 }, ["limit", "size"])).toBe(4);
    expect(numericRunParam({ limit: Infinity, size: 3 }, ["limit", "size"])).toBe(3);
    expect(numericRunParam({ limit: "unknown" }, ["limit"])).toBeUndefined();
  });

  it("keeps existing Number coercion for valid boolean and whitespace inputs", () => {
    expect(numericRunParam({ limit: false }, ["limit"])).toBe(0);
    expect(numericRunParam({ limit: "   " }, ["limit"])).toBe(0);
  });

  it("takes the first nonblank string, trimmed, without coercing other types", () => {
    expect(stringRunParam({ state: " ", stateCode: " WA " }, ["state", "stateCode"])).toBe("WA");
    expect(stringRunParam({ state: 13, stateCode: true }, ["state", "stateCode"])).toBeUndefined();
    expect(stringRunParam({ state: "NY", stateCode: "WA" }, ["state", "stateCode"])).toBe("NY");
  });

  it("preserves the existing run-store public export with the same implementation", () => {
    expect(legacyLaneRecheckParam).toBe(laneRecheckParam);
    expect(legacyLaneRecheckParam({ recheck: "quarterly" })).toBe("quarterly");
    expect(legacyLaneRecheckParam({ recheck: "quarterly " })).toBeNull();
  });

  it("parses frozen run input without mutating it or reordering fallback keys", () => {
    const params = Object.freeze({ limit: "unknown", next: "0x10", state: "  WA  ", recheck: "quarterly" });
    expect(numericRunParam(params, ["limit", "next"])).toBe(16);
    expect(stringRunParam(params, ["state"])).toBe("WA");
    expect(laneRecheckParam(params)).toBe("quarterly");
    expect(params.state).toBe("  WA  ");
  });

  it("keeps non-quarterly runs in the normal lane", () => {
    expect(laneRecheckParam({ recheck: "quarterly" })).toBe("quarterly");
    expect(laneRecheckParam({ recheck: "Quarterly" })).toBeNull();
    expect(laneRecheckParam({ recheck: true })).toBeNull();
    expect(laneRecheckParam({})).toBeNull();
  });
});
