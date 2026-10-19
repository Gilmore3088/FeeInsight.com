// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { capFirstItemPrices, pricesForStackedLabel, stackedFeePrices } from "@/lib/custom-report/stacked-fee-prices";
import { candidateWriteFacts } from "./candidate-facts";

const source = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
const pair = [
  "Check Images",
  "• $10.00 (Consumer Only) per statement",
  "Copy of canceled check image",
  "• $5.00 per image",
].join("\n");
const program = "Ready Reserve Overdraft Protection Fee\n• $25.00 (annually)\nStop Payment Fee\n• $35.00 per request";

describe("#2240/#2241 explicit stacked price ownership", () => {
  it("keeps the own Check Images price and the distinct canceled-copy identity in the repaired official text", () => {
    const result = runFreeSpecialists(source);
    expect(result.candidates.filter(row => row.feeName === "Check Images").map(row => row.amount)).toEqual([10]);
    expect(result.candidates).toContainEqual(expect.objectContaining({ feeName: "Copy of canceled check image", amount: 5 }));
  });

  it("refuses a neighboring amount when an explicit exact label owns another price", () => {
    expect(checkFeeAgainstSource(pair, "Check Images", 5, ".", "check_image")).toEqual({ ok: false, reason: "amount_not_the_fee" });
    expect(checkFeeAgainstSource(pair, "Check Images", 10, ".", "check_image").ok).toBe(true);
    expect(checkFeeAgainstSource(pair, "Copy of canceled check image", 5, ".", "check_image").ok).toBe(true);
  });

  it("retains the annual program as a non-promotable raw hold with its own annual clause", () => {
    const result = runFreeSpecialists(source);
    expect(result.candidates.filter(row => row.feeName === "Ready Reserve Overdraft Protection Fee")).toEqual([]);
    expect(result.held).toContainEqual(expect.objectContaining({
      shape: "periodic_program",
      feeName: "Ready Reserve Overdraft Protection Fee",
      amount: 25,
      frequency: "annual",
      excerpt: expect.stringContaining("(annually)"),
    }));
  });

  it("uses the same annual-program refusal at the shared source admission boundary", () => {
    expect(checkFeeAgainstSource(program, "Ready Reserve Overdraft Protection Fee", 25, ".", "overdraft")).toEqual({
      ok: false,
      reason: "amount_not_the_fee",
    });
    const perItem = program.replace("(annually)", "per item paid");
    expect(checkFeeAgainstSource(perItem, "Ready Reserve Overdraft Protection Fee", 25, ".", "overdraft").ok).toBe(true);
    const neighbor = "Ready Reserve Overdraft Protection Fee\n• $25 per item paid\nSafe Deposit Box Annual Fee\n• $50 annually";
    expect(checkFeeAgainstSource(neighbor, "Ready Reserve Overdraft Protection Fee", 25, ".", "overdraft").ok).toBe(true);
  });

  it("keeps multiple own prices under one heading rather than reducing a legitimate price run to its first tier", () => {
    const rows = stackedFeePrices("Overdraft Protection Fee\n• $20 per item\n• $30 per item\nStop Payment Fee\n• $35 per request");
    expect(pricesForStackedLabel(rows, "Overdraft Protection Fee").map(row => row.amount)).toEqual([20, 30]);
    expect(rows.every(row => !row.annualProgram)).toBe(true);
  });

  it("makes no ownership refusal across an unknown continuation, table, malformed price or exceeded run budget", () => {
    for (const text of [
      "Check Images\n• $10 per statement\nadditional terms continue here\nCopy of canceled check image\n• $5 per image",
      "Check Images | Other fee\n• $10 per statement\nCopy of canceled check image\n• $5 per image",
      "Check Images\n• $10.000 per statement\nCopy of canceled check image\n• $5 per image",
      "Check Images\n" + Array.from({ length: 5 }, (_, i) => `• $${10 + i} per item`).join("\n") + "\nOther Service Fee\n• $5 per image",
    ]) {
      expect(pricesForStackedLabel(stackedFeePrices(text), "Check Images")).toEqual([]);
    }
  });

  it("does not mistake an annual waiver for an annual program price or spread its refusal to another category", () => {
    const waiver = program.replace("(annually)", "(1 waived annually)");
    expect(stackedFeePrices(waiver).find(row => row.label === "Ready Reserve Overdraft Protection Fee")?.annualProgram).toBe(false);
    expect(checkFeeAgainstSource(waiver, "Ready Reserve Overdraft Protection Fee", 25, ".", "overdraft").ok).toBe(true);
    expect(checkFeeAgainstSource(program, "Ready Reserve Overdraft Protection Fee", 25, ".", null).ok).toBe(true);
  });

  it.each([false, true])("does not override another explicit same-name table price (table first=%s)", tableFirst => {
    const inline = "Check Images | $5 per statement";
    const text = tableFirst ? `${inline}\n${pair}` : `${pair}\n${inline}`;
    expect(checkFeeAgainstSource(text, "Check Images", 5, ".", "check_image").ok).toBe(true);
    const itemPrice = "Ready Reserve Overdraft Protection Fee | $25 per item paid";
    const mixed = tableFirst ? `${itemPrice}\n${program}` : `${program}\n${itemPrice}`;
    expect(checkFeeAgainstSource(mixed, "Ready Reserve Overdraft Protection Fee", 25, ".", "overdraft").ok).toBe(true);
    expect(runFreeSpecialists(mixed).held).not.toContainEqual(expect.objectContaining({ shape: "periodic_program" }));
  });

  it("leaves bare-price/price-first tables and incompletely bound repeated labels with their existing witnesses", () => {
    const bare = "Check Images\n$10 per statement\nCopy of canceled check image\n$5 per image";
    expect(stackedFeePrices(bare)).toEqual([]);
    const repeated = `${pair}\nCheck Images\n$5 per statement\nAdditional account terms continue`;
    expect(checkFeeAgainstSource(repeated, "Check Images", 5, ".", "check_image").ok).toBe(true);
  });

  it("keeps the literal own item price after its leading maximum, never the maximum as an item price", () => {
    const read = runFreeSpecialists(source);
    const savings = read.candidates.find(row => row.feeName === "Overdraft Fee Savings" && row.amount === 35);
    expect(savings).toBeDefined();
    expect(savings?.frequency).toBe("per_item");
    expect(candidateWriteFacts(savings!).sourceConditions).toContain("$140.00 Maximum. $35.00 per item");
    expect(read.candidates.some(row => row.amount === 140 && ["nsf", "overdraft"].includes(row.canonicalHint))).toBe(false);
    expect(checkFeeAgainstSource(source, "Overdraft Fee Savings", 35, ".", "overdraft").ok).toBe(true);
  });

  it("never admits an eligibility label through the standard cap-first price reader", () => {
    for (const label of ["NSF Fee for Ages 18 and Under", "Overdraft Fee for Youth Accounts", "Overdraft Fee for Senior Accounts"]) {
      const text = `${label}\n• $140 Maximum. $5 per item`;
      expect(capFirstItemPrices(text), label).toEqual([]);
      expect(runFreeSpecialists(text).candidates, label).toEqual([]);
    }
  });

  it("does not treat a smaller maximum as an item price", () => {
    const text = "Overdraft Fee\n• $25.00 Maximum. $5.00 per item";
    expect(runFreeSpecialists(text).candidates.map(row => row.amount)).toEqual([5]);
    expect(checkFeeAgainstSource(text, "Overdraft Fee", 25, ".", "overdraft").ok).toBe(false);
  });

  it("keeps a nearby explicit eligibility heading as a hold, never a new standard price", () => {
    for (const heading of ["Youth Checking (ages 18 and under)", "Senior Checking", "Student Accounts"]) {
      const text = `${heading}\nNSF Fee\n• $140 Maximum. $5 per item`;
      const read = runFreeSpecialists(text);
      expect(read.candidates, heading).toEqual([]);
      expect(read.held, heading).toContainEqual(expect.objectContaining({
        shape: "eligibility", amount: 5, linkedConditions: heading,
      }));
    }
    const section = "Youth Checking Account\nNSF Fee\n• $140 Maximum. $5 per item\nOverdraft Fee\n• $140 Maximum. $5 per item";
    const both = runFreeSpecialists(section);
    expect(both.candidates).toEqual([]);
    expect(both.held.filter(row => row.shape === "eligibility").map(row => row.feeName)).toEqual(["NSF Fee", "Overdraft Fee"]);
    expect(both.held.filter(row => row.shape === "eligibility").every(row => row.linkedConditions === "Youth Checking Account")).toBe(true);
    const unknown = section.replace("Overdraft Fee\n", "Additional terms continue\nOverdraft Fee\n");
    expect(runFreeSpecialists(unknown).candidates).toEqual([]);
    const reset = section.replace("Overdraft Fee\n", "Standard Fees\nOverdraft Fee\n");
    expect(runFreeSpecialists(reset).candidates).toContainEqual(expect.objectContaining({ feeName: "Overdraft Fee", amount: 5 }));
  });

  it("requires a complete literal item-price clause and never borrows a neighbor, threshold or other category", () => {
    for (const text of [
      "Overdraft Fee\n• $140 Maximum.",
      "Overdraft Fee\n• $140 Minimum. $35 per item",
      "Overdraft Fee\n• $10 Maximum. $35 per item",
      "Overdraft Fee\n• $140.000 Maximum. $35 per item",
      "Overdraft Fee\n• $140 Maximum. $35 per item if balance below $10",
      "Overdraft Protection Transfer Fee\n• $140 Maximum. $35 per item",
      "Deposited Item Return Fee\n• $140 Maximum. $35 per item",
      "Overdraft Fee\nOther Service Fee\n• $140 Maximum. $35 per item",
    ]) expect(capFirstItemPrices(text), text).toEqual([]);
    const text = "Overdraft Fee\n• $25 Maximum. $5 per item\nOverdraft Fee | $25 per item";
    expect(checkFeeAgainstSource(text, "Overdraft Fee", 25, ".", "overdraft").ok).toBe(true);
    expect(checkFeeAgainstSource(source, "Overdraft Fee Savings", 35, "unrelated category", "overdraft").ok).toBe(false);
    expect(checkFeeAgainstSource(source, "Overdraft Fee Savings", 35, ".", "deposited_item_return").ok).toBe(false);
    expect(checkFeeAgainstSource(source, "Overdraft Fee Savings", 35, ".", "nsf").ok).toBe(false);
    expect(checkFeeAgainstSource(source, "Insufficient Funds Return Item Charge", 35, ".", "overdraft").ok).toBe(false);
  });
});
