import { describe, expect, it } from "vitest";
import { parseSegment, segmentLabel, segmentParams } from "./segment";

describe("catalog segment", () => {
  it("is off when nothing is picked", () => {
    expect(parseSegment({})).toBeNull();
    expect(segmentParams(null)).toEqual({});
  });

  it("keeps known values and reads them in plain words", () => {
    const segment = parseSegment({ charter: "credit_union", tier: "community", state: "tx" });
    expect(segment).toEqual({ charter: "credit_union", tier: "community", state: "TX" });
    expect(segmentLabel(segment!)).toBe("Credit unions · $100M to $1B · TX");
    expect(segmentParams(segment)).toEqual({ charter: "credit_union", tier: "community", state: "TX" });
  });

  it("drops values it doesn't know", () => {
    expect(parseSegment({ charter: "thrift", tier: "huge", state: "Texas" })).toBeNull();
    expect(parseSegment({ charter: "bank", state: "1'" })).toEqual({ charter: "bank", tier: "", state: "" });
  });
});
