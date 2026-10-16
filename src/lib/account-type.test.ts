import { describe, expect, it } from "vitest";
import { accountTypeFlag, accountTypeOf, accountTypeOfText, heldAccountType } from "./account-type";

describe("accountTypeOf (#1100 gap 1)", () => {
  it("reads the account from the lineup product first", () => {
    // Live rows, prod, Oct 16 (fee 141227, 65609, 126011, 103916).
    expect(accountTypeOf("MMDA – Money Market Deposit Account – Personal", "Monthly maintenance fee")).toBe("money_market");
    expect(accountTypeOf("DIRECT SAVINGS ACCOUNT", "Service charge fee")).toBe("savings");
    expect(accountTypeOf("First Business Checking", "Monthly maintenance fee")).toBe("business");
    expect(accountTypeOf("Super Money Market", "Monthly Service Fee with minimum balance")).toBe("money_market");
    expect(accountTypeOf("Health Savings Account (HSA)", "Monthly fee")).toBe("ira_hsa_cd");
    expect(accountTypeOf("Christmas Club Savings", "Monthly fee")).toBe("club");
    // Fee 131974, prod, Oct 16: a kids' savings account named for its savers.
    expect(accountTypeOf("Kids' Super Savers Club Account*", "monthly maintenance fee if minimum balance is not maintained")).toBe("savings");
  });

  it("keeps a checking product checking, whatever the fee's words", () => {
    expect(accountTypeOf("Regular Checking", "Monthly fee (savings linked)")).toBeNull();
    expect(accountTypeOf("Club Five CheckingSM", "Monthly fee")).toBeNull();
    // "Money Market Checking" is a money market account; a business checking account is business.
    expect(accountTypeOf("Money Market Checking Account (Silver Account Type)", "Monthly Maintenance Charge")).toBe("money_market");
    expect(accountTypeOf("Business Interest Checking", "Monthly fee")).toBe("business");
  });

  it("reads the fee's name when no product is recorded", () => {
    expect(accountTypeOf(null, "Statement Savings monthly fee")).toBe("savings");
    expect(accountTypeOf(null, "Monthly Service Charge - Classic Money Market")).toBe("money_market");
    expect(accountTypeOf(null, "Commercial Checking monthly maintenance fee")).toBe("business");
    expect(accountTypeOf(null, "Monthly Maintenance Fee")).toBeNull();
    expect(accountTypeOf("", "Checking monthly service charge")).toBeNull();
  });

  it("does not read a bare 'Club' package as a club savings account", () => {
    for (const product of ["VIP Club Account", "Century Club Account", "Prime Time Club", "Diamond Club"]) {
      expect(accountTypeOfText(product), product).toBeNull();
    }
  });

  it("round-trips the flag", () => {
    expect(heldAccountType(["agentic_darwin_verified", accountTypeFlag("money_market")])).toBe("money_market");
    expect(heldAccountType(["account_type_checked:v1"])).toBeNull();
    expect(heldAccountType(["account_type:bogus"])).toBeNull();
  });
});
