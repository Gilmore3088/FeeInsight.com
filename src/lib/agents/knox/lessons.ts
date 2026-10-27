import type { sql } from "@/lib/data-store/connection";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { eligibleReferenceFeedbackSql, readReferenceEligibility } from "@/lib/data-store/answer-key-reference-store";
import { FEE_CORRECTION_CHECK } from "@/lib/fee-correction-rules";
import { FEE_HOLD_CHECK } from "@/lib/fee-hold-rules";

type SqlTag = typeof sql;

/**
 * Knox's learning reader: lessons from the shared learning store (`pipeline_feedback`).
 *
 * A lesson is a fee name that Knox kept filing under one category, which the category
 * guards (Darwin's or Hamilton's) rejected at several banks, while the same name was
 * verified under another category at several other banks: "Statement Copy" is
 * document_reproduction, not paper_statement; "Overdraft Transfer" is
 * od_protection_transfer, not overdraft. When today's rules still file that exact name
 * under the rejected category, Knox files it under the verified one, and the row carries
 * `knox_lesson:<wrong>-><right>` so the change is visible and Darwin still checks it.
 *
 * Only exact names (lowercase, letters only) learn, and only when both sides are clear:
 * at least `LESSON_MIN_BANKS` banks each way, no verified fee under the rejected
 * category and no rejection under the verified one. A name with no lesson is untouched.
 *
 * Per-bank memory: a bank writes its own names its own way, so one bank's verdicts are
 * enough for that bank. When a name was rejected under one category at a bank and
 * verified under another at the same bank (by a guard, Darwin or the answer key), with
 * no verdict the other way there, Knox files that name at that bank under the verified
 * category, even when no other bank has the name. The bank's lesson wins over the
 * global one; the row carries the same `knox_lesson:` flag.
 *
 * A person's label (`label-queue.ts`) is a lesson for the name under any other
 * category: it applies after the bank's own lesson and before the global ones.
 *
 * v3, restores: a fee Hamilton restored after a takedown (`restored_after_takedown`, the
 * second look and the restore bar) is a verified fee under the category it came back
 * with, and a takedown of that fee under that same category no longer counts as wrong.
 * A takedown under another category stands: "International Wire, outgoing" taken down as
 * a domestic wire and restored as an international one confirms the lesson. Only the
 * category kinds are read. `unreproduced` (a newer rules version disagreeing with an
 * older one), `not_on_schedule`, `wrong_amount` and `threshold` say nothing about a
 * category and are often restored, so Knox does not learn from them.
 *
 * v4, name families (#2068): an exact name learns only from banks that print it the same
 * way, so "Balance Inquiries" and "Balance Inquiry Fee" each waited for their own two banks.
 * A name's family is its words with plural "s", fee words and joining words dropped, in
 * sorted order (`lessonFamily`): "Balance Inquiry Fee" and "Balance Inquiries" are both
 * "balance inquiry". Families of two words or more learn globally under the same rule as
 * names (two banks each way, nothing on the other side), and apply only when the exact name
 * has no lesson. A one-word family ("annual", "additional") is too broad to learn from.
 *
 * v5, findings filed against extract (#2057, #2055, #2062): a person's hold or correction whose
 * cause is Knox's step, and Deming's audit misses at extract, are read here as category verdicts,
 * one bank each like every other verdict, never as a re-read (a re-read takes any other name on
 * the line at the same price as the better one, so it could rename a correct fee sideways; Deming's
 * lesson `issue-2055-route-to-owner-queue`). Only what a row says about the category counts
 * (`knoxFindingsSql`):
 * - an audit miss from the category guard is wrong under the fee's category;
 * - a hold whose cause is the wrong category is wrong under it, until the hold is released;
 * - a correction that moved the fee to another category is wrong under the old one and right under
 *   the new one, for the name Knox read; one that kept the category is right under it (the person
 *   cited the source line and the shared category guard passed it); a reversed one counts nothing.
 * An amount, perk or name miss and an amount hold say nothing about the category and teach no
 * lesson here: Knox has no amount lesson yet (#2067), and a bad name goes to the re-read queue. The
 * takedown sync's copies of a correction (check `hamilton.admin_correction`) are skipped, since the
 * person's own row is the finding.
 *
 * Every finding is about a live fee, so Darwin already recorded that fee as `darwin_verified` under
 * the category the finding rejects. Left in, that approval would put the finding's bank on both
 * sides and no lesson would ever form; so a finding that calls a fee's category wrong supersedes
 * Darwin's approval of that one fee (matched by its verified row, `published_fee_records.lineage_ref`),
 * as a restore supersedes a takedown. Darwin's approvals of the bank's other fees still count.
 *
 * The lessons query also tallies every finding it read, all time, by kind and verdict, so the extract
 * step shows what it read without a second scan (`loadKnoxLessonsAndFindings`,
 * `hand_findings_read_all_time` on the step).
 */

