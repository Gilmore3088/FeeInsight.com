import { describe, expect, it } from "vitest";
import { withGluedFootnotePrices, withoutGluedFootnoteMarks } from "./glued-footnote-price";
import { checkFeeAgainstSource } from "./source-check";

// North State Bank's account table, as stored (#1946): "$0³ or $10" lost its superscript.
const NORTH_STATE = "Open With | $100 | $100 | $100 | $25\n\nMonthly Fee | $03 or $10 | $03 or $10 | $03 or $20 | $03 or $5\n\nMonthly Fee Waived for Students | - | -";
const PENN = "Penn Community Bank network ATM transactions | $0\nNon-Penn Community Bank network ATM transactions | $01\nOnline Bill Pay | $0";

describe("a footnote glued to a $0 price (#1946)", () => {
  it("drops the footnote and keeps the $0 price; real prices are untouched", () => {
    expect(withGluedFootnotePrices("Monthly Fee | $03 or $10 | $ 012")).toBe("Monthly Fee | $0 or $10 | $ 0");
    expect(withGluedFootnotePrices("$0.50 each | $05.00 | $01,000 | $0 | $10 | $103")).toBe("$0.50 each | $05.00 | $01,000 | $0 | $10 | $103");
    // Zero-padded prices with the point dropped (Civista Bank): "$ 050 00" is $50.00.
    const padded = "Deposit Box Key Replacement | $ 050 00\nIRA External Transfer Fee | $ 035 00";
    expect(withGluedFootnotePrices(padded)).toBe(padded);
    expect(checkFeeAgainstSource(padded, "IRA External Transfer Fee", 35, ".").ok).toBe(true);
  });

  it("no longer traces the footnote as the fee's price, and leaves a real price on the same line alone", () => {
    expect(checkFeeAgainstSource(PENN, "Non-Penn Community Bank network ATM transactions", 1, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(NORTH_STATE, "Monthly Fee", 3, ".").ok).toBe(false);
    // Another row's glued figure on the same line does not take this row's own "$2".
    // The correct $0 read traces: the shared check's own-row refusals read the same cleaned text (#1946 review).
    expect(checkFeeAgainstSource(PENN, "Non-Penn Community Bank network ATM transactions", 0, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("• Minimum balance requirement – $02 | • Monthly maintenance fee – $2 (if account falls below)", "Monthly maintenance fee", 2, ".").ok).toBe(true);
  });
});

describe("footnote marks glued to whole prices (#2072, Oregon State CU)", () => {
  const OSCU = "Incoming wire ........ $152\nStop payment for cashier’s check ...... $302\nCashier’s check ...... $5 per check2\nOther machines ...... $1.50 per transaction2\nU.S. and foreign funds ...... $35 + third-party fees5";

  it("reads the mark off a price at a line's end when the page glues the same mark to its words", () => {
    expect(withoutGluedFootnoteMarks(OSCU).split("\n").slice(0, 2)).toEqual(["Incoming wire ........ $15", "Stop payment for cashier’s check ...... $30"]);
  });

  it("leaves a page with no marks glued to its words, a price with cents and a one-digit price as written", () => {
    const plain = "Incoming wire ........ $152\nCashier’s check ...... $5 per check";
    expect(withoutGluedFootnoteMarks(plain)).toBe(plain);
    const marked = "Fee A $15.002\nFee B $2\nper check2\nper page2";
    expect(withoutGluedFootnoteMarks(marked)).toBe(marked);
  });
});
