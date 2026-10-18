import { describe, expect, it } from "vitest";
import { SEARCH_TERM_MAX_LENGTH, boundedSearchTerm, escapeLikePattern } from "./query-caps";

describe("escapeLikePattern", () => {
  it("makes LIKE wildcards literal", () => {
    expect(escapeLikePattern("%%")).toBe("\\%\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("Chase Bank")).toBe("Chase Bank");
  });
});

describe("boundedSearchTerm", () => {
  it("keeps an ordinary term, trimmed", () => {
    expect(boundedSearchTerm("  Harbor  ")).toBe("Harbor");
    expect(boundedSearchTerm("M&T")).toBe("M&T");
    expect(boundedSearchTerm("Évry")).toBe("Évry");
  });

  it("refuses terms with fewer than two letters or digits", () => {
    expect(boundedSearchTerm("%%")).toBeNull();
    expect(boundedSearchTerm("__")).toBeNull();
    expect(boundedSearchTerm("--!!")).toBeNull();
    expect(boundedSearchTerm("a")).toBeNull();
    expect(boundedSearchTerm("a%")).toBeNull();
    expect(boundedSearchTerm("")).toBeNull();
    expect(boundedSearchTerm(null)).toBeNull();
    expect(boundedSearchTerm(42)).toBeNull();
  });

  it("cuts a long term to the maximum", () => {
    const long = "b".repeat(100_000);
    expect(boundedSearchTerm(long)).toHaveLength(SEARCH_TERM_MAX_LENGTH);
    expect(boundedSearchTerm(long, { max: 64 })).toHaveLength(64);
  });
});
