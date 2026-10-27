import { describe, expect, it } from "vitest";
import { billPayReturnedByPayee, billPayReturnName, payeeReturnedBillPayOnLine } from "./payee-returned-bill-pay";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileFromLine, withCollectionSection, type CategoryGuardContext } from "@/lib/fee-category-guard";
import { COLLECTION_TEXT_PATTERN, restoreTarget } from "@/lib/agents/hamilton/category-guard";

// Bellco FCU (institution 8479, document 15817): the note sits on the next line of a two-column PDF.
const BELLCO = `Account Reconciliation Fee (Hourly) | $20.00 | Failed Transfer Fee | $25.00
Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00
(Free with Platinum Checking) | $20.00 | (per item returned by payee)
Wire Transfers – International
(Free with Platinum Checking) | $40.00
Paper Statement Fee | $2.00 | Bill Pay Stop Payment Fee | $31.00`;

// Texas answer key tid 2419 keys this row as NSF.
const TID_2419 = `Bill Payment Overnight Check Service Fee | $14.95

Bill Payment Return Item Fee (per presentment) | $30.00

Check Cashing Fee | $5.00`;

describe("guard v99: a bill payment the payee returned is not NSF (#1912)", () => {
  it("is the version this rule ships under", () => {
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(99);
  });

  it("reads the payee note wrapped onto the next line at Bellco", () => {
    expect(payeeReturnedBillPayOnLine(BELLCO, "Bill Pay Return Item Fee", 10)).toBe(true);
    const context: CategoryGuardContext = withCollectionSection("nsf", "Bill Pay Return Item Fee", { amount: "10.00" } as CategoryGuardContext, BELLCO);
    expect(context.payee_returned).toBe(true);
    const verdict = checkFeeCategory("nsf", "Bill Pay Return Item Fee", context);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? null : verdict.code).toBe("schedule_contradicts");
    expect(refileFromLine("nsf", "Bill Pay Return Item Fee", context)).toBe("bill_pay");
  });

  it("re-files a name that itself says the payee returned it", () => {
    const name = "Bill Pay Return Item Fee (per item returned by payee)";
    expect(billPayReturnedByPayee(name)).toBe(true);
    expect(checkFeeCategory("nsf", name).ok).toBe(false);
    expect(refileFromLine("nsf", name, undefined)).toBe("bill_pay");
    expect(checkFeeCategory("bill_pay", name).ok).toBe(true);
  });

  it("keeps the Texas key's bill payment return item as NSF (tid 2419)", () => {
    const name = "Bill Payment Return Item Fee (per presentment)";
    expect(payeeReturnedBillPayOnLine(TID_2419, name, 30)).toBe(false);
    const context = withCollectionSection("nsf", name, { amount: 30 }, TID_2419);
    expect(checkFeeCategory("nsf", name, context).ok).toBe(true);
    expect(refileFromLine("nsf", name, context)).toBeNull();
  });

  it("keeps a bill pay return with no stored text, or no payee words, as NSF by name", () => {
    expect(checkFeeCategory("nsf", "Bill Pay Return Item Fee").ok).toBe(true);
    expect(checkFeeCategory("nsf", "Bill Pay Return Item Fee", withCollectionSection("nsf", "Bill Pay Return Item Fee", { amount: 10 }, "Bill Pay Return Item Fee | $10.00\nCheck Cashing Fee | $5.00")).ok).toBe(true);
  });

  it("never borrows the other column's note", () => {
    const text = `Bill Pay Return Item Fee | $10.00 | Stop Payment Fee | $31.00
(per statement) | (per item returned by payee)`;
    expect(payeeReturnedBillPayOnLine(text, "Bill Pay Return Item Fee", 10)).toBe(false);
  });

  it("leaves a name that names insufficient funds as NSF", () => {
    expect(billPayReturnName("Bill Pay NSF Returns")).toBe(false);
    expect(billPayReturnedByPayee("Bill Pay NSF Return (returned by payee)")).toBe(false);
    expect(checkFeeCategory("nsf", "Bill Pay NSF Return (returned by payee)").ok).toBe(true);
  });

  it("fetches Bellco's text for Hamilton's live guard and moves 85460 to bill pay in place", () => {
    expect(new RegExp(COLLECTION_TEXT_PATTERN, "i").test(BELLCO)).toBe(true);
    const row = withCollectionSection("nsf", "Bill Pay Return Item Fee", {
      fee_published_id: 85460, canonical_fee_key: "nsf", fee_name: "Bill Pay Return Item Fee", amount: "10.00", conditions: null, document_nsf_amount: null,
    }, BELLCO);
    expect(restoreTarget(row)).toBe("bill_pay");
  });
});
