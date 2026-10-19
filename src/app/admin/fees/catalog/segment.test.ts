import { describe, expect, it } from "vitest";
import { parseSegment, segmentLabel, segmentParams } from "./segment";

describe("catalog segment", () => {
  it("is off when nothing is picked", () => {
    expect(parseSegment({})).toBeNull();
    expect(segmentParams(null)).toEqual({});
  });

  it("keeps known values and reads them in plain words", () => {
    const segment = parseSegment({ charter: "credit_union", tier: "community", state: "tx" });
    expect(segment).toEqual({ charter: "credit_union", tier: "community", state: "TX", district: "" });
    expect(segmentLabel(segment!)).toBe("Credit unions · $100M to $1B · TX");
    expect(segmentParams(segment)).toEqual({ charter: "credit_union", tier: "community", state: "TX" });
  });

  it("takes the Fed district the old Peers page filtered on", () => {
    const segment = parseSegment({ charter: "bank", district: "11" });
    expect(segment).toEqual({ charter: "bank", tier: "", state: "", district: "11" });
    expect(segmentLabel(segment!)).toBe("Banks · District 11 (Dallas)");
    expect(segmentParams(segment)).toEqual({ charter: "bank", district: "11" });
    // An old /admin/peers?district=7 bookmark lands here as a district-only segment.
    expect(parseSegment({ district: "7" })).toEqual({ charter: "", tier: "", state: "", district: "7" });
  });

  it("drops values it doesn't know", () => {
    expect(parseSegment({ charter: "thrift", tier: "huge", state: "Texas" })).toBeNull();
    expect(parseSegment({ charter: "bank", state: "1'" })).toEqual({ charter: "bank", tier: "", state: "", district: "" });
    expect(parseSegment({ district: "13" })).toBeNull();
    expect(parseSegment({ district: "07" })).toBeNull();
    expect(parseSegment({ district: "1; drop" })).toBeNull();
  });
});
