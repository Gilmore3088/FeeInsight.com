import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  FIXED_ANSWER_KEY_COHORT, FIXED_COHORT_ID, cohortKeyFingerprint, fixedCohortBriefLine, fixedCohortDays,
  readFixedCohortScore, runFixedCohortScore, scoreFixedCohort, type FrozenCohortKey,
} from "./fixed-cohort";
import type { PipelineFee } from "@/lib/agents/answer-key-score";

/** Answer key 108 (institution 8459) as stored on prod, Nov 2 2026: its mapped confirmed fees. */
const KEY_108 = {
  answerKeyId: 108, institutionId: 8459, status: "confirmed",
  contentHash: "1c803c3aa6f726e466e6bc0564f30a2fc1ff42c2cb8a57b147d860e2e7a9a25d",
  fees: ([
    [2718, "nsf", 25], [2719, "stop_payment", 20], [2720, "stop_payment", 35], [2721, "card_replacement", 10],
    [2722, "deposited_item_return", 10], [2723, "dormant_account", 30], [2724, "account_research", 20],
    [2725, "garnishment_levy", 50], [2726, "wire_domestic_outgoing", 20],
  ] as const).map(([id, canonicalKey, amount]) => ({ id, canonicalKey, amount, amountKind: "fixed", status: "confirmed" })),
};
/** Institution 8459's live dollar fees on prod, Nov 2 2026 (no rate fees). */
const LIVE_8459: PipelineFee[] = ([
  ["card_replacement", 10], ["deposited_item_return", 10], ["dormant_account", 30],
  ["garnishment_levy", 50], ["stop_payment", 20], ["stop_payment", 35],
] as const).map(([canonicalKey, amount]) => ({ canonicalKey, amount }));

const ONE: FrozenCohortKey[] = [FIXED_ANSWER_KEY_COHORT.find((row) => row.answerKeyId === 108)!];
const AT = "2026-11-02T12:41:00.000Z";

describe("the frozen cohort", () => {
  it("is the 62 confirmed answer keys of Nov 2, 2,276 scored fees, each key and institution once", () => {
    expect(FIXED_ANSWER_KEY_COHORT).toHaveLength(62);
    expect(new Set(FIXED_ANSWER_KEY_COHORT.map((row) => row.answerKeyId)).size).toBe(62);
    expect(new Set(FIXED_ANSWER_KEY_COHORT.map((row) => row.institutionId)).size).toBe(62);
    expect(FIXED_ANSWER_KEY_COHORT.reduce((total, row) => total + row.fees, 0)).toBe(2276);
    expect(FIXED_COHORT_ID).toBe("answer-key-62@2026-11-02");
  });

  it("never drifts: one digest of every frozen row (key, institution, fee count, fingerprint)", () => {
    // Changing any row, or swapping ids that keep the count and fee total, changes this digest.
    const rows = FIXED_ANSWER_KEY_COHORT.map((row) => `${row.answerKeyId}:${row.institutionId}:${row.fees}:${row.fingerprint}`).join("\n");
    expect(createHash("md5").update(rows).digest("hex")).toBe("d0be2e7ae68ebdce2e545cb76fc8614b");
  });

  it("computes the same fingerprint as the read-only SQL that froze it", () => {
    expect(cohortKeyFingerprint(KEY_108)).toBe(ONE[0].fingerprint);
    // Unmapped or unconfirmed lines are not scored, so they do not change it.
    expect(cohortKeyFingerprint({ ...KEY_108, fees: [...KEY_108.fees, { id: 9999, canonicalKey: "unmapped", amount: 5, amountKind: "fixed", status: "confirmed" }] })).toBe(ONE[0].fingerprint);
  });
});

