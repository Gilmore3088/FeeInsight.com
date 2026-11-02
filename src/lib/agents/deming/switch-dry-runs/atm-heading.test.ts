// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ATM_HEADING_CASES } from "@/lib/fee-fold-atm-heading.fixtures";
import { footnotedAtmHeadingLive } from "@/lib/fee-fold-atm-heading";
import { addAtmHeadingRows, emptyAtmHeadingSummary, judgeAtmHeadingRow, replayLiveNonNetwork } from "./atm-heading";
import type { AtmHeadingRow, LiveNonNetworkFeeRow } from "./types";

const caseText = (prefix: string) => ATM_HEADING_CASES.find((c) => c.name.startsWith(prefix))!.text;
const TEXAS_2416 = caseText("Texas 2416");
const OWN_MARKED = caseText("own: Regions ATM1:");
const TELLER = caseText("teller inquiry under a footnoted");

const row = (over: Partial<AtmHeadingRow>): AtmHeadingRow => ({
  fee_raw_id: 1, institution_id: 10, institution_name: "Bank A", source_document_id: 100, raw_name: "Balance inquiry", raw_amount: 0.75,
  fee_verified_id: null, review_status: null, verified_key: null, verified_name: null, verified_amount: null,
  fee_published_id: null, published_key: null, published_name: null, published_amount: null, live: null, ...over,
});

