import { describe, expect, it } from "vitest";
import { asReadBoxName, boxSizeNamed } from "./box-size-name";
import { checkFeeAgainstSource } from "./source-check";

// W43 live audit (#2064): box tables whose rows print only the size, under a box heading.
const SELF_STORAGE = [
  "Self Storage Lease Boxes",
  "              2x5 Annual Fee: $11.00",
  "              3x5 Annual Fee: $20.00",
  "              10x10 Annual Fee: $80.00",
  "              Key Replacement: $25.00",
].join("\n");
const SIZE_WORD_TABLE = ["Safe Deposit Box (Southgate Office Only)", "Name", "Fee", "Term", 'Small (5"x5")', "$25.00", "Annual", 'Large (10"x10")', "$75.00", "Annual"].join("\n");
const BARE_SIZES = ["Safe Deposit Box Annual Rental", "2 x 5: $40.00", "3 x 5: $40.00", "4 x 5: $50.00", "Locker: $150.00"].join("\n");

describe("boxSizeNamed", () => {
  it("should_name_a_bare_box_size_as_a_safe_deposit_box", () => {
    expect(boxSizeNamed("10x10 Annual Fee")).toBe("Safe Deposit Box 10x10 Annual Fee");
    expect(boxSizeNamed("3” x 10” x 22” Box")).toBe("Safe Deposit Box 3” x 10” x 22”");
  });

  it("should_leave_a_name_with_other_words_or_two_sizes", () => {
    expect(boxSizeNamed("Night Deposit Bag 10x12")).toBe("Night Deposit Bag 10x12");
    expect(boxSizeNamed("3x5 or 5x5")).toBe("3x5 or 5x5");
  });
});

describe("asReadBoxName", () => {
  it("should_return_the_row_words_of_a_built_box_name", () => {
    expect(asReadBoxName("Safe Deposit Box 3 x 10")).toBe("3 x 10");
    expect(asReadBoxName('Safe Deposit Box Large (10"x10")')).toBe('Large (10"x10")');
  });

  it("should_return_null_for_any_other_name", () => {
    expect(asReadBoxName("Safe Deposit Box Drilling")).toBeNull();
    expect(asReadBoxName("3 x 10")).toBeNull();
  });
});

describe("checkFeeAgainstSource reads a box named by its size", () => {
  it.each([
    [SELF_STORAGE, "Safe Deposit Box 10x10 Annual Fee", 80],
    [SELF_STORAGE, "Safe Deposit Box 2x5 Annual Fee", 11],
    [SIZE_WORD_TABLE, 'Safe Deposit Box Large (10"x10")', 75],
    [BARE_SIZES, "Safe Deposit Box 4 x 5", 50],
  ])("should_trace_%j_name_%j_at_its_own_price", (text, name, amount) => {
    expect(checkFeeAgainstSource(text, name, amount, ".", "safe_deposit_box").ok).toBe(true);
  });

  it("should_refuse_a_box_name_at_its_neighbour_size_price", () => {
    expect(checkFeeAgainstSource(SELF_STORAGE, "Safe Deposit Box 10x10 Annual Fee", 20, ".", "safe_deposit_box").ok).toBe(false);
    expect(checkFeeAgainstSource(BARE_SIZES, "Safe Deposit Box 4 x 5", 40, ".", "safe_deposit_box").ok).toBe(false);
  });
});
