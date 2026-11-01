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
import type { DailyCapRow } from "./types";

/** A raw cap read with nothing downstream; each test adds the tier it needs. */
function capRow(overrides: Partial<DailyCapRow>): DailyCapRow {
  return {
    fee_raw_id: 1,
    institution_id: 10,
    institution_name: "Bank A",
    source_document_id: 100,
    source_url: null,
    document_url: null,
    document_crawled_at: null,
    document_stream: null,
    raw_name: "Paid Overdraft Charge daily maximum",
    raw_amount: 150,
    product_name: null,
    outlier_flags: ["canonical_hint:od_daily_cap"],
    conditions: null,
    fee_verified_id: null,
    review_status: null,
    verified_key: null,
    verified_name: null,
    verified_amount: null,
    fee_published_id: null,
    published_key: null,
    published_name: null,
    published_amount: null,
    removed: null,
    rolled_back_reason: null,
    verify_decision: null,
    verify_reason: null,
    verify_key: null,
    ...overrides,
  };
}

// Texts from `custom-report/daily-cap-lines.test.ts`: the first two are real caps the switch gains
// (off: not-ok, on: ok); the third traces both ways; the fourth traces neither way.
const GAINED_150 = "Paid Overdraft Charge: $30.00/item ($150.00 max daily)";
const GAINED_100 = "Total overdraft charges/fees will not exceed $100.00 per day";
const BOTH_175 = "Overdraft Daily Cap | $175";
const NEITHER_36 = "Overdraft Fee | $36.00 per item";

describe("switch dry runs: DAILY_CAP_LINES_LIVE", () => {
  it("should_audit_a_switch_that_is_still_off", () => {
    expect(DAILY_CAP_LINES_LIVE).toBe(false);
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

  it("should_count_no_gain_for_an_older_copy_of_a_line_live_on_a_newer_copy", () => {
    // Copies 100 (older, a held re-read) and 500 (newer, live) are the same page, so one line, as
    // Hamilton's supersede reads them. At cdcb367 the key held the document id: 1 gain.
    const page = "https://a.example/fees";
    const held = capRow({ fee_raw_id: 2, verify_decision: "needs_review", document_url: page });
    const live = capRow({
      fee_raw_id: 7, source_document_id: 500, document_url: `${page}/`, fee_published_id: 17, removed: false,
      published_key: "od_daily_cap", published_name: "Paid Overdraft Charge Daily Maximum", published_amount: 150,
    });
    const lines: CapLines = new Map();
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps([held, live], new Map([[100, GAINED_150], [500, BOTH_175]])), 5, lines);
    expect(finishDailyCapSummary(summary, lines, 5)).toMatchObject({ nowTracesLines: 1, gainLines: 0, alreadyLiveSamePriceLines: 1 });
  });

  it("should_report_a_live_price_change_when_a_newer_copy_traces_at_another_price", () => {
    // The re-review's probe: newer copy 500 of the page has a held $150 read that traces only with
    // the switch on; older copy 100 has the same-named cap live at $100. At 9a74546 the line folded
    // into "already live" with no sample. Hamilton supersedes the live $100 with the $150.
    const page = "https://a.example/fees";
    const held = capRow({ fee_raw_id: 2, source_document_id: 500, document_url: page, document_crawled_at: "2026-10-20T00:00:00Z", verify_decision: "needs_review" });
    const live = capRow({
      fee_raw_id: 1, source_document_id: 100, document_url: page, document_crawled_at: "2026-09-01T00:00:00Z", raw_amount: 100,
      fee_published_id: 11, removed: false, published_key: "od_daily_cap", published_name: "Paid Overdraft Charge daily maximum", published_amount: 100,
    });
    const lines: CapLines = new Map();
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps([live, held], new Map([[100, BOTH_175], [500, GAINED_150]])), 5, lines);
    const done = finishDailyCapSummary(summary, lines, 5);
    expect(done).toMatchObject({ nowTracesLines: 1, gainLines: 0, alreadyLiveSamePriceLines: 0, priceChangeLines: 1, priceChangeByDecision: { supersede: 1 } });
    expect(done.priceChangeSamples).toEqual([
      expect.objectContaining({ decision: "supersede", live: [{ feePublishedId: 11, amount: 100, sourceDocumentId: 100 }], verdict: expect.objectContaining({ feeRawId: 2, amount: 150 }) }),
    ]);
  });

  it("should_keep_two_caps_of_one_name_at_two_prices_on_one_page_as_two_lines", () => {
    // Nothing live: both are gains. At 9a74546 they folded into one line.
    const page = "https://a.example/fees";
    const rows = [
      capRow({ fee_raw_id: 1, source_document_id: 100, document_url: page, verify_decision: "needs_review" }),
      capRow({ fee_raw_id: 2, source_document_id: 200, document_url: page, raw_amount: 100, verify_decision: "needs_review" }),
    ];
    const texts = new Map([[100, GAINED_150], [200, "Paid Overdraft Charge: $25.00/item ($100.00 max daily)"]]);
    const lines: CapLines = new Map();
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps(rows, texts), 5, lines);
    expect(finishDailyCapSummary(summary, lines, 5)).toMatchObject({ nowTracesLines: 2, gainLines: 2, priceChangeLines: 0 });
  });

  it("should_label_a_gain_from_a_verified_unpublished_row_as_publish_gate_not_replayed", () => {
    const rows = [
      capRow({ fee_raw_id: 1, fee_verified_id: 21, review_status: "verified", verified_key: "od_daily_cap", verified_name: "Paid Overdraft Charge daily maximum", verified_amount: 150 }),
      capRow({ fee_raw_id: 4, source_document_id: 200, raw_name: "Overdraft fees daily maximum", raw_amount: 100, verify_decision: "needs_review" }),
    ];
    const lines: CapLines = new Map();
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps(rows, new Map([[100, GAINED_150], [200, GAINED_100]])), 5, lines);
    // Two gains: the verified row's (Darwin's judgement only) and the held row's.
    expect(finishDailyCapSummary(summary, lines, 5)).toMatchObject({ gainLines: 2, gainLinesPublishGateNotReplayed: 1 });
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
