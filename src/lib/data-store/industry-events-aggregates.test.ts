import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));

import { eventGroupExpression, medianOrNull, structureEventKind } from "./industry-events-aggregates";

describe("industry events aggregates helpers", () => {
  it("separates failures from assistance and mergers", () => {
    expect(structureEventKind("fdic-failures", "FAILURE")).toBe("failure");
    expect(structureEventKind("fdic-failures", "assistance ")).toBe("assistance");
    expect(structureEventKind("fdic-failures", null)).toBe("other");
    expect(structureEventKind("ncua-liquidations", null)).toBe("failure");
    expect(structureEventKind("ncua-mergers", "P&A")).toBe("merger");
  });

  it("groups events by the list's own state first", () => {
    expect(eventGroupExpression("state")).toBe("COALESCE(e.office_state, s.state_code)");
    expect(eventGroupExpression("district")).toBe("s.fed_district::text");
  });

  it("gives no median below five institutions", () => {
    expect(medianOrNull([1, 2, 3, 4])).toBeNull();
    expect(medianOrNull([5, 1, 3, 2, 4])).toBe(3);
    expect(medianOrNull([1, 2, 3, 4, 5, 6])).toBe(3.5);
  });
});
