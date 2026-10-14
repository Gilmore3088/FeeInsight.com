import { describe, expect, it } from "vitest";
import { feeDisplayName } from "@/lib/fee-display-name";

describe("feeDisplayName", () => {
  it("names a safe deposit box row that states only its size (101392)", () => {
    expect(feeDisplayName("3 X 10", "safe_deposit_box")).toBe("Safe Deposit Box 3 X 10");
    expect(feeDisplayName("10x10", "safe_deposit_box")).toBe("Safe Deposit Box 10x10");
    expect(feeDisplayName("5” x 10” Box", "safe_deposit_box")).toBe("Safe Deposit Box 5” x 10”");
    expect(feeDisplayName('3" x 5"', "safe_deposit_box")).toBe('Safe Deposit Box 3" x 5"');
    expect(feeDisplayName("10 x 10 x 22", "safe_deposit_box")).toBe("Safe Deposit Box 10 x 10 x 22");
  });

  it("leaves every other name as stored", () => {
    expect(feeDisplayName("Safe Deposit Box 3 x 5", "safe_deposit_box")).toBe("Safe Deposit Box 3 x 5");
    expect(feeDisplayName("Drilling", "safe_deposit_box")).toBe("Drilling");
    expect(feeDisplayName("3 x 10", "check_printing")).toBe("3 x 10");
    expect(feeDisplayName("3 x 10", null)).toBe("3 x 10");
  });
});
