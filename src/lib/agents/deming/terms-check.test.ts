// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { NO_TERMS, sourceLineTerms } from "@/lib/custom-report/source-line-terms";
import { traceLiveFee } from "@/lib/agents/hamilton/source-check";
import { TERMS_CHECK, lostTerm } from "./terms-check";
import { severityFor } from "./severity";
import { scoreFreshAudit, type FreshAuditFee } from "./fresh-audit";

const fee = (fee_name: string, extra: Partial<{ canonical_fee_key: string; frequency: string | null }> = {}) => ({ fee_name, canonical_fee_key: "account_research", ...extra });
const lost = (line: string, amount: number, name: string, extra: Partial<{ canonical_fee_key: string; frequency: string | null }> = {}) =>
  lostTerm(fee(name, extra), sourceLineTerms(line, amount));

describe("sourceLineTerms: what the line prints beside the fee's own price", () => {
  it("should_read_the_unit_after_the_price", () => {
    expect(sourceLineTerms("Account Research | $25 per hour", 25).unit).toBe("hourly");
    expect(sourceLineTerms("Research fee (1/2-hour minimum charge) | $50.00 per 1/2 hour", 50).unit).toBe("per_half_hour");
    expect(sourceLineTerms("Faxed Transmissions $1/page", 1).unit).toBe("per_page");
    expect(sourceLineTerms("Check Cashing (Non-customer) $5/ $100", 5).unit).toBe("per_amount");
    expect(sourceLineTerms("Temporary Checks | $2.00 For 4 Checks", 2).unit).toBe("per_bundle");
  });

  it("should_not_borrow_a_neighbours_unit", () => {
    // The $0.25/page belongs to Photocopies, not the cashier's check before it.
    const terms = sourceLineTerms("Cashier's checks (customers only) ........ $8.00 Photocopies ........ $0.25/page", 8);
    expect(terms.unit).toBeNull();
  });

  it("should_read_conditions_tiers_and_audience", () => {
    expect(sourceLineTerms("Statement Reprints: $2.00 plus tax", 2).conditions).toEqual(["plus_extra"]);
    expect(sourceLineTerms("$7.00 monthly maintenance fee if average balance falls below $1,000.00", 7).conditions).toContain("balance_condition");
    expect(sourceLineTerms("Money Market- Excessive Withdrawal | $7.50 Per Withdrawal After 6 Per Month", 7.5).conditions).toContain("allowance");
    expect(sourceLineTerms("Drilling of Box | $155.00 (or actual cost whichever is higher)", 155).conditions).toContain("greater_of");
    expect(sourceLineTerms("Debit Card Replacement | - $5 for first occurrence then $10 each", 5).tier).toBe("first_then");
    expect(sourceLineTerms("• Safe Deposit Box Annual Fees 3X5: $25.00 | 3X10: $35.00", 25)).toMatchObject({ tier: "size_band", band: "3X5" });
    expect(sourceLineTerms("Paper Statement Fee | $2.00 per statement Age 18-60 only.", 2).audience).toBe("age");
  });

  it("should_read_no_terms_from_a_neighbours_words (review of 0951351)", () => {
    // The same price twice: the line does not say whose words are whose.
    expect(lost("Research $25.00 per hour | Copies $25.00", 25, "Copies", { canonical_fee_key: "document_reproduction" })).toBeNull();
    expect(lost("Money Order $10.00 for non-members | Cashier's Check $10.00", 10, "Cashier's Check", { canonical_fee_key: "cashiers_check" })).toBeNull();
    // The next cell is another row's words.
    expect(lost("Dormant Account $5.00 | Monthly fee on balances below $100", 5, "Dormant Account", { canonical_fee_key: "dormant_account" })).toBeNull();
    // An audience named with a waiver is who does not pay.
    expect(lost("Monthly Maintenance Fee $10.00 waived for customers 65 and older", 10, "Monthly Maintenance Fee", { canonical_fee_key: "monthly_maintenance" })).toBeNull();
    expect(lost("Monthly Maintenance Fee $10.00 (waived for students)", 10, "Monthly Maintenance Fee", { canonical_fee_key: "monthly_maintenance" })).toBeNull();
    expect(lost("Excessive Withdrawal $10.00 Senior citizens age 62+ receive free checks", 10, "Excessive Withdrawal", { canonical_fee_key: "excess_withdrawal" })).toBeNull();
  });

  it("should_read_no_terms_from_the_next_rows_cells_in_a_pipe_table (review of f4d7b3f)", () => {
    // An empty price cell reads the next cell only when it is a bare basis, and only for unit and period.
    expect(lost("Stop Payment | $30 | Student Checking | $0", 30, "Stop Payment", { canonical_fee_key: "stop_payment", frequency: null })).toBeNull();
    expect(lost("Stop Payment | $30 | Non-Member ATM | $3", 30, "Stop Payment", { canonical_fee_key: "stop_payment", frequency: null })).toBeNull();
    expect(lost("Wire | $30 | Per Hour Research | $25", 30, "Wire", { canonical_fee_key: "wire_domestic_outgoing", frequency: null })).toBeNull();
    expect(lost("Stop Payment | $30 | Business Only | Wire | $3", 30, "Stop Payment", { canonical_fee_key: "stop_payment", frequency: null })).toBeNull();
    // Before the price, only the fee's own name cell and price cell.
    expect(lost("Fee A | $5 | after 3 per month | Fee B | $10", 10, "Fee B", { canonical_fee_key: "excess_withdrawal", frequency: null })).toBeNull();
    expect(lost("Low balance fee, waived for balances over 500 | Overdraft | $30", 30, "Overdraft", { canonical_fee_key: "overdraft", frequency: null })).toBeNull();
    // The shared period reader sees the fee's own row, not the next row's "Monthly".
    expect(lost("Wire | $30 | Monthly Service | $10", 30, "Wire", { canonical_fee_key: "wire_domestic_outgoing", frequency: null })).toBeNull();
    // Without cells, the previous price keeps its own unit.
    expect(sourceLineTerms("Research $25.00 per hour Copies $5.00", 5).unit).toBeNull();
  });

  it("should_stop_at_the_next_fees_name_on_flattened_text (review of cd9db5d)", () => {
    const flat = (line: string, amount: number, name: string, key: string) => lost(line, amount, name, { canonical_fee_key: key, frequency: null });
    expect(flat("Stop Payment $30 Student Checking $0", 30, "Stop Payment", "stop_payment")).toBeNull();
    expect(flat("Cashier's Check $10.00 Non-Member Check Cashing $5.00", 10, "Cashier's Check", "cashiers_check")).toBeNull();
    expect(flat("Stop Payment $30.00 - Student Checking $0", 30, "Stop Payment", "stop_payment")).toBeNull();
    // The shared unit and period readers see the same bounded row.
    expect(flat("Wire $30 Monthly Service $10", 30, "Wire", "wire_domestic_outgoing")).toBeNull();
    expect(flat("Stop Payment $30 Annual Fee $20", 30, "Stop Payment", "stop_payment")).toBeNull();
    expect(flat("Copy $5.00 Hourly Research $25", 5, "Copy", "document_reproduction")).toBeNull();
    expect(flat("Out of Network ATM Transaction** $3.50 Skip-A-Pay (2 per year) $35", 3.5, "Out of Network ATM Transaction", "atm_non_network")).toBeNull();
  });

  it("should_keep_the_prices_own_terms_on_flattened_text", () => {
    expect(sourceLineTerms("Counter Checks: $6.00 Per Page Paper Statement Fee: $2.00", 6).unit).toBe("per_page");
    expect(sourceLineTerms("Garnishments and levies ...... $125.00 plus legal fees We may require notice", 125).conditions).toEqual(["plus_extra"]);
    expect(sourceLineTerms("Inactivity Fee $7.50 Per month", 7.5).period).toBe("monthly");
    expect(sourceLineTerms("Notary $5.00 (Non-Members Only) Wire $25.00", 5).audience).toBe("non_member");
  });

  it("should_skip_empty_cells_before_a_basis_cell", () => {
    expect(sourceLineTerms("Maintenance Fee | $10 | | Monthly", 10).period).toBe("monthly");
    expect(sourceLineTerms("Research | $25 | | Per Hour", 25).unit).toBe("hourly");
  });

  it("should_still_read_a_bare_basis_cell_for_its_unit_and_period", () => {
    expect(sourceLineTerms("Account Research | $25.00 | Per Hour", 25).unit).toBe("hourly");
    expect(sourceLineTerms("Research | $50.00 | per 1/2 hour", 50).unit).toBe("per_half_hour");
    expect(sourceLineTerms("Dormant Fee | $10.00 | Monthly", 10).period).toBe("monthly");
    expect(sourceLineTerms("Overdraft | $30 | per item | Student Checking | $0", 30)).toMatchObject({ unit: null, audience: null });
  });

  it("should_still_read_the_fees_own_unit_beside_its_own_bound", () => {
    // "$25.00 minimum" bounds the same fee; it is not a second printing of the price.
    expect(lost("Account balancing assistance ........ $25.00 per hour, $25.00 minimum Notary public ........ $1.00", 25, "Account balancing assistance")).toBe("unit_lost:hourly");
    expect(sourceLineTerms("Inactive | $5.00 | Per Item", 5).unit).toBeNull();
    expect(sourceLineTerms("Inactivity Fee | $25.00 Per Month. Applicable after 12 months of no activity for non-members", 25).audience).toBeNull();
  });

  it("should_read_nothing_when_the_line_does_not_print_the_price", () => {
    expect(sourceLineTerms("Stop Payment | $30", 35)).toEqual(NO_TERMS);
  });
});

