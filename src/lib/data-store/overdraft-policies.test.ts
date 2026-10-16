import { describe, it, expect } from "vitest";
import { capScopeOf, classifyPolicyLine, cleanAccountName } from "./overdraft-policies";

const line = (category: string, fee_name: string, account: string | null = null, url: string | null = null) => ({ category, fee_name, account, url });

// James's guides review (Oct 16 2026): the comparison showed lines from other products beside
// deposit-account fees. These are the rows he named.
describe("account comparison lines", () => {
  it("excludes lines from other products", () => {
    expect(classifyPolicyLine(line("monthly_maintenance", "Tax Service Charge"))).toBe("exclude");
    expect(classifyPolicyLine(line("nsf", "Home Equity Line Check returned (due to non-sufficient funds)"))).toBe("exclude");
    expect(classifyPolicyLine(line("nsf", "Returned check", null, "https://www.usbank.com/investing/online-investing/self-directed-investing/fees.html"))).toBe("exclude");
  });

  it("keeps deposit-account lines and savings or credit-line transfers", () => {
    expect(classifyPolicyLine(line("nsf", "Returned Check Fee", null, "https://www.usbank.com/dam/en/documents/pdfs/disclosures/consumer-pricing-information.pdf"))).toBe("listed");
    expect(classifyPolicyLine(line("od_protection_transfer", "Overdraft Protection Transfer fee, per daily transfer (from Checking, Savings, Lines of Credit and CheckLoans)"))).toBe("listed");
    expect(classifyPolicyLine(line("monthly_maintenance", "Flagship Checking Monthly Fee", "Flagship Checking"))).toBe("listed");
  });

  it("asks for verification when a monthly charge names no account or reads like a waiver", () => {
    expect(classifyPolicyLine(line("monthly_maintenance", "Monthly Maintenance Fee with no minimum balance requirement"))).toBe("verify");
    expect(classifyPolicyLine(line("overdraft", "Maintenance Fee waived on every Smartly Checking account", "Smartly Checking"))).toBe("verify");
  });

  it("cleans page furniture from account names", () => {
    expect(cleanAccountName("Learn about Bank Smartly Checking")).toBe("Bank Smartly Checking");
    expect(cleanAccountName(null)).toBeNull();
  });

  it("reads a daily limit's scope from its name", () => {
    expect(capScopeOf(["Maximum overdraft and NSF fees per day", "Overdraft fee daily maximum", "Daily limit"])).toEqual({ overdraft: 1, nsf: 0, both: 1, unstated: 1 });
  });
});
