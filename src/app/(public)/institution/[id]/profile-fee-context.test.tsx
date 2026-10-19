import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExtractedFee } from "@/lib/data-store/types";
import { feeScheduleContext } from "./profile-fee-context";
import { toDisplayFees } from "./profile-data";
import { FeeScheduleTable, groupFeesByFamily } from "./fee-schedule-table";

const row = (overrides: Partial<ExtractedFee> = {}): ExtractedFee => ({
  id: 95792, institution_id: 75, institution_name: "Example Bank",
  fee_name: "Monthly service charge (United Checking)", amount: 8, frequency: "monthly",
  fee_category: "monthly_maintenance", conditions: null, review_status: "approved",
  extraction_confidence: 1, validation_flags: [], fee_audience: "consumer",
  source_url: "https://bank.example/fees", source_document_id: 1,
  account_product_type: "United Checking",
  source_line: "$8 monthly service charge (no monthly service charge if enrolled in eStatements or monthly Direct Deposits)",
  waiver_text: "no monthly service charge if enrolled in eStatements or monthly Direct Deposits",
  ...overrides,
});

describe("public fee context from W43 regressions (#2124)", () => {
  it("preserves the entire source-corroborated waiver, including its alternatives, on wide and phone rows", () => {
    const rows = toDisplayFees([row()]);
    expect(rows[0].conditions).toBe(row().waiver_text);
    const html = renderToStaticMarkup(<FeeScheduleTable fees={rows} disclosureUrl={null} />);
    expect(html.split(row().waiver_text as string)).toHaveLength(3);
    expect(rows[0]).toMatchObject({ amount: 8, frequency: "monthly", status: "verified" });
  });

  it("adds the stored account when a generic price name omits it, preserving existing conditions", () => {
    expect(feeScheduleContext(row({ fee_name: "Monthly fee", conditions: "Only for new accounts", source_line: `United Checking: ${row().source_line}` })))
      .toBe(`Account: United Checking · Only for new accounts · ${row().waiver_text}`);
  });

  it("does not add an account or waiver already visible in the existing text", () => {
    expect(feeScheduleContext(row({ conditions: row().waiver_text }))).toBe(row().waiver_text);
  });

  it("never carries a neighbouring returned-mail waiver onto a monthly fee (79658)", () => {
    expect(feeScheduleContext(row({
      fee_name: "Monthly fee", account_product_type: null, amount: 10,
      source_line: "A Gold checking account has a monthly $10 fee if the daily balance falls below $300 any day during the month.",
      waiver_text: "avoid the $5 returned mail fee",
    }))).toBeNull();
  });

  it("keeps uncorroborated, cross-footnote and cut waivers in the repair queue", () => {
    expect(feeScheduleContext(row({ source_line: null }))).toBeNull();
    expect(feeScheduleContext(row({ source_line: "$8 monthly service charge (with many options to avoid fees)" }))).toBeNull();
    expect(feeScheduleContext(row({ source_line: "$8 monthly service charge (no monthly service charge if enrolled in eStatements or monthly" }))).toBeNull();
  });

  it("does not expose pipeline notes in customer fields", () => {
    const note = 'Knox deterministic extraction from Rosetta artifact #12. canonical_hint=monthly_maintenance; text_hash=abc; calibrated_confidence=1; excerpt="waived with direct deposit"';
    expect(feeScheduleContext(row({ conditions: note, waiver_text: note, account_product_type: note }))).toBeNull();
  });

  it("never displays account labels that the price line does not corroborate", () => {
    expect(feeScheduleContext(row({ fee_name: "Service charge", account_product_type: "Now Account", waiver_text: null }))).toBeNull();
    expect(feeScheduleContext(row({ fee_name: "Service charge", source_line: "United Checking $12", waiver_text: null }))).toBeNull();
    expect(feeScheduleContext(row({ fee_name: "Service charge", source_line: null, waiver_text: null }))).toBeNull();
  });

  it("never treats numeric tier boundaries as no-fee thresholds (41467)", () => {
    const fees = toDisplayFees([row({
      fee_name: "Service charge fee", account_product_type: "Charter Checking Account", amount: 7,
      min_balance_to_avoid: 300, waiver_text: null,
      source_line: "If your balance is at least $300 but falls below $500 we impose a $7 fee",
    })]);
    expect(fees[0].conditions).toBeNull();
  });

  it("preserves same-priced account, condition, category and charging-basis variants", () => {
    const base = row({ fee_name: "Monthly service fee", waiver_text: null });
    const fees = toDisplayFees([
      base, { ...base, id: 2, account_product_type: "Premier Checking", source_line: "Premier Checking: monthly service fee $8" },
      { ...base, id: 3, conditions: "Waived for students" },
      { ...base, id: 4, frequency: "quarterly" },
      { ...base, id: 5, fee_category: "minimum_balance" },
    ]);
    expect(groupFeesByFamily(fees).flatMap((g) => g.rows)).toHaveLength(5);
    expect(groupFeesByFamily([fees[0], { ...fees[0], id: "copy" }]).flatMap((g) => g.rows)).toHaveLength(1);
  });
});
