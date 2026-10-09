import { describe, expect, it } from "vitest";
import { beigeBookSummary } from "./expert-context";

describe("beigeBookSummary", () => {
  it("keeps whole sentences up to the length", () => {
    const text = "Activity was little changed. Manufacturing slowed to a modest pace. Retail sales fell sharply across the district.";
    expect(beigeBookSummary(text, 70)).toBe("Activity was little changed. Manufacturing slowed to a modest pace.");
  });

  it("keeps a long first sentence whole rather than cutting it", () => {
    expect(beigeBookSummary("One very long sentence that runs on.", 10)).toBe("One very long sentence that runs on.");
  });
});
