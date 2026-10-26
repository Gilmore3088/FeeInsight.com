import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { FEE_CORRECTION_CHECK } from "@/lib/fee-correction-rules";
import { FEE_HOLD_CHECK } from "@/lib/fee-hold-rules";

type SqlTag = typeof sql;

/**
 * Darwin reads the findings filed against its own stage (#2057, #2062): a person's hold or
 * correction whose cause is "read right, but verification should have stopped it" (`verify_missed`,
 * `fee-error-cause.ts`). Each is a fee Darwin passed that was wrong, so each becomes a lesson line
 * naming the Darwin check that should have stopped it, and the step keeps a per-check "missed"
 * tally on the run ledger and the Darwin admin page.
 *
 * This reader changes no fee: it holds, rejects and releases nothing, so it needs no switch or
 * dry-run count. Its lessons are data for the check that missed, and the tally is the number to
 * beat when that check is changed; a check change that would hold or take down a live fee still
 * ships with its own live re-check, switch and dry-run count (CLAUDE.md, Standing rules).
 *
 * Which check missed is read from what the correction changed, not guessed by a model: a new
 * category is the category guard's miss, a new amount the source check's, only a new name the name
 * rule's, only a new frequency the frequency check's. A hold says nothing structured, and a
 * correction of only the conditions is no check's: both are `no_check`, a fee no Darwin check tests
 * for today, kept with the person's reason so a new check can be written from them.
 *
 * Not read here: the takedown sync's verify-stage copy of a hand correction (check
 * `hamilton.admin_correction`, reporter `gutenberg`). It mirrors the hand row, which names its own
 * stage, so reading it would count every Knox misread as a Darwin miss. Deming's audit misses are
 * not read either: Deming files them at discover or extract only (`deming/audit-misses.ts`
 * `missOwner`), never at verify.
 *
 * A finding is withdrawn, counted apart and teaching nothing, when the same act is undone later: a
 * hold by a release of the same fee, a correction by a reversal of the fee it created.
 *
 * The step reads (and writes its `darwin.verify_misses` event) at most once an hour, keyed on the
 * last full read's event; a read scoped to one institution never writes the event or restarts the
 * clock. Each read covers the newest `VERIFY_MISS_LIMIT` findings.
 */

export const VERIFY_MISS_EVENT = "darwin.verify_misses";
export const VERIFY_MISS_KINDS = ["admin_hold", "admin_correction"] as const;
/** The hand checks whose verify rows are a person's own finding. */
export const VERIFY_MISS_HAND_CHECKS = [FEE_HOLD_CHECK, FEE_CORRECTION_CHECK] as const;
/** Newest findings read per step; the tally covers these only. */
export const VERIFY_MISS_LIMIT = 500;
/** Lesson lines kept on the ledger event and the step detail. */
export const VERIFY_MISS_LESSON_LIMIT = 25;
/** A full read runs at most this often. */
export const VERIFY_MISS_INTERVAL_HOURS = 1;

export type VerifyMissCheck = "category_guard" | "source_check" | "name_rule" | "frequency_check" | "no_check";

export const VERIFY_MISS_CHECK_LABELS: Record<VerifyMissCheck, string> = {
  category_guard: "Category guard (the name does not support its category)",
  source_check: "Source check (the amount is not the fee's on its line)",
  name_rule: "Name rule (the name is not the fee's)",
  frequency_check: "Frequency check (the fee is charged on another basis)",
  no_check: "No Darwin check tests for this yet",
};

export interface VerifyMissRow {
  id: number;
  kind: string;
  check_name: string | null;
  reported_by: string;
  institution_id: number | null;
  fee_published_id: number | null;
  canonical_fee_key: string | null;
  amount: number | null;
  evidence: Record<string, unknown> | null;
  created_at: string | Date;
  withdrawn: boolean;
}

export interface VerifyMissLesson {
  feedbackId: number;
  kind: string;
  check: VerifyMissCheck;
  feePublishedId: number | null;
  institutionId: number | null;
  lesson: string;
}

export interface VerifyMissResult {
  /** The newest findings read at verify, at most `limit` (withdrawn ones included). */
  read: number;
  limit: number;
  /** Read and still standing. */
  standing: number;
  withdrawn: number;
  byKind: Record<string, number>;
  /** Standing findings among those read, by the Darwin check that should have stopped the fee. */
  missedByCheck: Record<string, number>;
  lessons: VerifyMissLesson[];
  /** A full read ran within the hour, so this step read nothing. */
  skipped: boolean;
  scoped: boolean;
  error?: string;
}

