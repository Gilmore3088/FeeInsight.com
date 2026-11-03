// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));

import { chargeCause, decide, diffBank } from "./diff";
import { readShadow, reconcileBank, type LiveInput } from "./bank";
import { gradeReconciliation, scoreKeys } from "./grade";
import { nextBanks } from "./run";
import type { Evidence, SideFee } from "./types";

const fee = (over: Partial<SideFee>): SideFee => ({
  canonicalFeeKey: "nsf", feeName: "NSF Fee", amountCents: 3000, audience: "consumer", line: null, sourceDocumentId: 1, ...over,
});
const ev = (over: Partial<Evidence> = {}): Evidence => ({ currentDocument: true, answerKey: null, categoryOk: true, ...over });

const SCHEDULE = [
  "Consumer Fee Schedule",
  "Overdraft Fee | $32.00 per item",
  "Stop Payment Fee | $30.00",
  "Wire Transfer - Domestic Outgoing | $25.00",
].join("\n");

describe("diffBank", () => {
  it("classifies same, amount, category, audience, new and missing", () => {
    const live = [
      fee({ canonicalFeeKey: "overdraft", feeName: "Overdraft Fee", amountCents: 3200 }),
      fee({ canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amountCents: 2500 }),
      fee({ canonicalFeeKey: "nsf", feeName: "Returned Item Fee", amountCents: 1000 }),
      fee({ canonicalFeeKey: "wire_domestic_outgoing", feeName: "Domestic wire", amountCents: 2500, audience: "unknown" }),
      fee({ canonicalFeeKey: "paper_statement", feeName: "Paper statement", amountCents: 300 }),
    ];
    const shadow = [
      fee({ canonicalFeeKey: "overdraft", feeName: "Overdraft Fee", amountCents: 3200 }),
      fee({ canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amountCents: 3000 }),
      fee({ canonicalFeeKey: "deposited_item_return", feeName: "Returned Item Fee", amountCents: 1000 }),
      fee({ canonicalFeeKey: "wire_domestic_outgoing", feeName: "Wire Transfer - Domestic Outgoing", amountCents: 2500 }),
      fee({ canonicalFeeKey: "atm_non_network", feeName: "Foreign ATM", amountCents: 250 }),
    ];
    const kinds = diffBank(live, shadow).map((entry) => `${entry.kind}:${entry.live?.canonicalFeeKey ?? entry.shadow?.canonicalFeeKey}`);
    expect(kinds.sort()).toEqual([
      "amount_changed:stop_payment",
      "audience_changed:wire_domestic_outgoing",
      "category_changed:nsf",
      "missing_in_shadow:paper_statement",
      "new_in_shadow:atm_non_network",
      "same:overdraft",
    ]);
  });

  it("leaves a second shadow row at the same price as new, not swallowed", () => {
    const kinds = diffBank([fee({})], [fee({}), fee({ audience: "business", feeName: "Business NSF Fee" })]).map((e) => e.kind).sort();
    expect(kinds).toEqual(["new_in_shadow", "same"]);
  });

  it("puts every fee in exactly one entry", () => {
    const live = [fee({}), fee({ amountCents: 3500 }), fee({ canonicalFeeKey: "x", feeName: "Other" })];
    const shadow = [fee({}), fee({ amountCents: 1 , feeName: "Unrelated words entirely" })];
    const entries = diffBank(live, shadow);
    expect(entries.filter((e) => e.live).length).toBe(3);
    expect(entries.filter((e) => e.shadow).length).toBe(2);
  });
});

describe("decide", () => {
  it("lets the answer key decide first, only for a version it lists", () => {
    expect(decide("amount_changed", ev({ answerKey: false }), ev({ answerKey: true }))).toEqual({ winner: "shadow", rule: "answer_key" });
    expect(decide("amount_changed", ev({ answerKey: true }), ev({ answerKey: false }))).toEqual({ winner: "live", rule: "answer_key" });
    // A key that lists neither falls through to the bank's document.
    expect(decide("missing_in_shadow", ev({ answerKey: false }), null)).toEqual({ winner: "live", rule: "source_check" });
  });
  it("prefers a known audience to unknown and sends two known audiences to review", () => {
    expect(decide("audience_changed", ev({ audience: "unknown" }), ev({ audience: "consumer" }))).toEqual({ winner: "shadow", rule: "audience_evidence" });
    expect(decide("audience_changed", ev({ audience: "business" }), ev({ audience: "consumer" }))).toEqual({ winner: "review", rule: "tie" });
  });
  it("then the bank's current document, then the category guard, then a tie for review", () => {
    expect(decide("amount_changed", ev({ currentDocument: false }), ev())).toEqual({ winner: "shadow", rule: "source_check" });
    expect(decide("category_changed", ev({ categoryOk: false }), ev())).toEqual({ winner: "shadow", rule: "category_guard" });
    expect(decide("category_changed", ev(), ev())).toEqual({ winner: "review", rule: "tie" });
  });
  it("takes a live fee missing from the shadow down only when its document does not support it", () => {
    expect(decide("missing_in_shadow", ev(), null).winner).toBe("live");
    expect(decide("missing_in_shadow", ev({ currentDocument: false }), null).winner).toBe("neither");
    expect(decide("new_in_shadow", null, ev()).winner).toBe("shadow");
  });
  it("never decides by which side is newer: both unsupported and unkeyed is neither", () => {
    expect(decide("amount_changed", ev({ currentDocument: false }), ev({ currentDocument: false })).winner).toBe("neither");
  });
});

