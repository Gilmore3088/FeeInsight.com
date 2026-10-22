// @vitest-environment node
import { describe, expect, it } from "vitest";
import { expectationsForRow, liveAuditCases, liveAuditNotReplayable, readLiveAudit, type LiveAuditRow } from "./live-audit";

const row = (extra: Partial<LiveAuditRow>): LiveAuditRow => ({
  case_key: "w43-1-0001",
  institution_id: 1,
  verdict: "MATCH",
  category: "stop_payment",
  fee_name: "Stop Payment fee",
  amount_on_site: "$35",
  schedule_amount: "$35",
  correction: null,
  document_key: "1-doc",
  ...extra,
});

const none = new Set<string>();

describe("live audit verdicts as expectations", () => {
  it("should_expect_a_match_published_at_its_price_and_name", () => {
    expect(expectationsForRow(row({}), none)).toEqual({
      publish: [{ canonicalFeeKey: "stop_payment", feeName: "Stop Payment fee", amountCents: 3500, expectedName: "Stop Payment fee" }],
      forbid: [],
    });
  });

  it("should_skip_a_match_stated_as_a_rate", () => {
    expect(expectationsForRow(row({ amount_on_site: "3%" }), none)).toEqual({ skip: "the live amount is a rate, not a dollar price" });
  });

  it("should_expect_a_missing_fee_at_the_schedules_one_dollar_figure", () => {
    const missing = row({ verdict: "MISSING", fee_name: null, amount_on_site: null, category: "nsf", correction: "nsf", schedule_amount: "$34/item" });
    expect(expectationsForRow(missing, none)).toEqual({
      publish: [{ canonicalFeeKey: "nsf", feeName: null, amountCents: 3400 }],
      forbid: [],
    });
  });

  it("should_skip_a_missing_fee_whose_schedule_amount_is_not_one_dollar_figure", () => {
    const tiers = row({ verdict: "MISSING", category: "minimum_balance", schedule_amount: "$5/month NOW; $6/month Money Market" });
    expect(expectationsForRow(tiers, none)).toEqual({ skip: "the schedule amount is not one dollar figure" });
    const rate = row({ verdict: "MISSING", category: "card_foreign_txn", schedule_amount: "1.5% of transaction" });
    expect(expectationsForRow(rate, none)).toEqual({ skip: "the schedule amount is a rate" });
  });

  it("should_forbid_a_wrong_amount_and_expect_the_schedules_price", () => {
    const wrong = row({ verdict: "WRONG_AMOUNT", category: "overdraft", amount_on_site: "$25", schedule_amount: "$30/item" });
    expect(expectationsForRow(wrong, none)).toEqual({
      publish: [{ canonicalFeeKey: "overdraft", feeName: "Stop Payment fee", amountCents: 3000 }],
      forbid: [{ canonicalFeeKey: "overdraft", feeName: "Stop Payment fee", amountCents: 2500 }],
    });
  });

  it("should_forbid_an_hourly_price_published_as_flat", () => {
    const hourly = row({ verdict: "WRONG_AMOUNT", category: "account_research", amount_on_site: "$25", schedule_amount: "$25/hour, $25 minimum" });
    expect(expectationsForRow(hourly, none)).toEqual({
      publish: [],
      forbid: [{ canonicalFeeKey: "account_research", feeName: "Stop Payment fee", amountCents: 2500, frequency: "!hourly" }],
    });
    const half = row({ verdict: "WRONG_AMOUNT", category: "account_research", amount_on_site: "$50", schedule_amount: "$50/half-hour" });
    expect(expectationsForRow(half, none)).toMatchObject({ forbid: [{ frequency: "!per_half_hour" }] });
  });

  it("should_skip_a_wrong_amount_whose_price_the_schedule_states", () => {
    const tier = row({ verdict: "WRONG_AMOUNT", category: "paper_statement", amount_on_site: "$5", schedule_amount: "$5/statement cycle; $2 Smart Start" });
    expect(expectationsForRow(tier, none)).toEqual({
      skip: "the live price is in the schedule; the error is a tier, unit or condition the lab does not score",
    });
  });

  it("should_forbid_a_wrong_category_and_expect_a_canonical_correction", () => {
    const wrong = row({ verdict: "WRONG_CATEGORY", category: "account_research", amount_on_site: "$15", correction: "card_replacement" });
    expect(expectationsForRow(wrong, none)).toEqual({
      publish: [{ canonicalFeeKey: "card_replacement", feeName: "Stop Payment fee", amountCents: 1500 }],
      forbid: [{ canonicalFeeKey: "account_research", feeName: "Stop Payment fee", amountCents: 1500 }],
    });
    const prose = row({ verdict: "WRONG_CATEGORY", category: "late_payment", amount_on_site: "$10", correction: "Safe deposit box late fee / Account Services" });
    expect(expectationsForRow(prose, none)).toEqual({ publish: [], forbid: [{ canonicalFeeKey: "late_payment", feeName: "Stop Payment fee", amountCents: 1000 }] });
  });

  it("should_not_forbid_a_category_and_price_another_row_confirms_in_the_same_schedule", () => {
    const wrong = row({ verdict: "WRONG_CATEGORY", category: "late_payment", amount_on_site: "$10", correction: null });
    expect(expectationsForRow(wrong, new Set(["late_payment:1000"]))).toEqual({
      skip: "a matched row in the same schedule has this category and price",
    });
  });

  it("should_expect_a_bad_name_published_under_the_corrected_name", () => {
    const bad = row({ verdict: "BAD_NAME", category: "safe_deposit_box", fee_name: "10x10 Annual Fee", amount_on_site: "$80", correction: "Safe deposit box 10x10 Annual Fee" });
    expect(expectationsForRow(bad, none)).toEqual({
      publish: [{ canonicalFeeKey: "safe_deposit_box", feeName: "10x10 Annual Fee", amountCents: 8000, expectedName: "Safe deposit box 10x10 Annual Fee" }],
      forbid: [],
    });
  });

  it("should_not_take_an_instruction_as_the_expected_name", () => {
    const bad = row({ verdict: "BAD_NAME", category: "monthly_maintenance", amount_on_site: "$25", correction: "Name the account" });
    expect(expectationsForRow(bad, none)).toEqual({
      publish: [{ canonicalFeeKey: "monthly_maintenance", feeName: "Stop Payment fee", amountCents: 2500 }],
      forbid: [],
    });
  });
});

