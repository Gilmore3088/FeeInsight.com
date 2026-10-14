import { describe, expect, it } from "vitest";
import { rateFeeFromHeld, rateFeeName } from "@/lib/agents/knox/percent";

function held(feeName: string, excerpt: string, canonicalHint: string | null = "card_foreign_txn") {
  return { shape: "percentage" as const, feeName, canonicalHint, percent: null, frequency: "per_item", excerpt };
}

describe("rateFeeFromHeld", () => {
  it("sends a traced foreign transaction rate to Darwin with its basis", () => {
    const text = "Debit Card Services\nForeign Transaction Fee | 1% of the transaction amount";
    const rate = rateFeeFromHeld(held("Foreign Transaction Fee", "Foreign Transaction Fee | 1% of the transaction amount"), text);
    expect(rate).toMatchObject({ feeName: "Foreign Transaction Fee", canonicalHint: "card_foreign_txn", ratePercent: 1, rateBasis: "transaction" });
  });

  it("names a sentence by the fee it charges for", () => {
    const line = "A 1% Currency Conversion Fee will be assessed on purchases made outside the U.S.";
    expect(rateFeeName("A 1% Currency Conversion Fee will be assessed on", line, "card_foreign_txn")).toBe("Currency Conversion Fee");
    const rate = rateFeeFromHeld(held("A 1% Currency Conversion Fee will be assessed on", line), line);
    expect(rate).toMatchObject({ feeName: "Currency Conversion Fee", ratePercent: 1 });
  });

  it("says what a bare 'Multi currency' rate charges for", () => {
    expect(rateFeeName("Multi currency", "Multi currency 1% of transaction amount", "card_foreign_txn")).toBe("Foreign transaction fee (multi currency)");
  });

  it("holds 'up to' rates, interest rates and lines with two rates", () => {
    const upTo = "International Service Fee | up to 3% of the transaction";
    expect(rateFeeFromHeld(held("International Service Fee", upTo), upTo)).toBe("up_to_rate");
    const interest = "Cash Advance Fee 3% | Cash advance APR 18.9%";
    expect(rateFeeFromHeld(held("Cash Advance Fee", interest, "cash_advance"), interest)).toBe("interest_rate");
    const two = "Foreign Transaction Fee 1% (0.8% for Visa Signature)";
    expect(rateFeeFromHeld(held("Foreign Transaction Fee", two), two)).toBe("several_rates");
  });

  it("holds a rate outside the category's range and one it cannot trace", () => {
    const high = "Foreign Transaction Fee | 25% of the transaction";
    expect(rateFeeFromHeld(held("Foreign Transaction Fee", high), high)).toBe("outside_range");
    const line = "Foreign Transaction Fee | 1% of the transaction";
    expect(rateFeeFromHeld(held("Foreign Transaction Fee", line), "Wire Transfer Fee $25")).toBe("untraced");
  });

  it("files a balance transfer rate under cash advance and reads its floor", () => {
    const line = "Balance Transfer Fee: 3% of each transfer, $5.00 minimum";
    const rate = rateFeeFromHeld(held("Balance Transfer Fee", line, null), line);
    expect(rate).toMatchObject({ canonicalHint: "cash_advance", ratePercent: 3, rateMinAmount: 5, rateMaxAmount: null, rateBasis: "balance_transferred" });
  });

  it("reads 'greater of' as a floor and 'whichever is lower' as a cap", () => {
    const greater = "Cash Advance Fee | Greater of 4% or $10.00";
    expect(rateFeeFromHeld(held("Cash Advance Fee", greater, "cash_advance"), greater)).toMatchObject({ rateMinAmount: 10, rateMaxAmount: null, rateBasis: "advance" });
    const lower = "Cash Advance Fee | 3% of the advance or $50.00, whichever is lower";
    expect(rateFeeFromHeld(held("Cash Advance Fee", lower, "cash_advance"), lower)).toMatchObject({ rateMinAmount: null, rateMaxAmount: 50 });
  });

  it("keeps categories that don't publish rates held", () => {
    const line = "Account Research | 2% of balance";
    expect(rateFeeFromHeld(held("Account Research", line, "research_fee"), line)).toBe("category_not_published");
    expect(rateFeeFromHeld(held("Fee", line, null), line)).toBe("category_not_published");
  });
});

describe("held rates a schedule row states without the word fee (#1102)", () => {
  it.each([
    ["card_foreign_txn", "Credit Card/Debit Card International Transaction", "Credit Card/Debit Card International Transaction | 1% of foreign transaction amount", 1],
    ["card_foreign_txn", "ATM Cross-border", "ATM Cross-border | 1% of International Transactions | 1% of International Transactions", 1],
    ["check_cashing", "Check Cashing", "Check Cashing | 1.00% of Amount", 1],
    ["check_cashing", "Non-Member On Us Check Cashing Fee", "Non-Member On Us Check Cashing Fee | 1% of check", 1],
    ["atm_international", "ATM / Debit Card International Transaction", "ATM / Debit Card International Transaction | 1% of transaction amount", 1],
    ["coin_counting", "Loose Coin Counting (non-customer)", "Loose Coin Counting (non-customer) | 10% of total", 10],
  ])("sends %s '%s' to Darwin", (hint, name, line, percent) => {
    const text = `Fee Schedule\nWire Transfer | $25.00\n${line}`;
    expect(rateFeeFromHeld(held(name, line, hint), text)).toMatchObject({ canonicalHint: hint, ratePercent: percent });
  });

  it("never reads a share of a balance or a rewards rate as a fee (post-merge review of #1237)", () => {
    for (const line of ["Coin Counting | 0.5% of the total balance", "Coin Counting | 1% of the average daily balance amount", "Coin Counting | Earn 1% on all purchases"]) {
      expect(typeof rateFeeFromHeld(held("Coin Counting", line, "coin_counting"), line)).toBe("string");
    }
  });

  it("still holds a share of a balance, an interest rate and a card network's own assessment", () => {
    const balance = "Savings | 1% of balance";
    expect(typeof rateFeeFromHeld(held("Savings", balance, "monthly_maintenance"), balance)).toBe("string");
    const dividend = "Share Certificate | 4.5% dividend on the balance";
    expect(rateFeeFromHeld(held("Share Certificate", dividend, "check_cashing"), dividend)).toBe("interest_rate");
    const network = "Issuer Cross-Border Assessment of 90 basis points (.9% of the transaction) on all cross-border";
    expect(typeof rateFeeFromHeld(held("Issuer Cross-Border Assessment of 90 basis points (", network), network)).toBe("string");
  });
});
