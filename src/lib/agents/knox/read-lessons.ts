import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { confidenceFor, type ExtractedFeeCandidate, type HeldFeeCandidate } from "./rules";
import { KNOX_READ_LESSONS_SWITCH, readLessonsLive } from "./read-lessons-switch";

export { KNOX_READ_LESSONS_SWITCH, readLessonsLive };

type SqlTag = typeof sql;

/**
 * Knox's read lessons (#2062): the feedback kinds other agents file against a fee Knox read, each read
 * back as a lesson about that one document's read, keyed like the audience lessons on the document,
 * the name and the amount in cents. The name key keeps digits (`readLessonName`): a box rent "3x5" and
 * "10x12" at one price are two fees, though `lessonName` would make them one. Before this the rows
 * were written and nothing read them, so a re-read of the document made the same read again and the same check had to fix it again.
 *
 * - frequency (`frequency_filled`, `frequency_corrected`, `frequency_cleared`; Hamilton's frequency fill
 *   and Darwin's hourly check): the check set the live fee's frequency from `from` (Knox's read) to `to`.
 *   A read of the same name and amount on that document that again gives `from` is written with `to`.
 *   Only a change still on the live row teaches (its frequency is still `to`), so a reversed change
 *   or a later version's different answer does not. A read that now gives anything else is untouched.
 * - hold (`wrong_payer`, `frequency_held`, `duplicate`): the fee is still down for that reason, so the
 *   same read is written held for review (`knox_review:taken_down`, never sent to Darwin), as the
 *   limit guard's takedown lessons are:
 *   - `wrong_payer`: the eval verdict (or the merchant-payer rule, `wrong_payer:merchant_payer`) found a
 *     price the customer does not pay ("Official Bank Check (Non-Customers)" $20).
 *   - `frequency_held`: the fill took the fee down because its own price states a period the fee
 *     cannot have (an NSF fee "$23.00/Month"); only a read that again gives that period is held.
 *   - `duplicate`: only Knox's own duplicate teaches, one printed fee read under two names on one
 *     document ("Wire outgoing foreign | /mo." beside "Wire outgoing foreign", both $40), whose kept
 *     twin is on the same document at the same amount under another name and is still live. The read
 *     is held only when
 *     the same text also reads the kept name at that amount, so the fee itself is still read. A
 *     collapse across documents (of the 13,061 extract-stage collapse rows on 2026-10-27, 10,491 kept
 *     a fee of the same name and amount on another document) is the collapse working on two
 *     copies of a page, and a same-name collapse is a re-read of the same line: neither is Knox's
 *     error, and neither teaches here (the collapse and Magellan's current copy own them).
 * - promotion (`promoted_from_held`, Knox's held recheck): a line the full read held as unclassified,
 *   which the recheck later filed and Darwin verified (and whose fee is live), is the fee Darwin
 *   verified. A held read of that name and amount on that document, still unclassified, is written as
 *   a candidate under the verified category instead of waiting for the next recheck pass. Darwin
 *   checks it like any other read.
 *
 * Every lesson changes what a re-read writes, so it applies only with `KNOX_READ_LESSONS_LIVE` on. Off,
 * the extract step still loads the lessons and counts the reads each would change
 * (`readLessonMatches`), the live dry run. A lesson never touches a row already written: the raw
 * dedupe key keeps an existing read, so a lesson reaches only a newly written read. A hold is written
 * only while its fee is still down for its reason (and a duplicate's kept twin is still live), checked
 * in the insert statement itself under a share lock (extract.ts `writeCandidate`; `holdLessonStands`), as the takedown lessons' v2
 * proof is current at insertion (#2186); when it no longer stands the read goes the ordinary way.
 *
 * Dry run 2026-10-27 (SELECT on prod with this file's loader rules and name key; the PR body has the SQL):
 * - frequency: 11,459 rows (10,468 filled, 526 corrected, 465 cleared) on fees still live teach 11,452
 *   lessons on 3,864 documents at 3,121 banks; no other live fee repeats a lesson's `from`.
 * - hold: 4 wrong-payer lessons on 4 documents; 66 frequency-hold rows teach 40 lessons on 40
 *   documents; 129 same-document duplicate rows with a live kept twin teach 92 lessons on 75 documents.
 *   No live fee repeats a wrong-payer or frequency-hold lesson; 4 live fees repeat a duplicate lesson's
 *   name and amount, 3 of them beside their live kept twin.
 * - promotion: 940 lessons on 721 documents at 687 banks; 9 of their lines are held today.
 * Switching on takes no live fee down and re-files none: it changes only new raw reads, and a re-read
 * reaches only a read that is not already stored.
 * Deterministic: no provider call.
 */