describe("live audit fixture", () => {
  const fixture = readLiveAudit();

  it("should_keep_every_audit_row_and_count_them_as_the_about_says", () => {
    const perVerdict: Record<string, number> = {};
    for (const item of fixture.rows) perVerdict[item.verdict] = (perVerdict[item.verdict] ?? 0) + 1;
    expect(fixture.rows).toHaveLength(fixture.about.rows);
    expect(perVerdict).toEqual(fixture.about.rows_per_verdict);
  });

  it("should_give_every_replayable_row_a_saved_document", () => {
    const keys = new Set(fixture.documents.map((d) => d.document_key));
    for (const item of fixture.rows) {
      expect(item.not_replayable ? item.document_key == null : keys.has(item.document_key ?? "")).toBe(true);
    }
  });

  it("should_build_one_case_per_document_with_expectations", () => {
    const cases = liveAuditCases(fixture);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((c) => c.scenario === "live_audit" && c.document.text && c.expected.publish.length + c.expected.forbid.length > 0)).toBe(true);
    expect(new Set(cases.map((c) => c.caseKey)).size).toBe(cases.length);
  });

  it("should_count_rows_it_cannot_replay_by_verdict_and_reason", () => {
    const listed = liveAuditNotReplayable(fixture);
    const skipped = listed.reduce((sum, item) => sum + Number(item.failure.match(/^(\d+)/)?.[1] ?? 0), 0);
    const cases = liveAuditCases(fixture);
    const scored = fixture.rows.length - skipped;
    expect(scored).toBeGreaterThan(0);
    expect(cases.length).toBeLessThanOrEqual(scored);
    expect(listed.every((item) => item.issue === "#2064 W43 live audit")).toBe(true);
  });
});