describe("lostTerm: does the published fee carry what its line prints", () => {
  it("should_call_a_flat_price_for_an_hourly_line_a_lost_unit", () => {
    expect(lost("Account Research | $25 per hour", 25, "Account Research")).toBe("unit_lost:hourly");
  });

  it("should_accept_the_unit_in_the_name_or_the_stored_frequency", () => {
    expect(lost("Account Research - per hour ($20.00 minimum) | $30.00", 30, "Account Research - per hour ($20.00 minimum)")).toBeNull();
    expect(lost("Account Research | $25 per hour", 25, "Account Research", { frequency: "hourly" })).toBeNull();
  });

  it("should_not_read_a_named_minimum_as_the_unit", () => {
    expect(lost("Research fee (1/2-hour minimum charge) | $50.00 per 1/2 hour", 50, "Research fee (1/2-hour minimum charge)")).toBe("unit_lost:per_half_hour");
  });

  it("should_score_a_period_only_when_the_stored_frequency_is_known", () => {
    const line = "Dormant Fee | $10.00 per month*";
    expect(lost(line, 10, "Dormant Fee", { canonical_fee_key: "dormant_account" })).toBeNull();
    expect(lost(line, 10, "Dormant Fee", { canonical_fee_key: "dormant_account", frequency: null })).toBe("period_lost:monthly");
    expect(lost(line, 10, "Dormant Fee", { canonical_fee_key: "dormant_account", frequency: "monthly" })).toBeNull();
  });

  it("should_call_a_dropped_size_band_or_ladder_lost", () => {
    expect(lost("• Safe Deposit Box Annual Fees 3X5: $25.00 | 3X10: $35.00", 25, "Safe Deposit Box Annual Fees", { canonical_fee_key: "safe_deposit_box" })).toBe("tier_lost:size_band");
    expect(lost("• Safe Deposit Box Annual Fees 3X5: $25.00 | 3X10: $35.00", 35, "Safe Deposit Box 3X10", { canonical_fee_key: "safe_deposit_box" })).toBeNull();
    expect(lost("Debit Card Replacement | - $5 for first occurrence then $10 each", 5, "Debit Card Replacement", { canonical_fee_key: "card_replacement" })).toBe("tier_lost:first_then");
  });

  it("should_leave_a_per_item_line_alone", () => {
    expect(lost("Stop Payment | $30 per item", 30, "Stop Payment", { canonical_fee_key: "stop_payment", frequency: null })).toBeNull();
  });
});

