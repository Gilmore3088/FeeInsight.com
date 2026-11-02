import { describe, expect, it } from "vitest";

import { DASH_LIST_ROWS_LIVE } from "@/lib/agents/knox/dash-list-rows";
import { addDashDocument, DASH_LIST_NOT_REPLAYED, emptyDashListSummary, readAudience, readMatchesLive, replayDashDocument } from "./dash-list";
import type { DocumentRow, LiveFeeRow } from "./types";

// State key 10272 (Crow Wing Power CU), as `knox/dash-list-rows.test.ts` stores it. Today Knox
// publishes card_replacement $10 "Debit Card Replacement: ‍", dormant_account $30 and
// stop_payment $35 "Stop Payment (single check)" (the range's price; the bank prints $20).
const STATE_10272 = [
  "Fee Schedule",
  "Checking Fees",
  "‍$25.00 - NSF Check/ACH/ATM item",
  "$20.00 - Stop Payment (single check)",
  "$35.00 - Stop Payment (range of checks)",
  "$10.00 - Debit Card Replacement",
  "‍",
  "‍Other Service Fees",
  "‍$10.00 - Deposited Item Return",
  "$30.00 - Dormant Account (Annual Fee)",
  "$20.00 - Account Reconciliation (per hour)",
  "$50.00 - Garnishment/Levy Processing",
  "$20.00 - Wire Transfer",
  "$15.00 - Fed Global ACH",
  "$25.00 - Return Loan Payment Fee",
].join("\n");

const DOC: DocumentRow = {
  source_document_id: 7,
  institution_id: 3,
  institution_name: "Crow Wing Power CU",
  document_url: "https://cw.example/fees",
  crawled_at: "2026-09-01T00:00:00Z",
  document_stream: null,
};

function live(id: number, key: string, name: string, amount: number, overrides: Partial<LiveFeeRow> = {}): LiveFeeRow {
  return {
    fee_published_id: id,
    institution_id: 3,
    institution_name: "Crow Wing Power CU",
    canonical_fee_key: key,
    fee_name: name,
    raw_fee_name: name,
    amount,
    amount_kind: "flat",
    rate_percent: null,
    frequency: null,
    variant_type: null,
    fee_audience: "consumer",
    product_name: null,
    published_at: "2026-10-01T00:00:00Z",
    source_url: "https://cw.example/fees",
    source_document_id: 7,
    document_crawled_at: "2026-09-01T00:00:00Z",
    document_stream: null,
    document_url: "https://cw.example/fees",
    ...overrides,
  };
}

const LIVE_10272 = [
  live(1, "stop_payment", "Stop Payment (single check)", 35),
  live(2, "card_replacement", "Debit Card Replacement: ‍", 10),
  live(3, "dormant_account", "Dormant Account (Annual Fee)", 30),
  // An older read neither reading makes: context only.
  live(4, "nsf", "Old NSF", 29),
];

