import { describe, expect, it } from "vitest";

import { DAILY_CAP_LINES_LIVE } from "@/lib/daily-cap-wording";
import { ANCILLARY_PRODUCT_FLAG } from "@/lib/agents/knox/ancillary-product";
import {
  addDailyCapVerdicts,
  capIdentity,
  capTier,
  emptyDailyCapSummary,
  finishDailyCapSummary,
  judgeDailyCap,
  judgeDailyCaps,
  type CapLines,
  type CapVerdict,
} from "./daily-cap";
import { BOTH_175, capRow, GAINED_100, GAINED_150, NEITHER_36 } from "./daily-cap.fixtures";

describe("switch dry runs: DAILY_CAP_LINES_LIVE", () => {
  // On since 2026-11-02 (sampled clean on prod, seed sw-2026-11-02); the audit still counts off against on.
  it("should_audit_a_switch_now_on", () => {
    expect(DAILY_CAP_LINES_LIVE).toBe(true);
  });

  it("should_place_each_row_at_its_furthest_tier", () => {
    expect(capTier(capRow({ fee_published_id: 5, removed: false }))).toBe("live");
    expect(capTier(capRow({ fee_published_id: 5, removed: true }))).toBe("removed");
    expect(capTier(capRow({ fee_verified_id: 4, review_status: "rejected" }))).toBe("rejected");
    expect(capTier(capRow({ fee_verified_id: 4, review_status: "verified" }))).toBe("verified_unpublished");
    expect(capTier(capRow({ verify_decision: "rejected" }))).toBe("rejected");
    expect(capTier(capRow({ verify_decision: "needs_review" }))).toBe("held");
    expect(capTier(capRow({}))).toBe("unjudged");
  });

  it("should_take_the_published_identity_over_the_verified_and_raw_ones", () => {
    const row = capRow({
      fee_verified_id: 4, verified_key: "nsf_daily_cap", verified_name: "Verified name", verified_amount: 90,
      fee_published_id: 5, removed: false, published_key: "od_daily_cap", published_name: "Published name", published_amount: 120,
    });
    expect(capIdentity(row)).toEqual({ tier: "live", category: "od_daily_cap", name: "Published name", amount: 120 });
  });

  it("should_skip_a_row_that_is_no_daily_cap", () => {
    // Knox hinted a cap, but Darwin verified it as an overdraft fee.
    expect(capIdentity(capRow({ fee_verified_id: 4, verified_key: "overdraft", verified_name: "Overdraft", verified_amount: 30 }))).toBeNull();
    expect(capIdentity(capRow({ outlier_flags: [], conditions: "canonical_hint=overdraft" }))).toBeNull();
    // The hint in the audit text counts when the flags carry none.
    expect(capIdentity(capRow({ outlier_flags: [], conditions: "Knox deterministic extraction. canonical_hint=nsf_daily_cap" }))?.category).toBe("nsf_daily_cap");
  });

  it("should_mark_a_row_that_traces_only_with_the_switch_on", () => {
    const verdict = judgeDailyCap(capRow({ verify_decision: "rejected" }), GAINED_150);
    expect(verdict).toMatchObject({ tier: "rejected", change: "now_traces", failure: "amount_is_a_threshold", line: GAINED_150, amount: 150, institutionName: "Bank A", sourceDocumentId: 100 });
  });

  it("should_leave_rows_that_trace_the_same_either_way", () => {
    expect(judgeDailyCap(capRow({ raw_name: "Overdraft Daily Cap", raw_amount: 175 }), BOTH_175)?.change).toBe("unchanged");
    expect(judgeDailyCap(capRow({ raw_name: "Overdraft Daily Cap", raw_amount: 36 }), NEITHER_36)?.change).toBe("unchanged");
    expect(judgeDailyCap(capRow({}), null)?.change).toBe("no_text");
  });

  it("should_check_a_held_ancillary_product_read_on_its_own_product_block_as_darwin_does", () => {
    // Darwin narrows an ancillary-product read to its product's block (`ownedSourceText`); with no
    // product named, it has no block, so the read traces neither way and is no gain. The whole-text
    // check alone (8a80f4c) called it now_traces.
    const row = capRow({ verify_decision: "needs_review", outlier_flags: ["canonical_hint:od_daily_cap", ANCILLARY_PRODUCT_FLAG] });
    expect(judgeDailyCap(row, GAINED_150)?.change).toBe("unchanged");
    // The same row without the flag is read on the whole text and gains.
    expect(judgeDailyCap(capRow({ verify_decision: "needs_review" }), GAINED_150)?.change).toBe("now_traces");
  });

  it("should_count_fee_lines_once_across_tiers_and_gains_only_where_nothing_is_live", () => {
    const rows = [
      capRow({ fee_raw_id: 1, fee_published_id: 11, removed: false, published_key: "od_daily_cap", published_name: "Paid Overdraft Charge daily maximum", published_amount: 150 }),
      // A second Knox read of the same held line on the same document: one more row, the same fee.
      capRow({ fee_raw_id: 2, verify_decision: "needs_review" }),
      capRow({ fee_raw_id: 3, verify_decision: "needs_review" }),
      capRow({ fee_raw_id: 4, source_document_id: 200, raw_name: "Overdraft fees daily maximum", raw_amount: 100, fee_published_id: 12, removed: true, published_key: "od_daily_cap", published_name: "Overdraft fees daily maximum", published_amount: 100 }),
      capRow({ fee_raw_id: 5, source_document_id: 300, raw_name: "Overdraft Daily Cap", raw_amount: 175, verify_decision: "rejected" }),
      capRow({ fee_raw_id: 6, source_document_id: 400 }),
    ];
    const texts = new Map([[100, GAINED_150], [200, GAINED_100], [300, BOTH_175]]);
    const lines: CapLines = new Map();
    const summary = finishDailyCapSummary(addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps(rows, texts), 2, lines), lines, 2);
    // Rows 1-4 newly trace: row 1 is live, rows 2 and 3 are held re-reads of row 1's line, row 4 is
    // removed. Row 5 traces either way; row 6 has no text.
    expect(summary.rows).toBe(6);
    expect(summary.nowTraces).toBe(3);
    expect(summary.liveNowTraces).toBe(1);
    // Two fee lines newly trace: doc 100's $150 (live through row 1, so no gain) and doc 200's $100
    // (removed, nothing live: the one gain).
    expect(summary.nowTracesLines).toBe(2);
    expect(summary.gainLines).toBe(1);
    expect(summary.alreadyLiveSamePriceLines).toBe(1);
    expect(summary.priceChangeLines).toBe(0);
    expect(summary.gainSamples.map((verdict) => verdict.feeRawId)).toEqual([4]);
    expect(summary.stopsTracing).toBe(0);
    expect(summary.noText).toBe(1);
    expect(summary.byTier.live).toEqual({ rows: 1, noText: 0, nowTraces: 1, stopsTracing: 0 });
    expect(summary.byTier.held).toEqual({ rows: 2, noText: 0, nowTraces: 2, stopsTracing: 0 });
    expect(summary.byTier.removed).toEqual({ rows: 1, noText: 0, nowTraces: 1, stopsTracing: 0 });
    expect(summary.byTier.rejected).toEqual({ rows: 1, noText: 0, nowTraces: 0, stopsTracing: 0 });
    expect(summary.byTier.unjudged).toEqual({ rows: 1, noText: 1, nowTraces: 0, stopsTracing: 0 });
  });

  it("should_judge_a_live_cap_that_newly_traces_by_darwins_verified_recheck_on_its_new_line", () => {
    // Courtesy Pay's cap: today the recheck reads Knox's excerpt (the first row); switch on, the cap
    // line. Every check passes on both, so the recheck keeps it.
    const text = "Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item\n4 item cap per day (max fee of $120/day)";
    const row = capRow({
      raw_name: "Courtesy Pay daily maximum", raw_amount: 120, conditions: 'excerpt="Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item"',
      fee_verified_id: 21, review_status: "verified", verified_key: "od_daily_cap", verified_name: "Courtesy Pay daily maximum", verified_amount: 120,
      fee_published_id: 11, removed: false, published_key: "od_daily_cap", published_name: "Courtesy Pay daily maximum", published_amount: 120,
    });
    const verdict = judgeDailyCap(row, text);
    expect(verdict?.change).toBe("now_traces");
    expect(verdict?.recheck).toEqual({
      today: { outcome: "kept", reason: null, line: "Courtesy Pay | $30/item | Wire Transfer (incoming) | $5/item" },
      switchOn: { outcome: "kept", reason: null, line: "4 item cap per day (max fee of $120/day)" },
    });
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), [verdict as CapVerdict], 5, new Map());
    expect(summary.liveRecheck).toEqual({ kept: 1, takedown: 0, alreadyFailing: 0, byReason: {} });
    expect(summary.liveNowTracesSamples).toHaveLength(1);
    // A held row gets no recheck: only live rows go through it.
    expect(judgeDailyCap(capRow({ verify_decision: "needs_review" }), GAINED_150)?.recheck).toBeUndefined();
  });

  it("should_count_a_live_cap_the_recheck_would_take_down_by_its_reason", () => {
    // No known cap line fails a name rule; the aggregator still counts one if prod has it.
    const base: CapVerdict = {
      tier: "live", category: "od_daily_cap", name: "Overdraft daily maximum", amount: 140, feeRawId: 9, feePublishedId: 19,
      institutionId: 10, institutionName: "Bank A", sourceDocumentId: 100, documentUrl: null, documentCrawledAt: null, documentStream: null,
      change: "now_traces", failure: "name_not_in_text", line: "x",
      recheck: { today: { outcome: "kept", reason: null, line: "a" }, switchOn: { outcome: "takedown", reason: "name_rule:cut_name", line: "x" } },
    };
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), [base, { ...base, feeRawId: 10 }], 1, new Map());
    expect(summary.liveRecheck).toEqual({ kept: 0, takedown: 2, alreadyFailing: 0, byReason: { "name_rule:cut_name": 2 } });
    expect(summary.liveNowTracesSamples).toHaveLength(1);
  });

  it("should_count_a_live_cap_failing_the_recheck_today_as_already_failing_not_a_switch_takedown", () => {
    // The recheck already fails it on Knox's excerpt; the switch does not cause its takedown.
    // At 9a74546 it counted as a takedown.
    const failing: CapVerdict = {
      tier: "live", category: "od_daily_cap", name: "Overdraft daily maximum", amount: 140, feeRawId: 9, feePublishedId: 19,
      institutionId: 10, institutionName: "Bank A", sourceDocumentId: 100, documentUrl: null, documentCrawledAt: null, documentStream: null,
      change: "now_traces", failure: "name_not_in_text", line: "x",
      recheck: { today: { outcome: "takedown", reason: "name_rule:cut_name", line: "a" }, switchOn: { outcome: "takedown", reason: "name_rule:cut_name", line: "x" } },
    };
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), [failing], 5, new Map());
    expect(summary.liveRecheck).toEqual({ kept: 0, takedown: 0, alreadyFailing: 1, byReason: {} });
  });

  it("should_keep_a_line_live_when_its_live_row_comes_in_after_its_gain", () => {
    // A held re-read is judged before the live row of its line: the line is still no gain.
    const held = capRow({ fee_raw_id: 2, verify_decision: "needs_review" });
    const live = capRow({ fee_raw_id: 1, fee_published_id: 11, removed: false, published_key: "od_daily_cap", published_name: "Paid Overdraft Charge daily maximum", published_amount: 150 });
    const texts = new Map([[100, BOTH_175]]);
    const lines: CapLines = new Map();
    const summary = emptyDailyCapSummary();
    addDailyCapVerdicts(summary, judgeDailyCaps([held], new Map([[100, GAINED_150]])), 5, lines);
    addDailyCapVerdicts(summary, judgeDailyCaps([live], texts), 5, lines);
    expect(finishDailyCapSummary(summary, lines, 5)).toMatchObject({ nowTracesLines: 1, gainLines: 0, alreadyLiveSamePriceLines: 1 });
  });

  it("should_count_a_row_that_stops_tracing_with_the_switch_on", () => {
    // No known text traces off and not on; the aggregator still has to count one if prod has it.
    const stops: CapVerdict = {
      tier: "live", category: "od_daily_cap", name: "Overdraft daily maximum", amount: 140, feeRawId: 9, feePublishedId: 19,
      institutionId: 10, institutionName: "Bank A", sourceDocumentId: 100, documentUrl: null, documentCrawledAt: null, documentStream: null, change: "stops_tracing", failure: "amount_is_a_threshold", line: "x",
    };
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), [stops, { ...stops, feeRawId: 10 }], 1, new Map());
    expect(summary.stopsTracing).toBe(2);
    expect(summary.byTier.live.stopsTracing).toBe(2);
    expect(summary.stopsTracingSamples).toHaveLength(1);
  });
});