export const KNOX_LESSONS_VERSION = 5;
/** Words a name family leaves out: they say a price is charged, not what for. */
export const FAMILY_FILLER_WORDS = ["fee", "charge", "cost", "per", "item", "each", "the", "a", "an", "of", "for", "to", "on", "and", "or", "service", "by", "with"] as const;
const FAMILY_PREFIX = "family:";
/** `wrongKey` of a person's label, which applies whatever category the rules chose. */
export const LABEL_WRONG_KEY = "*";
export const LESSON_MIN_BANKS = 2;
/** Lessons read per step; the store holds a few hundred. */
const LESSON_LIMIT = 2000;

export interface KnoxLesson {
  /** Set for a lesson learned at one bank, which applies only there. */
  institutionId?: number | null;
  name: string;
  wrongKey: string;
  rightKey: string;
  wrongBanks: number;
  rightBanks: number;
}

export type KnoxLessons = Map<string, KnoxLesson>;

/** The store's name key: letters only, lowercase, single spaces. Same as the SQL below. */
export function lessonName(feeName: string): string {
  return feeName.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A name's family (#2068): the store's name key with each word's plural made singular ("ies"
 * to "y" in words of five letters or more, else a final "s" in words of four or more, not "ss"), filler words left out, and the rest sorted and
 * deduplicated. Same as `familySql`. An empty string when nothing is left.
 */
export function lessonFamily(name: string): string {
  const words = lessonName(name).split(" ").filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .filter((word) => !(FAMILY_FILLER_WORDS as readonly string[]).includes(word));
  return [...new Set(words)].sort().join(" ");
}

/** `lessonFamily` in SQL, over a column already in the store's name key form. */
function familySql(column: string): string {
  if (!/^[a-z_][a-z0-9_.]*$/.test(column)) throw new Error("Invalid internal column");
  const fillers = FAMILY_FILLER_WORDS.map((word) => `'${word}'`).join(",");
  return `array_to_string(ARRAY(SELECT DISTINCT s FROM (SELECT CASE WHEN length(w) > 4 AND w ~ 'ies$' THEN left(w, -3) || 'y'
                                                WHEN length(w) > 3 AND w ~ 's$' AND w !~ 'ss$' THEN left(w, -1) ELSE w END AS s
            FROM unnest(string_to_array(${column}, ' ')) AS w) q WHERE s <> '' AND s NOT IN (${fillers}) ORDER BY s), ' ')`;
}

/** The finding kinds Knox reads at extract (v5), and the audit check whose misses are category verdicts. */
export const KNOX_FINDING_KINDS = ["admin_correction", "admin_hold", "audit_miss"] as const;
export const AUDIT_CATEGORY_CHECK = "hamilton.category_guard";
export type KnoxFindingKind = (typeof KNOX_FINDING_KINDS)[number];
export type KnoxFindingVerdict = "category" | "category_confirmed" | "no_category_verdict" | "withdrawn";

