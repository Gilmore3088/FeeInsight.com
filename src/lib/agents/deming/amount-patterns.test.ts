import { describe, expect, it } from "vitest";
import { amountClassRows, amountLayout, passesTodaysCheck, type AmountErrorRow } from "./amount-patterns";

// Layouts from the week's confirmed wrong amounts (2026-10-25), trimmed.
const PRICE_FIRST = [
  "Safe Deposit Box Annual Rental & Fees",
  "$100.00 Safe Deposit Box Drilling/Per Box",
  "$14.00 Safe Deposit Box 3x5/Year",
  "$19.00 Safe Deposit Box 4x5/Year",
  "$21.00 Safe Deposit Box 5x5/Year",
].join("\n");
const PRICE_FIRST_PIPES = [
  "$10.00 | Domestic Outgoing Wire Transfer Fee",
  "$50.00 | International Outgoing Wire Transfer Fee",
  "$10.00 | Inactive Account fee (per month)",
].join("\n");
const OPENING = ["Text Messaging", "Direct Deposit, Debit Card, & Bill Pay Available", "$25 Initial Deposit to Open", "Monthly Maintenance Charge of $7.00"].join("\n");
const UP_TO = ["Penalty Fees", "• Late Payment | Up to $25.00", "• Returned Payment | Up to $25.00"].join("\n");
const FREE = ["• Transfer Fee – Sweep Account (manual): $5.00 per transfer", "• Mobile Deposit: no fee", "• Online Bill Pay Billing Fee: Free"].join("\n");

const row = (id: number, institution: number, feeName: string, amount: number, text: string | null, kind = "wrong_amount"): AmountErrorRow => ({
  feedback_id: id, kind, check_name: "hamilton.source_check:v20", institution_id: institution, fee_published_id: 9000 + id,
  fee_name: feeName, amount, canonical_fee_key: null, text,
});

describe("amount error layouts (#2067)", () => {
  it("names the layout that put the wrong price on a fee", () => {
    expect(amountLayout("Safe Deposit Box 4x5/Year", 21, PRICE_FIRST)).toBe("price_before_label");
    expect(amountLayout("Domestic Outgoing Wire Transfer Fee", 50, PRICE_FIRST_PIPES)).toBe("price_before_label");
    expect(amountLayout("Direct Deposit, Debit Card, & Bill Pay Available", 25, OPENING)).toBe("opening_deposit");
    expect(amountLayout("Late Payment", 25, UP_TO)).toBe("cap_or_minimum");
    expect(amountLayout("Research Fee (minimum $25.00)", 25, "Research Fee (minimum $25.00) | $25.00 per hour")).toBe("amount_in_name");
    expect(amountLayout("Mobile Deposit", 5, FREE)).toBe("free_read_as_price");
    expect(amountLayout("Foreign ATM", 1, "Debit card replacement $10\nForeign ATM\n$1.00 per withdrawal")).toBe("price_on_other_line");
    expect(amountLayout("Monthly Fee", 3, "Open With | $100 | $25\nMonthly Fee | $03 or $10 | $03 or $20")).toBe("footnote_glued_price");
    expect(amountLayout("Generally a maximum late charge", 10, "Generally a maximum late charge of $10, $25 in KS")).toBe("cap_or_minimum");
    expect(amountLayout("ATM Transactions", 10, "ATM Transactions | $10.00 monthly for average | Free | Money Market Checking | $2")).toBe("multi_column");
  });

  it("keeps a read with the line's own price, an unnamed fee and a missing document out of the named layouts", () => {
    expect(amountLayout("Safe Deposit Box 3x5/Year", 14, PRICE_FIRST)).toBe("other");
    expect(amountLayout("Wire Fee", 25, PRICE_FIRST)).toBe("name_not_in_text");
    expect(amountLayout("Wire Fee", 25, null)).toBe("no_document");
  });

  it("groups rows by kind and layout across banks, leaves unnamed layouts unpatterned, and counts rows today's check still passes", () => {
    const groups = amountClassRows([
      row(1, 1565, "Safe Deposit Box 4x5/Year", 21, PRICE_FIRST),
      row(2, 1565, "Safe Deposit Box 5x5/Year", 100, PRICE_FIRST),
      row(3, 5181, "Domestic Outgoing Wire Transfer Fee", 50, PRICE_FIRST_PIPES),
      row(4, 7236, "Wire Fee", 25, null),
      row(5, 4486, "Late Payment", 25, UP_TO, "threshold"),
    ]);
    const priceFirst = groups.find((group) => group.pattern === "amount:price_before_label")!;
    expect(priceFirst).toMatchObject({ about_stage: "extract", kind: "wrong_amount", banks: 2, rows: 3, checks: ["hamilton.source_check"], feedback_ids: [3, 2, 1] });
    expect(priceFirst.passes_today).toBe(0);
    expect(groups.find((group) => group.pattern === "unknown")).toMatchObject({ rows: 1, passes_today: 0 });
    expect(groups.find((group) => group.kind === "threshold")).toMatchObject({ pattern: "amount:cap_or_minimum", banks: 1 });
  });

  it("re-checks a row with the shared source check: a matching line passes, the next row's price does not", () => {
    expect(passesTodaysCheck({ text: PRICE_FIRST_PIPES, fee_name: "Domestic Outgoing Wire Transfer Fee", amount: 10, canonical_fee_key: null })).toBe(true);
    expect(passesTodaysCheck({ text: PRICE_FIRST_PIPES, fee_name: "Domestic Outgoing Wire Transfer Fee", amount: 50, canonical_fee_key: null })).toBe(false);
    // A gap, not a wish: today's check still lets a glued footnote ("$01") pass as $1 (#1946).
    expect(passesTodaysCheck({ text: "Network ATM transactions | $0\nOther network ATM transactions | $01\nOnline Bill Pay | $0", fee_name: "Other network ATM transactions", amount: 1, canonical_fee_key: null })).toBe(true);
    expect(passesTodaysCheck({ text: null, fee_name: "Wire", amount: 10, canonical_fee_key: null })).toBe(false);
  });
});
