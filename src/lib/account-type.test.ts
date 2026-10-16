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

  it("never reads a disclosure title, a perk or the bank's own name as the account (#1566 review, prod rows)", () => {
    // Reg DD disclosure titles: checking fees under a "Truth in Savings" heading.
    const disclosures: Array<[number, string, string, string]> = [
      [27284, "Truth in Savings", "Monthly Maintenance Fee", "First Merchants Bank"],
      [45588, "Truth-In-Savings Fee Schedule", "Monthly Service", "Fox Federal Credit Union"],
      [90954, "TRUTH IN SAVINGS ACT", "Maintenance Fee", "Brannen Bank"],
      [98695, "CONSUMER TRUTH-IN-SAVINGS FEE SCHEDULE", "Perks+ Monthly Service Charge", "Georgia'S Own Federal Credit Union"],
      [104925, "TRUTH IN SAVINGS", "Personal Checking Service charge", "The First National Bank in Sioux Falls"],
      [140764, "Truth In Savings", "Monthly service charge", "Community National Bank in Monmouth"],
      [140765, "Truth In Savings", "Monthly service charge", "Community National Bank in Monmouth"],
      [140766, "Truth In Savings", "Monthly service charge", "Community National Bank in Monmouth"],
    ];
    // BaZing's "Health Savings Card" is a perk inside checking packages, not an HSA.
    const perks: Array<[number, string, string, string]> = [
      [67940, "Health Savings Card", "Monthly Fee", "One Federal Credit Union"],
      [112800, "Health Savings Card", "Monthly Fee", "Central National Bank"],
      [112801, "Health Savings Card", "Monthly Fee", "Central National Bank"],
      [136696, "Health Savings Card", "monthly fee", "Red Rocks Federal Credit Union"],
      [137007, "Health Savings Card", "Monthly fee", "Membersource Federal Credit Union"],
      [140866, "Health Savings Card", "Monthly fee", "Kh Credit Union, Inc."],
    ];
    // The bank's own name.
    const names: Array<[number, string, string, string]> = [
      [142774, "Free Bangor Savings Bank Debit Mastercard®", "monthly service charge waived by maintaining a + balance", "Bangor Savings Bank"],
    ];
    for (const [id, product, fee, bank] of [...disclosures, ...perks, ...names]) {
      expect(accountTypeOf(product, fee, bank), String(id)).toBeNull();
    }
    // Without the institution's name, a "Savings Bank" name still names no account.
    expect(accountTypeOf("Free Bangor Savings Bank Debit Mastercard®", "monthly service charge")).toBeNull();
    // A real HSA and a real savings account still read as theirs.
    expect(accountTypeOf("Health Savings Account (HSA)", "Monthly fee", "Central National Bank")).toBe("ira_hsa_cd");
    expect(accountTypeOf("Statement Savings", "Monthly fee", "Bangor Savings Bank")).toBe("savings");
  });

  it("takes the fee's own name when it says checking", () => {
    expect(accountTypeOf("Statement Savings", "Personal Checking Service charge")).toBeNull();
    expect(accountTypeOf("Savings Accounts", "Business Checking Monthly Fee")).toBe("business");
  });
});
