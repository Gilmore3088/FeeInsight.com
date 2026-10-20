import { describe, expect, it } from "vitest";
import { paidReturnedCandidateProof, paidReturnedUnits } from "./paid-returned-events";

const row = "NSF Paid/Returned | $29.00 per presentment";
const source = (...lines: string[]) => ["Account Fee Schedule", "Consumer Checking Fees", ...lines].join("\n");

describe("complete source-owned paid/returned unit", () => {
  it.each([
    row,
    "NSF Returned/Paid | $29.00 per item",
    "NSF Paid and Returned Item Fee | $29.00 each",
    "Non-sufficient funds Paid/Returned | $29.00",
    "NSF Paid/Returned\n$29.00 per presentment",
    "NSF Paid/Returned\n$29.00\nper presentment",
  ])("retains full literal row and independently grounded event labels: %s", literal => {
    const [unit] = paidReturnedUnits(source(literal));
    expect(unit).toMatchObject({ amount: 29, heading: "Consumer Checking Fees", audience: "consumer", eligibility: "admit" });
    expect(unit.ownText).toBe(literal.replace(/\s+/g, " "));
    expect(unit.events.map(event => [event.action, event.canonicalKey])).toEqual([["paid", "overdraft"], ["returned", "nsf"]]);
    for (const event of unit.events) {
      expect(paidReturnedCandidateProof(source(literal), event.name, 29, event.canonicalKey, event.lineShare))
        .toMatchObject({ event, unit });
      expect(paidReturnedCandidateProof(source(literal), event.name, 37, event.canonicalKey, event.lineShare)).toBeNull();
      expect(paidReturnedCandidateProof(source(literal), event.name, 29, event.canonicalKey, "paired_event:v1:unrelated:paid")).toBeNull();
    }
  });

  it("does not turn an absent unit into a charging frequency", () => {
    expect(paidReturnedUnits(source("NSF Paid/Returned | $29.00"))[0].frequency).toBeNull();
    expect(paidReturnedUnits(source(row))[0].frequency).toBe("per_item");
  });

  it.each([
    "Consumer Checking with Direct Deposit Fees", "Consumer Premier Checking Fees", "Consumer Checking Fees with Direct Deposit",
    "Personal Student Checking Fees", "Consumer Checking and Business Fees", "Pathfinder & Business Checking Fees",
    "Checking Fees", "Business Checking Fees", "Retail Fee Schedule", "Individual Savings Account Fees:",
  ])("recognizes but holds a qualified or unassigned owner: %s", heading => {
    const units = paidReturnedUnits(["Account Fee Schedule", heading, row].join("\n"));
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ heading, eligibility: "hold" });
  });

  it.each(["Consumer Checking Fees", "Personal Account Fees", "Personal Savings Account Fees:"])
    ("admits only an explicit generic consumer scope: %s", heading => {
      expect(paidReturnedUnits([heading, row].join("\n"))[0]).toMatchObject({ audience: "consumer", eligibility: "admit" });
    });

  it.each(["Premium | Standard", "Premium\nStandard", "With direct deposit", "Terms and conditions apply"])
    ("does not inherit generic scope through an unresolved owner/qualifier: %s", context => {
      expect(paidReturnedUnits(source(context, row))[0].eligibility).toBe("hold");
    });

  it.each(["NSF Paid Item Fee", "NSF Returned Item Fee", "NSF Paid Fee", "Overdraft Fee", "Returned Item Fee"])
    ("refuses a separate %s in either order, including equal prices and wrapped prices", label => {
      for (const amount of [29, 37]) for (const separate of [`${label} | $${amount}.00`, `${label}\n$${amount}.00`]) {
        expect(paidReturnedUnits(source(row, separate))).toEqual([]);
        expect(paidReturnedUnits(source(separate, row))).toEqual([]);
      }
    });

  it("checks beyond the previous seventeen-line prefix and proves a section boundary", () => {
    const filler = Array.from({ length: 30 }, (_, index) => `Statement Copy ${index + 1} | $2.00`);
    expect(paidReturnedUnits(source(row, ...filler, "NSF Paid Item Fee | $37.00"))).toEqual([]);
    expect(paidReturnedUnits(source(row, ...filler, "Miscellaneous Account Fees", "Overdraft Fee | $37.00")))
      .toHaveLength(1);
  });

  it("does not certify an unexamined oversized section", () => {
    const filler = Array.from({ length: 520 }, (_, index) => `Statement Copy ${index + 1} | $2.00`);
    expect(paidReturnedUnits(source(row, ...filler))).toEqual([]);
    expect(paidReturnedUnits(source(row, ...filler, "NSF Returned Item Fee | $37.00"))).toEqual([]);
  });

  it("retains an examined boundary at the section budget and refuses the next physical line", () => {
    const filler = Array.from({ length: 510 }, (_, index) => `Statement Copy ${index + 1} | $2.00`);
    expect(paidReturnedUnits(source(row, ...filler))).toHaveLength(1);
    expect(paidReturnedUnits(source(row, ...filler, "one more note"))).toEqual([]);
  });

  it.each([
    "NSF Paid | $29.00", "NSF Returned | $29.00", "NSF Paid $29 / Returned $37",
    "NSF Paid/Returned | $29.00 | $29.00", "NSF Paid/Returned | $29.00 per day",
    "NSF Paid/Returned | $29.00 maximum per day", "NSF Paid/Returned | $87 daily maximum ($29 per item)",
    "NSF Paid/Returned | $29.00 if balance below $100", "NSF Paid/Returned | $29.00 waived with direct deposit",
    "NSF Paid/Returned | $29.00 example charge", "NSF Paid/Returned | FREE",
    "NSF Paid/Returned | $0.00", "NSF Paid/Returned\n\n$29.00", "NSF Paid/Returned\n• Stop Payment | $29.00",
    "NSF Paid/Returned\nChecking Fees\n$29.00", "NSF Return/Paid Item Fee for Chkg. & Sav | $25.00",
  ])("does not manufacture paired flat fees from unsupported text: %s", literal => {
    expect(paidReturnedUnits(source(literal))).toEqual([]);
  });

  it.each(["Stop Payment", "Deposited Item Returned", "ACH Origination", "Overdraft Transfer"])
    ("does not borrow the neighboring %s price or scope", label => {
      const text = source(row, `${label} | $29.00`);
      expect(paidReturnedUnits(text)).toHaveLength(1);
      expect(paidReturnedUnits(source("NSF Paid/Returned", `${label} | $29.00`))).toEqual([]);
    });

  it.each([
    "For accounts enrolled in direct deposit", "Subject to account qualifications", "Only eligible accounts",
    "Charge applies after the account threshold", "3 items maximum per day", "$87 daily cap", "Maximum per day",
    "waived with direct deposit", "An unfamiliar qualification without a known keyword", "• Restricted account clause",
  ])("preserves arbitrary following context and holds it instead of shedding a qualifier: %s", qualifier => {
    const literal = "NSF Paid/Return $20";
    const [unit] = paidReturnedUnits(source(literal, qualifier));
    expect(unit).toMatchObject({ amount: 20, ownText: literal, followingContext: qualifier, eligibility: "hold", frequency: null });
    const [withUnit] = paidReturnedUnits(source(row, qualifier));
    expect(withUnit).toMatchObject({ ownText: row, followingContext: qualifier, eligibility: "hold", frequency: "per_item" });
  });

  it("does not clip an uncompleted long continuation into positive price evidence", () => {
    expect(paidReturnedUnits(source(row, "For eligible accounts", "Subject to additional terms", "Only while enrolled"))).toEqual([]);
  });

  it("holds repeated source owners instead of choosing a same-price product", () => {
    const text = source(row, "Personal Account Fees", row);
    const units = paidReturnedUnits(text);
    expect(units).toHaveLength(2);
    expect(units.every(unit => unit.eligibility === "hold")).toBe(true);
    expect(paidReturnedCandidateProof(text, "NSF - Paid", 29, "overdraft")).toBeNull();
  });

  it("holds distinct compressed prices rather than treating their different keys as admission", () => {
    const units = paidReturnedUnits(source(row, "NSF Returned/Paid | $37.00 per item"));
    expect(units).toHaveLength(2);
    expect(units.every(unit => unit.eligibility === "hold")).toBe(true);
  });

  it("declines a whole source over the bounded proof budget", () => {
    expect(paidReturnedUnits(source(row, "x".repeat(1_000_000)))).toEqual([]);
  });
});
