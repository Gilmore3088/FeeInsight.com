import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ getSql: vi.fn(), sql: vi.fn() }));

import {
  compareAccountLineups,
  lineupAccountFromRow,
  minBalanceFromExcerpt,
  productNameFromFeeName,
  waiverFromExcerpt,
  type LineupCatalogRow,
} from "./account-lineup";

const row = (overrides: Partial<LineupCatalogRow>): LineupCatalogRow => ({
  institution_id: 1,
  fee_name: "Monthly maintenance fee",
  amount: "10.00",
  conditions: null,
  account_product_type: null,
  min_balance_to_avoid: null,
  min_opening_deposit: null,
  waiver_text: null,
  ...overrides,
});

describe("productNameFromFeeName", () => {
  it("keeps the account name in front of the fee words", () => {
    expect(productNameFromFeeName("Essential Checking Account maintenance fee")).toBe("Essential Checking");
    expect(productNameFromFeeName("Freedom Start-Up Monthly Fee")).toBeNull();
  });

  it("gives nothing for generic names and sentence fragments", () => {
    expect(productNameFromFeeName("Monthly maintenance fee")).toBeNull();
    expect(productNameFromFeeName("Monthly Service Charge")).toBeNull();
    expect(productNameFromFeeName("in your account to avoid a service charge fee")).toBeNull();
    expect(productNameFromFeeName("Service charge if min. balance requirements are not met.5")).toBeNull();
  });
});

describe("minBalanceFromExcerpt", () => {
  it("reads the balance that avoids the fee", () => {
    expect(minBalanceFromExcerpt("Performance Plus Service Charge | $10.00 per month if average daily balance is below $1,000")).toBe(1000);
    expect(
      minBalanceFromExcerpt("You must maintain a minimum daily balance of $20,000 in your account to avoid a service charge fee."),
    ).toBe(20000);
  });

  it("does not take the price for the balance", () => {
    expect(minBalanceFromExcerpt("Monthly Fee / $10")).toBeNull();
  });
});

describe("waiverFromExcerpt", () => {
  it("keeps the waiver words from the row's own cell", () => {
    expect(waiverFromExcerpt("There is a $7.00 monthly maintenance fee which is waived if a Direct Deposit is made")).toBe(
      "waived if a Direct Deposit is made",
    );
    expect(waiverFromExcerpt("Monthly Fee | $2.50 (none with eStatements or age 65+ | $8.00 (if below minimum)")).toBe(
      "none with eStatements or age 65+",
    );
    expect(waiverFromExcerpt("Monthly Service | FREE")).toBeNull();
  });
});

describe("lineupAccountFromRow", () => {
  it("prefers stored lineup fields and marks derived ones", () => {
    const stored = lineupAccountFromRow(
      row({ account_product_type: "Opportunity Checking", min_balance_to_avoid: "500", waiver_text: "with e-statements" }),
    );
    expect(stored).toMatchObject({
      productName: "Opportunity Checking",
      productNameSource: "stored",
      minBalanceToAvoid: 500,
      minBalanceSource: "stored",
      waiverSource: "stored",
    });

    const derived = lineupAccountFromRow(
      row({
        fee_name: "Performance Plus Checking Service Charge",
        conditions:
          'Knox deterministic extraction. excerpt="Performance Plus Checking Service Charge | $10.00 per month if average daily balance is below $1,000"',
      }),
    );
    expect(derived).toMatchObject({
      productName: "Performance Plus Checking",
      productNameSource: "derived",
      minBalanceToAvoid: 1000,
      minBalanceSource: "derived",
    });
  });

  it("skips rows with no amount", () => {
    expect(lineupAccountFromRow(row({ amount: null }))).toBeNull();
  });
});

describe("compareAccountLineups", () => {
  it("sets one bank's accounts against its peers", () => {
    const accounts = [
      row({ institution_id: 1, amount: "0" }),
      row({ institution_id: 1, amount: "12", min_balance_to_avoid: "1500" }),
      row({ institution_id: 2, amount: "5" }),
      row({ institution_id: 3, amount: "10", waiver_text: "waived with direct deposit" }),
      row({ institution_id: 3, amount: "0" }),
    ].map((item) => lineupAccountFromRow(item)!);

    const comparison = compareAccountLineups(1, accounts);
    expect(comparison.subject).toMatchObject({
      institutions: 1,
      accounts: 2,
      lowestMonthlyFee: 0,
      medianMonthlyFee: 6,
      shareWithFreeAccount: 1,
      medianMinBalanceToAvoid: 1500,
      shareWithWayToAvoid: 1,
    });
    expect(comparison.peers).toMatchObject({
      institutions: 2,
      accounts: 3,
      lowestMonthlyFee: 0,
      medianMonthlyFee: 5,
      shareWithFreeAccount: 0.5,
      medianMinBalanceToAvoid: null,
      shareWithWayToAvoid: 0.5,
    });
  });
});
