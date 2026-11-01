import { describe, expect, it } from "vitest";
import { classifyFeeText } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

// Global FCU (institution 5005), stored text 1049 (document 1940), the two-column schedule as stored.
const GLOBAL_FCU = [
  "Outgoing/Foreign ...........................................................................................................$15.00 per item | to or greater than $5.00",
  "» Cash advance using non-Global card: ........................................... $5.00 per advance | $0.00 - $4.99 ........................ no charge | $20.00 - $24.99 .........................$20.00",
  "$5.00 - $9.99 ................................. $5.00 | $25.00 - $29.99 ..........................$25.00",
  "Checking account services: | $10.00 - $14.99 .......................... $10.00 | $30.00 + .......................................$30.00",
  "» Overdraft protection transfer: | $15.00 - $19.99 ............................$15.00",
  "From a Savings or Money Market Share or | » NSF mortgage payment: Additional Cenlar charge ................................. $25.00 per item",
  "Credit Line Loan ................................ $5.00 per day that total transfers exceed $25.00",
  "» Returned deposited item: ................................................................................... $5.00 per item",
].join("\n");

describe("Knox v144: NSF on a loan payment is the loan's fee", () => {
  it("runs at rules version 144 or later", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(144);
  });

  it("files Global FCU's Cenlar charge as other lending, not NSF", () => {
    const reads = runFreeSpecialists(GLOBAL_FCU).candidates.filter((read) => /cenlar/i.test(read.feeName));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.amount).toBe(25);
      expect(read.canonicalHint).toBe("other_lending_fee");
    }
  });

  it.each([
    ["NSF Loan Payment", "other_lending_fee"],
    ["NSF for Automatic Loan Payment", "other_lending_fee"],
    ["MBFS NSF (Business Loan Payment)", "other_lending_fee"],
    ["NSF check/Loan Payment", "nsf"],
    ["Nonsufficient Funds Loan Payment, Returned Check", "nsf"],
    ["NSF Fee", "nsf"],
    ["Returned loan payment", "other_lending_fee"],
  ])("classifies %s as %s", (name, key) => {
    expect(classifyFeeText(name)).toBe(key);
  });
});
