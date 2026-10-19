// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { feeBullets, FEE_BULLET_MAX_CHARS, FEE_BULLET_MAX_LINES } from "@/lib/custom-report/fee-bullets";
import { publishNameHold } from "@/lib/agents/hamilton/publish";
import { runFreeSpecialists } from "./specialists";
import { extractCandidatesFromText } from "./rules";
import { officialFeeDisclosure, wrappedPair } from "./wrapped-bullet-fixtures";

const targets = (text: string) => runFreeSpecialists(text).candidates.filter((row) => ["nsf", "overdraft"].includes(row.canonicalHint));

describe("Owned wrapped fee bullets (#2151)", () => {
  let official: string;
  beforeAll(async () => { official = await officialFeeDisclosure(); });
  it("reads both complete fee bullets from the unchanged current official PDF", () => {
    const rows = targets(official).filter((row) => row.amount === 22);
    expect(rows.map((r) => [r.canonicalHint, r.amount]).sort()).toEqual([["nsf", 22], ["overdraft", 22]]);
    for (const row of rows) {
      expect(row.feeName).toBe(row.canonicalHint === "nsf" ? "NSF" : "Standard Overdraft");
      expect(publishNameHold(row.feeName, row.canonicalHint, row.amount)).toBeNull();
      expect(row.excerpt).toContain(row.canonicalHint === "nsf" ? "and returned" : "and paid");
      expect(row.excerpt).toContain("payment");
      expect(row.linkedConditions).toBe("*No more than three NSF or Overdraft fees are charged per share, per day.");
      expect(row.excerpt).not.toContain("per day");
      const witness = checkFeeAgainstSource(official, row.feeName, row.amount, ".", row.canonicalHint);
      expect(witness).toMatchObject({ ok: true });
      if (witness.ok) {
        expect(witness.sourceLine).toContain(row.canonicalHint === "nsf" ? "and returned" : "and paid");
        expect(witness.sourceLine).not.toContain(row.canonicalHint === "nsf" ? "and paid" : "and returned");
        expect(witness.sourceLine).not.toContain("per day");
      }
    }
  });
  it.each([false, true])("keeps unequal paid/returned prices in reverse order=%s", (reverse) => {
    const text = wrappedPair({ returned: 25, paid: 22, reverse });
    expect(targets(text).map((r) => [r.canonicalHint, r.amount]).sort()).toEqual([["nsf", 25], ["overdraft", 22]]);
    expect(checkFeeAgainstSource(text, "NSF", 22, ".", "nsf").ok).toBe(false);
    expect(checkFeeAgainstSource(text, "Standard Overdraft", 25, ".", "overdraft").ok).toBe(false);
  });
  it.each([10, 100, 400])("formatting leaders of %i characters never erase or reprice a fee", (leaders) => {
    const rows = targets(wrappedPair({ returned: 25, paid: 22, leaders }));
    expect(rows.map((r) => [r.canonicalHint, r.amount]).sort()).toEqual([["nsf", 25], ["overdraft", 22]]);
    expect(rows.some((row) => [3, 66].includes(row.amount))).toBe(false);
  });
  it.each(["\n\n", "\n• Money order $5\n", "\nOther Fees\n", " | Cashier's check $10\n"])(
    "never joins the next price across barrier %j", (barrier) => {
      const text = "• Standard Overdraft — a payment item against insufficient funds" + barrier + "paid per item......................................$22";
      expect(targets(text).filter((r) => r.canonicalHint === "overdraft")).toEqual([]);
      expect(checkFeeAgainstSource(text, "Standard Overdraft", 22, ".", "overdraft").ok).toBe(false);
    },
  );
  it("leaves multicolumn wire/neighbor prices outside this single-column fix", () => {
    const text = "Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00\n(Free with Platinum Checking) | $20.00\nWire Transfers – International\n(Free with Platinum Checking) | $40.00";
    expect(runFreeSpecialists(text).candidates.filter((r) => r.canonicalHint.startsWith("wire_"))).toEqual([]);
  });
  it("keeps ordinary priced/free bullet rows with the existing readers", () => {
    for (const price of ["$22", "FREE"]) {
      const text = `• NSF — returned item ${price}`;
      expect(feeBullets(text)).toEqual([]);
      const read = runFreeSpecialists(text);
      expect([...read.candidates, ...read.held].filter((r) => r.canonicalHint === "nsf").map((r) => r.amount)).toEqual([price === "FREE" ? 0 : 22]);
    }
  });
  it("diagnoses line and character budgets without letting fragments supply the fee", () => {
    for (const text of [
      ["• Standard Overdraft — a payment against insufficient funds", ...Array.from({ length: FEE_BULLET_MAX_LINES }, () => "payment conditions continue"), "paid............................$22"].join("\n"),
      `• Standard Overdraft — a payment against insufficient funds\n${"conditions ".repeat(FEE_BULLET_MAX_CHARS)}\npaid............................$22`,
    ]) {
      expect(feeBullets(text)[0].problem).toBe("budget");
      expect(extractCandidatesFromText(text).dropped?.wrapped_bullet_unresolved).toBe(1);
      expect(targets(text)).toEqual([]);
      expect(checkFeeAgainstSource(text, "Standard Overdraft", 22, ".", "overdraft").ok).toBe(false);
    }
  });
  it("does not turn balance thresholds, multi-price caps or rates into a terminal price", () => {
    for (const continuation of [
      "below a $100 balance............................$22",
      "paid $22 per item, maximum $66 per day",
      "paid............................$22 plus 1%",
      "paid............................$22-$66",
    ]) {
      const text = `• Standard Overdraft — a payment against insufficient funds\n${continuation}`;
      expect(targets(text)).toEqual([]);
      expect(checkFeeAgainstSource(text, "Standard Overdraft", 22, ".", "overdraft").ok).toBe(false);
    }
  });
  it.each([
    "• Monthly Maintenance — waived with minimum balance................$100",
    "• Monthly Maintenance — waived with\nminimum balance................$100",
    "• Standard Overdraft — not charged when a balance is below................$100",
    "• ATM Withdrawal — free for the first allowance................$100",
  ])("never projects a single-dollar condition into a fee: %s", (text) => {
    expect(runFreeSpecialists(text).candidates).toEqual([]);
  });
  it.each(["\n\n", "\n• Another service\n", "\n• Wire Transfer — another service........$10\n"])(
    "does not attach a count-cap note across an unrelated boundary %j", (barrier) => {
      const text = "• NSF — a returned payment*........$22" + barrier + "*No more than three NSF fees are charged per day.";
      expect(feeBullets(text)[0].linkedConditions).toBeNull();
    },
  );
  it("keeps dollar-valued totals out of linked count-cap conditions", () => {
    const text = "• NSF — a returned payment*........$22\n*No more than $66 in NSF fees are charged per day.";
    expect(feeBullets(text)[0].linkedConditions).toBeNull();
  });
  it("keeps a separately priced dollar daily cap in its own category", () => {
    const text = "• Maximum Daily Overdraft Fees — maximum total overdraft charges\ncharged each day............................$66";
    expect(targets(text)).toEqual([]);
    expect(runFreeSpecialists(text).candidates.map((r) => [r.canonicalHint, r.amount])).toContainEqual(["od_daily_cap", 66]);
  });
  it("retains each owned row's explicit audience and price unit", () => {
    const text = [
      "• NSF — for consumer accounts only, a returned payment\nreturned............................$25 per item",
      "• NSF — for business accounts only, a returned payment\nreturned............................$22 per item",
    ].join("\n");
    expect(targets(text).map((r) => [r.feeAudience, r.amount, r.frequency]).sort()).toEqual([
      ["business", 22, "per_item"], ["consumer", 25, "per_item"],
    ]);
  });
  it("keeps nearby payroll/card service rows separate from paid/returned fees", () => {
    const text = [
      "• Payroll Deduction — a payment from an employer to a member\npayment............................$10",
      "• Debit Card Replacement — a card used for purchases or overdraft payments\nreplacement............................$7",
    ].join("\n");
    expect(targets(text)).toEqual([]);
    expect(runFreeSpecialists(text).candidates.filter((r) => r.canonicalHint === "card_replacement").map((r) => r.amount)).toEqual([7]);
  });
  it("does not refile ACH, deposited-item or transfer siblings as a paid/returned overdraft pair", () => {
    const text = [
      "• ACH Origination — a separately requested electronic service\npaid............................$7",
      "• Deposited Item Returned — another bank's deposited check\nreturned............................$9",
      "• Overdraft Transfer — a transfer from a savings account\npaid............................$5",
      "• ATM Withdrawal — a separately requested transaction FREE",
    ].join("\n");
    expect(targets(text)).toEqual([]);
    expect(runFreeSpecialists(text).candidates.filter((r) => r.canonicalHint === "od_protection_transfer").map((r) => r.amount)).toEqual([5]);
  });
});
