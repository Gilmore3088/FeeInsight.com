import { describe, expect, it } from "vitest";
import { depositedCardReturnRead, runFreeSpecialists, withoutOcrLeaderNoise } from "@/lib/agents/knox/specialists";
import { stopPaymentVariantRead } from "@/lib/agents/knox/rules";
import { checkFeeAgainstSource, labeledFeeCardDescription } from "@/lib/custom-report/source-check";
import { stopPaymentVariantRows } from "@/lib/custom-report/stop-payment-variant";

/** Knox v181: the reads backlog dry run 12 (Nov 3) found wrong or doubtful, each from the bank's own lines. */

// St. Louis Community FCU, text 3810, lines 53-57: the stop payment list in the right column.
const ST_LOUIS = [
  "• Early Withdrawal (per withdrawal) | $25.00",
  "Save to Prosper4 | Stop Payment Fee – Check or ACH (per item): | $20.00",
  "• Save to Prosper Withdrawal Fee | $25.00 | Check series | $25.00",
  "Savings accounts | • Corporate Check | $15.00",
  "• More than 6 teller-assisted withdrawals per quarter | Telephone Transfer Fee | $2.00",
].join("\n");

// First Bank & Trust Co., text 12416, lines 13-22 (a scanned schedule's OCR noise on the leaders).
const FIRST_BANK_TRUST = [
  "Telephone Transfer Fee. ....... iii eeeeeeaaeeeeaaaaaaaa.. | FREE",
  "Sweep Transfer Fee. ....... iii iiieeeeeeaeeeeeaaeaeeaaaaaaa.. | FREE",
  "Collection Item Fee (each) ........ iii. | 7.50",
  "Garnishment Fee... .. | iii | tte te ee eee i ee eeie eee... 30.00",
  "Levy Fee or Other Legal Fee... .. | iti itt eaeeeeeienaaeaaa. 30.00",
  "Copy Fee (Per Page) viv viii tt tee et ee ee te eee ee iie ieee. | 0.25",
  "Insufficient Funds (NSF) Returned Item Charge..................... 30.00",
  "Insufficient Funds (NSF) Paid Item Charge................c......... 30.00",
  "Overdraft Privilege (ODP) Paid Item Charge........................ 30.00",
  "Returned/Reprocessed Item Fee... | viii iit iit eieiieieaee... | 5.00",
].join("\n");

// ESL FCU, text 20267: the overdraft and returned item cards, then the check and stop payment cards.
const ESL = "Fee TypeCourtesy Pay Overdraft Fee\n\nDescriptionOverdraft Service for checks, bill pay, and automatic ACH payments – Coverage of insufficient or uncollectable funds (from your checks, automatic withdrawals via ACH, and ESL Bill Pay transactions) are paid by ESL up to the maximum overdraft. Each overdraft is charged a fee based on the value of the item. The monthly maximum overdraft is $250 for Free and Premier Checking accounts.\nWays to avoid fees\n- Monitor account activity with online banking and/or mobile banking.\n- Set up text or email alerts to let you know when your balance falls below a certain amount.\n- Transfer funds from another ESL account via an ESL ATM, online or mobile banking, TEL-E$L, chat or telephone banking, or at an ESL Branch.\n\nFee$5.00\n\nFee TypePOS Overdraft Fee\n\nDescriptionOverdraft service for Point of Sale Transactions – Coverage of insufficient or uncollectable funds (from your debit card purchases) are paid by ESL up to the maximum overdraft. Each overdraft is charged a fee based on the value of the item. The monthly maximum overdraft is $250 for Free and Premier Checking accounts.\nWays to avoid fees\n- Monitor account activity with online banking and/or mobile banking.\n- Set up text or email alerts to let you know when your balance falls below a certain amount.\n- Transfer funds from another ESL account via an ESL ATM, online or mobile banking, TEL-E$L, chat or telephone banking, or at an ESL Branch.\n\nFee$0.01-$5.00: $0\n\nGreater than $5.00: $5.00\n\nFee TypeReturned Item Fee\n\nDescriptionFor each item you deposit or cash that is returned unpaid. This usually occurs because the person who wrote you the check doesn’t have enough funds in their account to cover the amount.\n\nFee$10.00\n\nCheck Fees\n\nFee Type\n\nDescription\n\nFee\n\nFee TypeCheck Printing\n\nDescriptionFee to order checks online, in branch, via chat and telephone banking.\n\nFeeVaries by style\n\nFee TypeCheck Protest\n\nDescriptionFee charged for pursuing collection of a check written that was returned unpaid\n\nFeeFree\n\nFee TypeCertified Check\n\nDescriptionA guarantee for the payee from ESL that there are sufficient funds to honor the amount of the check written\n\nFee$5.00 per check\n\nFees may change.\n\n[timestamp]\n\nStop Payment Fees\n\nFee Type\n\nDescription\n\nFee\n\nFee TypeStop Payments\n\nDescriptionTo request the stop payment of a check you wrote that has not been deposited or cashed by the payee.\n\nFeeFree\n\nFees may change.\n\n[timestamp]\n\n";

