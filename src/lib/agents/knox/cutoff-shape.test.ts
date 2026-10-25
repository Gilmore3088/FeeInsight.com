import { describe, expect, it } from "vitest";
import { isCutoffName, withoutClosedQualifiers } from "./cutoff-shape";
import { publishNameHold } from "@/lib/agents/hamilton/publish";

// #1443: names hand-read on prod (the issue's examples, and `cutoff_name` holds read on Oct 25).
describe("isCutoffName reads a closed parenthetical after the name as a qualifier (#1443)", () => {
  const REAL_NAMES = [
    "ACH Return Item (fee is per item)",
    "Notary fee (this service is for members only)",
    "Overdraft fee (each time we pay an overdraft)",
    "Dormant Account Fee (minors are exempt)",
    "Early Closing Fee (Charged if an account is closed within the first 6 months)",
    "Stop Payment (includes ACH, Bill Pay)",
    "Other ATM Terminals Per Transaction Charge (a fee may be imposed by the owner of the other terminal or network)",
    "ATM Withdrawal Fees, out of Network (Surcharge Fees, fees accessed by other ATM proprietors, may still apply.) ²",
    "NSF Charge (per presentment, checks and ACH) (Overdrafts paid or returned, applies to all checking and savings accounts)",
  ];
  it.each(REAL_NAMES)("a real fee name is not cut off: %s", (name) => {
    expect(isCutoffName(name)).toBe(false);
  });

  const FRAGMENTS = [
    // The issue's fragments.
    "If the account is closed within 90 days of opening, a",
    "Perks Checking (monthly service charge if",
    // A parenthetical with the line running on past it may be the sentence itself.
    "Dormant Account / Inactive Account Fee (each month the account is inactive) After 12 months with no activity; excludes f",
    "transaction fee for withdrawals at foreign ATMs (other banks may charge a fee). Any ATM not in the Beneficial State Bank",
    "Notary Service - up to 5 items per month (we cannot notarize mortgage documents) - call the office to set up an appointm",
    // Another column's cell glued in front stays a cut-off sign.
    "(Per month some exclusions apply): Cashier's Check (Per item)",
    // A sentence outside the parenthetical is still a sentence.
    "Checking accounts are considered dormant (after 12 months)",
    "You will be charged (per item)",
    "Stop Payment Fee (per item) if",
  ];
  it.each(FRAGMENTS)("a fragment is still cut off: %s", (name) => {
    expect(isCutoffName(name)).toBe(true);
  });

  it("takes off only the closed parentheticals that end the name", () => {
    expect(withoutClosedQualifiers("NSF Charge (per presentment) (applies to all accounts) ²")).toBe("NSF Charge");
    expect(withoutClosedQualifiers("Research (includes reconciliation) - min. 1 hour")).toBe("Research (includes reconciliation) - min. 1 hour");
    expect(withoutClosedQualifiers("(balance falls below $1,000)")).toBe("(balance falls below $1,000)");
    expect(withoutClosedQualifiers("Perks Checking (monthly service charge if")).toBe("Perks Checking (monthly service charge if");
  });

  it("publish no longer holds the issue's real names as cutoff_name", () => {
    expect(publishNameHold("ACH Return Item (fee is per item)", "ach_return", 25)).toBeNull();
    expect(publishNameHold("Notary fee (this service is for members only)", "notary", 5)).toBeNull();
    expect(publishNameHold("If the account is closed within 90 days of opening, a", "early_closure", 25)?.code).toBe("cutoff_name");
    expect(publishNameHold("Perks Checking (monthly service charge if", "monthly_maintenance", 5)?.code).toBe("cutoff_name");
  });
});

// #1521: names read on prod on 2026-10-25 (live 75914 and 74142, verified 23259).
describe("isCutoffName reads a name cut before its noun after a count and an audience word (#1521)", () => {
  it.each([
    "Counter Check: A blank page of 3 personal",
    "Overdraft - Non-consumer - Continuous Overdraft Charge. Daily fee after 5 business",
    "Priority Rush Card Fee (up to 3 business",
  ])("holds %s as cut off", (name) => {
    expect(isCutoffName(name)).toBe(true);
  });

  it("publish holds the live name as cutoff_name", () => {
    expect(publishNameHold("Counter Check: A blank page of 3 personal", "counter_check", 3)?.code).toBe("cutoff_name");
  });

  it.each(["Monthly Service Fee - Business", "Small Business", "Overdraft (Personal)", "Tier 2 Business", "Wire Transfer Commercial", "Plan A Commercial"])(
    "keeps a name whose audience word is its own label: %s",
    (name) => {
      expect(isCutoffName(name)).toBe(false);
    },
  );
});
