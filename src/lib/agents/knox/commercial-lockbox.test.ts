import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPatternKey, extractCandidatesFromText } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

// #1912: Forte Bank's stored schedule (doc 29204) prints "Lock Box Service, per month | $225.00", a
// commercial lockbox; Knox filed it as a safe deposit box (live 135270).
const FORTE = readFileSync(join(__dirname, "__fixtures__", "forte-fee-schedule-29204.txt"), "utf8");

describe("Knox v132: a commercial lockbox service is not a safe deposit box (#1912)", () => {
  it("is the version these reads ship under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(132);
  });

  it("gives the lockbox service no category", () => {
    expect(classifyPatternKey("Lock Box Service, per month")).toBeNull();
    expect(classifyPatternKey("Lock Box Remittance Processing")).toBeNull();
  });

  it("files no specialist's read of Forte's lockbox as a safe deposit box", () => {
    const read = runFreeSpecialists(FORTE, {});
    expect(read.candidates.some((fee) => fee.canonicalHint === "safe_deposit_box")).toBe(false);
    expect(read.candidates.some((fee) => /lock box/i.test(fee.feeName))).toBe(false);
    // The bank's own fees around it still read.
    expect(read.candidates.some((fee) => fee.canonicalHint === "stop_payment" && fee.amount === 35)).toBe(true);
  });

  it("keeps sized lock box rentals, keys, drilling and late fees as safe deposit boxes", () => {
    for (const name of ["Lock Box Rental 5x5", "Lock Box Annual Fee 3 x 5", "Lock Box Replacement Key", "Lock Box Drilling", "Lock box past due date late fee", "Lock Box Late Payment Fee - per month"]) {
      expect(classifyPatternKey(name), name).toBe("safe_deposit_box");
    }
    const fees = extractCandidatesFromText("Lock Box Rental 5x5 | $20.00\n\nLock Box Annual Fee 3 x 5 | $12.00").candidates;
    expect(fees.filter((fee) => fee.canonicalHint === "safe_deposit_box").map((fee) => fee.amount).sort()).toEqual([12, 20]);
  });
});