/** The store's name key in SQL, as `lessonName`. */
function nameKeySql(column: string): string {
  return `regexp_replace(btrim(lower(regexp_replace(${column}, '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g')`;
}

/**
 * Extract-stage holds, corrections and audit misses as category verdicts (v5): one row per side, with
 * `signal` null when the finding says nothing about the category. Columns: id, kind, verdict,
 * institution_id, fee_verified_id (the verified row of the fee it is about), name (the store's name
 * key), raw_name, fee_key, signal. Static SQL, no parameters; used as the `findings` CTE.
 */
export function knoxFindingsSql(): string {
  return `SELECT h.id, h.kind, h.verdict, h.institution_id, h.fee_verified_id, ${nameKeySql("h.raw_name")} AS name, h.raw_name, side.fee_key, side.signal
    FROM (
      SELECT f.id, f.kind, f.institution_id, pr.lineage_ref AS fee_verified_id,
             COALESCE(f.evidence->>'fee_name', f.evidence#>>'{before,feeName}') AS raw_name,
             f.canonical_fee_key AS before_key,
             f.evidence#>>'{after,canonicalFeeKey}' AS after_key,
             CASE
               WHEN f.kind = 'audit_miss' THEN
                 CASE WHEN split_part(COALESCE(f.check_name, ''), ':', 1) = '${AUDIT_CATEGORY_CHECK}' THEN 'category' ELSE 'no_category_verdict' END
               WHEN f.kind = 'admin_hold' THEN
                 CASE WHEN EXISTS (SELECT 1 FROM pipeline_feedback r
                                    WHERE r.kind = 'admin_release' AND r.fee_published_id = f.fee_published_id AND r.created_at >= f.created_at) THEN 'withdrawn'
                      WHEN f.evidence->>'cause' = 'wrong_category' THEN 'category' ELSE 'no_category_verdict' END
               ELSE
                 CASE WHEN EXISTS (SELECT 1 FROM pipeline_feedback r
                                    WHERE r.kind = 'admin_correction_reversed'
                                      AND r.fee_published_id = CASE WHEN f.evidence->>'new_fee_published_id' ~ '^[1-9][0-9]{0,17}$'
                                                                    THEN (f.evidence->>'new_fee_published_id')::bigint END) THEN 'withdrawn'
                      WHEN f.evidence#>>'{after,canonicalFeeKey}' IS NULL OR f.canonical_fee_key IS NULL THEN 'no_category_verdict'
                      WHEN f.evidence#>>'{after,canonicalFeeKey}' <> f.canonical_fee_key THEN 'category'
                      ELSE 'category_confirmed' END
             END AS verdict
        FROM pipeline_feedback f
        LEFT JOIN published_fee_records pr ON pr.fee_published_id = f.fee_published_id
       WHERE f.about_stage = 'extract'
         AND f.signal = 'wrong'
         AND ((f.kind = 'audit_miss' AND f.reported_by = 'deming')
           OR (f.kind = 'admin_hold' AND f.check_name = '${FEE_HOLD_CHECK}')
           OR (f.kind = 'admin_correction' AND f.check_name = '${FEE_CORRECTION_CHECK}'))
    ) h
    CROSS JOIN LATERAL (VALUES
      (h.before_key, CASE WHEN h.verdict = 'category' THEN 'wrong' END),
      (CASE WHEN h.kind = 'admin_correction' THEN h.after_key END,
       CASE WHEN h.kind = 'admin_correction' AND h.verdict IN ('category', 'category_confirmed') THEN 'right' END)
    ) AS side(fee_key, signal)`;
}

/** In a query with a `findings` CTE: the findings' category verdicts (name, raw_name, fee_key, signal, institution_id). */
export const FINDING_VERDICTS_SQL = `SELECT name, raw_name, fee_key, signal, institution_id FROM findings
           WHERE signal IS NOT NULL AND fee_key IS NOT NULL AND name <> ''`;

