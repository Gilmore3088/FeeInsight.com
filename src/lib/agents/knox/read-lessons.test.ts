import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { FREQUENCY_FILL_CHECK } from "@/lib/agents/hamilton/frequency-fill";
import { HOURLY_CHECK } from "@/lib/agents/darwin/hourly-frequency-check";
import { HAND_TAKEDOWN_CHECK } from "@/lib/agents/hamilton/hand-takedowns";
import { CUT_NAME_DUPLICATE_CHECK, CUT_NAME_DUPLICATE_REASON } from "@/lib/agents/hamilton/cut-name-duplicates";
import { DUPLICATE_COLLAPSE_REASON_PREFIX } from "@/lib/agents/hamilton/duplicate-collapse";
import { RULE_VERDICTS } from "@/lib/agents/hamilton/eval-verdicts";
import { takedownCheck } from "@/lib/agents/learning/feedback";
import { heldDecision } from "./held-recheck";
import {
  documentReadKeys, DUPLICATE_LESSON_CHECKS, DUPLICATE_LESSON_REASONS, FREQUENCY_HOLD_CHECK, FREQUENCY_HOLD_REASON, FREQUENCY_LESSON_CHECKS,
  frequencyLessonFor, HELD_RECHECK_CHECK, holdLessonFor, KNOX_READ_LESSONS_SWITCH, promotedCandidate, promotionLessonFor,
  readLessonFlag, readLessonKey, readLessonsFrom, readLessonsLive, withFrequencyLesson, WRONG_PAYER_REASONS, type ReadLessonRow,
} from "./read-lessons";
import type { ExtractedFeeCandidate, HeldFeeCandidate } from "./rules";

const read = (feeName: string, amount: number, frequency: string | null = null): ExtractedFeeCandidate => ({
  feeName, amount, frequency, canonicalHint: "stop_payment", confidence: 0.9, excerpt: `${feeName} | $${amount.toFixed(2)}`, waivable: false,
});
const row = (changes: Partial<ReadLessonRow> & Pick<ReadLessonRow, "lesson" | "kind">): ReadLessonRow =>
  ({ feedback_id: 1, check_name: null, source_document_id: 40, fee_name: "Stop Payment", amount: "30.00", ...changes });

