import { describe, expect, it } from "vitest";
import { scopedFeeStatements } from "@/lib/fee-audience";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { extractCandidatesFromText } from "./rules";
import { runFreeSpecialists } from "./specialists";
import { recategorizeHeld } from "./held-recheck";
import { statedInOwnSource } from "../darwin/verify";

const PINNACLE = "- We've eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from $38 to $30 for business clients.";
const LEGACY_NAME = "We've eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from";

describe("Pinnacle audience regression", () => {
  it("the normal free team returns two correctly scoped prices, not a blanket $30", () => {
    const result = runFreeSpecialists(PINNACLE);
    expect(result.candidates.filter((fee) => fee.canonicalHint === "nsf").map((fee) => [fee.feeAudience, fee.amount])).toEqual([["consumer", 0], ["business", 30]]);
    expect(result.candidates.some((fee) => fee.amount === 38)).toBe(false);
    expect(extractCandidatesFromText(PINNACLE).candidates).toHaveLength(2);
  });
  it("the shared source checker and Darwin accept both new observations", () => {
    for (const fee of scopedFeeStatements(PINNACLE)) {
      expect(checkFeeAgainstSource(PINNACLE, fee.feeName, fee.amount, ".", "nsf").ok).toBe(true);
      expect(statedInOwnSource({ fee_name: fee.feeName, amount: fee.amount, source_document_id: 21164 }, new Map([[21164, PINNACLE]]), "nsf")).toBe(true);
    }
  });
  it("the legacy unscoped record fails the same shared check used by publication/restoration", () => {
    expect(checkFeeAgainstSource(PINNACLE, LEGACY_NAME, 30, ".", "nsf").ok).toBe(false);
    expect(statedInOwnSource({ fee_name: LEGACY_NAME, amount: 30, source_document_id: 21164 }, new Map([[21164, PINNACLE]]), "nsf")).toBe(false);
  });
  it("a held-row recheck cannot promote only the business amount out of a mixed sentence", () => {
    expect(recategorizeHeld({ fee_raw_id: 321488, amount: 30, fee_name: LEGACY_NAME, conditions: `Knox held for review (range); canonical_hint=none; excerpt="${PINNACLE}"` })).toBeNull();
  });
  it("keeps all-client overdraft at the new price without reading the cushion or daily limit as NSF", () => {
    const result = runFreeSpecialists([PINNACLE,
      "- We've lowered Overdraft Paid Item fees from $38 to $30 for ***all*** clients.",
      "We've increased our Overdraft Cushion to $15 for consumer clients.",
      "Consumer overdraft fees are limited to three per day ($90).",
    ].join("\n"));
    expect(result.candidates.filter((fee) => fee.canonicalHint === "overdraft").map((fee) => fee.amount)).toEqual([30]);
    expect(result.candidates.filter((fee) => fee.canonicalHint === "nsf").map((fee) => fee.amount)).toEqual([0, 30]);
  });
});