/**
 * In a query with a `findings` CTE, a join condition on feedback alias `f`: the finding that rejects
 * the category of the very fee this `darwin_verified` row approved. Join it LEFT, alias `sv`, and keep
 * rows where `sv.id IS NULL`.
 */
export const DARWIN_SUPERSEDED_ON = `f.kind = 'darwin_verified' AND sv.signal = 'wrong'
              AND sv.fee_verified_id = f.fee_verified_id AND sv.fee_key = f.canonical_fee_key`;

/** All-time tally of the extract-stage findings Knox read, by kind and verdict. */
export type KnoxFindingsRead = Partial<Record<KnoxFindingKind, Partial<Record<KnoxFindingVerdict, number>>>>;

/** `name` of the lessons query's tally rows; never a lesson name (those are letters and spaces). */
const FINDING_TALLY = "finding_tally:";

/** The extract-stage findings Knox read, all time, by kind and verdict. Empty on failure. */
export async function loadKnoxFindingsRead(db: SqlTag): Promise<KnoxFindingsRead> {
  return (await loadKnoxLessonsAndFindings(db)).findingsRead;
}

function lessonKey(name: string, wrongKey: string, institutionId?: number | null): string {
  return institutionId ? `${institutionId}|${name}|${wrongKey}` : `${name}|${wrongKey}`;
}

export function lessonsFrom(rows: KnoxLesson[]): KnoxLessons {
  const lessons: KnoxLessons = new Map();
  for (const row of rows) {
    const key = lessonKey(row.name, row.wrongKey, row.institutionId);
    const prior = lessons.get(key);
    // Two verified categories for one rejected name: neither is a lesson.
    if (prior && prior.rightKey !== row.rightKey) {
      lessons.set(key, { ...prior, rightKey: "" });
      continue;
    }
    lessons.set(key, row);
  }
  for (const [key, lesson] of lessons) if (!lesson.rightKey) lessons.delete(key);
  return lessons;
}

/** Reads the lessons; an empty set when the store is missing or the read fails. */
export async function loadKnoxLessons(db: SqlTag): Promise<KnoxLessons> {
  return (await loadKnoxLessonsAndFindings(db)).lessons;
}