describe("scoreFixedCohort", () => {
  it("scores institution 8459 as prod held it on Nov 2: 6 of 6 live fees right, 6 of 9 key fees live", () => {
    const score = scoreFixedCohort([KEY_108], new Map([[8459, LIVE_8459]]), AT, ONE);
    expect(score).toMatchObject({ scored: 1, unscored: 0, expected: 9, predicted: 6, matched: 6, correct: 6, precision: 1, recall: 0.6667, cohortFees: 9 });
  });

  it("counts a wrong live fee against precision and a duplicate read once", () => {
    const live = [...LIVE_8459, { canonicalKey: "nsf", amount: 30 }, { canonicalKey: "stop_payment", amount: 20.004 }];
    const score = scoreFixedCohort([KEY_108], new Map([[8459, live]]), AT, ONE);
    expect(score).toMatchObject({ predicted: 7, correct: 6, matched: 6 });
  });

  it("keeps an institution with no live fees in the score: every key fee missed", () => {
    const score = scoreFixedCohort([KEY_108], new Map([[8459, []]]), AT, ONE);
    expect(score).toMatchObject({ scored: 1, expected: 9, matched: 0, predicted: 0, precision: null, recall: 0, noLiveFees: 1 });
  });

  it("never drops an institution: an edited, missing or unreadable key is counted as unscored with its reason", () => {
    const edited = { ...KEY_108, fees: KEY_108.fees.map((fee) => (fee.id === 2718 ? { ...fee, amount: 30 } : fee)) };
    expect(scoreFixedCohort([edited], new Map([[8459, LIVE_8459]]), AT, ONE)).toMatchObject({ scored: 0, unscored: 1, unscoredByReason: { key_changed: 1 }, cohortFees: 9 });
    expect(scoreFixedCohort([], new Map([[8459, LIVE_8459]]), AT, ONE)).toMatchObject({ unscoredByReason: { key_missing: 1 } });
    expect(scoreFixedCohort([{ ...KEY_108, status: "prefilled" }], new Map(), AT, ONE)).toMatchObject({ unscoredByReason: { key_missing: 1 } });
    expect(scoreFixedCohort(null, new Map(), AT, ONE)).toMatchObject({ unscoredByReason: { read_failed: 1 } });
    const all = scoreFixedCohort([KEY_108], null, AT);
    expect(all).toMatchObject({ cohortSize: 62, scored: 0, unscored: 62, unscoredByReason: { read_failed: 62 }, precision: null, recall: null });
    expect(all.institutions).toHaveLength(62);
  });

  it("reports confirmed keys outside the frozen list without scoring them", () => {
    const extra = { ...KEY_108, answerKeyId: 999, institutionId: 1 };
    const score = scoreFixedCohort([KEY_108, extra], new Map([[8459, LIVE_8459], [1, LIVE_8459]]), AT, ONE);
    expect(score).toMatchObject({ notInCohort: 1, scored: 1, expected: 9 });
  });

  it("matches a rate fee only to a key fee keyed as varies (scorer v3)", () => {
    const varies = { ...KEY_108, fees: [{ id: 1, canonicalKey: "card_foreign_txn", amount: null, amountKind: "varies", status: "confirmed" }] };
    const frozen = [{ answerKeyId: 108, institutionId: 8459, fees: 1, fingerprint: cohortKeyFingerprint(varies) }];
    const rate = scoreFixedCohort([varies], new Map([[8459, [{ canonicalKey: "card_foreign_txn", amount: null, ratePercent: 1 }]]]), AT, frozen);
    expect(rate).toMatchObject({ predicted: 1, correct: 1, matched: 1 });
    const fixed = { ...varies, fees: [{ ...varies.fees[0], amount: 1, amountKind: "fixed" }] };
    const wrong = scoreFixedCohort([fixed], new Map([[8459, [{ canonicalKey: "card_foreign_txn", amount: null, ratePercent: 1 }]]]),
      AT, [{ ...frozen[0], fingerprint: cohortKeyFingerprint(fixed) }]);
    expect(wrong).toMatchObject({ predicted: 1, correct: 0, matched: 0 });
  });
});