describe("switch dry runs: DASH_LIST_ROWS_LIVE", () => {
  // On since 2026-11-02 (sampled clean on prod, seed sw-2026-11-02); the audit still counts off against on.
  it("should_audit_a_switch_now_on", () => {
    expect(DASH_LIST_ROWS_LIVE).toBe(true);
  });

  it("should_match_a_read_to_a_live_fee_on_category_amount_and_normalized_name", () => {
    const read = { canonicalFeeKey: "card_replacement", feeName: "Debit Card Replacement", amountCents: 1000, frequency: null, excerpt: null };
    expect(readMatchesLive(read, LIVE_10272[1])).toBe(true);
    expect(readMatchesLive({ ...read, amountCents: 1500 }, LIVE_10272[1])).toBe(false);
    expect(readMatchesLive({ ...read, canonicalFeeKey: "atm_card" }, LIVE_10272[1])).toBe(false);
  });

  it("should_count_state_key_10272s_wrong_live_single_check_and_the_price_it_would_publish_beside", () => {
    const result = replayDashDocument(DOC, STATE_10272, LIVE_10272);
    expect(result.runs).toBe(2);
    expect(result.changed).toBe(true);
    // Switch on, the single check reads at its own $20, so the live $35 is no longer read. The card
    // replacement's name loses its colon, which Hamilton's normalized name already ignores.
    expect(result.lost.map((fee) => fee.feePublishedId)).toEqual([1]);
    // The older NSF read neither reading reproduces is not assessed, not called unaffected.
    expect(result.notAssessed.map((fee) => fee.feePublishedId)).toEqual([4]);
    // Six reads are new: NSF $25, single check $20, range $35, deposited item return $10,
    // account reconciliation $20 hourly, garnishment $50.
    expect(result.added.map((read) => [read.canonicalFeeKey, read.amountCents])).toEqual([
      ["nsf", 2500], ["stop_payment", 2000], ["stop_payment", 3500], ["deposited_item_return", 1000], ["account_research", 2000], ["garnishment_levy", 5000],
    ]);
    // decidePriorFee against the live fees of each category on this document: NSF $25 beside live
    // NSF $29 and single check $20 beside live $35 are additional lines; the range's $35 is identical
    // to the live $35; the other three categories have no live fee, so they are new.
    expect(result.addedByDecision).toEqual({ additional_line: 2, identical: 1, new: 3 });
    // Only the single check shares its name with a live fee at another price.
    expect(result.beside).toHaveLength(1);
    expect(result.beside[0]).toMatchObject({ feeName: "Stop Payment (single check)", amountCents: 2000, decision: "additional_line" });
    expect(result.beside[0].sameNamed.map((fee) => [fee.feePublishedId, fee.amountCents])).toEqual([[1, 3500]]);
    expect(result.watch).toEqual([
      expect.objectContaining({ readToday: true, readSwitchOn: false, switchOnCents: [2000], live: expect.objectContaining({ feePublishedId: 1 }) }),
    ]);
  });

  it("should_name_the_steps_it_does_not_replay", () => {
    expect(DASH_LIST_NOT_REPLAYED.join(" ")).toMatch(/lessons.*paid reads/);
    expect(DASH_LIST_NOT_REPLAYED.join(" ")).toMatch(/not assessed/);
  });

  // Document B of institution X: a personal schedule whose dash run today reads only the overdraft
  // line. Switch on, its "Stop Payment" $20 reads too. X's live stop payments are on document A.
  const DOC_B: DocumentRow = { ...DOC, source_document_id: 8, document_url: "https://cw.example/personal-fees" };
  const TEXT_B = ["Personal Fee Schedule", "Checking Fees", "$20.00 - Stop Payment", "$35.00 - Overdraft Fee"].join("\n");
  const onDocumentA = { source_document_id: 6, document_url: "https://cw.example/fees" };

  it("should_publish_document_bs_new_read_beside_document_as_live_price", () => {
    const result = replayDashDocument(DOC_B, TEXT_B, [live(10, "stop_payment", "Stop Payment", 35, onDocumentA)]);
    // Today: overdraft $35. Switch on: overdraft $35 and stop payment $20, so one read is new, and
    // Hamilton (no same-page copy, no identical price) decides an additional line beside A's $35.
    expect(result.added.map((read) => [read.canonicalFeeKey, read.amountCents])).toEqual([["stop_payment", 2000]]);
    expect(result.addedByDecision).toEqual({ additional_line: 1 });
    expect(result.beside.map((read) => read.sameNamed.map((fee) => fee.feePublishedId))).toEqual([[10]]);
    expect(result.lost).toEqual([]);
  });

  it("should_compare_a_new_read_only_with_live_fees_of_its_audience", () => {
    // The title makes the read a consumer fee, as Darwin decides it.
    expect(readAudience({ canonicalFeeKey: "stop_payment", feeName: "Stop Payment", amountCents: 2000, frequency: null, excerpt: "$20.00 - Stop Payment" }, DOC_B, TEXT_B)).toBe("consumer");
    // A live business $20 is outside Hamilton's prior read, so it is not "identical": the consumer
    // read still publishes beside the live consumer $35. Comparing every audience (8a80f4c) found
    // the business $20 identical and counted beside 0.
    const result = replayDashDocument(DOC_B, TEXT_B, [
      live(10, "stop_payment", "Stop Payment", 35, onDocumentA),
      live(11, "stop_payment", "Stop Payment", 20, { ...onDocumentA, fee_audience: "business" }),
    ]);
    expect(result.addedByDecision).toEqual({ additional_line: 1 });
    expect(result.beside).toHaveLength(1);
    expect(result.beside[0]).toMatchObject({ feeAudience: "consumer", amountCents: 2000 });
    expect(result.beside[0].sameNamed.map((fee) => fee.feePublishedId)).toEqual([10]);
  });

  it("should_read_nothing_more_where_no_dash_list_prints", () => {
    const result = replayDashDocument(DOC, "Fee Schedule\nStop Payment | $35.00", [live(1, "stop_payment", "Stop Payment", 35)]);
    expect(result).toMatchObject({ runs: 0, changed: false, lost: [], added: [], beside: [], watch: [] });
  });

  it("should_add_documents_into_one_summary_with_capped_samples", () => {
    const first = replayDashDocument(DOC, STATE_10272, LIVE_10272);
    const plain = replayDashDocument(DOC, "Fee Schedule\nStop Payment | $35.00", []);
    const summary = emptyDashListSummary();
    addDashDocument(summary, first, 1);
    addDashDocument(summary, plain, 1);
    addDashDocument(summary, first, 1);
    expect(summary).toMatchObject({ documentsRead: 3, documentsWithRuns: 2, documentsChanged: 2, lost: 2, notAssessed: 2, added: 12, beside: 2 });
    expect(summary.notAssessedSamples).toHaveLength(1);
    expect(summary.addedByDecision).toEqual({ additional_line: 4, identical: 2, new: 6 });
    expect(summary.lostSamples).toHaveLength(1);
    expect(summary.besideSamples).toHaveLength(1);
    expect(summary.watch).toHaveLength(2);
  });
});