/** The lessons, and the all-time tally of the findings they read (v5), from one query. Empty when the store is missing or the read fails. */
export async function loadKnoxLessonsAndFindings(db: SqlTag): Promise<{ lessons: KnoxLessons; findingsRead: KnoxFindingsRead; readFailed?: true }> {
  try {
    const reference = await readReferenceEligibility(db);
    return await inSavepoint(db, async (scope) => {
      if (!(await feedbackSchemaReady(scope))) return { lessons: new Map(), findingsRead: {} };
      const rows = await scope<Array<{ institution_id: number | string | null; name: string; wrong_key: string; right_key: string; wrong_banks: number | string; right_banks: number | string }>>`
        WITH restored AS MATERIALIZED (
          -- A fee Hamilton put back, under the category it went live with again.
          SELECT DISTINCT r.fee_raw_id, r.canonical_fee_key, r.institution_id,
                 regexp_replace(btrim(lower(regexp_replace(fr.fee_name, '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g') AS name
            FROM pipeline_feedback r
            JOIN raw_fee_observations fr ON fr.fee_raw_id = r.fee_raw_id
           WHERE r.kind = 'restored_after_takedown'
             -- Restored with no check (before 7 Oct): no verdict that the takedown was wrong.
             AND COALESCE(r.evidence->>'restored_by', '') <> 'rules_recheck_restored:text_gone'
             AND r.canonical_fee_key IS NOT NULL
             AND fr.fee_name IS NOT NULL
        ), findings AS MATERIALIZED (
          -- v5: holds, corrections and audit misses filed against extract.
          ${scope.unsafe(knoxFindingsSql())}
        ), judged AS (
          SELECT regexp_replace(btrim(lower(regexp_replace(f.evidence->>'fee_name', '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g') AS name,
                 f.canonical_fee_key AS fee_key, f.signal, f.institution_id
            FROM pipeline_feedback f
            LEFT JOIN restored rs
              ON f.signal = 'wrong' AND rs.fee_raw_id = f.fee_raw_id AND rs.canonical_fee_key = f.canonical_fee_key
            -- A finding on this very fee supersedes Darwin's approval of it (v5).
            LEFT JOIN findings sv ON ${scope.unsafe(DARWIN_SUPERSEDED_ON)}
           WHERE f.about_stage = 'extract'
             AND f.evidence->>'fee_name' IS NOT NULL
             AND f.canonical_fee_key IS NOT NULL
             AND f.kind IN ('wrong_category', 'darwin_verified', 'answer_key')
             AND ${eligibleReferenceFeedbackSql(scope, "f", reference)}
             AND rs.fee_raw_id IS NULL
             AND sv.id IS NULL
          UNION ALL
          SELECT name, canonical_fee_key, 'right', institution_id FROM restored
          UNION ALL
          SELECT name, fee_key, signal, institution_id FROM (${scope.unsafe(FINDING_VERDICTS_SQL)}) fv
        ), families AS MATERIALIZED (
          SELECT name, ${scope.unsafe(familySql("name"))} AS family FROM (SELECT DISTINCT name FROM judged WHERE name <> '') d
        ), family_tally AS (
          SELECT fm.family AS name, j.fee_key,
                 count(DISTINCT j.institution_id) FILTER (WHERE j.signal = 'wrong') AS wrong_banks,
                 count(DISTINCT j.institution_id) FILTER (WHERE j.signal = 'right') AS right_banks
            FROM judged j JOIN families fm ON fm.name = j.name
           WHERE fm.family LIKE '% %'
           GROUP BY fm.family, j.fee_key
        ), family_sides AS (
          SELECT name,
                 array_agg(fee_key ORDER BY fee_key) FILTER (WHERE wrong_banks >= ${LESSON_MIN_BANKS} AND right_banks = 0) AS wrong_keys,
                 array_agg(wrong_banks ORDER BY fee_key) FILTER (WHERE wrong_banks >= ${LESSON_MIN_BANKS} AND right_banks = 0) AS wrong_counts,
                 array_agg(fee_key ORDER BY fee_key) FILTER (WHERE right_banks >= ${LESSON_MIN_BANKS} AND wrong_banks = 0) AS right_keys,
                 array_agg(right_banks ORDER BY fee_key) FILTER (WHERE right_banks >= ${LESSON_MIN_BANKS} AND wrong_banks = 0) AS right_counts
            FROM family_tally
           GROUP BY name
        ), tally AS (
          SELECT name, fee_key,
                 count(DISTINCT institution_id) FILTER (WHERE signal = 'wrong') AS wrong_banks,
                 count(DISTINCT institution_id) FILTER (WHERE signal = 'right') AS right_banks
            FROM judged
           WHERE name <> ''
           GROUP BY name, fee_key
        ), bank_tally AS (
          SELECT institution_id, name, fee_key,
                 count(*) FILTER (WHERE signal = 'wrong') AS wrong_count,
                 count(*) FILTER (WHERE signal = 'right') AS right_count
            FROM judged
           WHERE name <> '' AND institution_id IS NOT NULL
           GROUP BY institution_id, name, fee_key
        ),
        -- The wrong-only and right-only categories of each name, side by side. A self-join of the
        -- tallies is equivalent, but the planner misjudged the CTE sizes as a few rows and
        -- chose a nested loop: 53 s average over 538 runs on Oct 8, near the 120 s timeout.
        global_sides AS (
          SELECT name,
                 array_agg(fee_key ORDER BY fee_key) FILTER (WHERE wrong_banks >= ${LESSON_MIN_BANKS} AND right_banks = 0) AS wrong_keys,
                 array_agg(wrong_banks ORDER BY fee_key) FILTER (WHERE wrong_banks >= ${LESSON_MIN_BANKS} AND right_banks = 0) AS wrong_counts,
                 array_agg(fee_key ORDER BY fee_key) FILTER (WHERE right_banks >= ${LESSON_MIN_BANKS} AND wrong_banks = 0) AS right_keys,
                 array_agg(right_banks ORDER BY fee_key) FILTER (WHERE right_banks >= ${LESSON_MIN_BANKS} AND wrong_banks = 0) AS right_counts
            FROM tally
           GROUP BY name
        ), bank_sides AS (
          SELECT institution_id, name,
                 array_agg(fee_key ORDER BY fee_key) FILTER (WHERE wrong_count > 0 AND right_count = 0) AS wrong_keys,
                 array_agg(fee_key ORDER BY fee_key) FILTER (WHERE right_count > 0 AND wrong_count = 0) AS right_keys
            FROM bank_tally
           GROUP BY institution_id, name
        )
        (SELECT NULL::bigint AS institution_id, s.name, w.fee_key AS wrong_key, r.fee_key AS right_key,
                w.banks AS wrong_banks, r.banks AS right_banks
          FROM global_sides s,
               unnest(s.wrong_keys, s.wrong_counts) AS w(fee_key, banks),
               unnest(s.right_keys, s.right_counts) AS r(fee_key, banks)
         ORDER BY w.banks DESC
         LIMIT ${LESSON_LIMIT})
        UNION ALL
        (SELECT NULL::bigint AS institution_id, ${FAMILY_PREFIX}::text || s.name, w.fee_key AS wrong_key, r.fee_key AS right_key,
                w.banks AS wrong_banks, r.banks AS right_banks
          FROM family_sides s,
               unnest(s.wrong_keys, s.wrong_counts) AS w(fee_key, banks),
               unnest(s.right_keys, s.right_counts) AS r(fee_key, banks)
         ORDER BY w.banks DESC
         LIMIT ${LESSON_LIMIT})
        UNION ALL
        (SELECT s.institution_id, s.name, w AS wrong_key, r AS right_key, 1 AS wrong_banks, 1 AS right_banks
          FROM bank_sides s, unnest(s.wrong_keys) AS w, unnest(s.right_keys) AS r
         LIMIT ${LESSON_LIMIT})

        UNION ALL
        (SELECT NULL::bigint, regexp_replace(btrim(lower(regexp_replace(l.evidence->>'fee_name', '[^A-Za-z ]+', ' ', 'g'))), '\\s+', ' ', 'g'),
                ${LABEL_WRONG_KEY}, l.canonical_fee_key, 0, 0
          FROM pipeline_feedback l
         WHERE l.kind = 'name_label' AND l.signal = 'right'
           AND l.canonical_fee_key IS NOT NULL AND l.evidence->>'fee_name' IS NOT NULL
         LIMIT ${LESSON_LIMIT})
        UNION ALL
        -- v5: the all-time tally of the findings read, by kind (wrong_key) and verdict (right_key).
        (SELECT NULL::bigint, ${FINDING_TALLY}::text, kind, verdict, count(DISTINCT id), 0
          FROM findings GROUP BY kind, verdict)
      `;
      const findingsRead: KnoxFindingsRead = {};
      const lessonRows: KnoxLesson[] = [];
      for (const row of rows) {
        if (row.name === FINDING_TALLY) {
          const kind = row.wrong_key as KnoxFindingKind;
          findingsRead[kind] = { ...findingsRead[kind], [row.right_key as KnoxFindingVerdict]: Number(row.wrong_banks) };
          continue;
        }
        lessonRows.push({
          institutionId: row.institution_id === null ? null : Number(row.institution_id),
          name: row.name,
          wrongKey: row.wrong_key,
          rightKey: row.right_key,
          wrongBanks: Number(row.wrong_banks),
          rightBanks: Number(row.right_banks),
        });
      }
      return { lessons: lessonsFrom(lessonRows), findingsRead };
    });
  } catch (error) {
    console.error("loadKnoxLessons failed:", error);
    // The step records the failure, so an empty tally never reads as "nothing filed".
    return { lessons: new Map(), findingsRead: {}, readFailed: true };
  }
}

