import { describe, expect, it } from "vitest";
import { frequencyFromLine, wordsAfterPrice } from "./fee-frequency";

describe("frequencyFromLine (live excerpts, Oct 8)", () => {
  it("reads the words right after the fee's own price", () => {
    expect(frequencyFromLine("Copy of Share Draft (Check) Faxed | $6.00 each", 6)).toBe("per_item");
    expect(frequencyFromLine("| Photocopies: | $0.25 per page", 0.25)).toBe("per_item");
    expect(frequencyFromLine("Deposited Item Return | $25/Item", 25)).toBe("per_item");
    expect(frequencyFromLine("Stop Payment | $28.00 | Per request", 28)).toBe("per_item");
    expect(frequencyFromLine("Incoming Wire Transfer | $25.00 per transfer", 25)).toBe("per_item");
    expect(frequencyFromLine("Bill Pay Transactions - Business (per cycle) | $4.95 per cycle *fee waived if (1) bill payment made per cycle", 4.95)).toBe("monthly");
    expect(frequencyFromLine("Dormancy Fee (Maintanence Fee/Account Inactivity Fee) $1.00 per Statement Cycle", 1)).toBe("monthly");
    expect(frequencyFromLine("Late Fee | up to $25.00 | Money Order | $3.00 each", 3)).toBe("per_item");
  });

  it("reads the fee's own name when nothing follows the price", () => {
    expect(frequencyFromLine("Lost Safe Deposit Key (each) | $15.00", 15)).toBe("per_item");
    expect(frequencyFromLine("Inactive/Return Mail Fee (Quarterly) | $10.00", 10)).toBe("quarterly");
    expect(frequencyFromLine("Returned Mail – per piece / $10.00", 10)).toBe("per_item");
    expect(frequencyFromLine("Overdraft Protection Transfer (per occurrence) | $10.00 | Incoming International (per wire) | $20.00", 20)).toBe("per_item");
    expect(frequencyFromLine("Wire Initiation Fee (Outgoing/International) | Each | $50", 50)).toBe("per_item");
  });

  it("leaves a frequency unknown when the line prices by something else or says nothing", () => {
    expect(frequencyFromLine("Checkbook Reconciliation (per hour) | $30.00", 30)).toBeNull();
    expect(frequencyFromLine("Research Fee (per hour): | $25 per hour ($25.00 minimum)", 25)).toBeNull();
    expect(frequencyFromLine("Counter Checks | $1.00 | Per 5 checks", 1)).toBeNull();
    expect(frequencyFromLine("Garnishments, Executions, Levies and other subpoenas | $50.00 plus legal fees, plus $15.00 per hour research, plus $2.00 per copy", 50)).toBeNull();
    expect(frequencyFromLine("Paper Statement | $2.00", 2)).toBeNull();
    expect(frequencyFromLine("Statement Copy (Per Statement) | $2.00", 2)).toBeNull();
    expect(frequencyFromLine("Account Closure Fee ......$10.00 (less than 90 days) | Maximum of 3 Visa Reloadable Cards per member", 10)).toBeNull();
    // A frequency is never borrowed from a line that does not print the fee's price.
    expect(frequencyFromLine("Money Orders | $1.00 each", 2)).toBeNull();
  });

  it("keeps Darwin's reader unchanged", () => {
    expect(wordsAfterPrice("6 withdrawals included per month; $5.00 each after 6", 5)).toBe(" each after 6");
    expect(wordsAfterPrice("no price here", 5)).toBe("no price here");
  });
});