export const KNOX_READ_LESSONS_VERSION = 1;
/** Lessons read per extract step: a step reads at most a few hundred documents. */
const READ_LESSON_LIMIT = 20000;

/** The checks whose rows teach, as they write them (pinned to each check's constant in the test). */
export const FREQUENCY_LESSON_CHECKS = ["hamilton.frequency_fill", "darwin.hourly_frequency_check"] as const;
export const FREQUENCY_HOLD_CHECK = "hamilton.frequency_fill";
export const FREQUENCY_HOLD_REASON = "frequency_hold:";
/** Reason prefixes of a wrong-payer takedown: the eval's critical, and the rule's or a hand check's `wrong_payer:<rule>`. */
export const WRONG_PAYER_REASONS = ["eval_critical:wrong_payer", "wrong_payer:"] as const;
export const DUPLICATE_LESSON_CHECKS = ["hamilton.duplicate_collapse", "hamilton.hand_takedown", "hamilton.cut_name_duplicate"] as const;
export const DUPLICATE_LESSON_REASONS = ["duplicate of #", "cut_name_duplicate"] as const;
export const HELD_RECHECK_CHECK = "knox.held_recheck";
/** Darwin's statuses for a verified row (`review_status`). */
export const VERIFIED_STATUSES = ["verified", "approved"] as const;

export type ReadLessonKind = "frequency" | "wrong_payer" | "frequency_held" | "duplicate" | "promoted_from_held";
export type HoldLessonKind = Extract<ReadLessonKind, "wrong_payer" | "frequency_held" | "duplicate">;

export interface FrequencyLesson { feedbackId: number; check: string; from: string | null; to: string | null }
export interface HoldLesson {
  feedbackId: number;
  kind: HoldLessonKind;
  /** The taken-down fee; the hold is written only while it is still down for its reason. */
  publishedId: number;
  /** duplicate: the kept twin's live fee; the hold is written only while it is still live. */
  keeperPublishedId?: number;
  /** The check the held read is filed under (`knox_lesson:taken_down:<check>`). */
  check: string;
  /** frequency_held: the period the fill held; only a read that gives it again is held. */
  frequency?: string | null;
  /** duplicate: the kept twin's name key on the same document at the same amount. */
  keeper?: string;
}
export interface PromotionLesson { feedbackId: number; category: string }

export interface ReadLessons {
  frequency: Map<string, FrequencyLesson>;
  holds: Map<string, HoldLesson[]>;
  promotions: Map<string, PromotionLesson>;
  /** Lessons loaded, by kind. */
  loaded: Partial<Record<ReadLessonKind, number>>;
  readFailed?: boolean;
}

export function emptyReadLessons(): ReadLessons {
  return { frequency: new Map(), holds: new Map(), promotions: new Map(), loaded: {} };
}

export function readLessonCount(lessons: ReadLessons): number {
  return Object.values(lessons.loaded).reduce((total, n) => total + (n ?? 0), 0);
}

