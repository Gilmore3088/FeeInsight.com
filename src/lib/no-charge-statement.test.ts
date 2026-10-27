import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NO_CHARGE_SENTENCE_READ_LIVE,
  documentPricesNsf,
  noChargeNsfSentence,
  noChargeNsfWitness,
  readNoChargeNsf,
  scopeWordIn,
} from "./no-charge-statement";

// Excerpts of stored texts on prod (agent_source_texts, current copies, read Oct 27), by source document.
const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", "no-charge-nsf", name), "utf8");
const WELLS_FARGO = fixture("wells-fargo-overdraft-faq-33356.txt");
const GRAND_BANK = fixture("grand-bank-agreement-24812.txt");
const MONET = fixture("monet-bank-agreement-15387.txt");
const CAPE_AND_COAST = fixture("cape-and-coast-nsf-terms-24606.txt");
const HSBC_PREMIER = fixture("hsbc-premier-terms-34307.txt");
const EASY_CHECKING = fixture("easy-checking-tis-25352.txt");

const names = (text: string) => readNoChargeNsf(text).statements.map((statement) => statement.feeName);

describe("no-charge NSF sentences (#2040)", () => {
  it("ships switched off", () => {
    expect(NO_CHARGE_SENTENCE_READ_LIVE).toBe(false);
  });

  describe("grammar: must pass", () => {
    it.each([
      ["We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.", "Returned item/non-sufficient funds (NSF) fee"],
      ["We do not charge an NSF fee for returned items.", "NSF fee"],
      ["We do not charge an NSF fee for items we return.", "NSF fee"],
      ["We do not currently charge NSF fees.", "NSF fee"],
      ["The Bank does not charge NSF fees.", "NSF fee"],
      ["We do not currently charge a Nonsufficient Funds (NSF) Fee for returning an item unpaid.", "Nonsufficient Funds (NSF) Fee"],
      ["We do not charge a fee for an NSF return.", "NSF return fee"],
      ["We do not currently charge a fee for NSF items returned.", "NSF item fee"],
      ["• We don't charge insufficient funds fees.", "Insufficient funds fee"],
    ])("%s", (sentence, name) => {
      expect(noChargeNsfSentence(sentence)).toBe(name);
    });
  });

  describe("grammar: must not pass", () => {
    it.each([
      // A first-item waiver, a figure, a band, a count or a transaction type is no "none at all".
      "We do not charge a fee for the first item.",
      "We do not charge Overdraft Fees or NSF Fees for items $5 or less, or for items that cause",
      "We do not charge NSF fees for declined one-time debit card purchases or ATM withdrawals.",
      "We do not charge another NSF fee for an item or transaction.",
      "We do not charge an NSF fee when your account is overdrawn by less than five dollars.",
      "We do not charge an NSF fee if you deposit a check from someone else in good faith, but it bounces on you.",
      // Another subject, another tense, a second fee or a generic fee.
      "In these instances, Old National Bank does not charge an NSF fee.",
      "We will not charge an NSF fee for any item that is $5 or less.",
      "We no longer charge NSF fees.",
      "We do not charge overdraft or NSF fees for one-time debit card or ATM transactions.",
      "We do not charge a fee for this service.",
      "We do not charge a fee when we return an item unpaid due to insufficient funds in your account.",
      // "Returned item" alone is as often a returned deposited item.
      "We do not charge a returned item fee.",
      "We do not charge interest for the NSF/UCF items.",
    ])("%s", (sentence) => {
      expect(noChargeNsfSentence(sentence)).toBeNull();
    });
  });

  describe("documents: must pass", () => {
    it("Wells Fargo's overdraft FAQ (doc 33356): its own paragraph under a question heading", () => {
      expect(names(WELLS_FARGO)).toEqual(["Returned item/non-sufficient funds (NSF) fee"]);
    });

    it("Grand Bank for Savings' agreement (doc 24812): the sentence after its own inline heading", () => {
      expect(names(GRAND_BANK)).toEqual(["NSF fee"]);
    });

    it("Monet Bank's agreement (doc 15387): a sentence wrapped onto the next line is joined to its end", () => {
      expect(names(MONET)).toEqual(["Nonsufficient Funds (NSF) Fee"]);
    });

    it("Cape & Coast Bank's NSF terms (doc 24606): a scope word three sentences up is another paragraph's", () => {
      expect(names(CAPE_AND_COAST)).toEqual(["NSF return fee"]);
    });
  });

  describe("documents: must not pass", () => {
    it("a tier's terms (HSBC Premier, doc 34307): the heading names the tier", () => {
      const read = readNoChargeNsf(HSBC_PREMIER);
      expect(read.statements).toEqual([]);
      expect(read.refused.map((row) => row.reason)).toEqual(["scope"]);
    });

    it("one account's terms (doc 25352): 'In your Easy Checking account, we do not charge ...' opens no sentence", () => {
      expect(names(EASY_CHECKING)).toEqual([]);
    });

    it("a line that continues the line above is not a sentence of its own", () => {
      const text = "If your account is enrolled in our overdraft line and the line is drawn,\nwe do not charge NSF fees.";
      expect(readNoChargeNsf(text).refused.map((row) => row.reason)).toEqual(["continues_line_above"]);
    });

    it("a product heading above the fee's own heading", () => {
      const text = "Business Checking\n\nOverdraft and NSF Fees\n\nWe do not charge NSF fees.";
      expect(readNoChargeNsf(text).refused.map((row) => row.reason)).toEqual(["scope"]);
    });

    it("a sentence before it in its paragraph that names one account", () => {
      const text = "Fees\nWith Premier Checking you pay no monthly fee. We do not charge an NSF fee for returned items.";
      expect(names(text)).toEqual([]);
      const named = "Fees\nThese terms apply to Assure Checking accounts. We do not charge an NSF fee for returned items.";
      expect(names(named)).toEqual([]);
    });

    it("the sentence after it narrows it", () => {
      const text = "Fees\n\nWe do not charge NSF fees. This applies to student accounts only.\n";
      expect(names(text)).toEqual([]);
    });

    it("a page that prices NSF anywhere, on the line or under a short label", () => {
      expect(names("We do not charge NSF fees.\n\nFee Schedule\nNSF Fee $35.00")).toEqual([]);
      expect(names("We do not charge NSF fees.\n\nReturned Item (NSF)\n$29.00 per item")).toEqual([]);
      expect(names("We do not charge NSF fees.\n\nPaid or returned item (NSF) 35")).toEqual([]);
    });

    it("a condition on the wrapped next line", () => {
      expect(names("Fees\n\nWe do not currently charge a Nonsufficient Funds (NSF) Fee\nfor items of five dollars or less.")).toEqual([]);
    });
  });

  describe("the price check reads prices, not page numbers or another fee's row", () => {
    it("refuses an NSF price", () => {
      expect(documentPricesNsf(["NSF Fee ........ $35.00"])).toBe(true);
      expect(documentPricesNsf(["Insufficient Funds Fee", "$25.00 per item"])).toBe(true);
    });

    it("does not read a table of contents' page number, a page number below a sentence, or the next fee's row", () => {
      expect(documentPricesNsf(["D. Understanding and Avoiding Overdraft and Returned Items.......................... 22"])).toBe(false);
      expect(documentPricesNsf(["the transaction was returned for insufficient funds.", "31"])).toBe(false);
      expect(documentPricesNsf(["OVERDRAFT & RETURNED ITEMS", "Cover Me Now Overdraft Privilege $10.00/item"])).toBe(false);
    });
  });

  describe("scope words", () => {
    it.each(["Bill Pay Services", "Business accounts", "HSBC PREMIER", "Assure Checking Accounts", "BankOn certified"])("%s names a scope", (text) => {
      expect(scopeWordIn(text)).toBe(true);
    });
    it.each(["What is the fee for overdrafts?", "Nonsufficient Funds (NSF)", "Bank on the go using your mobile device", "Your Checking Account"])("%s names none", (text) => {
      expect(scopeWordIn(text)).toBe(false);
    });
  });

  it("the source check's witness answers only for NSF, the exact name, and only with the switch on", () => {
    expect(noChargeNsfWitness(WELLS_FARGO, "Returned item/non-sufficient funds (NSF) fee", "nsf")).toBeNull();
    expect(noChargeNsfWitness(WELLS_FARGO, "Returned item/non-sufficient funds (NSF) fee", "nsf", true)?.sentence)
      .toBe("We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.");
    expect(noChargeNsfWitness(WELLS_FARGO, "Returned item/non-sufficient funds (NSF) fee", "overdraft", true)).toBeNull();
    expect(noChargeNsfWitness(WELLS_FARGO, "Overdraft fee", "nsf", true)).toBeNull();
  });
});
