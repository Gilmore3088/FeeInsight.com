import { describe, expect, it } from "vitest";
import { HMDA_REPAIR_MANIFEST as manifest, HMDA_REPAIR_MANIFEST_DIGEST, hashHmdaJson, stableHmdaJson } from "./hmda-repair-manifest";

describe("committed ten-bank HMDA scope", () => {
  it("pins the complete server-owned document and preserves precise database JSON", () => {
    expect(HMDA_REPAIR_MANIFEST_DIGEST).toBe("6118ff5a567d8792bfbba691c13c95ff78664772fc3cce1c8ea34fed7795beb9");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.cohort)).toBe(true);
    expect(hashHmdaJson({ b: 1, a: { timestamp: "2026-10-14T02:22:22.248548+00:00", id: 3982 } })).toBe(
      hashHmdaJson({ a: { id: 3982, timestamp: "2026-10-14T02:22:22.248548+00:00" }, b: 1 }));
    expect(stableHmdaJson({ b: 1, a: "2026-10-14T02:22:22.248548+00:00" })).toBe('{"a":"2026-10-14T02:22:22.248548+00:00","b":1}');
    expect(hashHmdaJson({ x: 42 })).not.toBe(hashHmdaJson({ x: "42" }));
  });
  it("retains exactly the reviewed banks, annual lenders and all-state child IDs", () => {
    expect(manifest.fixedBounds).toEqual({ canonicalRows: 10, annualLenders: 10, originationRows: 85, costRows: 39, aggregateRows: 124 });
    expect(new Set(manifest.cohort.map(r => r.lei)).size).toBe(10);
    expect(new Set(manifest.guards.institutions.ids).size).toBe(10);
    expect(new Set(manifest.guards.originations.ids).size).toBe(85);
    expect(new Set(manifest.guards.costs.ids).size).toBe(39);
    expect(manifest.cohort.reduce((n, r) => n + r.originationRows, 0)).toBe(85);
    expect(manifest.cohort.reduce((n, r) => n + r.costRows, 0)).toBe(39);
    expect(manifest.plan.rows.every(row => row.beforeInstitutionId === null && row.beforeMatchMethod === null)).toBe(true);
  });
});
