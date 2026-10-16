import { describe, expect, it } from "vitest";
import { apiFeeName, feeDisplayName, isCutFeeName } from "@/lib/fee-display-name";

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

  it("shows the category's name for a name cut from its line (#1180)", () => {
    expect(feeDisplayName("Chase Mobile to send a wire from your account to", "wire_domestic_outgoing")).toBe("Wire Transfer (Domestic Out)");
    expect(feeDisplayName("Fees: o A Minimum Balance Fee", "monthly_maintenance")).toBe("Monthly Maintenance");
  });

  it("flags the API name when the category's name stands in for a cut name (#1482)", () => {
    expect(apiFeeName("Chase Mobile to send a wire from your account to", "wire_domestic_outgoing")).toEqual({
      fee_name: "Wire Transfer (Domestic Out)",
      name_is_category_fallback: true,
    });
    expect(apiFeeName("3 X 10", "safe_deposit_box")).toEqual({ fee_name: "Safe Deposit Box 3 X 10", name_is_category_fallback: false });
    expect(apiFeeName("Overdraft Fee", "overdraft")).toEqual({ fee_name: "Overdraft Fee", name_is_category_fallback: false });
  });

  it("keeps a cut name when there is no known category to fall back to", () => {
    expect(feeDisplayName("Chase Mobile to send a wire from your account to", null)).toBe("Chase Mobile to send a wire from your account to");
    expect(feeDisplayName("Chase Mobile to send a wire from your account to", "not_a_category")).toBe("Chase Mobile to send a wire from your account to");
  });

  it("leaves whole names alone, including ones that only look odd", () => {
    for (const name of ["OVERDRAFT FEE", "Monthly Service Fee", "Stop Payment", "Loan Application, each", "N/A", "e-Statement fee"]) {
      expect(isCutFeeName(name)).toBe(false);
      expect(feeDisplayName(name, "overdraft")).toBe(name);
    }
  });

  it("shows the stored name when a pronoun sits only inside a parenthetical (#1443)", () => {
    // Darwin's live check exempts these, so the page agrees: the stored name is a real fee name.
    expect(isCutFeeName("Stop Payment (per item, if you request it)")).toBe(false);
    expect(feeDisplayName("Stop Payment (per item, if you request it)", "stop_payment")).toBe("Stop Payment (per item, if you request it)");
    // Outside the parenthetical the pronoun is still a cut name.
    expect(isCutFeeName("Stop Payment (per item) if you request it")).toBe(true);
  });

  it("shows all-capitals names ending on a letter or an article as stored, as main does (#1499)", () => {
    // Darwin's all-capitals article rule lives in the live fragment check only; the public name is unchanged.
    for (const name of ["SAFE DEPOSIT BOX SIZE A", "CHECKING PLAN A", "OPTION A", "SCHEDULE A", "BOX A", "CLUB A",
      "WIRE FEE FOR THE", "TRANSFER TO A", "SERVICE CHARGE A", "BILL PAY A", "MONTHLY SERVICE CHARGE A"]) {
      expect(isCutFeeName(name)).toBe(false);
      expect(feeDisplayName(name, "wire_domestic_outgoing")).toBe(name);
      expect(feeDisplayName(name, "safe_deposit_box")).toBe(name);
    }
  });
});

describe("fee-name helpers stay pure (#1483)", () => {
  it("import no agent, database or crypto code, so public pages can use them", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/lib/fee-display-name.ts", "src/lib/fee-name-fragments.ts", "src/lib/coverage-labels.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["'](?:@\/lib\/agents|@\/lib\/data-store|node:)/);
    }
  });
});
