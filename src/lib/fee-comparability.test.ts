import { describe, expect, it } from "vitest";
import {
  CARD_INACTIVITY_REASON,
  CATEGORY_BASIS,
  COMPARABILITY_SCREEN,
  CONTRADICTING_FREQUENCIES,
  SAFE_DEPOSIT_SERVICE_REASON,
  SAFE_DEPOSIT_SERVICE_SQL,
  basisMismatchReason,
  basisMismatchSql,
  categoryBasis,
  contradictingFrequencies,
  notComparableReason,
} from "./fee-comparability";
import { FEE_FAMILIES } from "./fee-taxonomy";

describe("notComparableReason: card inactivity under an account-dormancy category", () => {
  it("keeps a card's inactivity fee out of the dormant-account median, by name", () => {
    expect(notComparableReason("dormant_account", "Inactive Debit Card Fee (No use in 6 months or more)", null)).toBe(CARD_INACTIVITY_REASON);
    expect(notComparableReason("dormant_account", "Card Inactivity Fee", null)).toBe(CARD_INACTIVITY_REASON);
  });

  it("reads the schedule line when the name alone is generic (Navy Federal's prepaid-card Inactivity Fee)", () => {
    const line =
      "Inactivity Fee (After 12 consecutive months of no activity, the card will be charged $5.00 per month until the balance is depleted or you make a purchase.";
    expect(notComparableReason("dormant_account", "Inactivity Fee", null, line)).toBe(CARD_INACTIVITY_REASON);
    expect(notComparableReason("dormant_account", "Inactivity Fee", null)).toBeNull();
  });

  it("keeps a real dormant account fee compared, even when the next schedule row is about gift cards", () => {
    expect(
      notComparableReason(
        "dormant_account",
        "Dormant Checking fee",
        null,
        "Dormant Checking fee: Assessed to the checking account if the member has a combined savings and checking balance with less than $50, no activity in 12 months",
      ),
    ).toBeNull();
    expect(notComparableReason("dormant_account", "Dormant Account Fee", null, "Dormant Account Fee | $5.00 per month2 | Gift Card Fees:")).toBeNull();
  });

  it("leaves other categories to the CD/IRA rule only", () => {
    expect(notComparableReason("card_replacement", "Replacement debit card", null, "the card will be charged $5")).toBeNull();
    expect(notComparableReason("early_closure", "Early closure of CD", null)).toBe("CD/IRA fee");
  });
});

describe("notComparableReason: safe deposit service charges under the box's rent", () => {
  it("keeps drilling, key and late fees out of the safe deposit box median", () => {
    for (const name of ["Box Drilling Fee (both keys lost)", "Key Deposit Fee", "Lost Key Replacement", "Late Payment Fee", "Forced Entry"]) {
      expect(notComparableReason("safe_deposit_box", name, null), name).toBe(SAFE_DEPOSIT_SERVICE_REASON);
    }
  });

  it("compares the box's rent, and a key fee in any other category", () => {
    expect(notComparableReason("safe_deposit_box", "Safe Deposit Box 3x5", null)).toBeNull();
    expect(notComparableReason("safe_deposit_box", "Safe Deposit Box Rental, 5 x 10, annual", null)).toBeNull();
    expect(notComparableReason("night_deposit", "Night Depository Key, per additional key", null)).toBeNull();
  });

  it("compares a lock box's rent, and still leaves out a lockout or a lost key (#1816)", () => {
    for (const name of ["Lock Box Rental 5x5", "Lock Box Annual Fee 3 x 5", "Lockbox 10x10"]) {
      expect(notComparableReason("safe_deposit_box", name, null), name).toBeNull();
    }
    for (const name of ["Lock Change", "Locked out of box", "Lock Box Drilling", "Lock Box Lost Key"]) {
      expect(notComparableReason("safe_deposit_box", name, null), name).toBe(SAFE_DEPOSIT_SERVICE_REASON);
    }
  });

  it("the statistics filter's Postgres pattern reads the same names the same way", () => {
    // Postgres \m and \M are word starts and ends; JavaScript's \b stands in for both here.
    const asJs = new RegExp(SAFE_DEPOSIT_SERVICE_SQL.replace(/\\[mM]/g, "\\b"), "i");
    const names = ["Box Drilling Fee (both keys lost)", "Key Deposit Fee", "Late Payment Fee", "Past due rent", "Forced Entry",
      "Lock Change", "Lock Box Rental 5x5", "Lock Box Annual Fee 3 x 5", "Safe Deposit Box 3x5", "Blockade", "Chocolate"];
    for (const name of names) {
      expect(asJs.test(name), name).toBe(notComparableReason("safe_deposit_box", name, null) !== null);
    }
  });

  it("every word a rule tests passes the screen the market read uses", () => {
    const screen = new RegExp(COMPARABILITY_SCREEN, "i");
    for (const text of ["CD", "IRAs", "share certificate", "Individual Retirement", "time deposit", "the card will be charged", "card balance", "drilling", "keys", "locked", "late", "past due", "forced"]) {
      expect(screen.test(text), text).toBe(true);
    }
  });
});

