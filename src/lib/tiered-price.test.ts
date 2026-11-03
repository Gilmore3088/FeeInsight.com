import { describe, expect, it } from "vitest";
import { MOOSE_LAKE_OVERDRAFT } from "@/lib/tiered-price.fixtures";
import { namesTier, scopedTierName, tierGroupAt, tierLines, tierOfRead, withoutTierScope } from "@/lib/tiered-price";



const group = (text: string, index: number) => tierGroupAt(tierLines(text), index);

describe("tier groups (#1092, #1110)", () => {
  it("reads Moose Lake's two overdraft tiers as one group of two, with the lead-in's noun", () => {
    const found = group(MOOSE_LAKE_OVERDRAFT, 6);
    expect(found?.tiers.map((tier) => [tier.condition, tier.price, tier.line])).toEqual([
      ["$30.00 or less", 15, 6],
      ["More than $30.00", 30, 8],
    ]);
    expect(found?.leadNoun).toBe("overdraft balance");
    expect(group(MOOSE_LAKE_OVERDRAFT, 8)?.tiers).toHaveLength(2);
    // The repeated bare rows below are their own group; the cap sentence is no tier.
    expect(group(MOOSE_LAKE_OVERDRAFT, 12)?.tiers.map((tier) => tier.price)).toEqual([15, 30]);
    expect(group(MOOSE_LAKE_OVERDRAFT, 2)).toBeNull();
  });

  it("names each tier with its own condition", () => {
    const lines = tierLines(MOOSE_LAKE_OVERDRAFT);
    const low = tierOfRead(lines, "$30.00 or less – Overdraft fee per item per presentment. | $15.00 per item", 15);
    const high = tierOfRead(lines, "More than $30.00 – Overdraft fee per item per presentment. | $30.00 per item", 30);
    expect(scopedTierName("or less – Overdraft fee per item per presentment", low!.tier, low!.group))
      .toBe("Overdraft fee per item per presentment (overdraft balance $30.00 or less)");
    expect(scopedTierName("Overdraft fee per item per presentment", high!.tier, high!.group))
      .toBe("Overdraft fee per item per presentment (overdraft balance more than $30.00)");
    expect(namesTier("Overdraft fee per item per presentment", high!.tier)).toBe(false);
    // A read at a price the line does not print as a tier is no tier read.
    expect(tierOfRead(lines, "More than $30.00 – Overdraft fee per item per presentment. | $30.00 per item", 15)).toBeNull();
  });

  it("reads balance tiers on adjacent lines and count tiers on one line", () => {
    const balance = ["Wire Transfer, Outgoing Domestic up to $1,000 | $15.00", "Wire Transfer, Outgoing Domestic over $1,000 | $25.00"].join("\n");
    expect(group(balance, 1)?.tiers.map((tier) => [tier.condition, tier.price])).toEqual([["up to $1,000", 15], ["over $1,000", 25]]);
    const counts = "Check printing: 1-3 items $1.00, 4+ items $2.00";
    const found = group(counts, 0);
    expect(found?.tiers.map((tier) => [tier.condition, tier.kind, tier.price])).toEqual([["1-3 items", "count", 1], ["4+ items", "count", 2]]);
    expect(found?.base).toBe("Check printing");
    // The audit's own shape: "1-3 items $X, 4+ $Y", the second tier with no unit.
    expect(group("Coin counting: 1-3 items $1.00, 4+ $2.00", 0)?.tiers.map((tier) => [tier.condition, tier.price])).toEqual([["1-3 items", 1], ["4+", 2]]);
    const countRows = ["Overdraft items 1-3 per day | $25.00", "Overdraft items 4 or more per day | $35.00"].join("\n");
    expect(group(countRows, 0)?.tiers.map((tier) => tier.price)).toEqual([25, 35]);
  });

  it("reads no tier from a cap, a waiver threshold or two fees on one line", () => {
    expect(group("Overdraft fee $35 per item, maximum $150 per day", 0)).toBeNull();
    expect(group("Monthly maintenance fee $5.00, waived with $500 balance", 0)).toBeNull();
    expect(group("Stop payment $20, Wire transfer $15", 0)).toBeNull();
    expect(group(["Overdraft fee | $30.00", "No fee if overdrawn $5 or less | $0.00"].join("\n"), 1)).toBeNull();
    // Two fees, each with its own threshold, are not one fee's tiers.
    expect(group(["Cashier's Check more than $1,000 (MCB customers only) | $2.00", "Money Orders $1,000 or less (MCB customers only) | $1.00"].join("\n"), 0)).toBeNull();
    // A dollar figure's digits are no count ("$1 + 3%"), and a $0 band is no priced tier.
    expect(group("Foreign ATM Fee | $1 + 3% of the amount", 0)).toBeNull();
    expect(group(["Courtesy Pay (overdrawn $5 or less) | $0.00", "Courtesy Pay (overdrawn more than $5) | $28.00"].join("\n"), 1)).toBeNull();
    // One conditioned line alone is no group.
    expect(group("Official Check $1,000 and above | $10.00", 0)).toBeNull();
  });
});

describe("withoutTierScope (category guard)", () => {
  it("drops a priced fee's own tier bracket and nothing else", () => {
    expect(withoutTierScope("Overdraft fee per item per presentment (overdraft balance $30.00 or less)", 15)).toBe("Overdraft fee per item per presentment");
    expect(withoutTierScope("Overdraft fee per item per presentment (overdraft balance $30.00 or less)", 0)).toBe("Overdraft fee per item per presentment (overdraft balance $30.00 or less)");
    expect(withoutTierScope("Overdraft fee (waived if overdrawn $5 or less)", 15)).toBe("Overdraft fee (waived if overdrawn $5 or less)");
    expect(withoutTierScope("or less – Overdraft fee per item per presentment", 15)).toBe("or less – Overdraft fee per item per presentment");
    expect(withoutTierScope("Overdraft fee (unless the total overdraft is $50 or less)", 30)).toBe("Overdraft fee (unless the total overdraft is $50 or less)");
  });
});
