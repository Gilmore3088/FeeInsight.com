// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { MOOSE_LAKE_FEE_SCHEDULE } from "@/lib/tiered-price.fixtures";

const doc = (...lines: string[]) => ["Fee Schedule", ...lines].join("\n");
const reads = (text: string) => runFreeSpecialists(text).candidates.map((read) => [read.canonicalHint, read.amount, read.feeName]);
const held = (text: string) => runFreeSpecialists(text).held.map((row) => [row.shape, row.canonicalHint, row.amount, row.feeName]);

describe("Knox v183 names each price tier with its own condition (#1110)", () => {
  it("reads Moose Lake's two overdraft tiers (document 35684) as two scoped fees, and nothing else changes", () => {
    const overdraft = reads(MOOSE_LAKE_FEE_SCHEDULE).filter(([hint]) => hint === "overdraft");
    expect(overdraft).toEqual([
      ["overdraft", 15, "Overdraft fee per item per presentment (overdraft balance $30.00 or less)"],
      ["overdraft", 30, "Overdraft fee per item per presentment (overdraft balance more than $30.00)"],
    ]);
    expect(held(MOOSE_LAKE_FEE_SCHEDULE).some(([shape]) => shape === "tier_incomplete")).toBe(false);
    expect(reads(MOOSE_LAKE_FEE_SCHEDULE)).toContainEqual(["stop_payment", 20, "Stop payment (per request). These fees double for lost checkbook"]);
  });

  it("keeps balance and amount tiers whose names already state them", () => {
    expect(reads(doc("Cashier’s checks $1,000.00 or less per item | $5.00", "", "Cashier’s checks over $1,000.00 per item | $10.00"))).toEqual([
      ["cashiers_check", 5, "Cashier’s checks $1,000.00 or less per item"],
      ["cashiers_check", 10, "Cashier’s checks over $1,000.00 per item"],
    ]);
    expect(reads(doc("Wire Transfer (Incoming) - up to $100,000 | $15", "Wire Transfer (Incoming) - over $100,000 | $18"))).toEqual([
      ["wire_domestic_incoming", 15, "Wire Transfer (Incoming) - up to $100,000"],
      ["wire_domestic_incoming", 18, "Wire Transfer (Incoming) - over $100,000"],
    ]);
  });

  it("reads a balance tier pair printed on one line as two scoped fees", () => {
    expect(reads(doc("Overdraft fee: $15.00 per item if overdraft balance is $30.00 or less; $30.00 per item if over $30.00"))).toEqual([
      ["overdraft", 15, "Overdraft fee (overdraft balance $30.00 or less)"],
      ["overdraft", 30, "Overdraft fee (overdraft balance over $30.00)"],
    ]);
  });

  it("reads count tiers on rows and on one line (\"1-3 items $X, 4+ $Y\"), adding the tier no reader read", () => {
    expect(reads(doc("Overdraft items 1-3 per day | $25.00", "Overdraft items 4 or more per day | $35.00"))).toEqual([
      ["overdraft", 25, "Overdraft items 1-3 per day"],
      ["overdraft", 35, "Overdraft items 4 or more per day"],
    ]);
    const line = runFreeSpecialists(doc("Check printing: 1-3 items $1.00, 4+ items $2.00")).candidates;
    expect(line.map((read) => [read.canonicalHint, read.amount, read.feeName])).toEqual([
      ["check_printing", 1, "Check printing: 1-3 items"],
      ["check_printing", 2, "Check printing (4+ items)"],
    ]);
    expect(line[1].confidence).toBeLessThanOrEqual(0.85);
  });

  it("holds every tier of a group when one tier cannot be read, instead of sending Darwin one tier", () => {
    const text = doc("Overdraft items 1-3 per day | $25.00", "Overdraft items 4 or more per day | $900.00", "Stop payment | $30.00");
    expect(reads(text)).toEqual([["stop_payment", 30, "Stop payment"]]);
    expect(held(text)).toEqual([
      ["tier_incomplete", "overdraft", 900, "Overdraft items 4 or more per day"],
      ["tier_incomplete", "overdraft", 25, "Overdraft items 1-3 per day"],
    ]);
  });

  it("leaves a cap, a waiver threshold and two fees on one line alone", () => {
    expect(reads(doc("Overdraft fee | $35.00 per item, maximum $150 per day"))).toEqual([
      ["overdraft", 35, "Overdraft fee"],
      ["od_daily_cap", 150, "Overdraft fee daily maximum"],
    ]);
    expect(reads(doc("Monthly maintenance fee | $5.00, waived with $500 balance"))).toEqual([["monthly_maintenance", 5, "Monthly maintenance fee"]]);
    const twoFees = doc("Stop payment $20, Wire transfer $15");
    expect(reads(twoFees).every(([, , name]) => !String(name).includes("("))).toBe(true);
    expect(held(twoFees).some(([shape]) => shape === "tier_incomplete")).toBe(false);
  });

  it("makes up no fee from a rate's minimum (review of #2981)", () => {
    expect(reads(doc("Foreign check collection: up to $1,000 $25.00, over $1,000 0.25% with a $50.00 minimum"))).toEqual([
      ["collection_item", 25, "Foreign check collection: up"],
    ]);
    expect(reads(doc("Coin counting non-customers: under $100 $5.00; $100 or more 5% ($10.00 min)"))).toEqual([
      ["coin_counting", 5, "Coin counting non-customers: under $100"],
    ]);
    expect(reads(doc("Check cashing non-customer: under $100 $5.00; over $100 2% (minimum $10.00)"))).toEqual([
      ["check_cashing", 5, "Check cashing non-customer: under $100"],
    ]);
  });

  it("reads two fees on one line as two fees, not one fee's tiers (review of #2981)", () => {
    const text = doc("Official checks: Cashier's check over $1,000 $10.00; Money order up to $1,000 $5.00");
    expect(reads(text)).toEqual([
      ["cashiers_check", 10, "Official checks: Cashier's check over $1,000"],
      ["money_order", 5, "Money order up"],
    ]);
    expect(held(text)).toEqual([]);
  });

  it("leaves one price under every condition alone (review of #2981)", () => {
    const text = doc("Collection Items (domestic) up to $1,000 | $25.00", "Collection Items (domestic) over $1,000 | $25.00");
    expect(reads(text).map(([hint, amount]) => [hint, amount])).toEqual([["collection_item", 25], ["collection_item", 25]]);
    expect(held(text)).toEqual([]);
  });

  it("lets the guard read a fee word in a tier bracket (review of #2981)", () => {
    expect(checkFeeCategory("wire_domestic_outgoing", "Outgoing wire (international over $1,000)", { amount: 30 }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft fee (continuous over $5)", { amount: 30 }).ok).toBe(false);
    expect(checkFeeCategory("nsf", "NSF fee (paid overdraft items over $5)", { amount: 30 }).ok).toBe(false);
    expect(checkFeeCategory("overdraft", "Overdraft fee per item per presentment (overdraft balance $30.00 or less)", { amount: 15 }).ok).toBe(true);
  });
});
