import { describe, expect, it } from "vitest";
import { noChargeStatement, noChargeStatementsIn, statesNoChargeFor } from "@/lib/no-charge-statement";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

const read = (sentence: string) => {
  const statement = noChargeStatement(sentence);
  return statement ? [statement.canonicalKey, statement.feeName] : null;
};

describe("noChargeStatement (#2040)", () => {
  it("reads an unconditional sentence that names the fee as that fee's $0", () => {
    // Wells Fargo, doc 33356 (institution 4).
    expect(read("We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.")).toEqual(["nsf", "Returned item/non-sufficient funds (NSF) fee"]);
    expect(read("We do not charge a returned item/non-sufficient funds (NSF) fee for items we return unpaid.")).toEqual(["nsf", "Returned item/non-sufficient funds (NSF) fee"]);
    expect(read("The bank does not charge NSF fees.")).toEqual(["nsf", "NSF fee"]);
    expect(read("We do not charge an NSF fee for returned items.")).toEqual(["nsf", "NSF fee"]);
    expect(read("We do not charge a fee for an NSF return.")).toEqual(["nsf", "NSF return fee"]);
    expect(read("We do not assess fees for returned items or declined transactions.")).toEqual(["nsf", "Returned item fee"]);
    expect(read("We don't charge overdraft fees.")).toEqual(["overdraft", "Overdraft fee"]);
    expect(read("We never charge overdraft fees.")).toEqual(["overdraft", "Overdraft fee"]);
    expect(read("The credit union does not charge an overdraft item fee.")).toEqual(["overdraft", "Overdraft item fee"]);
    expect(read("We do not charge for overdraft protection transfers.")).toEqual(["od_protection_transfer", "Overdraft transfer fee"]);
    expect(read("We do not charge a transfer fee for overdraft protection transfers.")).toEqual(["od_protection_transfer", "Overdraft transfer fee"]);
    expect(read("We do not assess a fee for using our overdraft transfer service.")).toEqual(["od_protection_transfer", "Overdraft transfer fee"]);
    expect(read("We do not charge an overdraft protection transfer fee.")).toEqual(["od_protection_transfer", "Overdraft protection transfer fee"]);
  });

  it("reads the prod sentences of the Oct 26 dry run (current copies, each checked on its page)", () => {
    expect([
      "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.", // Wells Fargo 4, 172, 359
      "We don't assess fees for declined or returned transactions.", // Wells Fargo
      "We do not assess fees for returned items or declined transactions.", // Wells Fargo
      "The Bank does not charge NSF fees.", // HSBC 26
      "We do not charge an NSF fee for returned items.", // United Bank 67
      "We do not charge a fee for an NSF return.", // Cape & Coast Bank 678
      "We do not currently charge NSF fees.", // Grand Bank for Savings 2568
      "We do not charge a transfer fee for Overdraft Protection transfers.", // Regions 27
      "We do not charge for overdraft protection transfers.", // New Tripoli Bank 1424
    ].map(read)).toEqual([
      ["nsf", "Returned item/non-sufficient funds (NSF) fee"],
      ["nsf", "Returned item fee"],
      ["nsf", "Returned item fee"],
      ["nsf", "NSF fee"],
      ["nsf", "NSF fee"],
      ["nsf", "NSF return fee"],
      ["nsf", "NSF fee"],
      ["od_protection_transfer", "Overdraft transfer fee"],
      ["od_protection_transfer", "Overdraft transfer fee"],
    ]);
  });

  it("does not read a sentence that names no fee in the supported list", () => {
    expect(read("We do not charge for electronic fund transfers.")).toBeNull();
    expect(read("We do not charge a fee for using the Zelle® transfer service.")).toBeNull();
    expect(read("We do not charge interest for the NSF/UCF items.")).toBeNull();
    expect(read("We do not charge a fee.")).toBeNull();
    // A generic "a fee" names the event, not the fee: Fidelity Bank prints this for its bill pay service.
    expect(read("We do not charge a fee when we return an item unpaid due to insufficient funds in your account.")).toBeNull();
    // A returned deposited item is another fee.
    expect(read("We do not charge a returned deposited item fee.")).toBeNull();
    // Monthly maintenance is outside the supported list.
    expect(read("We do not charge a monthly maintenance fee.")).toBeNull();
    // One name, two categories.
    expect(read("We do not charge overdraft or NSF fees.")).toBeNull();
  });

  it("does not read a waiver, a band, an allowance or a cap", () => {
    expect(read("We do not charge an NSF fee if you deposit a check from someone else in good faith, but it bounces on you.")).toBeNull();
    expect(read("We do not charge an NSF fee when your account is overdrawn by $5 or less.")).toBeNull();
    expect(read("We do not charge overdraft fees on transactions under $5.")).toBeNull();
    expect(read("We do not charge overdraft fees on transactions under five dollars.")).toBeNull();
    expect(read("We do not charge a fee for the first overdraft each year.")).toBeNull();
    expect(read("We do not charge a fee for the first three overdraft protection transfers.")).toBeNull();
    expect(read("We will not charge more than 3 overdraft fees per day.")).toBeNull();
    expect(read("We will not charge more than three overdraft fees per day.")).toBeNull();
    expect(read("We do not charge more than three NSF fees per day.")).toBeNull();
    expect(read("We do not charge overdraft or NSF fees for one-time debit card or ATM transactions.")).toBeNull();
    expect(read("We do not charge overdraft fees on Assure Checking accounts.")).toBeNull();
    expect(read("We do not charge an overdraft item fee:")).toBeNull();
    expect(read("We do not charge another NSF fee for an item or transaction")).toBeNull();
    expect(read("We do not charge NSF fees at this time, but your retail")).toBeNull();
    expect(read("We do not charge transfer fees or advance fees for Overdraft Protection.")).toBeNull();
    expect(read("We don't charge a fee for setting up overdraft protection transfer service.")).toBeNull();
    expect(read("We do not charge a fee when a transaction is declined due to non-sufficient funds.")).toBeNull();
  });

  it("honours the negation's scope: only a sentence that opens on the bank and states its present policy", () => {
    expect(read("In that case, we will not charge an overdraft fee.")).toBeNull();
    expect(read("However, the credit union will not charge an overdraft fee.")).toBeNull();
    expect(read("We will not charge you an overdraft fee.")).toBeNull();
    expect(read("We won't charge NSF fees.")).toBeNull();
    expect(read("TD Essential Banking will not charge any overdraft fees.")).toBeNull();
    // "No longer": prod holds no unconditional such sentence, and the read cannot tell whether the copy is current.
    expect(read("We no longer charge NSF fees.")).toBeNull();
    expect(read("Effective March 1, we no longer charge NSF fees.")).toBeNull();
    // A sentence the line cuts off may go on to a condition on the next line (Monet Bank, text 2417).
    expect(read("We do not currently charge a Nonsufficient Funds (NSF) Fee")).toBeNull();
    expect(read("We do not currently charge a Nonsufficient Funds (NSF) Fee.")).toEqual(["nsf", "Nonsufficient Funds (NSF) Fee"]);
    // A footnote number glued on, or any figure, is no unconditional statement.
    expect(read("5We will not charge NSF fees.")).toBeNull();
  });

  it("finds statements by sentence on a line of prose, never in a table row", () => {
    const line = "If we don't pay a transaction into overdraft, it will be declined or returned unpaid. We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.";
    expect(noChargeStatementsIn(line).map((statement) => statement.canonicalKey)).toEqual(["nsf"]);
    // Fidelity Bank, doc 23446: the label cell makes it the bill pay service's terms.
    expect(noChargeStatementsIn("BILL PAY SERVICES NSF | We do not charge NSF fees.")).toEqual([]);
    expect(statesNoChargeFor(line, "Returned item/non-sufficient funds (NSF) fee")).toBe(true);
    expect(statesNoChargeFor(line, "NSF fee")).toBe(false);
  });
});

describe("checkFeeAgainstSource reads the sentence as the fee's $0 (#2040)", () => {
  const text = [
    "Overdraft fee | $35 per item",
    "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.",
    "We do not charge overdraft fees on transactions under $5.",
  ].join("\n");

  it("traces the exact name the sentence prints at $0", () => {
    const result = checkFeeAgainstSource(text, "Returned item/non-sufficient funds (NSF) fee", 0, ".", "nsf");
    expect(result).toEqual({ ok: true, sourceLine: "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid." });
  });

  it("never traces a conditional sentence, another name or a price", () => {
    expect(checkFeeAgainstSource(text, "Overdraft fee", 0, ".", "overdraft").ok).toBe(false);
    expect(checkFeeAgainstSource(text, "Returned item/non-sufficient funds (NSF) fee", 30, ".", "nsf").ok).toBe(false);
    expect(checkFeeAgainstSource("We do not charge an NSF fee if the item is $5 or less.", "NSF fee", 0, ".", "nsf").ok).toBe(false);
  });
});
