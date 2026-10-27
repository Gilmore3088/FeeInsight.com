import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_GUARD_RULES, NSF_NAME_INCLUDE } from "./fee-category-guard";
import {
  NO_CHARGE_SENTENCE_READ_LIVE,
  chargesNsfFamily,
  documentChargesNsf,
  documentPricesNsf,
  namesNsfFamily,
  narrowsStatement,
  noChargeNsfSentence,
  noChargeNsfWitness,
  mentionsNsfFee,
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

  describe("review of #2753: NSF-family prices the old page test missed (must not pass)", () => {
    it("reads the category guard's own NSF words, shared and not copied", () => {
      expect(CATEGORY_GUARD_RULES.nsf.include).toBe(NSF_NAME_INCLUDE);
      // On a whole page "nsf" never matches inside another word.
      expect(namesNsfFamily("Transfer Fee $5")).toBe(false);
    });

    it.each([
      "Unpaid Item Fee $35",
      "Item returned unpaid $35",
      "Returned ACH $30",
      "Returned payment $30",
      "Returned draft $30",
      "Cargo por fondos insuficientes $30",
      "Dishonored check $25",
      "Bounce fee $30",
      "NSF fee 35 each",
      "NSF fee: twenty-five dollars per item",
      "Returned check charge twenty five dollars",
    ])("%s prices NSF on the page", (line) => {
      expect(documentPricesNsf([line])).toBe(true);
      expect(names(`We do not charge NSF fees.\n\nFee Schedule\n${line}`)).toEqual([]);
      expect(readNoChargeNsf(`We do not charge NSF fees.\n\nFee Schedule\n${line}`).refused.map((row) => row.reason)).toEqual(["document_prices_nsf"]);
    });

    it("a short label priced on the next line in figures or words", () => {
      expect(documentPricesNsf(["Unpaid Item", "35 each"])).toBe(true);
      expect(documentPricesNsf(["Bounced Check", "Twenty-five dollars"])).toBe(true);
    });

    it("a held read no category took, with NSF-family words and a price, charges NSF", () => {
      expect(chargesNsfFamily({ canonicalHint: null, amount: 35, feeName: "Item returned unpaid", excerpt: "Item returned unpaid | $35" })).toBe(true);
      expect(chargesNsfFamily({ canonicalHint: null, amount: 35, feeName: "Item", excerpt: "Item returned unpaid | $35" })).toBe(true);
      expect(chargesNsfFamily({ canonicalHint: "nsf_daily_cap", amount: 105, feeName: "Maximum per day" })).toBe(true);
      expect(chargesNsfFamily({ canonicalHint: null, amount: 0, feeName: "Item returned unpaid" })).toBe(false);
      expect(chargesNsfFamily({ canonicalHint: null, amount: 5, feeName: "Wire transfer", excerpt: "Wire transfer | $5" })).toBe(false);
    });
  });

  describe("review of #2753: scope the old test missed (must not pass)", () => {
    it.each([
      "This applies only to items under five dollars.",
      "Only applies to accounts opened after January 1.",
      "Except for items presented by our affiliates.",
      "This does not apply to items presented more than once.",
      "This waiver applies to accounts in good standing.",
      "Unless you are enrolled in overdraft protection.",
      "If your account is closed, a fee may apply.",
      "This covers items of twenty dollars or less.",
    ])("the next sentence narrows it: %s", (after) => {
      expect(narrowsStatement(after)).toBe(true);
      expect(names(`Fees\n\nWe do not charge NSF fees. ${after}\n`)).toEqual([]);
      // In the next paragraph too.
      expect(names(`Fees\n\nWe do not charge NSF fees.\n\n${after}\n`)).toEqual([]);
    });

    it("a following note about another fee, or a change-of-practice notice, narrows nothing", () => {
      expect(narrowsStatement("Note: We will not charge an overdraft fee on items that are $10 or less.")).toBe(false);
      expect(narrowsStatement("If we change this practice, we will provide you with advance notice.")).toBe(false);
    });

    it.each([
      "VALUE CHECKING\n\nWe do not charge NSF fees.",
      "Fees\n\nWith eChecking, statements are online. We do not charge NSF fees.",
      "Fees\n\nThese terms are for iSavings. We do not charge NSF fees.",
    ])("a named product in capitals or led by a lowercase letter: %s", (text) => {
      expect(names(text)).toEqual([]);
    });

    it.each(["Young Saver", "Kids Club", "for members under 18", "kids", "SMB accounts", "Fresh Start", "Second Chance", "Relationship pricing", "Online-only accounts", "VALUE CHECKING", "eChecking"])("%s names a scope", (text) => {
      expect(scopeWordIn(text)).toBe(true);
    });

    it.each(["PERSONAL CHECKING", "FEES FOR ACCOUNTS", "CHECKING AND SAVINGS ACCOUNTS", "Checking"])("%s names none", (text) => {
      expect(scopeWordIn(text)).toBe(false);
    });

    it("a section heading more than 40 lines up still scopes the sentence", () => {
      const prose = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} explains how deposits are posted and when the funds become available for withdrawal.`).join("\n");
      for (const heading of ["BUSINESS ACCOUNTS", "4. Business Accounts"]) {
        const read = readNoChargeNsf(`${heading}\n\n${prose}\n\nFees\n\nWe do not charge NSF fees.`);
        expect(read.statements).toEqual([]);
        expect(read.refused.map((row) => row.reason)).toEqual(["scope"]);
      }
      // With no section heading, the nearest heading counts however far up.
      expect(names(`Business Checking\n\n${prose}\n\nWe do not charge NSF fees.`)).toEqual([]);
      // A neutral section heading far up refuses nothing.
      expect(names(`ACCOUNT TERMS\n\n${prose}\n\nFees\n\nWe do not charge NSF fees.`)).toEqual(["NSF fee"]);
    });
  });

  describe("second review of #2753: unpriced NSF charges on the page (must not pass)", () => {
    const S = "We do not charge NSF fees.";
    it.each([
      [`${S}\n\nReturned Items\n\nAn NSF fee will be charged for each item we return unpaid. See our fee schedule for the amount.`, "document_charges_nsf"],
      [`Overdraft FAQ\n\n${S}\n\nOther questions\n\nNSF fees are assessed per item as listed in the Schedule of Fees.`, "document_charges_nsf"],
      [`${S}\n\nDaily limits\n\nWe charge no more than five NSF fees per business day.`, "document_charges_nsf"],
      [`${S}\nWe will not charge more than three NSF fees per day.`, "document_charges_nsf"],
      // A figure in the next sentence naming NSF already narrows it.
      [`${S}\n\nWe will not charge more than 3 NSF fees per day.`, "narrowed_after"],
    ])("%s", (text, reason) => {
      expect(names(text)).toEqual([]);
      expect(documentChargesNsf(text.split("\n"))).toBe(true);
      expect(readNoChargeNsf(text).refused.map((row) => row.reason)).toEqual([reason]);
    });

    it.each([
      "An NSF fee will be charged for each item we return unpaid.",
      "NSF fees are assessed per item as listed in the Schedule of Fees.",
      "We charge no more than five NSF fees per business day.",
      "We will not charge more than three NSF fees per day.",
      "If you do not have enough money, an NSF fee will be charged.",
      "Insufficient funds fees apply to each item returned.",
      // Refuse by default: a negated or waived NSF fee also names one (these read false under the old verb rule).
      "An NSF fee will not be charged.",
      "No NSF fee will be charged for items we return.",
    ])("names an NSF fee: %s", (sentence) => {
      expect(mentionsNsfFee(sentence)).toBe(true);
    });

    it.each([
      // The statement itself, repeated, and the fee's bare name as an inline heading are the exceptions.
      "We do not charge NSF fees.",
      "Nonsufficient Funds (NSF) Fees.",
      "We will return the item unpaid.",
      "Yes. A returned item / non-sufficient funds (NSF) item occurs when the bank returns an item unpaid.",
      "We charge no more than four overdraft fees per business day.",
    ])("names none: %s", (sentence) => {
      expect(mentionsNsfFee(sentence)).toBe(false);
    });
  });

  describe("third review of #2753: refuse by default on any NSF fee sentence (must not pass)", () => {
    const S = "We do not charge a non-sufficient funds (NSF) fee.";
    it.each([
      "You will owe an NSF fee for each item we return.",
      "Returned items are subject to an NSF fee.",
      "Each returned item incurs an NSF fee.",
      "An item returned for insufficient funds results in a fee.",
      "See the Schedule of Fees for our NSF fee.",
      "The NSF fee is listed in our fee schedule.",
      "An NSF fee will be charged for each item, which we may waive at our discretion.",
      "An NSF fee will be charged for each returned item, and no other fees apply.",
      "An NSF fee is charged on each item, even on free checking.",
      "The NSF fee does not apply to Free accounts.",
    ])("%s", (other) => {
      const text = `${S}\n\nReturned Items\n\n${other}`;
      expect(noChargeNsfSentence(S)).toBe("Non-sufficient funds (NSF) fee");
      expect(names(text)).toEqual([]);
      expect(readNoChargeNsf(text).refused.map((row) => row.reason)).toEqual(["document_charges_nsf"]);
    });

    it.each([
      "We do not charge a fee for the first returned item each year.",
      "We do not charge a fee for returned items on Premier Checking.",
      "We do not charge a fee for returned items under $5.",
      "We do not charge a fee for returned items, but a $35 NSF fee applies to paid items.",
      "We do not charge a fee for items returned unless you overdraw more than three times.",
      // Third review of d1e85d04c: the tail is closed, so any condition, count, audience or item type refuses.
      "We do not charge a fee for returned items in excess of three per day.",
      "We do not charge a fee for items returned the second time.",
      "We do not charge a fee for items returned once a year.",
      "We do not charge a fee for items returned while you are enrolled in overdraft protection.",
      "We do not charge a fee for items returned on accounts with Overdraft Protection.",
      "We do not charge a fee for items returned during the grace period.",
      "We do not charge a fee for items returned on the same day you make a covering deposit.",
      "We do not charge a fee for items returned; we charge one for each presentment.",
      "We do not charge a fee for items returned to Gold members.",
      "We do not charge a fee for items returned to active military.",
      "We do not charge a fee for items returned to eStatement customers.",
      "We do not charge a fee for ACH items returned.",
      "No NSF fee: We do not charge a fee for items returned this month.",
      // Only the bank speaks for itself.
      "Other banks do not charge a fee for returned items.",
      "Many banks do not charge a fee for returned items.",
      "Some do not charge a fee for returned items.",
    ])("a no-fee sentence with a figure, condition or scope still refuses the page: %s", (other) => {
      expect(mentionsNsfFee(other)).toBe(true);
      expect(names(`${S}\n\nReturned Items\n\n${other}`)).toEqual([]);
    });

    it("a deposited item's return is no NSF word", () => {
      expect(namesNsfFamily("Deposited Items Returned $10")).toBe(false);
      expect(namesNsfFamily("Items returned to sender")).toBe(false);
      expect(names(`Fees\n\n${S}\n\nFee Schedule\nDeposited Items Returned $10`)).toEqual(["Non-sufficient funds (NSF) fee"]);
    });

    it("a repeat of the statement on the same page refuses nothing", () => {
      expect(names(`Fees\n\n${S}\n\nReturned Items\n\n${S}`)).toEqual(["Non-sufficient funds (NSF) fee", "Non-sufficient funds (NSF) fee"]);
    });
  });

  describe("third review of #2753: item handling with no fee in it refuses nothing (must pass)", () => {
    const S = "We do not charge a non-sufficient funds (NSF) fee.";
    it.each([
      "If we don't pay a transaction into overdraft, it will be declined or returned unpaid.",
      "If we do not authorize and pay an overdraft, your transaction will be declined or returned unpaid.",
      "Debit Card Overdraft Service is offered at the discretion of Wells Fargo and may be removed by the bank at any time for a variety of reasons, including excessive overdrafts or returned items, as determined by the bank.",
      "If you convert from a Wells Fargo account with check writing ability to a Clear Access Banking account, any outstanding check(s) presented on the new Clear Access Banking account on or after the date of conversion will be returned unpaid.",
      "An item that was previously returned for Non-Sufficient Funds may be paid at the time of a resubmission either because additional funds have become available in your account or because we elect to pay the item under a Courtesy Overdraft service.",
      "Items presented for payment after the Account is closed may be dishonored.",
      "A foreign item may be returned unpaid much later (sometimes many months later) than checks or other items that are drawn on banks located in the U.S.",
      // Wells Fargo's own sentences agree with the $0.
      "We do not assess fees for returned items or declined transactions.",
      "No returned item (NSF) fee: Wells Fargo does not charge a fee for items that are declined or returned unpaid.",
    ])("%s", (other) => {
      expect(mentionsNsfFee(other)).toBe(false);
      expect(names(`Fees\n\n${S}\n\nReturned Items\n\n${other}`)).toEqual(["Non-sufficient funds (NSF) fee"]);
    });
  });

  describe("second review of #2753: the next two sentences narrow it (must not pass)", () => {
    const S = "We do not charge NSF fees.";
    it.each([
      "A $35 fee applies to Classic accounts.",
      "Classic accounts pay a $35 fee per item.",
      "Other accounts: $35 per item.",
      "Members without direct deposit pay the standard fee.",
      "Otherwise the standard fee in our schedule applies.",
      "Accounts opened online are excluded.",
      "Gold members are not eligible.",
    ])("%s", (after) => {
      expect(narrowsStatement(after)).toBe(true);
      expect(names(`Fees\n\n${S}\n${after}`)).toEqual([]);
      expect(readNoChargeNsf(`Fees\n\n${S}\n${after}`).refused.map((row) => row.reason)).toEqual(["narrowed_after"]);
    });

    it.each(["You can bank without worry.", "We may still return items without paying them."])("bare 'without' narrows nothing: %s", (after) => {
      expect(narrowsStatement(after)).toBe(false);
      expect(names(`Fees\n\n${S}\n${after}`)).toEqual(["NSF fee"]);
    });

    it("the second sentence after it", () => {
      const text = `Fees\n\n${S} We want to help you. This applies only to Smart accounts.`;
      expect(names(text)).toEqual([]);
      expect(readNoChargeNsf(text).refused.map((row) => row.reason)).toEqual(["narrowed_after"]);
    });

    it("an eChecking Account heading 60 lines up scopes it", () => {
      const prose = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} explains how deposits are posted and when the funds become available for withdrawal.`).join("\n");
      const read = readNoChargeNsf(`eChecking Account\n\n${prose}\n\n${S}`);
      expect(read.statements).toEqual([]);
      expect(read.refused.map((row) => row.reason)).toEqual(["scope"]);
    });

    it("a plain statement on a page with no NSF charge still reads $0", () => {
      expect(names(`Fees\n\n${S}`)).toEqual(["NSF fee"]);
      expect(names(`Fees\n\n${S} We want to help you. Call us with any questions.`)).toEqual(["NSF fee"]);
      expect(names(`Overdraft FAQ\n\n${S}\n\nOur overdraft fee is $35 per item.`)).toEqual(["NSF fee"]);
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
