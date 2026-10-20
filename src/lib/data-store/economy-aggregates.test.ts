import { describe, expect, it } from "vitest";

import { normalizeGeoCode } from "./economy-aggregates";

describe("economy aggregates helpers", () => {
  it("normalises area codes and refuses malformed ones", () => {
    expect(normalizeGeoCode("state", "tx")).toBe("TX");
    expect(normalizeGeoCode("state", "48")).toBe("TX");
    expect(normalizeGeoCode("state", "72")).toBe("PR");
    expect(normalizeGeoCode("county", "1001")).toBe("01001");
    expect(normalizeGeoCode("metro", "1018")).toBeNull();
    expect(normalizeGeoCode("nation", "anything")).toBe("US");
  });
});