describe("charging basis (#1901)", () => {
  it("leaves out Navy Federal's $3 a quarter dormant fee and keeps monthly, per-item and blank ones", () => {
    expect(notComparableReason("dormant_account", "Dormant Checking fee", null, null, "quarterly")).toBe("Quarterly charge, not monthly");
    expect(notComparableReason("dormant_account", "Dormant Checking fee", null, null, "monthly")).toBeNull();
    expect(notComparableReason("dormant_account", "Dormant Checking fee", null, null, "per_item")).toBeNull();
    expect(notComparableReason("dormant_account", "Dormant Checking fee", null, null, null)).toBeNull();
    expect(notComparableReason("dormant_account", "Dormant Checking fee", null, null)).toBeNull();
  });

  it("reads safe deposit and IRA fees as annual prices", () => {
    expect(basisMismatchReason("safe_deposit_box", "monthly")).toBe("Monthly charge, not annual");
    expect(basisMismatchReason("safe_deposit_box", "annual")).toBeNull();
    expect(basisMismatchReason("ira_administration", "one_time")).toBe("One-time charge, not annual");
    expect(basisMismatchReason("ira_administration", " Quarterly ")).toBe("Quarterly charge, not annual");
  });

  it("gives every category one basis: a period category's or per event", () => {
    const taxonomy = Object.values(FEE_FAMILIES).flat();
    for (const category of Object.keys(CATEGORY_BASIS)) expect(taxonomy, category).toContain(category);
    expect(categoryBasis("overdraft")).toBe("per_event");
    expect(categoryBasis("a_new_category")).toBe("per_event");
    expect(categoryBasis("paper_statement")).toBe("monthly");
    expect(categoryBasis("continuous_od")).toBe("daily");
  });

  it("leaves a stated period out of a per-event category's median", () => {
    expect(basisMismatchReason("overdraft", "daily")).toBe("Daily charge, not per item");
    expect(basisMismatchReason("od_protection_transfer", "daily")).toBe("Daily charge, not per item");
    expect(basisMismatchReason("document_reproduction", "monthly")).toBe("Monthly charge, not per item");
    expect(basisMismatchReason("cashiers_check", "annual")).toBe("Annual charge, not per item");
    for (const frequency of ["per_item", "per_occurrence", "per_transaction", "one_time", "other", null]) {
      expect(basisMismatchReason("early_closure", frequency), String(frequency)).toBeNull();
    }
    // Hourly and other literal units are the special-unit rule's (fee-unit.ts), with its own reason.
    expect(basisMismatchReason("account_research", "hourly")).toBeNull();
    expect(basisMismatchReason(null, "quarterly")).toBeNull();
  });

  it("reads paper statements as monthly, keeping a per-item reading of \"$5 each\"", () => {
    expect(basisMismatchReason("paper_statement", "quarterly")).toBe("Quarterly charge, not monthly");
    expect(basisMismatchReason("paper_statement", "per_item")).toBeNull();
    expect(basisMismatchReason("safe_deposit_box", "per_item")).toBeNull();
  });

  it("splits returned mail and bill pay by basis: a per-event price leaves their monthly median", () => {
    expect(basisMismatchReason("returned_mail", "per_item")).toBe("Per-item charge, not monthly");
    expect(basisMismatchReason("bill_pay", "per_transaction")).toBe("Per-transaction charge, not monthly");
    expect(basisMismatchReason("bill_pay", "one_time")).toBe("One-time charge, not monthly");
    expect(basisMismatchReason("returned_mail", "monthly")).toBeNull();
    expect(basisMismatchReason("returned_mail", null)).toBeNull();
  });

  it("reads continuous overdraft as a daily price, so a one-time sustained overdraft fee leaves it", () => {
    expect(basisMismatchReason("continuous_od", "one_time")).toBe("One-time charge, not daily");
    expect(basisMismatchReason("continuous_od", "daily")).toBeNull();
  });

  it("never lists a category's own basis as a contradiction", () => {
    for (const [category, basis] of Object.entries(CATEGORY_BASIS)) {
      expect(CONTRADICTING_FREQUENCIES[basis], category).not.toContain(basis);
      expect(basisMismatchReason(category, basis), category).toBeNull();
    }
  });

  it("SQL and client rules agree on every category and frequency", () => {
    // Evaluate basisMismatchSql's arms by reading them back: each is a category list (IN or NOT IN)
    // and a frequency list. The SQL must flag exactly the rows basisMismatchReason flags.
    const sql = basisMismatchSql("c");
    const arms = [...sql.matchAll(/\(c\.fee_category (NOT )?IN \(([^)]*)\) AND lower\(btrim\(c\.frequency, [^)]*\)\) IN \(([^)]*)\)\)/g)].map((m) => ({
      negated: Boolean(m[1]),
      categories: m[2].split(", ").map((v) => v.replace(/'/g, "")),
      frequencies: m[3].split(", ").map((v) => v.replace(/'/g, "")),
    }));
    expect(arms.length).toBeGreaterThan(1);
    const flagged = (category: string, frequency: string) =>
      arms.some((arm) => arm.categories.includes(category) !== arm.negated && arm.frequencies.includes(frequency));
    const frequencies = ["monthly", "quarterly", "annual", "daily", "hourly", "one_time", "per_item", "per_occurrence", "per_transaction", "other"];
    for (const category of [...Object.values(FEE_FAMILIES).flat(), "a_new_category"]) {
      for (const frequency of frequencies) {
        expect(flagged(category, frequency), `${category} ${frequency}`).toBe(basisMismatchReason(category, frequency) !== null);
        expect(contradictingFrequencies(category).includes(frequency)).toBe(basisMismatchReason(category, frequency) !== null);
      }
    }
    expect(sql.startsWith("COALESCE(")).toBe(true);
    expect(sql.endsWith(", false)")).toBe(true);
  });
});