export interface LessonApplied {
  candidate: ExtractedFeeCandidate;
  /** `knox_lesson:<wrong>-><right>` when a lesson re-filed the fee. */
  lessonFlag: string | null;
}

/**
 * Re-files a fee whose exact name the store says Knox keeps putting in the wrong
 * category: at this bank first, then anywhere, then by its name's family (v4).
 */
export function applyKnoxLesson(
  candidate: ExtractedFeeCandidate,
  lessons: KnoxLessons,
  institutionId?: number | null,
): LessonApplied {
  const lesson = knoxLessonFor(candidate.feeName, candidate.canonicalHint, lessons, institutionId);
  if (!lesson) return { candidate, lessonFlag: null };
  return {
    candidate: { ...candidate, canonicalHint: lesson.rightKey },
    lessonFlag: `knox_lesson:${candidate.canonicalHint}->${lesson.rightKey}`,
  };
}

/**
 * The lesson that re-files a fee of this name filed under `canonicalKey`, if any: at this bank
 * first, then a person's label, then anywhere, then by the name's family (v4). The free read and
 * the paid read (#2068) both use it. Pure.
 */
export function knoxLessonFor(
  feeName: string,
  canonicalKey: string,
  lessons: KnoxLessons,
  institutionId?: number | null,
): KnoxLesson | undefined {
  if (lessons.size === 0) return undefined;
  const name = lessonName(feeName);
  const label = lessons.get(lessonKey(name, LABEL_WRONG_KEY));
  const bankLesson = institutionId ? lessons.get(lessonKey(name, canonicalKey, institutionId)) : undefined;
  // A label that agrees with the rules keeps the global lessons from moving the fee.
  return (
    bankLesson ??
    (label
      ? (label.rightKey !== canonicalKey ? label : undefined)
      : lessons.get(lessonKey(name, canonicalKey)) ?? familyLesson(feeName, canonicalKey, lessons))
  );
}

