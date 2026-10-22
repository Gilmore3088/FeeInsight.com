import { describe, expect, it } from "vitest";
import { asReadBoxName, boxNameRowWords, boxSizeNamed, leadsBoxRow } from "./box-size-name";
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
    expect(asReadBoxName("Safe Deposit Box 3 x 10", "safe_deposit_box")).toBe("3 x 10");
    expect(asReadBoxName('Safe Deposit Box Large (10"x10")', "safe_deposit_box")).toBe('Large (10"x10")');
  });

  it("should_return_null_for_any_other_name", () => {
    expect(asReadBoxName("Safe Deposit Box Drilling", "safe_deposit_box")).toBeNull();
    expect(asReadBoxName("3 x 10", "safe_deposit_box")).toBeNull();
    expect(asReadBoxName("Safe Deposit Box 3 x 10", "wire_domestic_outgoing")).toBeNull();
    expect(asReadBoxName("Safe Deposit Box 3 x 10", null)).toBeNull();
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

  // Review of 3f7803d: the row's own words trace a box name only for a safe deposit box, and only
  // on a row that is the size itself, not another product's row that prints a size.
  it.each([
    ["Night Deposit Bag 10x12 $20.00", "Safe Deposit Box 10x12", 20, null],
    ["Night Deposit Bag 10x12 $20.00", "Safe Deposit Box 10x12", 20, "safe_deposit_box"],
    ["Photocopies\n11 x 17 $0.50\n8.5 x 11 $0.25", "Safe Deposit Box 11 x 17", 0.5, "document_reproduction"],
    ["Wire Transfer 3x5 $25.00", "Safe Deposit Box 3x5", 25, "wire_domestic_outgoing"],
    ["Wire Transfer 3x5 $25.00", "Safe Deposit Box 3x5", 25, "safe_deposit_box"],
  ])("should_not_trace_%j_as_box_name_%j", (text, name, amount, key) => {
    expect(checkFeeAgainstSource(text, name, amount, ".", key).ok).toBe(false);
  });

  it("should_refuse_a_box_name_at_its_neighbour_size_price", () => {
    expect(checkFeeAgainstSource(SELF_STORAGE, "Safe Deposit Box 10x10 Annual Fee", 20, ".", "safe_deposit_box").ok).toBe(false);
    expect(checkFeeAgainstSource(BARE_SIZES, "Safe Deposit Box 4 x 5", 40, ".", "safe_deposit_box").ok).toBe(false);
  });
});

describe("leadsBoxRow", () => {
  it("should_accept_a_size_that_starts_its_row_or_follows_box_words_or_a_price", () => {
    expect(leadsBoxRow("3 x 10: $70.00", "3 x 10")).toBe(true);
    expect(leadsBoxRow("Safe Deposit Box Annual Fees 3X5: $25.00 | 3X10: $35.00", "3X10")).toBe(true);
    expect(leadsBoxRow("may earn, or your monthly statement. | 3 x 10.......$30.00 per year", "3 x 10")).toBe(true);
  });

  it("should_refuse_a_size_printed_in_another_product_row", () => {
    expect(leadsBoxRow("Night Deposit Bag 10x12 $20.00", "10x12")).toBe(false);
    expect(leadsBoxRow("Wire Transfer 3x5 $25.00", "3x5")).toBe(false);
  });

  it("should_read_the_page_when_the_traced_window_stops_short_of_the_size", () => {
    const page = "Garnishment $75.00 Safe Deposit Box Rental 3 x 10 $50.00 5 x 10 $70.00";
    expect(leadsBoxRow("Garnishment $75.00", "5 x 10", page)).toBe(true);
    expect(leadsBoxRow("Garnishment $75.00", "10x12", "Garnishment $75.00 Night Deposit Bag 10x12 $20.00")).toBe(false);
  });
});

describe("boxNameRowWords", () => {
  it("should_compare_a_box_name_as_its_row_words_for_any_caller", () => {
    expect(boxNameRowWords("Safe Deposit Box 5x5 Annual Fee")).toBe("5x5 Annual Fee");
    expect(boxNameRowWords("Safe Deposit Box Drilling")).toBeNull();
  });
});