describe("chargeCause", () => {
  it("charges a stale live copy to Magellan and a shadow-only winner to Knox's old read", () => {
    const live = fee({ onSupersededCopy: true, line: "NSF Fee | $30.00" });
    expect(chargeCause({ entry: { kind: "missing_in_shadow", live, shadow: null }, winner: "neither", drops: [], currentTexts: ["nothing here"], liveHasText: true }))
      .toEqual({ step: "magellan", cause: "live_on_stale_copy" });
    expect(chargeCause({ entry: { kind: "new_in_shadow", live: null, shadow: fee({}) }, winner: "shadow", drops: [], currentTexts: [], liveHasText: true }))
      .toEqual({ step: "knox", cause: "old_read_missed" });
  });
  it("charges a winning live fee the shadow dropped to the stage that dropped it", () => {
    const live = fee({ line: "NSF Fee | $30.00" });
    const drops = [{ stage: "verify" as const, reason: "not_in_source", canonicalFeeKey: "nsf", amountCents: 3000, feeName: "NSF Fee", line: "NSF Fee | $30.00" }];
    expect(chargeCause({ entry: { kind: "missing_in_shadow", live, shadow: null }, winner: "live", drops, currentTexts: ["NSF Fee | $30.00"], liveHasText: true }))
      .toEqual({ step: "darwin", cause: "shadow_dropped:not_in_source" });
  });
});

describe("reconcileBank on a real read", () => {
  const current = [{ sourceDocumentId: 7, url: "https://bank.example/fee-schedule.pdf", text: SCHEDULE }];
  const live: LiveInput[] = [
    { ...fee({ canonicalFeeKey: "overdraft", feeName: "Overdraft Fee", amountCents: 3200, line: "Overdraft Fee | $32.00 per item", sourceDocumentId: 7 }), ownText: SCHEDULE },
    { ...fee({ canonicalFeeKey: "stop_payment", feeName: "Stop Payment Fee", amountCents: 3500, line: "Stop Payment Fee | $35.00", sourceDocumentId: 6, onSupersededCopy: true }), ownText: "Stop Payment Fee | $35.00" },
  ];
  it("reads today's pipeline in memory and decides each difference from the bank's document", () => {
    const shadow = readShadow(current);
    expect(shadow.fees.map((f) => `${f.canonicalFeeKey}:${f.amountCents}`)).toEqual(expect.arrayContaining(["overdraft:3200", "stop_payment:3000"]));
    const result = reconcileBank({ institutionId: 1, live, current, shadow, keys: null });
    expect(result.counts.same).toBeGreaterThanOrEqual(1);
    const stop = result.conflicts.find((c) => c.live?.k === "stop_payment");
    expect(stop).toMatchObject({ kind: "amount_changed", winner: "shadow", rule: "source_check", step: "magellan", cause: "live_on_stale_copy" });
    expect(result.liveLost).toBe(1);
    expect(result.liveOnSupersededCopy).toBe(1);
  });

  it("grades live and shadow on the same keys", () => {
    const shadow = readShadow(current);
    const bank = reconcileBank({ institutionId: 1, live, current, shadow, keys: null });
    const keyed = [{ institutionId: 1, expected: [
      { canonicalKey: "overdraft", amount: 32, amountKind: "fixed" as const },
      { canonicalKey: "stop_payment", amount: 30, amountKind: "fixed" as const },
    ] }];
    const grade = gradeReconciliation([bank], keyed, []);
    expect(grade.live.keys).toMatchObject({ expected: 2, matched: 1, predicted: 2, correct: 1 });
    expect(grade.shadow.keys?.matched).toBe(2);
    expect(grade.live.keysEligibleToday).toBeNull();
    expect(grade.byCause[0]).toMatchObject({ step: "magellan", cause: "live_on_stale_copy" });
  });
});

describe("scoreKeys and nextBanks", () => {
  it("scores only banks that were run", () => {
    expect(scoreKeys([{ institutionId: 2, expected: [] }], new Map())).toBeNull();
  });
  it("takes the batch's next banks in order", () => {
    expect(nextBanks([1, 2, 3, 4], new Set([2]), 2)).toEqual([1, 3]);
  });
});
