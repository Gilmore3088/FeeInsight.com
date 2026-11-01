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
    expect(summary.alreadyLiveLines).toBe(1);
    expect(summary.gainSamples.map((verdict) => verdict.feeRawId)).toEqual([4]);
    expect(summary.stopsTracing).toBe(0);
    expect(summary.noText).toBe(1);
    expect(summary.byTier.live).toEqual({ rows: 1, noText: 0, nowTraces: 1, stopsTracing: 0 });
    expect(summary.byTier.held).toEqual({ rows: 2, noText: 0, nowTraces: 2, stopsTracing: 0 });
    expect(summary.byTier.removed).toEqual({ rows: 1, noText: 0, nowTraces: 1, stopsTracing: 0 });
    expect(summary.byTier.rejected).toEqual({ rows: 1, noText: 0, nowTraces: 0, stopsTracing: 0 });
    expect(summary.byTier.unjudged).toEqual({ rows: 1, noText: 1, nowTraces: 0, stopsTracing: 0 });
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
    expect(finishDailyCapSummary(summary, lines, 5)).toMatchObject({ nowTracesLines: 1, gainLines: 0, alreadyLiveLines: 1 });
  });

  it("should_count_a_row_that_stops_tracing_with_the_switch_on", () => {
    // No known text traces off and not on; the aggregator still has to count one if prod has it.
    const stops: CapVerdict = {
      tier: "live", category: "od_daily_cap", name: "Overdraft daily maximum", amount: 140, feeRawId: 9, feePublishedId: 19,
      institutionId: 10, institutionName: "Bank A", sourceDocumentId: 100, change: "stops_tracing", failure: "amount_is_a_threshold", line: "x",
    };
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), [stops, { ...stops, feeRawId: 10 }], 1, new Map());
    expect(summary.stopsTracing).toBe(2);
    expect(summary.byTier.live.stopsTracing).toBe(2);
    expect(summary.stopsTracingSamples).toHaveLength(1);
  });
});
