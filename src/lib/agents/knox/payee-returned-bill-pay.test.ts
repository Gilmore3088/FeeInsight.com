import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPatternKey, extractCandidatesFromText, payeeReturnedBillPayRead } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

// #1912: Bellco FCU's stored schedule (doc 15817) prints "(per item returned by payee)" on the line
// under "Bill Pay Return Item Fee | $10.00"; Knox filed it as NSF (live 85460).
const BELLCO = readFileSync(join(__dirname, "__fixtures__", "bellco-fee-schedule-15817.txt"), "utf8");

describe("Knox v131: a bill payment the payee returned is bill pay, not NSF (#1912)", () => {
  it("is the version these reads ship under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(131);
  });

  it("files Bellco's bill pay return as bill pay, whichever specialist read it", () => {
    const read = runFreeSpecialists(BELLCO, {});
    const returns = read.candidates.filter((fee) => /bill pay return item/i.test(fee.feeName));
    expect(returns.length).toBeGreaterThan(0);
    expect(returns.every((fee) => fee.canonicalHint === "bill_pay" && fee.amount === 10)).toBe(true);
    expect(read.candidates.some((fee) => fee.canonicalHint === "nsf" && fee.amount === 10)).toBe(false);
    // The bank's own NSF fee stays NSF.
    expect(read.candidates.some((fee) => fee.canonicalHint === "nsf" && fee.amount === 28)).toBe(true);
  });

  it("re-files a read that lost the note on the next line", () => {
    const text = "Wire Transfers – Domestic | Bill Pay Return Item Fee | $10.00\n(Free with Platinum Checking) | $20.00 | (per item returned by payee)";
    const read = { feeName: "Bill Pay Return Item Fee", amount: 10, frequency: null, canonicalHint: "nsf", confidence: 0.9, excerpt: "Bill Pay Return Item Fee | $10.00", waivable: false };
    expect(payeeReturnedBillPayRead(read, text).canonicalHint).toBe("bill_pay");
  });

  it("keeps the Texas key's bill payment return item as NSF (tid 2419)", () => {
    expect(classifyPatternKey("Bill Payment Return Item Fee (per presentment)")).toBe("nsf");
    const fees = extractCandidatesFromText("Bill Payment Return Item Fee (per presentment) | $30.00\n\nCheck Cashing Fee | $5.00").candidates;
    expect(fees.find((fee) => fee.amount === 30)?.canonicalHint).toBe("nsf");
  });

  it("keeps a bill pay return whose name names insufficient funds as NSF", () => {
    expect(classifyPatternKey("Bill Pay NSF Return (returned by payee)")).toBe("nsf");
    expect(classifyPatternKey("Bill Pay Return Item Fee (per item returned by payee)")).toBe("bill_pay");
  });
});