describe("Knox read lessons from other checks' fixes to a document's read (#2062)", () => {
  it("is off unless its switch says on", () => {
    const env = (value?: string) => (value == null ? {} : { [KNOX_READ_LESSONS_SWITCH]: value }) as NodeJS.ProcessEnv;
    expect(readLessonsLive(env())).toBe(false);
    expect(readLessonsLive(env("no"))).toBe(false);
    expect(readLessonsLive(env(" \"True\" "))).toBe(true);
    expect(readLessonsLive(env("1"))).toBe(true);
  });

  it("names each check and reason the way its writer does", () => {
    expect([...FREQUENCY_LESSON_CHECKS]).toEqual([FREQUENCY_FILL_CHECK, HOURLY_CHECK]);
    expect(FREQUENCY_HOLD_CHECK).toBe(FREQUENCY_FILL_CHECK);
    expect(takedownCheck(`${FREQUENCY_HOLD_REASON} per-event fee priced by the month`)).toBe(FREQUENCY_FILL_CHECK);
    expect([...DUPLICATE_LESSON_CHECKS]).toEqual([takedownCheck(`${DUPLICATE_COLLAPSE_REASON_PREFIX}1`), HAND_TAKEDOWN_CHECK, CUT_NAME_DUPLICATE_CHECK]);
    expect([...DUPLICATE_LESSON_REASONS]).toEqual([DUPLICATE_COLLAPSE_REASON_PREFIX, CUT_NAME_DUPLICATE_REASON]);
    expect(RULE_VERDICTS.merchant_payer).toBe("wrong_payer");
    expect(WRONG_PAYER_REASONS[1]).toBe(`${RULE_VERDICTS.merchant_payer}:`);
    expect(heldDecision({ fee_raw_id: 1, amount: 5, conditions: null }, { promotedTo: "stop_payment" }, [1], null).checkName).toBe(HELD_RECHECK_CHECK);
    expect(heldDecision({ fee_raw_id: 1, amount: 5, conditions: null }, { promotedTo: "stop_payment" }, [1], null).kind).toBe("promoted_from_held");
  });

  it("keys a lesson on the document, the name however it is spelled, and the amount in cents", () => {
    expect(readLessonKey(40, "Stop Payment", "30.00")).toBe("40|stop payment|3000");
    expect(readLessonKey(40, "STOP-PAYMENT:", 30)).toBe("40|stop payment|3000");
    expect(readLessonKey(40, "$$", 30)).toBeNull();
    expect(readLessonKey(0, "Stop Payment", 30)).toBeNull();
    expect(readLessonKey(40, "Stop Payment", null)).toBeNull();
    // Digits stay in the key: two box sizes at one price are two fees.
    expect(readLessonKey(40, "Box 3x5", 25)).toBe("40|box 3x5|2500");
    expect(readLessonKey(40, "Box 10x12", 25)).not.toBe(readLessonKey(40, "Box 3x5", 25));
  });

  it("writes the checked frequency only on a read that repeats the one the check corrected", () => {
    const lessons = readLessonsFrom([
      row({ lesson: "frequency", kind: "frequency_filled", feedback_id: 7, check_name: FREQUENCY_FILL_CHECK, freq_from: null, freq_to: "per_item" }),
      row({ lesson: "frequency", kind: "frequency_cleared", feedback_id: 8, check_name: FREQUENCY_FILL_CHECK, fee_name: "Wire Out", amount: 25, freq_from: "annual", freq_to: null }),
      // A change that set nothing new teaches nothing.
      row({ lesson: "frequency", kind: "frequency_corrected", feedback_id: 9, fee_name: "Same", freq_from: "monthly", freq_to: "monthly" }),
    ]);
    expect(lessons.loaded).toEqual({ frequency: 2 });
    const blank = read("Stop payment", 30);
    const lesson = frequencyLessonFor(blank, lessons, 40)!;
    expect(lesson).toMatchObject({ feedbackId: 7, from: null, to: "per_item" });
    expect(withFrequencyLesson(blank, lesson).frequency).toBe("per_item");
    // A read that now states a frequency of its own, or another document, is untouched.
    expect(frequencyLessonFor(read("Stop Payment", 30, "monthly"), lessons, 40)).toBeNull();
    expect(frequencyLessonFor(blank, lessons, 41)).toBeNull();
    // A neighbour's period cleared: the read that takes it again is written with none.
    const cleared = frequencyLessonFor(read("Wire Out", 25, "annual"), lessons, 40)!;
    expect(withFrequencyLesson(read("Wire Out", 25, "annual"), cleared).frequency).toBeNull();
    expect(frequencyLessonFor(read("Wire Out", 25, "per_item"), lessons, 40)).toBeNull();
  });

  it("holds a wrong payer's read, a frequency hold's read with the held period, and Knox's own duplicate beside its kept name", () => {
    const lessons = readLessonsFrom([
      row({ lesson: "hold", kind: "wrong_payer", feedback_id: 1, check_name: "hamilton.eval_verdict", fee_name: "Official Bank Check (Non-Customers)", amount: 20, fee_published_id: 101 }),
      row({ lesson: "hold", kind: "frequency_held", feedback_id: 2, check_name: FREQUENCY_FILL_CHECK, fee_name: "NSF Fee", amount: 23, freq_from: "monthly", fee_published_id: 102 }),
      row({ lesson: "hold", kind: "duplicate", feedback_id: 3, check_name: "hamilton.duplicate_collapse", fee_name: "Wire outgoing foreign | /mo.", amount: 40,
        keeper_name: "Wire outgoing foreign", fee_published_id: 103, keeper_published_id: 203 }),
      // Not Knox's duplicate: no live kept twin on the document, or the same name (a re-read of one line).
      row({ lesson: "hold", kind: "duplicate", feedback_id: 4, fee_name: "Stop Payment", amount: 30, keeper_name: null, fee_published_id: 104 }),
      row({ lesson: "hold", kind: "duplicate", feedback_id: 5, fee_name: "Gift Card", amount: 4.5, keeper_name: "GIFT CARD", fee_published_id: 105, keeper_published_id: 205 }),
      row({ lesson: "hold", kind: "duplicate", feedback_id: 6, fee_name: "Coin Count", amount: 5, keeper_name: "Coin Counting", fee_published_id: 106, keeper_published_id: null }),
      // A hold whose taken-down fee is not named cannot be re-checked at insert, so it teaches nothing.
      row({ lesson: "hold", kind: "wrong_payer", feedback_id: 7, fee_name: "Money Order (Non-Customer)", amount: 3, fee_published_id: null }),
    ]);
    expect(lessons.loaded).toEqual({ wrong_payer: 1, frequency_held: 1, duplicate: 1 });
    const none = new Set<string>();
    expect(holdLessonFor(read("Official Bank Check (Non Customers)", 20), lessons, 40, none)).toMatchObject({ kind: "wrong_payer", check: "hamilton.eval_verdict" });
    expect(holdLessonFor(read("Official Bank Check (Non-Customers)", 7), lessons, 40, none)).toBeNull();
    expect(holdLessonFor(read("NSF Fee", 23, "monthly"), lessons, 40, none)).toMatchObject({ kind: "frequency_held", check: FREQUENCY_FILL_CHECK });
    expect(holdLessonFor(read("NSF Fee", 23, "per_item"), lessons, 40, none)).toBeNull();
    // The duplicate is held only when the same text reads the kept name at the same amount.
    const dup = read("Wire outgoing foreign | /mo.", 40);
    expect(holdLessonFor(dup, lessons, 40, none)).toBeNull();
    expect(holdLessonFor(dup, lessons, 40, documentReadKeys([dup, read("Wire Outgoing Foreign", 41)]))).toBeNull();
    expect(holdLessonFor(dup, lessons, 40, documentReadKeys([dup, read("Wire Outgoing Foreign", 40)]))).toMatchObject({ kind: "duplicate", feedbackId: 3 });
    expect(holdLessonFor(read("Stop Payment", 30), lessons, 40, documentReadKeys([read("Stop Payment", 30)]))).toBeNull();
    expect(readLessonFlag("duplicate")).toBe("knox_lesson:read:duplicate");
  });

  it("files a held line the document's earlier read promoted, and Darwin verified, under the verified category", () => {
    const lessons = readLessonsFrom([
      row({ lesson: "promotion", kind: "promoted_from_held", feedback_id: 6, fee_name: "Courtesy Pay", amount: 30, category: "overdraft" }),
      row({ lesson: "promotion", kind: "promoted_from_held", feedback_id: 5, fee_name: "Courtesy Pay", amount: 30, category: "nsf" }),
    ]);
    expect(lessons.loaded).toEqual({ promoted_from_held: 1 });
    const held: HeldFeeCandidate = { shape: "unclassified", feeName: "Courtesy Pay", amount: 30, amountMax: null, percent: null, frequency: "per_item", canonicalHint: null, excerpt: "Courtesy Pay | $30.00 per item" };
    const lesson = promotionLessonFor(held, lessons, 40)!;
    expect(lesson).toEqual({ feedbackId: 6, category: "overdraft" });
    const candidate = promotedCandidate(held, lesson);
    expect(candidate).toMatchObject({ feeName: "Courtesy Pay", amount: 30, frequency: "per_item", canonicalHint: "overdraft", excerpt: held.excerpt, waivable: false });
    expect(candidate).not.toHaveProperty("shape");
    // A range, a categorized hold, another amount or another document is not taught.
    expect(promotionLessonFor({ ...held, shape: "range" }, lessons, 40)).toBeNull();
    expect(promotionLessonFor({ ...held, canonicalHint: "overdraft" }, lessons, 40)).toBeNull();
    expect(promotionLessonFor({ ...held, amount: 35 }, lessons, 40)).toBeNull();
    expect(promotionLessonFor(held, lessons, 41)).toBeNull();
  });
});
