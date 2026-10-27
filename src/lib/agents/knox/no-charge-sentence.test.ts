import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { NO_CHARGE_CONFLICT_FLAG } from "./extract";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

// Wells Fargo's stored overdraft FAQ (doc 33356, current copy on prod Oct 27): "We do not charge a
// returned item/non-sufficient funds (NSF) fee for items returned unpaid." Wells has no NSF row.
const WELLS_FARGO = readFileSync(join(__dirname, "..", "..", "__fixtures__", "no-charge-nsf", "wells-fargo-overdraft-faq-33356.txt"), "utf8");
const NAME = "Returned item/non-sufficient funds (NSF) fee";

const statedZeros = (text: string, noChargeSentences?: boolean) =>
  runFreeSpecialists(text, noChargeSentences == null ? {} : { noChargeSentences }).held
    .filter((row) => row.statedNoCharge);

describe("Knox v133: a no-charge NSF sentence is the NSF fee's $0, behind an off switch (#2040)", () => {
  it("is the version this read ships under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(133);
    expect(NO_CHARGE_CONFLICT_FLAG).toBe("knox_no_charge_conflict");
  });

  it("reads nothing while the switch is off", () => {
    expect(statedZeros(WELLS_FARGO)).toEqual([]);
  });

  it("switched on, reads Wells Fargo's sentence as a held NSF $0 for Darwin", () => {
    const [row, ...rest] = statedZeros(WELLS_FARGO, true);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ shape: "zero", feeName: NAME, amount: 0, canonicalHint: "nsf" });
    expect(row.excerpt).toBe("We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.");
  });

  it("reads none beside another read of NSF on the same text", () => {
    const priced = `${WELLS_FARGO}\nFee Schedule\nNSF Fee | $35.00\n`;
    expect(statedZeros(priced, true)).toEqual([]);
    expect(runFreeSpecialists(priced, { noChargeSentences: true }).candidates.some((fee) => fee.canonicalHint === "nsf" && fee.amount === 35)).toBe(true);
    const freeRow = `${WELLS_FARGO}\nFee Schedule\nNSF Returned Item Fee | No Fee\n`;
    expect(statedZeros(freeRow, true)).toEqual([]);
  });

  it("the shared source check traces the $0 to the sentence only with the switch on, and only as NSF", () => {
    expect(checkFeeAgainstSource(WELLS_FARGO, NAME, 0, ".", "nsf").ok).toBe(false);
    const on = checkFeeAgainstSource(WELLS_FARGO, NAME, 0, ".", "nsf", { noChargeSentences: true });
    expect(on).toMatchObject({ ok: true, sourceLine: "We do not charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid." });
    expect(checkFeeAgainstSource(WELLS_FARGO, NAME, 0, ".", "overdraft", { noChargeSentences: true }).ok).toBe(false);
    expect(checkFeeAgainstSource(WELLS_FARGO, NAME, 35, ".", "nsf", { noChargeSentences: true }).ok).toBe(false);
  });
});