const emptyResult = (): VerifyMissResult => ({
  read: 0, limit: VERIFY_MISS_LIMIT, standing: 0, withdrawn: 0, byKind: {}, missedByCheck: {}, lessons: [], skipped: false, scoped: false,
});

function record(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

function changed(before: unknown, after: unknown): boolean {
  const left = num(before);
  const right = num(after);
  if (left != null || right != null) return left == null || right == null || Math.abs(left - right) >= 0.005;
  return (str(before)?.toLowerCase() ?? null) !== (str(after)?.toLowerCase() ?? null);
}

/** Pure: the Darwin check that should have stopped the fee, from what the finding changed. */
export function verifyMissCheck(row: Pick<VerifyMissRow, "kind" | "evidence">): VerifyMissCheck {
  if (row.kind !== "admin_correction") return "no_check";
  const evidence = record(row.evidence);
  const before = record(evidence?.before);
  const after = record(evidence?.after);
  if (!before || !after) return "no_check";
  if (str(after.canonicalFeeKey) && changed(before.canonicalFeeKey, after.canonicalFeeKey)) return "category_guard";
  if (after.amount != null && changed(before.amount, after.amount)) return "source_check";
  if (str(after.feeName) && changed(before.feeName, after.feeName)) return "name_rule";
  if (changed(before.frequency, after.frequency)) return "frequency_check";
  return "no_check";
}

function money(value: unknown): string {
  const amount = num(value);
  return amount == null ? "no amount" : `$${amount.toFixed(2)}`;
}

/** Pure: one plain lesson line for a standing finding. */
export function verifyMissLesson(row: VerifyMissRow): VerifyMissLesson {
  const evidence = record(row.evidence) ?? {};
  const check = verifyMissCheck(row);
  const before = record(evidence.before);
  const after = record(evidence.after);
  const feeName = str(evidence.fee_name) ?? str(before?.feeName) ?? "a fee";
  const filedAs = row.canonical_fee_key ?? str(before?.canonicalFeeKey) ?? "no category";
  const who = str(evidence.actor) ?? "A person";
  const found = row.kind === "admin_correction" && after
    ? `corrected it to "${str(after.feeName) ?? feeName}" ${money(after.amount)} as ${str(after.canonicalFeeKey) ?? filedAs}`
    : "held it";
  const reason = str(evidence.reason);
  return {
    feedbackId: row.id,
    kind: row.kind,
    check,
    feePublishedId: row.fee_published_id,
    institutionId: row.institution_id,
    lesson: `Darwin passed "${feeName}" ${money(row.amount)} filed as ${filedAs}; ${who} ${found}${reason ? ` ("${reason}")` : ""}. Should have stopped it: ${VERIFY_MISS_CHECK_LABELS[check]}.`,
  };
}

/** Pure: the tally and the lessons from the rows read. */
export function summarizeVerifyMisses(rows: VerifyMissRow[], limit = VERIFY_MISS_LIMIT): VerifyMissResult {
  const result = { ...emptyResult(), limit };
  for (const row of rows) {
    result.read += 1;
    result.byKind[row.kind] = (result.byKind[row.kind] ?? 0) + 1;
    if (row.withdrawn) {
      result.withdrawn += 1;
      continue;
    }
    result.standing += 1;
    const lesson = verifyMissLesson(row);
    result.missedByCheck[lesson.check] = (result.missedByCheck[lesson.check] ?? 0) + 1;
    if (result.lessons.length < VERIFY_MISS_LESSON_LIMIT) result.lessons.push(lesson);
  }
  return result;
}

/**
 * The newest verify-stage findings: a person's own hold and correction rows (not the takedown
 * sync's copies). A hold is withdrawn by a later release of the same fee; a correction by a later
 * reversal of the fee it created (the reversal's row names that fee).
 */
export async function loadVerifyMissRows(db: SqlTag, options: { institutionId?: number | null; limit?: number } = {}): Promise<VerifyMissRow[]> {
  const institutionId = options.institutionId ?? null;
  return db<VerifyMissRow[]>`
    SELECT f.id::int AS id, f.kind, f.check_name, f.reported_by,
           f.institution_id::int AS institution_id, f.fee_published_id::int AS fee_published_id,
           f.canonical_fee_key, f.amount::float8 AS amount, f.evidence, f.created_at,
           EXISTS (
             SELECT 1 FROM pipeline_feedback undo
              WHERE undo.institution_id = f.institution_id
                AND undo.created_at > f.created_at
                AND (
                  (f.kind = 'admin_hold' AND undo.kind = 'admin_release'
                    AND undo.fee_published_id = f.fee_published_id)
                  OR (f.kind = 'admin_correction' AND undo.kind = 'admin_correction_reversed'
                    AND undo.fee_published_id = (f.evidence->>'new_fee_published_id')::bigint)
                )
           ) AS withdrawn
      FROM pipeline_feedback f
     WHERE f.about_stage = 'verify'
       AND f.signal = 'wrong'
       AND f.reported_by = 'human'
       AND f.kind = ANY(${[...VERIFY_MISS_KINDS]}::text[])
       AND f.check_name = ANY(${[...VERIFY_MISS_HAND_CHECKS]}::text[])
       AND (${institutionId}::bigint IS NULL OR f.institution_id = ${institutionId}::bigint)
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT ${options.limit ?? VERIFY_MISS_LIMIT}
  `;
}

/** The ledger's and admin page's view of a result. */
export function verifyMissDetail(result: VerifyMissResult) {
  return {
    read: result.read,
    newest_limit: result.limit,
    standing: result.standing,
    withdrawn: result.withdrawn,
    by_kind: result.byKind,
    missed_by_check: result.missedByCheck,
    skipped: result.skipped,
    scoped: result.scoped,
    interval_hours: VERIFY_MISS_INTERVAL_HOURS,
    changes_fees: false,
    lessons: result.lessons.map((lesson) => ({
      feedback_id: lesson.feedbackId,
      kind: lesson.kind,
      check: lesson.check,
      fee_published_id: lesson.feePublishedId,
      institution_id: lesson.institutionId,
      lesson: lesson.lesson,
    })),
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Pure: the step summary's sentence, or "" when nothing was read. */
export function verifyMissNote(result: VerifyMissResult): string {
  if (result.read === 0) return "";
  const checks = Object.entries(result.missedByCheck).sort((a, b) => b[1] - a[1]).map(([check, count]) => `${check} ${count.toLocaleString()}`).join(", ");
  return ` Verify misses (newest ${result.limit.toLocaleString()} findings): ${result.standing.toLocaleString()} standing against verify${checks ? ` (${checks})` : ""}, ${result.withdrawn.toLocaleString()} withdrawn; no fee changed.`;
}

/** True when a full read wrote its event under the interval ago. A failed read never skips. */
async function readRecently(db: SqlTag, now: Date): Promise<boolean> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<{ created_at: Date | string | null }[]>`
      SELECT created_at
        FROM agent_run_events
       WHERE event_type = ${VERIFY_MISS_EVENT}
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    const at = rows[0]?.created_at == null ? null : new Date(rows[0].created_at).getTime();
    return at != null && Number.isFinite(at) && now.getTime() - at < VERIFY_MISS_INTERVAL_HOURS * 3_600_000;
  } catch (error) {
    console.warn("[darwin] verify misses interval read failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Darwin's verify step reads the findings against its stage (see the module note) and records what
 * a full read found as one `darwin.verify_misses` event on its run step, at most hourly. Read-only
 * on fees. Never throws: a failed read comes back as `error` with an empty tally.
 */
export async function readVerifyMisses(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun?: boolean; institutionId?: number | null; now?: Date },
): Promise<VerifyMissResult> {
  const scoped = options.institutionId != null;
  if (!scoped && !options.dryRun && await readRecently(db, options.now ?? new Date())) {
    return { ...emptyResult(), skipped: true };
  }
  let result: VerifyMissResult;
  try {
    const rows = await inSavepoint(db, (scope) => loadVerifyMissRows(scope, { institutionId: options.institutionId }));
    result = { ...summarizeVerifyMisses(rows), scoped };
  } catch (error) {
    result = { ...emptyResult(), scoped, error: error instanceof Error ? error.message : String(error) };
    console.warn("[darwin] verify misses read failed", result.error);
    return result;
  }
  // A full read writes its event even when it found nothing, so the hourly clock runs.
  if (!options.dryRun && !scoped) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${VERIFY_MISS_EVENT}, 'completed',
          ${`Read the newest ${result.limit} finding(s) filed against verify: ${result.read} found, ${result.standing} standing, ${result.withdrawn} withdrawn; no fee changed`},
          ${JSON.stringify(verifyMissDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] verify misses event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}
