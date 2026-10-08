import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { extractCandidatesFromText } from "@/lib/agents/knox/rules";
import { newestColumnText } from "./fee-change-columns";

// Jeanne D'Arc CU's change notice (source document 21764), as stored.
const notice = [
  "General Fee Changes:",
  "The fees highlighted below have been adjusted and will be effective on August 1, 2026.",
  "Consumer and Business Account Fees | Fee through | Fee as of",
  "July 31,2026 | August 1, 2026",
  "Money Orders | $2.00 | $5.00",
  "ATM Service Fee (non-JDCU ATMs) - first 8 | $1.50 | $2.00",
  "withdrawals free, 9 or more are assessed a fee",
  "Rush Replacement ATM or Debit Card | $20.00 | $60.00",
  "Same Day ACH Service Charge | $10.00 | $10.00",
  "Account Research | $35.00 per hour | $50.00 per hour",
  "Tax Levy / Attachment | $50.00 | $100.00",
  "Mortgage Subordination | $75.00 | $150.00",
].join("\n");

describe("fee-change columns", () => {
  it("reads a change notice's row at its newest column", () => {
    expect(newestColumnText(notice)).toContain("Same Day ACH Service Charge | $10.00\n");
    expect(newestColumnText(notice)).toContain("Money Orders | $5.00\n");
    expect(newestColumnText(notice)).toContain("Account Research | $50.00 per hour");
  });

  it("leaves a two-price row outside a change table alone", () => {
    const schedule = "Fee Schedule\nWire Transfer In/Out | $10.00 | $35.00";
    expect(newestColumnText(schedule)).toBe(schedule);
  });

  it("fails the old price in the source check and passes the new one", () => {
    expect(checkFeeAgainstSource(notice, "Money Orders", 2, ".", "money_order").ok).toBe(false);
    expect(checkFeeAgainstSource(notice, "Money Orders", 5, ".", "money_order").ok).toBe(true);
    expect(checkFeeAgainstSource(notice, "Tax Levy / Attachment", 50, ".", "garnishment_levy").ok).toBe(false);
    expect(checkFeeAgainstSource(notice, "Tax Levy / Attachment", 100, ".", "garnishment_levy").ok).toBe(true);
  });

  it("has Knox publish the current prices", () => {
    const found = extractCandidatesFromText(notice).candidates.map((fee) => [fee.feeName, fee.amount]);
    expect(found).toContainEqual(["Money Orders", 5]);
    expect(found).toContainEqual(["Rush Replacement ATM or Debit Card", 60]);
    expect(found.some(([name, amount]) => name === "Money Orders" && amount === 2)).toBe(false);
  });
});
