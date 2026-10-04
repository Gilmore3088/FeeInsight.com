import { describe, expect, it } from "vitest";

import { amountsIn, classifyFeeText, extractCandidatesFromText, extractFromSegment } from "./rules";

function fees(text: string): Array<[string, number, string]> {
  return extractCandidatesFromText(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint]);
}

describe("Knox extract.rules v2", () => {
  it("reads thousands with and without a comma", () => {
    expect(amountsIn("Appraisal $1500").map((amount) => amount.value)).toEqual([1500]);
    expect(amountsIn("Appraisal $1,500.00").map((amount) => amount.value)).toEqual([1500]);
    expect(amountsIn("Overdraft $35.00, up to $175 a day").map((amount) => amount.value)).toEqual([35, 175]);
  });

  it("files an overdraft or returned-item service charge under overdraft or NSF, not maintenance", () => {
    expect(classifyFeeText("Overdraft service charge")).toBe("overdraft");
    expect(classifyFeeText("Returned item service charge")).toBe("nsf");
    expect(classifyFeeText("Monthly service charge")).toBe("monthly_maintenance");
    expect(classifyFeeText("Inactive account monthly fee")).toBe("dormant_account");
    expect(classifyFeeText("IRA annual maintenance fee")).toBe("ira_administration");
    expect(classifyFeeText("Foreign ATM withdrawal")).toBe("atm_non_network");
    expect(classifyFeeText("ATM withdrawal outside the U.S.")).toBe("atm_international");
  });

  it("pairs each amount with the fee named in its own cell", () => {
    const text = [
      "Service | Fee",
      "Overdraft fee | $35.00 per item",
      "Stop payment | $30.00",
      "Monthly maintenance | $10.00 | $0.00", // second account column, not a fee
      "Paid overdraft item $35, maximum of 5 per day ($175)", // cap, not a fee
      "Stop payment $30; Outgoing domestic wire $25",
    ].join("\n");

    expect(fees(text)).toEqual([
      ["Overdraft fee", 35, "overdraft"],
      ["Stop payment", 30, "stop_payment"],
      ["Monthly maintenance", 10, "monthly_maintenance"],
      ["Paid overdraft item", 35, "overdraft"],
      ["Outgoing domestic wire", 25, "wire_domestic_outgoing"],
    ]);
  });

  it("keeps a waived fee at its price and ignores the balance in the waiver", () => {
    const [fee] = extractFromSegment("Monthly service fee $12.00, waived with a $1,500 minimum daily balance").candidates;
    expect(fee).toMatchObject({ feeName: "Monthly service fee", amount: 12, waivable: true, canonicalHint: "monthly_maintenance" });

    expect(extractFromSegment("Fee waived with direct deposit of $500 or more")).toEqual({ candidates: [], held: [] });
    expect(extractFromSegment("No monthly fee with a $500 minimum balance")).toEqual({ candidates: [], held: [] });
  });

  it("holds $0, range, percentage and unrecognized priced rows for review", () => {
    const { candidates, held } = extractCandidatesFromText(
      [
        "Paper statement | Free",
        "E-statement fee $0.00",
        "Check printing $15 - $40 per order",
        "Foreign transaction fee 3% of the transaction amount",
        "Fax service fee $3.00",
      ].join("\n"),
    );

    expect(candidates).toEqual([]);
    expect(held.map((row) => [row.shape, row.feeName, row.amount, row.amountMax, row.percent, row.canonicalHint])).toEqual([
      ["zero", "Paper statement", 0, null, null, "paper_statement"],
      ["zero", "E-statement fee", 0, null, null, "estatement_fee"],
      ["range", "Check printing", 15, 40, null, "check_printing"],
      ["percentage", "Foreign transaction fee", null, null, 3, "card_foreign_txn"],
      ["unclassified", "Fax service fee", 3, null, null, null],
    ]);
  });

  it("skips schedule boilerplate and lines with no fee words", () => {
    expect(extractCandidatesFromText("Schedule of fees effective January 1, 2026 $0\nInterest rate 4.5%\nFree online banking")).toEqual({
      candidates: [],
      held: [],
    });
  });
});
