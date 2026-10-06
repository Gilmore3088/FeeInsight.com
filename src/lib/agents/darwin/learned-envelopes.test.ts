import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  darwinEnvelopeFor,
  LEARNED_ENVELOPE_MIN_INSTITUTIONS,
  learnedEnvelope,
  loadLearnedEnvelopes,
  resetLearnedEnvelopeCache,
} from "./learned-envelopes";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function dbReturning(rows: unknown[] | Error): DbMock {
  const db = vi.fn() as DbMock;
  db.unsafe = vi.fn(() => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)));
  return db;
}

describe("learned amount ceilings", () => {
  beforeEach(() => resetLearnedEnvelopeCache());

  it("caps at three times the per-bank 95th percentile and keeps the $0.01 floor", () => {
    expect(learnedEnvelope("document_reproduction", 7.5, 1301)).toMatchObject({ min: 0.01, max: 22.5 });
    expect(learnedEnvelope("check_cashing", 2000, 707)?.max).toBe(2500);
  });

  it("learns only for categories with no hand-set range, enough banks, and outside lending", () => {
    expect(learnedEnvelope("overdraft", 35, 1564)).toBeNull();
    expect(learnedEnvelope("other_lending_fee", 134, 270)).toBeNull();
    expect(learnedEnvelope("coin_counting", 91, LEARNED_ENVELOPE_MIN_INSTITUTIONS - 1)).toBeNull();
    expect(learnedEnvelope("coin_counting", 0, 48)).toBeNull();
  });

  it("prefers the hand-set range, then the learned one, then the catch-all", () => {
    const learned = new Map([["bill_pay", learnedEnvelope("bill_pay", 30, 464)!]]);
    expect(darwinEnvelopeFor("overdraft", learned)).toMatchObject({ min: 5, max: 60, source: "hand" });
    expect(darwinEnvelopeFor("bill_pay", learned)).toMatchObject({ min: 0.01, max: 90, source: "learned" });
    expect(darwinEnvelopeFor("notary_fee", learned)).toMatchObject({ min: 0.01, max: 2500, source: "default" });
  });

  it("reads the live catalog once an hour and keeps the last good ranges on a failed read", async () => {
    const db = dbReturning([
      { canonical_fee_key: "bill_pay", p95: "30", institutions: "464" },
      { canonical_fee_key: "overdraft", p95: "35", institutions: "1564" },
    ]);
    const first = await loadLearnedEnvelopes(db as never, 0);
    expect(Array.from(first.keys())).toEqual(["bill_pay"]);
    expect(String(db.unsafe.mock.calls[0][0])).toContain("FROM published_fee_catalog");

    await loadLearnedEnvelopes(db as never, 30 * 60 * 1000);
    expect(db.unsafe).toHaveBeenCalledTimes(1);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const later = await loadLearnedEnvelopes(dbReturning(new Error("db down")) as never, 2 * 60 * 60 * 1000);
    spy.mockRestore();
    expect(later.get("bill_pay")?.max).toBe(90);
  });

  it("returns no ranges when the first read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const envelopes = await loadLearnedEnvelopes(dbReturning(new Error("db down")) as never, 0);
    spy.mockRestore();
    expect(envelopes.size).toBe(0);
  });
});
