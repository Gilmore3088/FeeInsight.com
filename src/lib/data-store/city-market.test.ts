import { describe, expect, it } from "vitest";
import { cityFeeValue } from "./city-market";

describe("city market fee value", () => {
  it("keeps the schedule's own line, drops the pipeline note and says when no account is named", () => {
    const value = cityFeeValue({
      fee_category: "overdraft",
      amount: "36.00",
      fee_name: "Truist will charge you an Overdraft Fee, if applicable, of",
      conditions: null,
      account_product_type: null,
      waiver_text: null,
      extraction_note:
        'Knox deterministic extraction from Rosetta artifact #6250. canonical_hint=overdraft; text_hash=abc; excerpt="• Truist will charge you an Overdraft Fee, if applicable, of $36 each time we pay an overdraft on your behalf."',
      source_url: "https://example.com/schedule.pdf",
      read_on: "2026-10-01",
    });
    expect(value.amount).toBe(36);
    expect(value.account).toBeNull();
    expect(value.source_line).toContain("of $36 each time we pay an overdraft");
    expect(value.source_line).not.toMatch(/text_hash|artifact #/);
    expect(value.conditions.join(" ")).not.toMatch(/Knox|text_hash/);
  });

  it("names the account when the catalog stores one", () => {
    const value = cityFeeValue({ fee_category: "monthly_maintenance", amount: 12, fee_name: "Monthly Maintenance", account_product_type: "Premier Checking" });
    expect(value.account).toBe("Premier Checking");
    expect(value.source_line).toBeNull();
  });
});