describe("the shared check returns the terms only when asked", () => {
  const text = "Fee Schedule\nAccount Research | $25 per hour\nStop Payment | $30";

  it("should_return_the_same_result_without_the_option", () => {
    const plain = checkFeeAgainstSource(text, "Account Research", 25, ".", "account_research");
    expect(plain.ok).toBe(true);
    expect(plain.ok && "terms" in plain).toBe(false);
    const asked = checkFeeAgainstSource(text, "Account Research", 25, ".", "account_research", { terms: true });
    expect(asked.ok && asked.terms?.unit).toBe("hourly");
    expect(asked.ok && plain.ok && asked.sourceLine).toBe(plain.ok && plain.sourceLine);
  });

  it("should_carry_the_terms_through_traceLiveFee", () => {
    const row = { fee_published_id: 1, lineage_ref: 1, fee_raw_id: 1, institution_id: 1, source: "knox", source_document_id: 7, canonical_fee_key: "account_research", fee_name: "Account Research", amount: 25 };
    const verdict = traceLiveFee(row, [{ source_document_id: 7, normalized_text: text }], { terms: true });
    expect(verdict).toMatchObject({ kind: "traced", terms: { unit: "hourly" } });
    expect(traceLiveFee(row, [{ source_document_id: 7, normalized_text: text }])).toEqual({ kind: "traced", sourceDocumentId: 7 });
  });
});

describe("severity of a lost term", () => {
  it("should_place_terms_lost_as_major_on_purpose", () => {
    expect(severityFor(TERMS_CHECK, "unit_lost:hourly")).toBe("major");
    expect(severityFor(TERMS_CHECK, "tier_lost:balance_band")).toBe("major");
  });
});

describe("fresh audit v10 scores a lost term as a qualifier miss", () => {
  it("should_count_the_hourly_fee_wrong_and_the_flat_fee_right", () => {
    const text = "Fee Schedule\nAccount Research | $25 per hour\nStop Payment | $30";
    const fees: FreshAuditFee[] = [
      { fee_id: 1, fee_published_id: 1, lineage_ref: 1, fee_raw_id: 1, institution_id: 1, source: "knox", source_document_id: 7, canonical_fee_key: "account_research", fee_name: "Account Research", amount: 25, frequency: null },
      { fee_id: 2, fee_published_id: 2, lineage_ref: 2, fee_raw_id: 2, institution_id: 1, source: "knox", source_document_id: 7, canonical_fee_key: "stop_payment", fee_name: "Stop Payment", amount: 30, frequency: null },
    ];
    const score = scoreFreshAudit(fees, new Map([[1, [{ source_document_id: 7, normalized_text: text }]]]));
    expect(score).toMatchObject({ scorable: 2, right: 1, qualifierMiss: 1, amountMiss: 0 });
    expect(score.observations).toEqual([[1, "qualifier"], [2, "right"]]);
    expect(score.misses[0]).toMatchObject({ check: "deming.terms_lost", reason: "unit_lost:hourly" });
  });
});
