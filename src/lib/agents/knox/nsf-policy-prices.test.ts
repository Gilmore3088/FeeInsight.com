// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { runFreeSpecialists } from "./specialists";
import { candidateWriteFacts } from "./candidate-facts";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { nsfPolicyPrices, chargedFeeCountTotal } from "@/lib/custom-report/nsf-policy-prices";

const policy = readFileSync(new URL("./__fixtures__/newvalley-nsf-policy.txt", import.meta.url), "utf8");
const exemption = "NOTE: The election for ATM withdrawals and everyday debit card transactions does not apply to Rise Checking Accounts. NSF fees will not be charged to a Rise Checking account.";
const text = [
  exemption,
  "Overdraft Protection Fee",
  "$5.00 for each day there is a transfer from another account to cover one or more overdrafts in a checking account.",
  policy,
].join("\n");
const itemFees = (source = text) => runFreeSpecialists(source).candidates.filter(
  candidate => candidate.canonicalHint === "nsf" || candidate.canonicalHint === "overdraft",
);
const itemObservations = () => {
  const result = runFreeSpecialists(text);
  return [...itemFees(), ...result.held.filter(c => c.shape === "eligibility")];
};

describe("#2209: price-first returned/paid-item policy paragraphs", () => {
  it("reads both stated item prices into distinct NSF/paid-overdraft twins, never cap totals or the balance cushion", () => {
    const rows = itemFees();
    expect(rows.map(c => [c.canonicalHint, c.amount]).sort()).toEqual([
      ["nsf", 34],
      ["overdraft", 34],
    ].sort());
    const all = itemObservations();
    expect(all.map(c => [c.canonicalHint, c.amount]).sort()).toEqual([
      ["nsf", 5],
      ["nsf", 34],
      ["overdraft", 5],
      ["overdraft", 34],
    ].sort());
    for (const c of all) {
      expect(c.frequency).toBe("per_item");
      expect(checkFeeAgainstSource(text, c.feeName, c.amount!, ".", c.canonicalHint).ok).toBe(true);
    }
    expect(all.filter(c => c.lineShare?.startsWith("twin:"))).toHaveLength(2);
    expect(runFreeSpecialists(text).held.filter(c => c.shape === "eligibility")).toHaveLength(2);
  });
  it("persists the complete price paragraph and the correct variant's explicit exceptions", () => {
    for (const c of itemObservations()) {
      const facts = {
        sourceConditions: "shape" in c
          ? [c.excerpt, c.linkedConditions].join(" ")
          : candidateWriteFacts(c).sourceConditions,
      };
      expect(facts.sourceConditions).toContain("less than $10.00");
      expect(facts.sourceConditions).toContain(c.amount === 34 ? "($136)" : "($20)");
      expect(facts.sourceConditions).toContain("Rise Checking account");
      if (c.amount === 5) {
        expect(facts.sourceConditions).toContain("18/65 checking product");
        expect(facts.sourceConditions).toContain("18 or younger or 65 and older");
        expect(facts.sourceConditions).not.toContain("($136)");
        expect(facts.sourceConditions).not.toContain("Other stated price tier:");
      }
      else {
        const [own, alternate] = facts.sourceConditions!.split("Other stated price tier:");
        expect(own).toContain("($136)");
        expect(own).not.toContain("($20)");
        expect(own).not.toContain("18/65 checking product");
        expect(alternate).toContain("$5.00 for each item");
        expect(alternate).toContain("18/65 checking product");
        expect(alternate).toContain("($20)");
      }
    }
  });
  it("refuses cumulative dollar totals through the shared live-source check, including when a legitimate item elsewhere costs the same", () => {
    const elsewhere = text + "\nNSF Fee | $20.00 per item";
    for (const amount of [136, 20]) {
      expect(checkFeeAgainstSource(
        elsewhere,
        "Your account has already been charged a total of 4 NSF fees (",
        amount,
        ".",
        "nsf",
      )).toEqual({ ok: false, reason: "amount_not_the_fee" });
    }
    expect(checkFeeAgainstSource(elsewhere, "NSF Fee", 20, ".", "nsf").ok).toBe(true);
  });
  it("does not invent policy rows without the owning heading or from a table column/cap/threshold", () => {
    expect(itemFees(policy.replace("Insufficient Funds (NSF) Fee", "Other Information"))).toEqual([]);
    expect(itemFees("Insufficient Funds (NSF) Fee\nYour account has already been charged a total of 4 NSF fees ($136) for items processed for payment on that business day")).toEqual([]);
    expect(itemFees("Insufficient Funds (NSF) Fee\n$34.00 | for each item we return due to insufficient funds or for each overdraft item we pay").some(c => c.ownedPolicy)).toBe(false);
  });
  it("holds incomplete, ambiguous equal-price or over-budget policies instead of truncating their scope", () => {
    expect(nsfPolicyPrices(policy.replaceAll("$5.00 for each item", "$34.00 for each item"))).toEqual([]);
    expect(nsfPolicyPrices(policy.replaceAll("Your account has already been charged a total of 4 NSF fees", "Unresolved policy"))).toEqual([]);
    expect(nsfPolicyPrices(policy.replace("Funds Availability", "An additional scope term " + "word ".repeat(900)))).toEqual([]);
    const after = nsfPolicyPrices(text.replace("Funds Availability", "Unrelated Service\nOther account costs $99.00 and belongs only to that service."));
    expect(after).toHaveLength(2);
    expect(after.every(c => !c.linkedConditions.includes("$99.00"))).toBe(true);
    expect(nsfPolicyPrices(text.replace("Funds Availability", "another product costs $99 and has unrelated eligibility."))).toEqual([]);
    expect(nsfPolicyPrices(text.replace("$5.00 for each item", "$5.00 for unrelated activity"))).toEqual([]);
  });
  it("treats the dollar total as a count cap only for its own explicit clause and price", () => {
    const cap = "Your account has already been charged a total of 4 NSF fees ($136) for items processed for payment on that business day";
    expect(chargedFeeCountTotal(cap, 136)).toBe(true);
    expect(chargedFeeCountTotal(cap, 34)).toBe(false);
    expect(chargedFeeCountTotal(cap.replace("$136)", "$136.000)"), 136)).toBe(false);
    expect(chargedFeeCountTotal("NSF Fee | $34 per item, maximum 4 fees per business day", 34)).toBe(false);
    expect(checkFeeAgainstSource("Overdraft Protection Transfer Fee | $5.00 per day", "Overdraft Protection Transfer Fee", 5, ".", "od_protection_transfer").ok).toBe(true);
  });
  it("never extends the returned/paid-item witness to transfer, deposited-return or cap categories", () => {
    for (const key of ["deposited_item_return", "od_protection_transfer", "od_daily_cap", "nsf_daily_cap"]) {
      expect(checkFeeAgainstSource(text, "NSF/Overdraft Fee", 34, ".", key).ok).toBe(false);
    }
    expect(checkFeeAgainstSource(text, "NSF/Overdraft Fee", 34, ".", null).ok).toBe(true);
    expect(checkFeeAgainstSource(text, "NSF/Overdraft Fee", 34, "wire", "nsf").ok).toBe(false);
  });
});
