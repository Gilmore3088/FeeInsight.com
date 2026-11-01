import { describe, expect, it } from "vitest";

import { excerptOnlyHold, excerptOnlyTakedownCode, summarizeExcerptAtPublish } from "./excerpt-at-publish";
import type { LimitRow, LimitTakedownRow } from "./types";

const excerpt = (line: string) => `Knox deterministic extraction. excerpt="${line}"`;

function limitRow(id: number, key: string, name: string, amount: number, conditions: string | null): LimitRow {
  return { fee_published_id: id, institution_id: 10, institution_name: "Bank A", source_document_id: 100, canonical_fee_key: key, fee_name: name, amount, conditions };
}

function takedown(id: number, reason: string): LimitTakedownRow {
  return { fee_published_id: id, institution_id: 10, institution_name: "Bank A", canonical_fee_key: "zelle_fee", fee_name: "Zelle", amount: 150, rolled_back_reason: reason };
}

const LIVE: LimitRow[] = [
  // Held only with the excerpt: $150 is under Zelle's $250 ceiling, and the excerpt says "Limit".
  limitRow(1, "zelle_fee", "Zelle", 150, excerpt("Zelle | $150 Limit")),
  limitRow(2, "wire_domestic_outgoing", "Wire Transfer", 500, excerpt("Wire Transfer | $500 daily limit")),
  limitRow(3, "nsf", "Paid Item Fee", 17, excerpt("the Paid Item Fee for the check/item in the amount of $17 would be waived")),
  // Held without the excerpt too (over Zelle's ceiling): publish already holds it, not counted.
  limitRow(4, "zelle_fee", "Zelle", 1000, excerpt("Zelle | $1,000 Limit")),
  // A price: held neither way.
  limitRow(5, "wire_domestic_outgoing", "Wire Transfer", 125, excerpt("Wire Transfer | $125.00")),
  // No excerpt stored: nothing to read.
  limitRow(6, "wire_domestic_outgoing", "Wire Transfer", 500, null),
];

describe("switch dry runs: excerpt-at-publish", () => {
  it("should_hold_only_what_the_excerpt_alone_shows_is_a_limit", () => {
    expect(excerptOnlyHold(LIVE[0])?.code).toBe("source_states_limit");
    expect(excerptOnlyHold(LIVE[1])?.code).toBe("source_states_limit");
    expect(excerptOnlyHold(LIVE[2])?.code).toBe("transaction_amount");
    for (const row of LIVE.slice(3)) expect(excerptOnlyHold(row), String(row.fee_published_id)).toBeNull();
  });

  it("should_read_the_excerpt_only_codes_from_a_takedown_reason", () => {
    expect(excerptOnlyTakedownCode("limit_as_fee:source_states_limit: the source states $150 as a limit")).toBe("source_states_limit");
    expect(excerptOnlyTakedownCode("limit_as_fee:transaction_amount: the source gives $17 as a transaction's amount, not a price")).toBe("transaction_amount");
    expect(excerptOnlyTakedownCode("limit_as_fee:above_category_ceiling: $1000 is a transfer or load limit")).toBeNull();
    expect(excerptOnlyTakedownCode("source_check_untraceable")).toBeNull();
  });

  it("should_count_live_holds_and_past_takedowns_once_each", () => {
    const takedowns = [
      takedown(20, "limit_as_fee:source_states_limit: the source states $150 as a limit"),
      // The same fee listed twice counts once.
      takedown(20, "limit_as_fee:source_states_limit: the source states $150 as a limit"),
      takedown(21, "limit_as_fee:transaction_amount: the source gives $17 as a transaction's amount, not a price"),
      takedown(22, "limit_as_fee:name_states_limit: the name states a limit"),
    ];
    const summary = summarizeExcerptAtPublish(LIVE, takedowns, 2);
    expect(summary.liveChecked).toBe(6);
    expect(summary.liveHeld).toBe(3);
    expect(summary.liveByCode).toEqual({ source_states_limit: 2, transaction_amount: 1 });
    expect(summary.liveSamples.map((hold) => hold.feePublishedId)).toEqual([1, 2]);
    expect(summary.takenDown).toBe(2);
    expect(summary.takenDownByCode).toEqual({ source_states_limit: 1, transaction_amount: 1 });
    expect(summary.takenDownSamples.map((row) => row.feePublishedId)).toEqual([20, 21]);
  });
});
