import { describe, expect, it } from "vitest";

import { withHeldNameVocabulary } from "./held-name-vocabulary";
import { runFreeSpecialists } from "./specialists";

/**
 * v161 (third review of #2888): a bare "Title Fee" or "Title transfers" is never placed. Whose title it
 * is (a mortgage's or a car's) only the section it sits in can say, and Knox has no section structure to
 * read (#2872's root cause): two rounds of heading rules each let a mortgage section's title fee through.
 * So it stays held unclassified, exactly as on main, under every heading the reviews tried. A title the
 * name ties to a vehicle ("Vehicle Title Transfer", "Auto Title Fee") or a DMV filing still reads.
 */
const reads = (text: string, on = true) =>
  withHeldNameVocabulary(on, () => runFreeSpecialists(text).candidates.map((c) => [c.canonicalHint, c.amount, c.feeName]));
const titleReads = (text: string) => reads(text).filter(([, , name]) => /\btitle\b/i.test(String(name)));

const REVIEW_INPUTS: Array<[string, string]> = [
  ["a dated mortgage heading", "Mortgage Fees (effective 1/1/2026)\nTitle Fee $75.00"],
  ["a first mortgage heading", "1st Mortgage Fees\nTitle Fee $75.00"],
  ["a mortgage table header", "MORTGAGE LOAN FEES | Amount\nTitle Fee $75.00"],
  ["a mortgage heading over a sub-row", "MORTGAGE LOAN FEES\nOrigination\nTitle Fee $75.00"],
  ["home loans", "Home Loans\nTitle Fee $75.00"],
  ["escrow services", "Escrow Services\nTitle Fee $75.00"],
  ["deed and title services", "Deed and Title Services\nTitle Fee $75.00"],
  ["property loans", "Property Loans\nTitle Fee $75.00"],
  ["a mortgage section beside title insurance", "MORTGAGE LOAN FEES\nTitle Insurance $500.00\nTitle Fee $75.00"],
  ["review A: an auto payoff on the same line", "MORTGAGE LOAN FEES\nTitle Fee $75.00 Auto Loan Payoff $20.00"],
  ["review B: a dated mortgage heading under an auto heading", "AUTO LOAN FEES\nLate Fee $25.00\nMortgage Fees (2026)\nTitle Fee $75.00"],
  ["recreational facilities", "Recreational Facilities\nTitle Fee $75.00"],
  // Even under a vehicle heading: positive evidence needs section structure too.
  ["an auto loan heading", "Auto Loan Fees\nTitle Fee | $15.00"],
  ["a flattened misc block (Texas key 38)", "Deposit corrections – $1.00 Title transfers – $25.00 Notary – $5.00"],
  ["a miscellaneous heading (State key 3141)", "Miscellaneous Fees\nLoan Modification | $32.00\nTitle Fee | $18.00"],
];

describe("v161: a bare title fee is never placed", () => {
  for (const [what, text] of REVIEW_INPUTS) {
    it(`holds it under ${what}, as main does`, () => {
      expect(titleReads(text).filter(([, , name]) => /^\W*titles?\s+(?:fees?|transfers?)\W*$/i.test(String(name)))).toEqual([]);
      expect(reads(text, true)).toEqual(reads(text, false));
    });
  }

  it("still reads a title the name ties to a vehicle, and a DMV filing", () => {
    expect(titleReads("Fees\nAuto Title Fee | $15.00")).toEqual([["vehicle_title", 15, "Auto Title Fee"]]);
    expect(reads("Fees\nDMV Documentation and Transfer | $20.00")).toContainEqual(["vehicle_title", 20, "DMV Documentation and Transfer"]);
    expect(reads("MORTGAGE LOAN FEES\nVehicle Title Transfer | $15.00", true)).toEqual(reads("MORTGAGE LOAN FEES\nVehicle Title Transfer | $15.00", false));
  });
});
