import { describe, expect, it } from "vitest";
import type { MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { amountBasis, buildAmountEvidence, educationalPage, evidenceProblem, quoteStatesFigure } from "./evidence";

const READ = "2026-10-15";

/** Wells Fargo's monthly fee as the sample report read it on 17 Oct 2026 (rows 119366, 68710, 68708). */
const wells: MarketFeeLine = {
  institution_id: 4,
  line: "monthly_maintenance",
  id: 119366,
  amount: 15,
  fee_name: "Monthly service fee",
  source_url: "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/",
  updated_at: null,
  schedule_read_on: READ,
  source_line: "Monthly service fee | $5",
  tiers: [
    { id: 119366, amount: 5, fee_name: "Monthly service fee", source_line: "Monthly service fee | $5", source_url: "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/", schedule_read_on: READ },
    { id: 68708, amount: 25, fee_name: "Prime Checking Monthly service fee", source_line: "How to avoid the $25 monthly service fee", source_url: "https://www.wellsfargo.com/checking/prime/", schedule_read_on: READ },
    { id: 68710, amount: 15, fee_name: "Everyday Checking Monthly service fee", source_line: "Avoid the $15 monthly service fee", source_url: "https://www.wellsfargo.com/checking/everyday/", schedule_read_on: READ },
  ],
};

describe("buildAmountEvidence", () => {
  it("states the basis of a calculated amount and lists every record behind it", () => {
    const evidence = buildAmountEvidence(wells);
    expect(evidence.amount).toBe(15);
    expect(evidence.basis).toBe("middle of 3 published prices");
    expect(evidence.records.map((r) => [r.record_id, r.amount, r.source_url])).toEqual([
      [119366, 5, "https://www.wellsfargo.com/checking/clear-access-banking/account-fees-summary/"],
      [68710, 15, "https://www.wellsfargo.com/checking/everyday/"],
      [68708, 25, "https://www.wellsfargo.com/checking/prime/"],
    ]);
    expect(evidence.excluded).toEqual([]);
  });

  it("calls a single record a published price", () => {
    const one = { ...wells, tiers: undefined, amount: 5 };
    expect(buildAmountEvidence(one)).toMatchObject({ amount: 5, basis: "published price" });
  });

  it("excludes an article's general statement (TD's overdraft, row 64718)", () => {
    const td: MarketFeeLine = {
      institution_id: 12,
      line: "overdraft",
      id: 64718,
      amount: 35,
      fee_name: "The amount for overdraft fees varies, but",
      source_url: "https://www.td.com/us/en/personal-banking/learning/money-management/types-of-checking-accounts",
      updated_at: null,
      schedule_read_on: READ,
      source_line: "The amount for overdraft fees varies, but $35 each occurrence is common.",
    };
    const evidence = buildAmountEvidence(td);
    expect(evidence.amount).toBeNull();
    expect(evidence.excluded[0]).toMatchObject({ record_id: 64718, problem: "not_a_fee_schedule" });
  });

  it("rebuilds the amount from the records that remain", () => {
    const tiers = [...wells.tiers!];
    tiers[1] = { ...tiers[1], source_line: "Prime Checking Monthly service fee | $15" };
    const evidence = buildAmountEvidence({ ...wells, tiers });
    expect(evidence.excluded.map((r) => r.record_id)).toEqual([68708]);
    expect(evidence).toMatchObject({ amount: 10, basis: "middle of 2 published prices" });
  });
});

describe("evidence rules", () => {
  it("reads overdraft at the highest of its prices", () => {
    expect(amountBasis("overdraft", [25, 30])).toBe("highest of 2 prices");
    expect(amountBasis("overdraft", [35, 35])).toBe("published price");
  });

  it("keeps a credit union's fee schedule filed under /learn/", () => {
    expect(educationalPage("https://beaconfed.org/learn/fee-schedule")).toBe(false);
    expect(educationalPage("https://www.truenorthfcu.org/learn/true-north-account-info/fees.html")).toBe(false);
    expect(educationalPage("https://www.schoolsfirstfcu.org/advice/financial-wellness/saving/dont-get-stung-by-banking-fees/")).toBe(true);
    expect(educationalPage("https://www.axosbank.com/personal/insights/finance/understanding-overdraft-fees")).toBe(true);
  });

  it("finds the figure in a quote that prices several accounts in one row", () => {
    const quote = "Monthly Service Charge | $8.00 fee can be avoided by maintaining a $1,500.00 average daily collected balance | $10.00 fee";
    expect(quoteStatesFigure(quote, 10)).toBe(true);
    expect(quoteStatesFigure(quote, 12)).toBe(false);
    expect(evidenceProblem("monthly_maintenance", { product: "Monthly Maintenance Fee", amount: 10, quote, source_url: null })).toBeNull();
    expect(evidenceProblem("monthly_maintenance", { product: "Monthly Maintenance Fee", amount: 12, quote, source_url: null })).toBe("quote_without_amount");
  });
});
