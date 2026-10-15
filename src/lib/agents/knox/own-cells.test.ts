import { describe, expect, it } from "vitest";

import { ownCells } from "./own-cells";

describe("the fee's own cells of a two-column line (#1394)", () => {
  it("keeps West Shore Bank's wire fee, not the zipper bag beside it", () => {
    // agent_source_texts 342 (West Shore Bank, document 12974), the line behind published fee 98871.
    const line = "Zipper Bags (Small)…………………………. $4.00 | Outgoing International Wires…….……… $40.00/ea";
    expect(ownCells(line, "Outgoing International Wires", 40)).toBe("Outgoing International Wires…….……… $40.00/ea");
    expect(ownCells(line, "Zipper Bags (Small)", 4)).toBe("Zipper Bags (Small)…………………………. $4.00");
  });

  it("keeps a name cell printed before its price cell, and stops at the neighbour's price", () => {
    expect(ownCells("• Overdrafts $100.00 and over | $20.00 | Money Order | $4.00", "Money Order", 4)).toBe("Money Order | $4.00");
    expect(ownCells("Stop Payment | $25 per item | Outgoing International | $45", "Stop Payment", 25)).toBe("Stop Payment | $25 per item");
    expect(ownCells("| Cashier's Checks | Customer: $5.00 Non – Customer: $10.00 |", "Cashier's Checks: Customer", 5)).toBe(
      "Cashier's Checks | Customer: $5.00 Non – Customer: $10.00",
    );
    expect(ownCells("Stop Payment Fee $ 10.00 | or $2,000.00 minimum balance in related savings account.", "Stop Payment Fee", 10)).toBe(
      "Stop Payment Fee $ 10.00",
    );
  });

  it("keeps the line whole when it has no cells or no cell at the fee's price", () => {
    expect(ownCells("Overdraft fee $35.00 per item", "Overdraft fee", 35)).toBe("Overdraft fee $35.00 per item");
    expect(ownCells("Wire Investigation | Varies", "Wire Investigation", 25)).toBe("Wire Investigation | Varies");
    expect(ownCells("Money Order | $4.00", "Money Order", null)).toBe("Money Order | $4.00");
    expect(ownCells("Monthly fee | Free | Paper statement | $2.00", "Monthly fee", 0)).toBe("Monthly fee | Free");
  });
});