/** The family lesson for a fee whose exact name has none (v4); none for a one-word family. */
function familyLesson(feeName: string, canonicalKey: string, lessons: KnoxLessons): KnoxLesson | undefined {
  const family = lessonFamily(feeName);
  return family.includes(" ") ? lessons.get(lessonKey(`${FAMILY_PREFIX}${family}`, canonicalKey)) : undefined;
}

/** Most category lessons one paid read carries, and the most characters of them (#2068). */
export const PAID_CATEGORY_LESSON_LIMIT = 20;
export const PAID_CATEGORY_LESSON_MAX_CHARS = 2_500;

export type DocumentCategoryLessonScope = "bank" | "label" | "name" | "family";

export interface DocumentCategoryLesson {
  /** Stable id for the run log: `<scope>:<name>:<wrong>-><right>` (a bank lesson adds its bank). */
  id: string;
  scope: DocumentCategoryLessonScope;
  /** The store's name key, or the family's words for a family lesson. */
  name: string;
  wrongKey: string;
  rightKey: string;
}

/** A line's words in family form (`lessonFamily` without the sort or dedupe): singular, fillers out. */
function familyWords(line: string): string[] {
  return lessonName(line).split(" ").filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .filter((word) => !(FAMILY_FILLER_WORDS as readonly string[]).includes(word));
}

/** True when every family word appears within a window three words wider than the family. */
function familyInLine(words: readonly string[], family: readonly string[]): boolean {
  const need = new Set(family);
  const span = need.size + 3;
  for (let start = 0; start < words.length; start += 1) {
    if (!need.has(words[start])) continue;
    const seen = new Set<string>();
    for (let index = start; index < Math.min(words.length, start + span); index += 1) if (need.has(words[index])) seen.add(words[index]);
    if (seen.size === need.size) return true;
  }
  return false;
}

