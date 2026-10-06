import { describe, expect, it } from "vitest";

import { tidyFeeName } from "./layout";

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
  ])("tidies %j", (raw, expected) => {
    expect(tidyFeeName(raw)).toBe(expected);
  });

  it("leaves clean names and their qualifiers alone", () => {
    expect(tidyFeeName("Stop Payment")).toBe("Stop Payment");
    expect(tidyFeeName("Drill box fee (when keys are lost or stolen)")).toBe("Drill box fee (when keys are lost or stolen)");
    expect(tidyFeeName("returned check (single party)")).toBe("returned check (single party)");
  });

  it("keeps the raw name when tidying would leave nothing usable", () => {
    expect(tidyFeeName("3 x 5")).toBe("3 x 5");
  });
});