/** Cents, so 2 and "2.00" are one amount; null for no usable amount. */
const cents = (amount: unknown): number | null => {
  const value = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : NaN;
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};
/** The name key: lowercase letters and digits, single spaces. Same as `nameKeySql`. */
export function readLessonName(feeName: string): string {
  return feeName.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
/** `<source_document_id>|<name key>|<cents>`, or null when the read has no name key or amount. */
export function readLessonKey(sourceDocumentId: number, feeName: string | null | undefined, amount: unknown): string | null {
  const name = feeName ? readLessonName(feeName) : "", value = cents(amount);
  if (!name || value == null || !Number.isSafeInteger(sourceDocumentId) || sourceDocumentId <= 0) return null;
  return `${sourceDocumentId}|${name}|${value}`;
}
/** A frequency as Knox writes it: blank is none. */
const frequencyOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export interface ReadLessonRow {
  lesson: "frequency" | "hold" | "promotion";
  feedback_id: number | string;
  kind: string;
  check_name: string | null;
  source_document_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  /** frequency: the read's and the check's values; frequency_held: the held period. */
  freq_from?: string | null;
  freq_to?: string | null;
  /** hold: the taken-down fee. */
  fee_published_id?: number | string | null;
  /** duplicate: the kept twin's raw name and live fee, when it is on the same document at the same amount. */
  keeper_name?: string | null;
  keeper_published_id?: number | string | null;
  /** promotion: the category Darwin verified. */
  category?: string | null;
}

const count = (lessons: ReadLessons, kind: ReadLessonKind) => { lessons.loaded[kind] = (lessons.loaded[kind] ?? 0) + 1; };

/** Pure: the lessons a set of feedback rows teach. The newest row per key wins (rows come newest first). */
export function readLessonsFrom(rows: readonly ReadLessonRow[]): ReadLessons {
  const lessons = emptyReadLessons();
  for (const row of rows) {
    const feedbackId = Number(row.feedback_id);
    const key = readLessonKey(Number(row.source_document_id), row.fee_name, row.amount);
    if (!key || !Number.isSafeInteger(feedbackId)) continue;
    if (row.lesson === "frequency") {
      const from = frequencyOf(row.freq_from), to = frequencyOf(row.freq_to);
      if (from === to || lessons.frequency.has(key)) continue;
      lessons.frequency.set(key, { feedbackId, check: row.check_name ?? "", from, to });
      count(lessons, "frequency");
    } else if (row.lesson === "promotion") {
      if (!row.category || lessons.promotions.has(key)) continue;
      lessons.promotions.set(key, { feedbackId, category: row.category });
      count(lessons, "promoted_from_held");
    } else {
      const kind = row.kind as HoldLessonKind;
      if (kind !== "wrong_payer" && kind !== "frequency_held" && kind !== "duplicate") continue;
      const publishedId = Number(row.fee_published_id);
      if (!Number.isSafeInteger(publishedId) || publishedId <= 0) continue;
      let lesson: HoldLesson;
      if (kind === "duplicate") {
        const keeper = row.keeper_name ? readLessonName(row.keeper_name) : "";
        const keeperPublishedId = Number(row.keeper_published_id);
        // Only Knox's own duplicate: a live kept twin on the same document, same amount, another name.
        if (!keeper || keeper === readLessonName(row.fee_name ?? "") || !Number.isSafeInteger(keeperPublishedId) || keeperPublishedId <= 0) continue;
        lesson = { feedbackId, kind, publishedId, check: row.check_name ?? "hamilton.duplicate_collapse", keeper, keeperPublishedId };
      } else if (kind === "frequency_held") {
        lesson = { feedbackId, kind, publishedId, check: row.check_name ?? FREQUENCY_HOLD_CHECK, frequency: frequencyOf(row.freq_from) };
      } else {
        lesson = { feedbackId, kind, publishedId, check: row.check_name ?? "hamilton.eval_verdict" };
      }
      const group = lessons.holds.get(key) ?? [];
      if (group.some((item) => item.kind === kind && item.keeper === lesson.keeper && item.frequency === lesson.frequency)) continue;
      group.push(lesson);
      lessons.holds.set(key, group);
      count(lessons, kind);
    }
  }
  return lessons;
}

/** The name key in SQL, as `readLessonName` computes it. */
export const nameKeySql = (column: string) => `btrim(regexp_replace(regexp_replace(lower(${column}), '[^a-z0-9 ]+', ' ', 'g'), '\\s+', ' ', 'g'))`;

/** The takedown reason prefixes that keep a hold lesson standing. */
export function holdLessonReasons(kind: HoldLessonKind): readonly string[] {
  return kind === "wrong_payer" ? WRONG_PAYER_REASONS : kind === "frequency_held" ? [FREQUENCY_HOLD_REASON] : DUPLICATE_LESSON_REASONS;
}

/**
 * Whether a hold lesson still stands: its fee still down for its reason, and a duplicate's kept twin
 * still live. The hold's own insert (`writeCandidate` in extract.ts) checks the same condition in its
 * statement, share-locking both rows, so a restore that commits first is seen and one that comes later
 * waits for the insert. This copy tells an existing row from a lesson gone when the insert wrote nothing.
 */
export async function holdLessonStands(db: SqlTag, lesson: HoldLesson): Promise<boolean> {
  const [row] = await db<Array<{ ok: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM published_fee_records lesson_fee
                    WHERE lesson_fee.fee_published_id = ${lesson.publishedId}::bigint
                      AND lesson_fee.rolled_back_at IS NOT NULL
                      AND EXISTS (SELECT 1 FROM unnest(${[...holdLessonReasons(lesson.kind)]}::text[]) AS reason(prefix)
                                   WHERE left(lesson_fee.rolled_back_reason, length(reason.prefix)) = reason.prefix))
       AND (${lesson.keeperPublishedId ?? null}::bigint IS NULL
            OR EXISTS (SELECT 1 FROM published_fee_records kept_fee
                        WHERE kept_fee.fee_published_id = ${lesson.keeperPublishedId ?? null}::bigint
                          AND kept_fee.rolled_back_at IS NULL)) AS ok`;
  return row?.ok === true;
}

/**
 * The feedback that teaches these documents' reads. Read-only; a failed read returns no lessons
 * (`readFailed`) and never blocks the step.
 */
export async function loadReadLessons(db: SqlTag, sourceDocumentIds: readonly number[]): Promise<ReadLessons> {
  const ids = [...new Set(sourceDocumentIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return emptyReadLessons();
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await feedbackSchemaReady(scope))) return emptyReadLessons();
      const rows = await scope<ReadLessonRow[]>`
        SELECT 'frequency' AS lesson, f.id AS feedback_id, f.kind, f.check_name, fr.source_document_id, fr.fee_name, fr.amount,
               f.evidence->>'from' AS freq_from, f.evidence->>'to' AS freq_to, NULL::bigint AS fee_published_id,
               NULL::text AS keeper_name, NULL::bigint AS keeper_published_id, NULL::text AS category
          FROM pipeline_feedback f
          JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
          LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          -- The row's own raw read when it names one (the fill does; the hourly check names the live fee only).
          JOIN raw_fee_observations fr ON fr.fee_raw_id = COALESCE(f.fee_raw_id, fv.fee_raw_id)
         WHERE f.kind IN ('frequency_filled', 'frequency_corrected', 'frequency_cleared')
           AND f.about_stage = 'extract'
           AND f.check_name = ANY(${[...FREQUENCY_LESSON_CHECKS]}::text[])
           -- Still live and still the live row's frequency: a reversed or superseded change teaches nothing.
           AND fp.rolled_back_at IS NULL
           AND fp.frequency IS NOT DISTINCT FROM (f.evidence->>'to')
           AND fr.source = 'knox'
           AND fr.source_document_id = ANY(${ids}::bigint[])
        UNION ALL
        SELECT 'hold', f.id, f.kind, f.check_name, fr.source_document_id, fr.fee_name, fr.amount,
               CASE WHEN f.kind = 'frequency_held' THEN f.evidence->>'from' END, NULL, fp.fee_published_id,
               keeper.fee_name, keeper.fee_published_id, NULL
          FROM pipeline_feedback f
          JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
          LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = COALESCE(f.fee_raw_id, fv.fee_raw_id)
          -- A duplicate's kept twin: the fee its reason names ("duplicate of #k", "... live fee #k"), still
          -- live, read from the same document at the same amount under another name.
          LEFT JOIN LATERAL (
            SELECT kr.fee_name, kp.fee_published_id
              FROM published_fee_records kp
              JOIN verified_fee_observations kv ON kv.fee_verified_id = kp.lineage_ref
              JOIN raw_fee_observations kr ON kr.fee_raw_id = kv.fee_raw_id
             WHERE f.kind = 'duplicate'
               AND kp.fee_published_id = substring(fp.rolled_back_reason FROM '#([0-9]{1,18})')::bigint
               AND kp.rolled_back_at IS NULL
               AND kr.source_document_id = fr.source_document_id
               AND kr.amount = fr.amount
               AND ${scope.unsafe(nameKeySql("kr.fee_name"))} <> ${scope.unsafe(nameKeySql("fr.fee_name"))}
             LIMIT 1) keeper ON TRUE
         WHERE fp.rolled_back_at IS NOT NULL
           AND fr.source = 'knox'
           AND fr.source_document_id = ANY(${ids}::bigint[])
           AND ((f.kind = 'wrong_payer' AND (left(fp.rolled_back_reason, ${WRONG_PAYER_REASONS[0].length}) = ${WRONG_PAYER_REASONS[0]}
                                          OR left(fp.rolled_back_reason, ${WRONG_PAYER_REASONS[1].length}) = ${WRONG_PAYER_REASONS[1]}))
             OR (f.kind = 'frequency_held' AND f.check_name = ${FREQUENCY_HOLD_CHECK}
                 AND left(fp.rolled_back_reason, ${FREQUENCY_HOLD_REASON.length}) = ${FREQUENCY_HOLD_REASON})
             OR (f.kind = 'duplicate' AND f.about_stage = 'extract' AND f.check_name = ANY(${[...DUPLICATE_LESSON_CHECKS]}::text[])
                 AND (left(fp.rolled_back_reason, ${DUPLICATE_LESSON_REASONS[0].length}) = ${DUPLICATE_LESSON_REASONS[0]}
                   OR left(fp.rolled_back_reason, ${DUPLICATE_LESSON_REASONS[1].length}) = ${DUPLICATE_LESSON_REASONS[1]})))
        UNION ALL
        SELECT 'promotion', f.id, f.kind, f.check_name, f.source_document_id, f.evidence->>'fee_name', f.amount,
               NULL, NULL, NULL, NULL, NULL, fv.canonical_fee_key
          FROM pipeline_feedback f
          -- Darwin's latest verdict on the promoted line: it must be a verification, and its fee live.
          JOIN LATERAL (
            SELECT v.fee_verified_id, v.canonical_fee_key, v.review_status
              FROM verified_fee_observations v
             WHERE v.fee_raw_id = f.fee_raw_id
             ORDER BY v.fee_verified_id DESC
             LIMIT 1) fv ON fv.review_status = ANY(${[...VERIFIED_STATUSES]}::text[])
         WHERE f.kind = 'promoted_from_held'
           AND f.check_name = ${HELD_RECHECK_CHECK}
           AND f.source_document_id = ANY(${ids}::bigint[])
           AND EXISTS (SELECT 1 FROM published_fee_records fp WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL)
         ORDER BY feedback_id DESC
         LIMIT ${READ_LESSON_LIMIT}`;
      return readLessonsFrom(rows);
    });
  } catch (error) {
    console.error("loadReadLessons failed:", error);
    return { ...emptyReadLessons(), readFailed: true };
  }
}

export function readLessonFlag(kind: ReadLessonKind): string {
  return `knox_lesson:read:${kind}`;
}

/** Pure: the frequency lesson for a read that gives the frequency the check corrected. */
export function frequencyLessonFor(candidate: ExtractedFeeCandidate, lessons: ReadLessons, sourceDocumentId: number): FrequencyLesson | null {
  const key = readLessonKey(sourceDocumentId, candidate.feeName, candidate.amount);
  const lesson = key == null ? undefined : lessons.frequency.get(key);
  return lesson && frequencyOf(candidate.frequency) === lesson.from ? lesson : null;
}

/** The read with the lesson's frequency. */
export function withFrequencyLesson(candidate: ExtractedFeeCandidate, lesson: FrequencyLesson): ExtractedFeeCandidate {
  return { ...candidate, frequency: lesson.to };
}

/**
 * Pure: the hold lesson for a read. `documentReads` is the name keys this text reads at each amount
 * (`documentReadKeys`): a duplicate is held only when the text also reads its kept name at that amount.
 */
export function holdLessonFor(candidate: ExtractedFeeCandidate, lessons: ReadLessons, sourceDocumentId: number, documentReads: ReadonlySet<string>): HoldLesson | null {
  const key = readLessonKey(sourceDocumentId, candidate.feeName, candidate.amount);
  const group = key == null ? undefined : lessons.holds.get(key);
  if (!group) return null;
  const amount = cents(candidate.amount);
  for (const lesson of group) {
    if (lesson.kind === "wrong_payer") return lesson;
    if (lesson.kind === "frequency_held" && frequencyOf(candidate.frequency) === (lesson.frequency ?? null)) return lesson;
    if (lesson.kind === "duplicate" && lesson.keeper && documentReads.has(`${lesson.keeper}|${amount}`)) return lesson;
  }
  return null;
}

/** The name keys a text's reads give, at their amounts: `<name key>|<cents>`. */
export function documentReadKeys(candidates: readonly ExtractedFeeCandidate[]): Set<string> {
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const name = readLessonName(candidate.feeName), amount = cents(candidate.amount);
    if (name && amount != null) keys.add(`${name}|${amount}`);
  }
  return keys;
}

/** Pure: the promotion lesson for a held read still unclassified. */
export function promotionLessonFor(held: HeldFeeCandidate, lessons: ReadLessons, sourceDocumentId: number): PromotionLesson | null {
  if (held.shape !== "unclassified" || held.canonicalHint || held.amount == null || held.statedNoCharge) return null;
  const key = readLessonKey(sourceDocumentId, held.feeName, held.amount);
  return key == null ? null : lessons.promotions.get(key) ?? null;
}

/** The held read as the candidate Darwin verified once: its own name, amount and line, the verified category. */
export function promotedCandidate(held: HeldFeeCandidate, lesson: PromotionLesson): ExtractedFeeCandidate {
  const { shape: _shape, amountMax: _amountMax, percent: _percent, statedNoCharge: _noCharge, canonicalHint: _hint, ...read } = held;
  return {
    ...read,
    amount: held.amount ?? 0,
    canonicalHint: lesson.category,
    confidence: confidenceFor(held.excerpt),
    waivable: false,
  };
}
