import { describe, expect, it } from "vitest";

import { withHeldNameVocabulary } from "./held-name-vocabulary";
import { runFreeSpecialists } from "./specialists";
import { namesVehicle } from "./title-section";

/**
 * v157 (reviews of #2888): a bare "Title Fee" or "Title transfers" that only the vocabulary names
 * files as a vehicle title only with positive evidence: its own line or the nearest heading above it
 * names a vehicle, a consumer loan or an installment loan. Otherwise it stays held, as on main.
 */
const reads = (text: string, on = true) =>
  withHeldNameVocabulary(on, () => runFreeSpecialists(text).candidates.map((c) => [c.canonicalHint, c.amount, c.feeName]));
const titleReads = (text: string) => reads(text).filter(([key]) => key === "vehicle_title");
const titleHeld = (text: string) => runFreeSpecialists(text).held.filter((h) => /title/i.test(h.feeName)).map((h) => [h.shape, h.canonicalHint]);

// The second review's eight headings: none names a vehicle, so the bare title fee stays held.
const HELD: string[] = [
  "Mortgage Fees (effective 1/1/2026)",
  "1st Mortgage Fees",
  "MORTGAGE LOAN FEES | Amount",
  "MORTGAGE LOAN FEES\nOrigination",
  "Home Loans",
  "Escrow Services",
  "Deed and Title Services",
  "Property Loans",
  // and the first review's case
  "MORTGAGE LOAN FEES\nTitle Insurance $500.00",
];

describe("v157: a bare title fee with no vehicle on its line or heading stays held", () => {
  for (const heading of HELD) {
    it(`holds "Title Fee $75.00" under ${JSON.stringify(heading)}`, () => {
      const text = `${heading}\nTitle Fee $75.00`;
      expect(titleReads(text)).toEqual([]);
      expect(titleHeld(text)).toContainEqual(["unclassified", null]);
    });
  }

  it("holds one under no heading at all", () => {
    expect(titleReads("Title transfers – $25.00")).toEqual([]);
  });
});

describe("v157: a bare title fee a vehicle places reads as a vehicle title", () => {
  const POSITIVE: Array<[string, string, number, string]> = [
    ["an auto loan heading", "Auto Loan Fees\nTitle Fee | $15.00", 15, "Title Fee"],
    ["a consumer loan heading", "Consumer Loans\nTitle Fee | $18.00", 18, "Title Fee"],
    ["its own note naming the vehicle", "Fees\nTitle Fee (vehicle) | $20.00", 20, "Title Fee (vehicle)"],
    ["a boat and RV loan heading", "Boat & RV Loans\nTitle transfer | $25.00", 25, "Title transfer"],
    ["an installment loan heading past priced rows", "Installment Loan Fees\nLate Fee | 5% of payment\nSkip Payment | $25.00\nTitle Fee | $18.00", 18, "Title Fee"],
  ];
  for (const [what, text, amount, name] of POSITIVE) {
    it(`reads it under ${what}`, () => {
      expect(titleReads(text)).toEqual([["vehicle_title", amount, name]]);
    });
  }

  it("reads a vehicle named on the row's own stretch of a flattened line, not elsewhere on it", () => {
    expect(namesVehicle("Notary – $5.00 Title transfers (per vehicle) – $25.00", "Title transfers (per vehicle)", null)).toBe(true);
    expect(namesVehicle("Car wash coupons – $5.00 Notary – $5.00 Title transfers – $25.00", "Title transfers", null)).toBe(false);
  });

  it("leaves names that say vehicle themselves as main reads them", () => {
    for (const text of ["MORTGAGE LOAN FEES\nVehicle Title Transfer | $15.00", "Fees\nDMV Documentation and Transfer | $20.00"]) {
      expect(reads(text, true).filter(([key]) => key === "vehicle_title")).toHaveLength(1);
    }
    expect(reads("MORTGAGE LOAN FEES\nVehicle Title Transfer | $15.00", true)).toEqual(reads("MORTGAGE LOAN FEES\nVehicle Title Transfer | $15.00", false));
  });
});
