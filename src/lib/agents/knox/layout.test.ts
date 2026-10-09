import { describe, expect, it } from "vitest";

import { readsAMeasuredAmount, repairNameShape, tidyFeeName } from "./layout";

describe("tidyFeeName", () => {
  it.each([
    // A neighbouring cell's unit or the price's qualifier is not part of the name.
    ["Copy of Paid Check | Per Item", "Copy of Paid Check"],
    ["Check Copy | N/C | N/C | N/C", "Check Copy"],
    ["/Item | Bill Pay Reactivation", "Bill Pay Reactivation"],
    ["APY of .00% | Subpoena Fee", "Subpoena Fee"],
    ["Garnishment/Levy Fee | Per Item", "Garnishment/Levy Fee"],
    // Dot leaders, bullets and list markers.
    ["per Withdrawal/Transfer | Dormant Account Fee ……………………………………………..….", "Dormant Account Fee"],
    ["Check Return/NSF Fee:……….…………………………..………", "Check Return/NSF Fee"],
    [" Copy of Cancelled Share Draft . . . . . . . . . . . . . . . . . . . .", "Copy of Cancelled Share Draft"],
    ["b. Non-Sufficient Funds (NSF)", "Non-Sufficient Funds (NSF)"],
    ["➢ NSF Fee", "NSF Fee"],
    ["/transfer ● Drill lock on box", "Drill lock on box"],
    // A unit glued to the front of the next row's name.
    ["/Item Cashier’s Check", "Cashier’s Check"],
    ["per year Duplicate Safe Deposit Box Key ....................................", "Duplicate Safe Deposit Box Key"],
    ["/year | 3 x 5 Safe Deposit Box Rent", "3 x 5 Safe Deposit Box Rent"],
    // Separators become one readable join; a name in parentheses is the name.
    ["Wire Transfers:: Outgoing - domestic", "Wire Transfers: Outgoing - domestic"],
    ["Hi-Yield Checking | Non-Blaze ATM Fee", "Hi-Yield Checking: Non-Blaze ATM Fee"],
    ["(Money Order)", "Money Order"],
    // The words that ran on into the price, and the previous row's "None" price.
    ["Visa Lost/Stolen Replacement Card Fee of", "Visa Lost/Stolen Replacement Card Fee"],
    ["Non-Bank of America ATM Fee for", "Non-Bank of America ATM Fee"],
    ["Debit Card Replacement A fee of", "Debit Card Replacement"],
    ["A minimum balance fee of", "Minimum balance fee"],
    ["Monthly service fee | None | Bill payment- same day ACH", "Bill payment- same day ACH"],
  ])("tidies %j", (raw, expected) => {
    expect(tidyFeeName(raw)).toBe(expected);
  });

  it("leaves clean names and their qualifiers alone", () => {
    expect(tidyFeeName("Stop Payment")).toBe("Stop Payment");
    expect(tidyFeeName("Drill box fee (when keys are lost or stolen)")).toBe("Drill box fee (when keys are lost or stolen)");
    expect(tidyFeeName("returned check (single party)")).toBe("returned check (single party)");
    // A sentence keeps "fee of": the category guard reads it as a fee, not a requirement.
    expect(tidyFeeName("minimum daily balance is required to avoid a monthly minimum balance fee of")).toBe(
      "minimum daily balance is required to avoid a monthly minimum balance fee of",
    );
  });

  it("keeps the raw name when tidying would leave nothing usable", () => {
    expect(tidyFeeName("3 x 5")).toBe("3 x 5");
  });
});

describe("readsAMeasuredAmount (v32)", () => {
  it("drops a waiver threshold and a worked example's transaction amount", () => {
    const usBank = "if your Available Balance (excluding the Overdraft Paid Fees and\nincluding immediate and same day deposits), is at least $0 we will waive Overdraft Paid Fee(s) charged.";
    expect(readsAMeasuredAmount(usBank, "(excluding the Overdraft Paid Fees and including immediate and same day deposits), is at least", 0)).toBe(true);
    const chase = "To avoid the $34 Overdraft Fee on the $60 gasoline transaction from Tuesday";
    expect(readsAMeasuredAmount(chase, "Overdraft Fee on", 60)).toBe(true);
  });

  it("keeps the price when the threshold is a different figure", () => {
    expect(readsAMeasuredAmount("$5 service charge if balance falls below $300", "service charge if balance falls below", 5)).toBe(false);
    expect(readsAMeasuredAmount("Overdraft Fee on the $600 purchase", "Overdraft Fee on", 60)).toBe(false);
    expect(readsAMeasuredAmount("Overdraft fee $34", "Overdraft fee", 34)).toBe(false);
  });
});

describe("repairNameShape (Extraco, Oct 8)", () => {
  it("ends the name before a parenthesis the line break cut off", () => {
    expect(repairNameShape("Consumer, Inactivity Fee (Notification sent at 10")).toBe("Consumer, Inactivity Fee");
    expect(repairNameShape("Early Account Closure (by Extraco – no")).toBe("Early Account Closure");
    expect(repairNameShape("Free official checks (subject to maximum of five (5) per month; additional check fee")).toBe(
      "Free official checks",
    );
    expect(repairNameShape("(Lost key replacement")).toBe("Lost key replacement");
    expect(repairNameShape("Bill Payment Service)")).toBe("Bill Payment Service");
    expect(repairNameShape("ATM's and Presto Network ATMs)")).toBe("ATM's and Presto Network ATMs");
    expect(repairNameShape("Stop Payment (per item)")).toBe("Stop Payment (per item)");
    expect(repairNameShape("Early Account Closure (by customer)")).toBe("Early Account Closure (by customer)");
  });

  it("reads a doubled word once", () => {
    expect(repairNameShape("Account Research Research")).toBe("Account Research");
    expect(repairNameShape("Personal Loan Loan Application Fee")).toBe("Personal Loan Application Fee");
    expect(repairNameShape("MORTGAGE Mortgage Fax Fee")).toBe("Mortgage Fax Fee");
    expect(repairNameShape("Monthly Fee Fee is waived if average daily balance is over")).toBe("Monthly Fee");
    expect(repairNameShape("Safe Deposit Box 10x10")).toBe("Safe Deposit Box 10x10");
  });

  it("keeps the name when the repair would leave nothing usable", () => {
    expect(repairNameShape("(")).toBe("(");
  });
});

describe("tidyFeeName footnote numbers", () => {
  it("drops a footnote number left once the dot leaders are gone", () => {
    expect(tidyFeeName("Check Cashing Fee1. . . . . . . . . . . . . .")).toBe("Check Cashing Fee");
    expect(tidyFeeName("OVERDRAFT & NSF FEES | Statement Copy Fee8 . . . . . . .")).toBe("OVERDRAFT & NSF FEES: Statement Copy Fee");
    expect(tidyFeeName("Safe Deposit Box 10x10")).toBe("Safe Deposit Box 10x10");
  });
});
