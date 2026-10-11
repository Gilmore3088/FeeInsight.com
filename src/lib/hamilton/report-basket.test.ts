import { describe, expect, it } from "vitest";
import { basketItemId, basketItemsFor, sanitizeBasketItems } from "./report-basket";

describe("sanitizeBasketItems", () => {
  it("drops malformed items, duplicates and bad keys, and trims text", () => {
    const items = sanitizeBasketItems([
      { id: "a", source: "Ask", title: "  NSF  is high ", detail: "x".repeat(2000), feeCategory: "nsf", institutionId: "12" },
      { id: "a", source: "Ask", title: "dupe" },
      { id: "b", source: "Hack", title: "bad source" },
      { id: "c", source: "Test", title: "Try $30", feeCategory: "DROP TABLE", institutionId: "x1" },
      "nope",
    ]);
    expect(items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(items[0].title).toBe("NSF is high");
    expect(items[0].detail).toHaveLength(1200);
    expect(items[1].feeCategory).toBeNull();
    expect(items[1].institutionId).toBeNull();
  });

  it("keeps answer A's original context when added while B is selected", () => {
    const identityContext = { version: 1, researchInstitutionId: 1, accountInstitutionId: 101, accountStatus: "identified", researchInstitutionName: "Research Bank A", accountInstitutionName: "Space Coast CU", peerBaselineLabel: "Original A cohort" };
    const items = sanitizeBasketItems([{ id: "saved-a", source: "Ask", title: "A answer", institutionId: "2", savedAnalysisId: "11111111-2222-3333-4444-555555555555", identityContext }]);
    expect(items[0].institutionId).toBe("1");
    expect(items[0].identityContext).toEqual(identityContext);
    expect(basketItemsFor(items, "2")).toEqual([]);
    expect(sanitizeBasketItems(JSON.parse(JSON.stringify(items)))).toEqual(items);
  });

  it("keeps at most 12, newest last", () => {
    const raw = Array.from({ length: 15 }, (_, i) => ({ id: `i${i}`, source: "Position", title: `t${i}` }));
    const items = sanitizeBasketItems(raw);
    expect(items).toHaveLength(12);
    expect(items[0].id).toBe("i3");
  });
});

describe("basketItemsFor", () => {
  it("shows a bank's items plus unscoped ones", () => {
    const items = sanitizeBasketItems([
      { id: "a", source: "Ask", title: "A", institutionId: "1" },
      { id: "b", source: "Ask", title: "B", institutionId: "2" },
      { id: "c", source: "Ask", title: "C" },
    ]);
    expect(basketItemsFor(items, "1").map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("basketItemId", () => {
  it("is stable for the same parts", () => {
    expect(basketItemId("Ask", "nsf", "lead")).toBe(basketItemId("Ask", "nsf", "lead"));
    expect(basketItemId("Ask", "nsf", "lead")).not.toBe(basketItemId("Test", "nsf", "lead"));
  });
});