const SCOPE_RANK: Record<DocumentCategoryLessonScope, number> = { bank: 0, label: 1, name: 2, family: 3 };

/**
 * The category lessons that bear on one document (#2068): those whose exact name the text prints,
 * or whose name family it prints within a few words, kept to this bank's own lessons and the
 * global ones (never another bank's). This bank's lessons first, then people's labels, then exact
 * names and families by how many banks taught them. At most `limit` lessons and `maxChars`
 * characters of their prompt lines. Pure.
 */
export function categoryLessonsForText(
  lessons: KnoxLessons,
  text: string,
  institutionId: number | null,
  options: { limit?: number; maxChars?: number } = {},
): DocumentCategoryLesson[] {
  if (lessons.size === 0) return [];
  const limit = options.limit ?? PAID_CATEGORY_LESSON_LIMIT;
  const maxChars = options.maxChars ?? PAID_CATEGORY_LESSON_MAX_CHARS;
  const lines = text.split(/\n+/);
  // Every line's name key in one string, with a mark between lines so a name never spans two.
  const printed = ` ${lines.map(lessonName).join(" | ")} `;
  const lineFamilies = lines.map(familyWords).filter((words) => words.length > 0);
  const found: Array<{ lesson: DocumentCategoryLesson; banks: number }> = [];
  for (const lesson of lessons.values()) {
    if (lesson.institutionId && lesson.institutionId !== institutionId) continue;
    const isFamily = lesson.name.startsWith(FAMILY_PREFIX);
    const name = isFamily ? lesson.name.slice(FAMILY_PREFIX.length) : lesson.name;
    if (!name) continue;
    const scope: DocumentCategoryLessonScope = lesson.institutionId ? "bank" : lesson.wrongKey === LABEL_WRONG_KEY ? "label" : isFamily ? "family" : "name";
    const inText = isFamily ? lineFamilies.some((words) => familyInLine(words, name.split(" "))) : printed.includes(` ${name} `);
    if (!inText) continue;
    found.push({
      lesson: {
        id: `${scope}:${scope === "bank" ? `${lesson.institutionId}:` : ""}${name}:${lesson.wrongKey}->${lesson.rightKey}`,
        scope,
        name,
        wrongKey: lesson.wrongKey,
        rightKey: lesson.rightKey,
      },
      banks: lesson.wrongBanks,
    });
  }
  found.sort((a, b) => SCOPE_RANK[a.lesson.scope] - SCOPE_RANK[b.lesson.scope] || b.banks - a.banks || a.lesson.id.localeCompare(b.lesson.id));
  const chosen: DocumentCategoryLesson[] = [];
  let chars = 0;
  for (const { lesson } of found) {
    const size = categoryLessonLine(lesson).length;
    if (chosen.length >= limit || chars + size > maxChars) continue;
    chosen.push(lesson);
    chars += size;
  }
  return chosen;
}

function categoryLessonLine(lesson: DocumentCategoryLesson): string {
  if (lesson.scope === "label") return `- "${lesson.name}": file under ${lesson.rightKey} (a person labelled it).`;
  if (lesson.scope === "family") return `- names with the words "${lesson.name}": file under ${lesson.rightKey}, not ${lesson.wrongKey}.`;
  return `- "${lesson.name}"${lesson.scope === "bank" ? " at this bank" : ""}: file under ${lesson.rightKey}, not ${lesson.wrongKey}.`;
}

/** The instructions block for a paid read's category lessons; empty when there are none (#2068). */
export function categoryLessonsPromptBlock(lessons: readonly DocumentCategoryLesson[]): string {
  if (lessons.length === 0) return "";
  return [
    "CATEGORY LESSONS FOR THIS DOCUMENT",
    "The category guards rejected these fee names under the second key and verified them under the first, at several banks or at this one. When this document prints one, use the first key. They never override what the text says the fee is.",
    ...lessons.map(categoryLessonLine),
  ].join("\n");
}
