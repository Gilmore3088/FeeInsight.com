import { describe, expect, it } from "vitest";
import { inferFeeCategory } from "./infer-category";

describe("inferFeeCategory", () => {
  it("picks the first fee category the text names", () => {
    expect(inferFeeCategory("Angelina prices most services below medians, but its NSF fee sits at the top.")).toBe("nsf");
    expect(inferFeeCategory("Monthly maintenance is waived; overdraft is high.")).toBe("monthly_maintenance");
  });

  it("returns null when no category is named", () => {
    expect(inferFeeCategory("Fee income is 6.8% of revenue.")).toBeNull();
  });
});