// San Francisco FCU, text 33150, lines 11-14 and its fee row.
const SAN_FRANCISCO = [
  "Minimum Balance for Membership/Par Value of a Share: You must",
  "deposit and maintain at least a $5 (par value of a share) in your Regular",
  "Share Savings Account to maintain membership and be eligible for other",
  "Credit Union services.",
  "",
  "Maintenance Fee | $5.00/month",
].join("\n");

const reads = (text: string) => runFreeSpecialists(text).candidates;

describe("v181: a bulleted variant under a priced stop payment row is that stop payment", () => {
  it("finds the variant under the right column's stop payment row", () => {
    expect(stopPaymentVariantRows(ST_LOUIS).map((row) => [row.heading, row.variant, row.amount])).toEqual([
      ["Stop Payment Fee – Check or ACH (per item)", "Corporate Check", 15],
    ]);
  });

  it("files the $15 Corporate Check as a stop payment that traces to its row", () => {
    const read = reads(ST_LOUIS).find((row) => row.amount === 15)!;
    expect(read.canonicalHint).toBe("stop_payment");
    expect(read.feeName).toBe("Stop Payment Fee – Check or ACH (per item): Corporate Check");
    const traced = checkFeeAgainstSource(ST_LOUIS, read.feeName, 15, ".", "stop_payment");
    expect(traced.ok && traced.sourceLine).toBe("Savings accounts | • Corporate Check | $15.00");
  });

  it("leaves a bullet list of different fees alone", () => {
    const list = ["Stop Payment | $20.00", "Cashier’s Check Fee | $3.00", "• Corporate Check | $15.00"].join("\n");
    expect(stopPaymentVariantRows(list)).toEqual([]);
    // A bullet list whose items are different fees (live #75973's page, text 13162).
    const bullets = ["• ACH Stop Payment Fee Per Item | $30.00", "• Check Stop Payment Fee Per Item | $30.00", "• Certified Checks | $10.00", "• Overdraft Fee (daily) | $5.00/Day over 5 Days"].join("\n");
    expect(stopPaymentVariantRows(bullets)).toEqual([]);
    const read = { feeName: "Corporate Check", amount: 15, canonicalHint: "cashiers_check", excerpt: "• Corporate Check | $15.00", confidence: 0.9, frequency: null, waivable: false };
    expect(stopPaymentVariantRead(read as never, list)).toBe(read);
  });
});

describe("v181: a fee card's own description decides a returned item's category", () => {
  it("reads ESL's Returned Item Fee card as the deposited item return", () => {
    expect(labeledFeeCardDescription(ESL, "Returned Item Fee")).toMatch(/^DescriptionFor each item you deposit or cash/);
    const filed = reads(ESL).map((row) => [row.canonicalHint, row.feeName, row.amount]);
    expect(filed).toContainEqual(["deposited_item_return", "Returned Item Fee", 10]);
    expect(filed).not.toContainEqual(["nsf", "Returned Item Fee", 10]);
  });

  it("leaves ESL's other cards as they were", () => {
    const filed = reads(ESL).map((row) => [row.canonicalHint, row.feeName, row.amount]);
    expect(filed).toContainEqual(["overdraft", "Courtesy Pay Overdraft Fee", 5]);
    expect(filed).toContainEqual(["cashiers_check", "Certified Check", 5]);
  });

  it("keeps an NSF card about the member's own item", () => {
    const card = ["Fee TypeReturned Item Fee", "", "DescriptionCharged when a check you write is returned because your account does not have enough funds.", "", "Fee$30.00"].join("\n");
    const read = { canonicalHint: "nsf", feeName: "Returned Item Fee", amount: 30 };
    expect(depositedCardReturnRead(read, card)).toBe(read);
  });
});

describe("v181: OCR noise on a dot leader is no part of a name", () => {
  it("blanks single letters and repeated-letter runs between leaders, and keeps real words", () => {
    const cleaned = withoutOcrLeaderNoise(FIRST_BANK_TRUST);
    expect(cleaned).not.toMatch(/iiieee|\.c\./);
    expect(withoutOcrLeaderNoise("Statement Copy ........ free | $0")).toBe("Statement Copy ........ free | $0");
    expect(withoutOcrLeaderNoise("Fee ......... see below")).toBe("Fee ......... see below");
  });

  it("names the paid item charge and the sweep transfer by their own words", () => {
    const names = reads(FIRST_BANK_TRUST).map((row) => row.feeName);
    expect(names).toContain("Paid Item Charge");
    expect(names.some((name) => /\bc$|iii|eee/.test(name))).toBe(false);
  });
});

describe("v181: the source check's line is the row that prints the fee", () => {
  it("traces San Francisco FCU's Maintenance Fee to its own row, not the par value sentence", () => {
    const traced = checkFeeAgainstSource(SAN_FRANCISCO, "Maintenance Fee", 5, ".", "monthly_maintenance");
    expect(traced.ok && traced.sourceLine).toBe("Maintenance Fee | $5.00/month");
  });
});
