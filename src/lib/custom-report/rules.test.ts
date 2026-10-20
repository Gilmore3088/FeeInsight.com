import { describe, expect, it } from "vitest";
import { FEE_LINE_RULES } from "./rules";

/** The rules run as Postgres `~*`; \m and \M are its word boundaries. */
function matches(pattern: string, text: string): boolean {
  return new RegExp(pattern.replace(/\\[mM]/g, "\\b"), "i").test(text);
}

function counts(key: string, feeName: string): boolean {
  const rule = FEE_LINE_RULES.find((r) => r.key === key)!;
  return matches(rule.include, feeName) && !matches(rule.exclude, feeName);
}

describe("fee line rules", () => {
  it("keeps small-item variants out of the overdraft and NSF lines (#1177)", () => {
    expect(counts("overdraft", "Overdraft Fee on item under $5")).toBe(false);
    expect(counts("overdraft", "Overdraft fee, items less than $10")).toBe(false);
    expect(counts("nsf", "NSF fee - item below $ 5")).toBe(false);
  });

  it("still counts the standard per-item fees, exemptions included", () => {
    expect(counts("overdraft", "Overdraft Fee (per item)")).toBe(true);
    expect(counts("overdraft", "Overdraft fee for items over $5")).toBe(true);
    expect(counts("nsf", "NSF / Returned Item Fee")).toBe(true);
    expect(counts("overdraft", "Overdraft Fee (no fee if overdrawn by less than $5)")).toBe(true);
    expect(counts("nsf", "NSF Fee, no charge for items under $5")).toBe(true);
    expect(counts("overdraft", "Paid Item Fee (waived on items below $10)")).toBe(true);
    expect(counts("overdraft", "Overdraft Fee - up to $35 per item")).toBe(true);
  });

  it("counts an out-of-network ATM fee that also covers inquiries, and not an inquiry-only fee", () => {
    expect(counts("atm_non_network", "ATM Network Usage Fee, for each inquiry, transfer or withdrawal at non-Capital City Bank ATM")).toBe(true);
    expect(counts("atm_non_network", "ATM Withdrawal/Inquiry on all other networks")).toBe(true);
    expect(counts("atm_non_network", "Foreign ATM Inquiry or Transfer Fee")).toBe(true);
    expect(counts("atm_non_network", "Foreign ATM balance inquiry")).toBe(false);
    expect(counts("atm_non_network", "ATM card replacement")).toBe(false);
  });
});
