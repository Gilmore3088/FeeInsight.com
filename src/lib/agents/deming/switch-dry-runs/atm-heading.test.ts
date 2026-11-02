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

  it("should_count_every_live_non_network_fee_the_switch_on_read_no_longer_reads", () => {
    // Review of 634ce2e: the takedown count reads every live atm_non_network fee, whatever Knox hinted.
    const fee = (id: number, amount: number | null, kind: string | null = "flat"): LiveNonNetworkFeeRow =>
      ({ fee_published_id: id, institution_id: 10, institution_name: "Bank A", source_document_id: 200, fee_name: "Balance Inquiry", amount, amount_kind: kind });
    const summary = emptyAtmHeadingSummary().liveNonNetwork;
    // Read today at $0 under "Regions ATM1:" (main misses the heading); the switch reads the bank's own ATM.
    replayLiveNonNetwork(summary, [fee(1, 0), fee(2, 9), fee(3, 1.5, "percent"), fee(4, null)], OWN_MARKED, 5);
    expect(summary).toMatchObject({ fees: 4, documents: 1, wouldLeave: 1, notReadToday: 1, notDollar: 2, wouldLeaveByOnRead: { balance_inquiry: 1 } });
    expect(summary.samples).toEqual([expect.objectContaining({ feePublishedId: 1, onAtPrice: ["balance_inquiry"] })]);
    // The review's blocker: a live $1.50 under "Not In Network ATM:" stays read with the switch on.
    const negated = "ATM Fees\nRegions ATM:\nBalance Inquiry $0.00\nNot In Network ATM:\nBalance Inquiry $1.50\n";
    const kept = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(kept, [fee(5, 1.5)], negated, 5);
    expect(kept).toMatchObject({ fees: 1, wouldLeave: 0, notReadToday: 0 });
    const missing = emptyAtmHeadingSummary().liveNonNetwork;
    replayLiveNonNetwork(missing, [fee(6, 2)], null, 5);
    expect(missing).toMatchObject({ fees: 1, noText: 1, documents: 0 });
  });

  it("should_leave_the_switch_as_it_found_it", () => {
    judgeAtmHeadingRow(row({}), TEXAS_2416);
    expect(footnotedAtmHeadingLive()).toBe(false);
  });
});
