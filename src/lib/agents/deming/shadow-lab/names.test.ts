// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nameMatches } from "./names";

describe("shadow lab published-name check", () => {
  it("should_accept_a_name_carrying_the_expected_names_own_words", () => {
    expect(nameMatches("Safe deposit box 10x10 Annual Fee", "Safe Deposit Box 10x10 annual fee")).toBe(true);
    expect(nameMatches("Stop Payment fee (Expires in 6 months)", "Stop payment")).toBe(true);
  });

  it("should_reject_a_name_missing_most_of_the_expected_words", () => {
    expect(nameMatches("Safe deposit box 10x10 Annual Fee", "10x10 Annual Fee")).toBe(false);
  });

  it("should_reject_a_name_that_starts_with_a_cut_or_condition_fragment", () => {
    expect(nameMatches("Paper statement fee", "2 – Paper Statement Fee")).toBe(false);
    expect(nameMatches("Overdraft fee", "if overdraft fee")).toBe(false);
    expect(nameMatches("Overdraft fee", ") Overdraft fee")).toBe(false);
  });

  it("should_not_require_the_expected_names_own_condition", () => {
    expect(nameMatches("Account Closure Fee (if closed within 45 days of opening)", "Account Closure Fee")).toBe(true);
    expect(nameMatches("Dormant fee if no activity for one year", "Dormant Account Fee")).toBe(true);
  });

  it("should_read_a_plural_as_its_singular", () => {
    expect(nameMatches("VISA Gift Card", "Gift Cards")).toBe(true);
  });

  it("should_reject_an_empty_published_name", () => {
    expect(nameMatches("Overdraft fee", null)).toBe(false);
    expect(nameMatches("Overdraft fee", "  ")).toBe(false);
  });

  it("should_judge_only_the_fragment_rule_when_the_expected_name_has_no_distinctive_word", () => {
    expect(nameMatches("Monthly fee", "Checking monthly service charge")).toBe(true);
    expect(nameMatches("Monthly fee", "and monthly fee")).toBe(false);
  });

  it("should_not_treat_a_leading_number_that_names_the_fee_as_a_fragment", () => {
    expect(nameMatches("24-Hour Banking fee", "24-Hour Banking fee")).toBe(true);
  });
});
