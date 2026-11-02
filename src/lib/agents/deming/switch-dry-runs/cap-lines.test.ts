import { describe, expect, it } from "vitest";

import { addDailyCapVerdicts, emptyDailyCapSummary, finishDailyCapSummary, judgeDailyCaps, type CapLines } from "./daily-cap";
import { BOTH_175, capRow, GAINED_100, GAINED_150 } from "./daily-cap.fixtures";

describe("switch dry runs: daily cap lines across copies, prices and pages", () => {
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

  it("should_keep_an_older_copys_new_price_out_of_the_price_change_headline", () => {
    // Swapped dates: the $150 read sits on the OLDER copy 100, the live $100 on the NEWER copy 500.
    // decidePriorFee says older_document, so the live price stays; ccca154 counted it a price change.
    const page = "https://a.example/fees";
    const held = capRow({ fee_raw_id: 2, source_document_id: 100, document_url: page, document_crawled_at: "2026-09-01T00:00:00Z", verify_decision: "needs_review" });
    const live = capRow({
      fee_raw_id: 1, source_document_id: 500, document_url: page, document_crawled_at: "2026-10-20T00:00:00Z", raw_amount: 100,
      fee_published_id: 11, removed: false, published_key: "od_daily_cap", published_name: "Paid Overdraft Charge daily maximum", published_amount: 100,
    });
    const lines: CapLines = new Map();
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps([held, live], new Map([[100, GAINED_150], [500, BOTH_175]])), 5, lines);
    expect(finishDailyCapSummary(summary, lines, 5)).toMatchObject({
      priceChangeLines: 0, livePriceStaysLines: 1, livePriceStaysByDecision: { older_document: 1 }, gainLines: 0,
    });
  });

  it("should_report_a_new_cap_beside_a_same_named_live_cap_on_another_page", () => {
    // The $150 read is on the fees page; the only live "Paid Overdraft Charge daily maximum" ($100) is
    // on the business page. Hamilton publishes the $150 as an additional line beside it; ccca154
    // called it a plain gain.
    const held = capRow({ fee_raw_id: 2, source_document_id: 100, document_url: "https://a.example/fees", document_crawled_at: "2026-10-20T00:00:00Z", verify_decision: "needs_review" });
    const live = capRow({
      fee_raw_id: 1, source_document_id: 600, document_url: "https://a.example/business-fees", document_crawled_at: "2026-09-01T00:00:00Z", raw_amount: 100,
      fee_published_id: 12, removed: false, published_key: "od_daily_cap", published_name: "Paid Overdraft Charge daily maximum", published_amount: 100,
    });
    const lines: CapLines = new Map();
    const summary = addDailyCapVerdicts(emptyDailyCapSummary(), judgeDailyCaps([held, live], new Map([[100, GAINED_150], [600, BOTH_175]])), 5, lines);
    const done = finishDailyCapSummary(summary, lines, 5);
    expect(done).toMatchObject({ gainLines: 0, priceChangeLines: 0, besideElsewhereLines: 1 });
    expect(done.besideElsewhereSamples[0]).toMatchObject({ decision: "additional_line", live: [{ feePublishedId: 12, amount: 100, sourceDocumentId: 600 }] });
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

});