describe("daily history", () => {
  const day = (at: string, correct: number, matched: number) => ({ ...scoreFixedCohort([KEY_108], new Map([[8459, LIVE_8459]]), at, ONE), correct, matched, precision: correct / 6, recall: matched / 9 });

  it("keeps the newest valid score of each day and refuses another cohort or protocol", () => {
    const days = fixedCohortDays([day("2026-11-02T08:00:00Z", 5, 5), day("2026-11-02T12:00:00Z", 6, 6), day("2026-11-03T12:00:00Z", 6, 6),
      { ...day("2026-11-04T12:00:00Z", 6, 6), cohortId: "other" }, { ...day("2026-11-05T12:00:00Z", 6, 6), protocol: 2 }, null, "x"]);
    expect(days.map((row) => [row.day, row.correct])).toEqual([["2026-11-02", 6], ["2026-11-03", 6]]);
    expect(readFixedCohortScore({ ...day(AT, 7, 6) })).toBeNull();
  });

  it("says the day's number and its move since the day before", () => {
    const latest = day("2026-11-03T12:00:00Z", 6, 6);
    const [previous] = fixedCohortDays([day("2026-11-02T12:00:00Z", 5, 5)]);
    const line = fixedCohortBriefLine({ latest, previous });
    expect(line).toContain("precision 100.0% (6 of 6 live fees match the key)");
    expect(line).toContain("recall 66.7% (6 of 9 key fees live)");
    expect(line).toContain("Since 2026-11-02: precision +16.7 pts, recall +11.1 pts.");
    expect(fixedCohortBriefLine(null)).toContain("no score recorded yet");
  });

  it("notes a different set of unscored banks even when the count is the same", () => {
    const latest = scoreFixedCohort([], new Map([[8459, LIVE_8459]]), "2026-11-03T12:00:00Z", ONE);
    expect(latest.unscored).toBe(1);
    const [base] = fixedCohortDays([day("2026-11-02T12:00:00Z", 6, 6)]);
    expect(fixedCohortBriefLine({ latest, previous: { ...base, unscored: 1, unscoredIds: [999] } })).toContain("unscored 1 both days, but a different set of banks");
    expect(fixedCohortBriefLine({ latest, previous: { ...base, unscored: 1, unscoredIds: [108] } })).not.toMatch(/both days|then, /);
  });
});

describe("runFixedCohortScore", () => {
  it("records nothing on a dry run and scores every institution unscored when the live read fails", async () => {
    const db = vi.fn(async () => { throw new Error("down"); }) as unknown as Parameters<typeof runFixedCohortScore>[0]["db"];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runFixedCohortScore({ db, keys: [KEY_108], runId: 1, stepId: 2, dryRun: true });
    spy.mockRestore();
    expect(result.eventId).toBeNull();
    expect(result.score).toMatchObject({ unscored: 62, unscoredByReason: { read_failed: 62 } });
  });

  it("records one event on the step of a real run, with the whole cohort in it", async () => {
    const statements: string[] = [];
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      statements.push(text);
      if (text.includes("published_fee_catalog")) return [{ institution_id: 8459, canonical_fee_key: "stop_payment", amount: "20.00" }];
      if (text.includes("INSERT INTO agent_run_events")) return [{ id: 77 }];
      return [];
    }) as unknown as Parameters<typeof runFixedCohortScore>[0]["db"];
    const result = await runFixedCohortScore({ db, keys: [KEY_108], runId: 1, stepId: 2, dryRun: false });
    expect(result.eventId).toBe(77);
    expect(statements.filter((text) => text.includes("INSERT"))).toHaveLength(1);
    expect(result.score).toMatchObject({ cohortSize: 62, scored: 1, unscored: 61, unscoredByReason: { key_missing: 61 }, predicted: 1, correct: 1, matched: 1 });
  });
});
