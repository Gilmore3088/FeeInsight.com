import { describe, expect, it } from "vitest";
import { classifyFeeText } from "@/lib/agents/knox/rules";
import { runFreeSpecialists, KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { restoreTarget } from "@/lib/agents/hamilton/category-guard";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { wireNotificationName } from "@/lib/wire-notification";
import { accountReactivationName } from "@/lib/account-reactivation";
import { serviceMonthlyTarget } from "@/lib/service-monthly-charge";

// Knox v166 / guard v106: the wrong reads the Nov 2 re-read backlog dry run found (42 sampled texts),
// each with the stored lines it was read from.
const INTERCREDIT = [
  "‐Legal Document Processing (per hour plus Attorney’s fee)... $100.00 | ‐Incoming Wire Transfer – Returns (unable to apply) ……………….. $45.00",
  "‐Hold Mail – monthly fee (refer to agreement)...................... No Fee | ‐Outgoing Wire Transfer – Domestic ...................................... $50.00",
  "‐Notary Services (per document) – customers only | $15.00 | ‐Outgoing WT Returned for Customer Error........................... $15.00",
  "‐Overdraft fee – per item paid (1)(2)(8)….…………………………… $25.00 | ‐Incoming Wire Transfer Email Notification…………………………. No Fee",
  "‐Photocopies – per copy ......................................................... $2.00 | ‐Outgoing Wire Transfer Email Notification…………………………. No Fee",
].join("\n");
const BAC = [
  "Online Bill Pay Monthly Service Fee ............................................................ No Fee",
  "Mobile Banking Monthly Service Charge ........................................................ No Fee",
  "Mobile Deposit Monthly Service Charge ........................................................ No Fee",
].join("\n");
const MIDWEST_HERITAGE = "Account Reactivation (check or savings closed for less than 3 months) ..................................................... $10.00/occurrence";

const reads = (text: string) => runFreeSpecialists(text).candidates.map((c) => `${c.canonicalHint} ${c.feeName} ${c.amount}`);

describe("re-read backlog misfiles (Knox v166, guard v106)", () => {
  it("bumps both versions", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(166);
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(106);
  });

  it("holds a wire's notice instead of filing it as the wire at $0", () => {
    expect(classifyFeeText("Incoming Wire Transfer Email Notification")).toBeNull();
    expect(classifyFeeText("Outgoing Wire Transfer Email Notification")).toBeNull();
    const read = reads(INTERCREDIT);
    expect(read.some((r) => /Notification/.test(r))).toBe(false);
    expect(read).toContain("wire_domestic_outgoing ‐Outgoing Wire Transfer – Domestic 50");
  });

  it("keeps a wire priced with its notice", () => {
    expect(wireNotificationName("Incoming Wire with Phone Notification")).toBe(false);
    expect(checkFeeCategory("wire_domestic_incoming", "Incoming Wire with Phone Notification").ok).toBe(true);
    expect(checkFeeCategory("wire_domestic_incoming", "Wire Transfer Fee (Incoming)").ok).toBe(true);
  });

  it("keeps a wire that names its notice only as a qualifier (review of #2957)", () => {
    for (const name of ["Incoming Wire (no notification)", "Incoming Wire without notification", "Incoming wire fee, notification included",
      "Outgoing Wire w/ notification", "Outgoing Wire w/notification", "Incoming wire and notification", "Incoming Wire Transfer (notification by phone)"]) {
      expect(wireNotificationName(name), name).toBe(false);
    }
    for (const name of ["Incoming Wire Notification", "Wire Notification – Incoming/ Outgoing (Fax/Email)", "Incoming Wire Transfer Email Notification"]) {
      expect(wireNotificationName(name), name).toBe(true);
    }
  });

  it("refuses a notice under every wire type, with no re-file (the four live notices)", () => {
    for (const name of ["Incoming Wire Notification", "Incoming Wire Notification or Special Handling", "Wire Notification – Incoming", "Electronic Wire Notification Incoming"]) {
      expect(checkFeeCategory("wire_domestic_incoming", name).ok).toBe(false);
      // No re-file: refileCategory hands back the fee's own key when no rule moves it.
      expect(refileCategory("wire_domestic_incoming", name)).toBe("wire_domestic_incoming");
      expect(restoreTarget({ canonical_fee_key: "wire_domestic_incoming", fee_name: name } as never)).toBeNull();
    }
    for (const key of ["wire_domestic_outgoing", "wire_intl_outgoing", "wire_intl_incoming"]) {
      expect(checkFeeCategory(key, "Outgoing Wire Transfer Email Notification").ok).toBe(false);
    }
  });

  it("does not file mobile banking's or hold mail's own monthly charge as monthly maintenance", () => {
    expect(serviceMonthlyTarget("Mobile Banking Monthly Service Charge")).toBeNull();
    expect(serviceMonthlyTarget("‐Hold Mail – monthly fee (refer to agreement)")).toBeNull();
    expect(classifyFeeText("Mobile Banking Monthly Service Charge")).toBeNull();
    expect(classifyFeeText("‐Hold Mail – monthly fee (refer to agreement)")).toBeNull();
    expect(reads(BAC).some((r) => r.startsWith("monthly_maintenance"))).toBe(false);
    expect(reads(INTERCREDIT).some((r) => r.startsWith("monthly_maintenance"))).toBe(false);
    expect(checkFeeCategory("monthly_maintenance", "Mobile Banking Monthly Service Charge").ok).toBe(false);
    expect(checkFeeCategory("monthly_maintenance", "Hold Mail – monthly fee").ok).toBe(false);
    // An account named with the service, or the service as a waiver, stays the account's fee.
    expect(serviceMonthlyTarget("Checking with Mobile Banking monthly fee")).toBeUndefined();
    expect(serviceMonthlyTarget("Monthly Service Charge - waived with mobile banking and direct deposit")).toBeUndefined();
  });

  it("files reactivating an account as the dormant account fee", () => {
    expect(classifyFeeText("Account Reactivation (check or savings closed for less than 3 months)")).toBe("dormant_account");
    expect(reads(MIDWEST_HERITAGE)).toContain("dormant_account Account Reactivation (check or savings closed for less than 3 months) 10");
    expect(checkFeeCategory("early_closure", "Reactivate Closed Account Fee").ok).toBe(false);
    expect(refileCategory("early_closure", "Reactivate Closed Account Fee")).toBe("dormant_account");
    expect(restoreTarget({ canonical_fee_key: "early_closure", fee_name: "Reactivate Closed Account Fee" } as never)).toBe("dormant_account");
  });

  it("keeps one price for a reactivation or a closure, a card's reactivation and a plain early closure", () => {
    for (const name of ["Reactivate/Close Draft Account (within 1 year)", "Reactivation Fee/Close Account (within 1 year)"]) {
      expect(accountReactivationName(name)).toBe(false);
      expect(checkFeeCategory("early_closure", name).ok).toBe(true);
    }
    for (const name of ["Reactivation and Closure fee", "Reactivation Fee - Close Account"]) {
      expect(accountReactivationName(name), name).toBe(false);
    }
    expect(accountReactivationName("Debit Card Reactivation")).toBe(false);
    for (const name of ["Closed Account Reactivation Fee"]) {
      expect(accountReactivationName(name), name).toBe(true);
      expect(refileCategory("early_closure", name), name).toBe("dormant_account");
    }
    expect(checkFeeCategory("early_closure", "Account closed within 90 days of opening").ok).toBe(true);
    expect(classifyFeeText("Account closed within 90 days of opening")).toBe("early_closure");
  });
});