describe("FOOTNOTED_ATM_HEADING_LIVE dry run", () => {
  it("should_count_a_verified_inquiry_the_fold_step_would_re_file_into_the_non_network_atm_fee", () => {
    const verdict = judgeAtmHeadingRow(row({ fee_verified_id: 5, review_status: "verified", verified_key: "balance_inquiry", verified_name: "Balance inquiry", verified_amount: 0.75 }), TEXAS_2416);
    expect(verdict).toMatchObject({ tier: "verified", today: "balance_inquiry", off: "balance_inquiry", on: "atm_non_network", accepted: true });
  });

  it("should_record_a_live_balance_inquiry_row_the_switch_files_elsewhere_by_tier", () => {
    const live = row({ fee_raw_id: 2, source_document_id: 200, raw_name: "Balance Inquiry", raw_amount: 0, fee_verified_id: 6, review_status: "verified",
      verified_key: "atm_non_network", verified_name: "Balance Inquiry", verified_amount: 0, fee_published_id: 9, published_key: "atm_non_network",
      published_name: "Balance Inquiry", published_amount: 0, live: true });
    const summary = emptyAtmHeadingSummary();
    addAtmHeadingRows(summary, [live], new Map([[200, OWN_MARKED]]), 5);
    expect(summary).toMatchObject({ rows: 1, changed: 1, wouldRefileIn: 0, byChange: { "live atm_non_network->balance_inquiry": 1 } });
  });

  it("should_leave_a_teller_inquiry_and_unreadable_rows_uncounted", () => {
    const summary = emptyAtmHeadingSummary();
    addAtmHeadingRows(summary, [
      row({ raw_name: "Teller Balance Inquiry", raw_amount: 1 }),
      row({ fee_raw_id: 3, source_document_id: 300 }),
      row({ fee_raw_id: 4, raw_name: "Balance Inquiry at the drive-up", raw_amount: 9 }),
      row({ fee_raw_id: 5, source_document_id: null }),
    ], new Map([[100, TELLER]]), 5);
    expect(summary).toMatchObject({ rows: 4, changed: 0, noText: 2, notFound: 1, samples: [] });
  });

  // The takedown count judges live fees as Hamilton's rules re-check does (review of 634ce2e).
  const live = (id: number, over: Partial<LiveNonNetworkFeeRow> = {}): LiveNonNetworkFeeRow => ({
    fee_published_id: id, lineage_ref: id, institution_id: 10, institution_name: "Bank A", source_document_id: 200, text_hash: "h1",
    canonical_fee_key: "atm_non_network", fee_name: "Balance Inquiry", amount: 0, raw_fee_name: "Balance Inquiry", fee_audience: "consumer",
    pulled: false, lesson_flag: null, name_filed: false, ...over,
  });
  const text = (hash: string, normalized: string, id = 1) => ({ id, source_document_id: 200, text_hash: hash, normalized_text: normalized });
  // Main misses "Regions ATM1:" and reads a non-network $0; the switch reads the bank's own ATM.
  const OWN = text("h1", `${OWN_MARKED}\n`);
  // "Foreign ATM Withdrawal" no longer traces in the text, so the second look cannot keep it.
  const UNTRACED = { fee_name: "Foreign ATM Withdrawal" };

  it("should_count_a_live_fee_the_switch_takes_down_only_when_the_second_look_fails_too", () => {
    const summary = emptyAtmHeadingSummary().liveNonNetwork;
    // Two documents, one fee each. Fee 1 still traces, so the re-check would keep it as disputed; fee 2 comes down.
    replayLiveNonNetwork(summary, 200, [live(1)], [OWN], 5);
    replayLiveNonNetwork(summary, 200, [live(2, UNTRACED)], [OWN], 5);
    expect(summary).toMatchObject({ fees: 2, documents: 2, wouldLeave: 1, wouldDispute: 1, alreadyFailing: 0, byChange: { "pass->disputed": 1, "pass->fail": 1 } });
    expect(summary.samples).toEqual([expect.objectContaining({ feePublishedId: 2, off: "pass", on: "fail", secondLook: "source_trace:name_not_in_text" })]);
  });

  it("should_count_one_takedown_when_two_live_fees_on_one_key_share_a_single_read", () => {
    const summary = emptyAtmHeadingSummary().liveNonNetwork;
    // One "Balance Inquiry $0.00" line: the newer fee holds it today and the older is already a copy.
    replayLiveNonNetwork(summary, 200, [live(1, UNTRACED), live(2, UNTRACED)], [OWN], 5);
    expect(summary).toMatchObject({ fees: 2, wouldLeave: 1, alreadyFailing: 1 });
    expect(summary.samples.map((sample) => sample.feePublishedId)).toEqual([2]);
  });

  it("should_judge_each_fee_on_the_text_it_was_read_from_and_fall_back_to_the_newest", () => {
    // The document's newest text prints no marked heading: the switch changes nothing there.
    const NEWEST = text("h2", "ATM Fees\nNon-Regions ATM:\nBalance Inquiry $0.00\n", 2);
    const own = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(own, 200, [live(1, UNTRACED)], [OWN, NEWEST], 5);
    expect(own).toMatchObject({ wouldLeave: 1 });
    const newer = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(newer, 200, [live(1, { ...UNTRACED, text_hash: "h2" })], [OWN, NEWEST], 5);
    expect(newer).toMatchObject({ wouldLeave: 0, byChange: {} });
    // A fee whose own text is gone is judged on the newest, and the re-check never takes it down for it.
    const gone = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(gone, 200, [live(1, { ...UNTRACED, text_hash: "gone" })], [OWN, NEWEST], 5);
    expect(gone).toMatchObject({ wouldLeave: 0, alreadyFailing: 0 });
  });

  it("should_keep_the_review_blocker_fee_and_count_fees_with_no_text_apart", () => {
    const negated = text("h1", "ATM Fees\nRegions ATM:\nBalance Inquiry $0.00\nNot In Network ATM:\nBalance Inquiry $1.50\n");
    const kept = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(kept, 200, [live(5, { amount: 1.5 })], [negated], 5);
    expect(kept).toMatchObject({ fees: 1, wouldLeave: 0, wouldDispute: 0, alreadyFailing: 0, byChange: {} });
    const missing = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(missing, 200, [live(6)], [], 5);
    expect(missing).toMatchObject({ fees: 1, noText: 1, documents: 0 });
  });

  it("should_leave_the_switch_as_it_found_it", () => {
    judgeAtmHeadingRow(row({}), TEXAS_2416);
    expect(footnotedAtmHeadingLive()).toBe(false);
  });
});
