// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collectionSectionReturn } from "./collection-section-return";
import { checkFeeAgainstSource } from "./source-check";

// U.S. Bank (institution 5, doc 20724, stored text 16610): live 75929 "Returned Check Fee" $35, filed as NSF.
const usBank = [
  "Consumer Pricing Information | Effective August 10, 2026 | page 12",
  "",
  "FOREIGN CHECKS/CURRENCY FEES",
  "Checks Deposited in Foreign Currency on Foreign Banks",
  "All checks subject to review. If item must be processed on a collection basis, U.S. Bank will disclose additional",
  "fees prior to assessing. See Foreign Check Collection section for potential fees. Return rate subject to sell rates in",
  "effect on return date.",
  "Foreign Check Collection (incoming/outgoing)",
  "Courier Fee (per check) | $55.00",
  "Initiation Fee (per check) | $55.00",
  "Tracer Fee | $50.00",
  "Returned Check Fee | $35.00",
  "Checks on Canadian Banks (non-collection) | $6.00",
  "Checks on Select Countries/Banks (non-collection) | $12.00",
].join("\n");

// BankUnited (institution 64, doc 15894, stored text 10197): live 56558 "Returned Items" $25 and 109208
// "Return Items" $25, both filed as NSF; its own NSF fee is in the overdraft section further down.
const bankUnited = [
  "SERVICE | FEE DESCRIPTION | FEE AMOUNT",
  "ATM Access-Non-BankUnited ATM | $2.50",
  "(A $2.50 fee will be charged for each transaction performed at",
  "a non-proprietary ATM. Fees charged by the ATM owner/operator",
  "may also apply.)",
  "COLLECTIONS | Domestic (in) | $15",
  "Domestic (out) | $15",
  "Express Canadian Check Collection | $100",
  "Foreign Clean Collection | $50",
  "Returned Items | $25",
  "(Out-of-pocket and correspondent bank fees may apply)",
  "Tracers | $25",
  "FOREIGN CHECK CLEARING | Cash Letter | $10",
  "Return Items | $25",
  "(Correspondent bank return item fee may apply)",
  "LEGAL PROCESSING FEE | Processing of any garnishment, tax levy, or other court | $100",
  "OVERDRAFT FEES | Overdrawn Account Balance (per day account is overdrawn) | No charge",
].join("\n");

describe("a return charge in a foreign check or collection section is not NSF (#1912)", () => {
  it("reads the collection heading above the fee's line, or in its own row's first cell", () => {
    expect(collectionSectionReturn(usBank, "Returned Check Fee", 35)).toBe(true);
    expect(collectionSectionReturn(bankUnited, "Returned Items", 25)).toBe(true);
    expect(collectionSectionReturn(bankUnited, "Return Items", 25)).toBe(true);
    expect(collectionSectionReturn("FOREIGN CHECK CLEARING | Return Items | $25", "Return Items", 25)).toBe(true);
  });

  it("each mover traces on its own line under the returned deposited item type", () => {
    for (const [text, name, amount] of [[usBank, "Returned Check Fee", 35], [bankUnited, "Returned Items", 25], [bankUnited, "Return Items", 25]] as const) {
      expect(checkFeeAgainstSource(text, name, amount, ".", "deposited_item_return").ok, name).toBe(true);
    }
  });

  it("stops at the overdraft heading, another heading, a sentence or an unrelated row", () => {
    const flat = ["Foreign Checks deposits | $5.00", "Courtesy Pay or NSF Fee | $30.00", "Return Item | $30.00"].join("\n");
    expect(collectionSectionReturn(flat, "Return Item", 30)).toBe(false);
    const between = ["Foreign (International) Checks", "Collection | $40", "Overdraft and NSF Fees", "Returned Item | $15"].join("\n");
    expect(collectionSectionReturn(between, "Returned Item", 15)).toBe(false);
    const other = ["**COLLECTIONS**", "- Customer $9", "**SERVICE FEES**", "- Return item fee $25"].join("\n");
    expect(collectionSectionReturn(other, "Return item fee", 25)).toBe(false);
    const sentence = ["COLLECTION OF NON-CASH DEPOSITS", "Every share draft, check or other item other than cash that is presented", "Return Item | $25"].join("\n");
    expect(collectionSectionReturn(sentence, "Return Item", 25)).toBe(false);
    const row = ["Check Collection Fee (Domestic or Foreign) $25.00", "Letter of Protest $15.00", "Returned Check $25.00"].join("\n");
    expect(collectionSectionReturn(row, "Returned Check", 25)).toBe(false);
  });

  it("reads a flat table row as a row, not a heading, and a second column as its own", () => {
    expect(collectionSectionReturn("Collection Items | $20 | each\nReturned Item | $30 | each", "Returned Item", 30)).toBe(false);
    const twoColumns = ["Collection Items", "Domestic........ $15.00 | Returned Item Fee (Non-profit account) ......$5.00"].join("\n");
    expect(collectionSectionReturn(twoColumns, "Returned Item Fee (Non-profit account)", 5)).toBe(false);
  });

  it("needs every priced place of the name in the section, and a plain return name", () => {
    const twice = [bankUnited, "OVERDRAFT FEES", "Overdraft Item | $25", "Returned Items | $25"].join("\n");
    expect(collectionSectionReturn(twice, "Returned Items", 25)).toBe(false);
    expect(collectionSectionReturn(usBank, "NSF Returned Check Fee", 35)).toBe(false);
    expect(collectionSectionReturn(usBank, "Tracer Fee", 50)).toBe(false);
    expect(collectionSectionReturn(null, "Returned Check Fee", 35)).toBe(false);
  });
});
