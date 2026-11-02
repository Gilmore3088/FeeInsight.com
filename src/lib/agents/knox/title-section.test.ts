import { describe, expect, it } from "vitest";

import { withHeldNameVocabulary } from "./held-name-vocabulary";
import { runFreeSpecialists } from "./specialists";
import { inRealEstateSection } from "./title-section";

/**
 * v156 (review of #2888): a bare title fee or title transfer is a vehicle title only outside a real
 * estate section. Under a mortgage, real estate, home equity, HELOC, closing or land heading it stays
 * held, and every read main makes stays as main makes it.
 */
const reads = (text: string, on = true) =>
  withHeldNameVocabulary(on, () => runFreeSpecialists(text).candidates.map((c) => [c.canonicalHint, c.amount, c.feeName]));
const titleHeld = (text: string) => runFreeSpecialists(text).held.filter((h) => /title/i.test(h.feeName)).map((h) => [h.shape, h.canonicalHint, h.amount]);

const HELD_SECTIONS: Array<[string, string]> = [
  ["a mortgage section beside title insurance (the review's case)", "MORTGAGE LOAN FEES\nTitle Insurance $500.00\nTitle Fee $75.00\n"],
  ["a real estate loan section", "Real Estate Loan Fees\nAppraisal | $450.00\nTitle Fee | $75.00"],
  ["a home equity section", "HOME EQUITY LINE OF CREDIT FEES\nTitle Fee | $60.00\nAnnual Fee | $50.00"],
  ["a HELOC section", "HELOC Fees\nTitle Transfer | $40.00"],
  ["a closing costs section", "Closing Costs\nRecording Fee | $30.00\nTitle Fee | $75.00"],
  ["a land loan section", "Land Loans\nTitle Fee | $95.00"],
  ["a mortgage heading in the row's own cell", "Fees\nMortgage Fees | Title Fee | $75.00"],
];

describe("v156: a bare title fee in a real estate section stays held", () => {
  for (const [what, text] of HELD_SECTIONS) {
    it(`holds it in ${what}`, () => {
      expect(reads(text).filter(([key]) => key === "vehicle_title")).toEqual([]);
      expect(titleHeld(text).some(([shape, key]) => shape === "unclassified" && key === null)).toBe(true);
    });
  }

  it("still reads it under a consumer loan or general heading (State key 3141's shape)", () => {
    expect(reads("Consumer Loan Fees\nLoan Modification | $32.00\nTitle Fee | $18.00")).toContainEqual(["vehicle_title", 18, "Title Fee"]);
    expect(reads("Other Fees\nNotary | $5.00\nTitle Transfers | $25.00")).toContainEqual(["vehicle_title", 25, "Title Transfers"]);
  });

  it("looks past priced rows and a percentage row to the heading above", () => {
    const text = "Loan Fees\nConsumer Loan Late Payment Fee | 5% of the installment due\nSkip Payment for each Loan | $32.00\nTitle Fee | $18.00";
    expect(inRealEstateSection(text, "Title Fee", "Title Fee | $18.00")).toBe(false);
    expect(inRealEstateSection(`Mortgage Services\n${text.split("\n").slice(1).join("\n")}`, "Title Fee", "Title Fee | $18.00")).toBe(true);
  });

  it("leaves a vehicle title transfer main files under a mortgage heading as main reads it", () => {
    const text = "MORTGAGE LOAN FEES\nVehicle Title Transfer | $15.00";
    expect(reads(text, true)).toEqual(reads(text, false));
  });
});
