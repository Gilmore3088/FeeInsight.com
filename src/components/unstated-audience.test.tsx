import { describe, expect, it } from "vitest";
import { medianHasUnstatedAudience } from "./unstated-audience";

describe("medianHasUnstatedAudience (#1132)", () => {
  it("is true only for a shown median with an unstated-audience institution behind it", () => {
    expect(medianHasUnstatedAudience({ median_amount: 30, unstated_audience_institution_count: 2 })).toBe(true);
    expect(medianHasUnstatedAudience({ median_amount: 0, unstated_audience_institution_count: 1 })).toBe(true);
    expect(medianHasUnstatedAudience({ median_amount: null, unstated_audience_institution_count: 2 })).toBe(false);
    expect(medianHasUnstatedAudience({ median_amount: 30, unstated_audience_institution_count: 0 })).toBe(false);
    expect(medianHasUnstatedAudience({ median_amount: 30 })).toBe(false);
    expect(medianHasUnstatedAudience(undefined)).toBe(false);
  });
});
