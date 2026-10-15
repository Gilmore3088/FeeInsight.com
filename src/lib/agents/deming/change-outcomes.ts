import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import registry from "./should-move.json";

type SqlTag = typeof sql;

/**
 * Did each change move the number it named? (#1106 step 2, approved by James 2026-10-12.)
 *
 * Each PR that names a "Should move" number adds an entry to `should-move.json` in the same PR.
 * The daily `deming-change-outcomes` step (Atlas's scoreboard run, after the snapshot) records
 * the entry the first day it sees it, with that day's scoreboard value as "before". Seven days
 * later it reads the scoreboard again and gives a verdict:
 * - `moved_as_expected`: moved at least `min_change` the named way;
 * - `wrong_way`: moved at least `min_change` the other way;
 * - `no_change`: moved less than `min_change` (default: any change counts);
 * - `unreadable`: the scoreboard does not hold the number on one of the two days, or (for the
 *   answer-key numbers) the two days were scored by different scorer versions (#1354).
 * Read-only on everything but `change_outcomes`. No model calls.
 */

export const CHANGE_OUTCOME_DAYS = 7;

export interface ShouldMoveEntry {
  pr: number;
  issue?: number | null;
  metric: string;
  direction: "up" | "down";
  min_change?: number | null;
  note?: string | null;
}

export type ChangeVerdict = "moved_as_expected" | "no_change" | "wrong_way" | "unreadable";

export const SHOULD_MOVE: ShouldMoveEntry[] = (registry as { entries: ShouldMoveEntry[] }).entries;

/** Columns of pipeline_scoreboard_snapshots a metric may name. */
const SNAPSHOT_COLUMNS = new Set([
  "coverage_rate",
  "right_document_rate",
  "knox_yield",
  "depth_median_categories",
  "depth_live_institutions",
  "accuracy_precision",
  "accuracy_recall",
  "freshness_median_days",
]);

/** Answer-key numbers: comparable only between snapshots scored by the same scorer version (#1354). */
export const SCORER_METRICS = new Set(["accuracy_precision", "accuracy_recall"]);

/** Pure: true when two snapshots' answer-key numbers come from the same scorer version. */
export function sameScorer(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): boolean {
  const version = (row: Record<string, unknown> | null | undefined) =>
    row?.accuracy_scorer_version == null ? null : Number(row.accuracy_scorer_version);
  const a = version(before);
  return a != null && a === version(after);
}

/** Pure: the metric's value in one snapshot row, or null when it is not there. */
export function metricValue(row: Record<string, unknown> | null | undefined, metric: string): number | null {
  if (!row) return null;
  let value: unknown;
  if (metric.startsWith("detail.")) {
    value = metric
      .slice("detail.".length)
      .split(".")
      .reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), row.detail);
  } else if (SNAPSHOT_COLUMNS.has(metric)) {
    value = row[metric];
  } else {
    return null;
  }
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pure: the verdict for a before and after value. */
export function changeVerdict(entry: Pick<ShouldMoveEntry, "direction" | "min_change">, before: number | null, after: number | null): ChangeVerdict {
  if (before == null || after == null) return "unreadable";
  const delta = after - before;
  const threshold = Math.max(0, Number(entry.min_change ?? 0));
  if (delta === 0 || Math.abs(delta) < threshold) return "no_change";
  return (entry.direction === "up") === delta > 0 ? "moved_as_expected" : "wrong_way";
}

function isoDay(value: unknown): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface ChangeOutcomesResult {
  ready: boolean;
  entries: number;
  started: number;
  judged: Array<{ pr: number; metric: string; verdict: ChangeVerdict; before: number | null; after: number | null; scorerChanged?: boolean }>;
  pending: number;
  /** All checks so far, for the checkpoint's hit rate (#1106 step 4). Null when unread. */
  hitRate: ChangeHitRate | null;
}

/** The share of judged changes that moved their number. Unreadable checks are counted apart. */
export interface ChangeHitRate {
  moved: number;
  judged: number;
  unreadable: number;
}

/** Pure: the hit rate from a count of rows per verdict. */
export function changeHitRate(rows: Array<{ verdict: string; n: number | string | null | undefined }>): ChangeHitRate {
  const tally = new Map<string, number>();
  for (const row of rows) tally.set(row.verdict, (tally.get(row.verdict) ?? 0) + (Number(row.n) || 0));
  const moved = tally.get("moved_as_expected") ?? 0;
  return {
    moved,
    judged: moved + (tally.get("no_change") ?? 0) + (tally.get("wrong_way") ?? 0),
    unreadable: tally.get("unreadable") ?? 0,
  };
}

/** Pure: "7 of 10 changes moved their number (70%)", or why there is no rate yet. */
export function hitRateLine(rate: ChangeHitRate): string {
  const unreadable = rate.unreadable > 0 ? `; ${rate.unreadable} could not be checked` : "";
  if (rate.judged === 0) return `no change has been judged yet${unreadable}`;
  return `${rate.moved} of ${rate.judged} change${rate.judged === 1 ? "" : "s"} moved their number (${Math.round((rate.moved / rate.judged) * 100)}%)${unreadable}`;
}

async function readHitRate(db: SqlTag): Promise<ChangeHitRate> {
  const rows = await db<Array<{ verdict: string; n: number }>>`
    SELECT verdict, COUNT(*)::int AS n FROM change_outcomes WHERE verdict <> 'pending' GROUP BY verdict
  `;
  return changeHitRate(rows);
}

/** A change that did not move its number: the Sunday email asks for it to be explained or reverted. */
export interface FlaggedChange {
  pr: number;
  issue: number | null;
  metric: string;
  verdict: "no_change" | "wrong_way";
  before: number | null;
  after: number | null;
  note: string | null;
}

export interface ChangeOutcomeReview {
  /** False until the `change_outcomes` table exists. */
  ready: boolean;
  /** Checks from the last 7 days that came back "no change" or "wrong way". */
  flagged: FlaggedChange[];
  hitRate: ChangeHitRate | null;
}

/** Last week's "no change" and "wrong way" checks, and the hit rate so far (#1106 steps 3 and 4). Read-only. */
export async function readChangeOutcomeReview(db: SqlTag, now: Date = new Date()): Promise<ChangeOutcomeReview> {
  const [table] = await db<{ ready: boolean }[]>`SELECT to_regclass('public.change_outcomes') IS NOT NULL AS ready`;
  if (!table?.ready) return { ready: false, flagged: [], hitRate: null };
  const since = new Date(now.getTime() - CHANGE_OUTCOME_DAYS * 86_400_000).toISOString();
  const rows = await db<Array<{ pr_number: number | string; issue_number: number | string | null; metric: string; verdict: string; before_value: number | string | null; after_value: number | string | null; note: string | null }>>`
    SELECT pr_number, issue_number, metric, verdict, before_value, after_value, note
      FROM change_outcomes
     WHERE verdict IN ('no_change', 'wrong_way')
       AND checked_at >= ${since}::timestamptz
       AND checked_at <= ${now.toISOString()}::timestamptz
     ORDER BY verdict DESC, pr_number
  `;
  const num = (value: number | string | null) => (value == null || value === "" ? null : Number(value));
  return {
    ready: true,
    flagged: rows.map((row) => ({
      pr: Number(row.pr_number),
      issue: num(row.issue_number),
      metric: row.metric,
      verdict: row.verdict === "wrong_way" ? "wrong_way" : "no_change",
      before: num(row.before_value),
      after: num(row.after_value),
      note: row.note ?? null,
    })),
    hitRate: await readHitRate(db),
  };
}

interface OutcomeRow {
  pr_number: number | string;
  metric: string;
  first_seen_date: string | Date;
  before_value: number | string | null;
  before_snapshot_date?: string | Date | null;
  verdict: string;
}

/** Records new entries and judges the ones a week old. Never throws on a missing table. */
export async function runChangeOutcomes(options: {
  db?: SqlTag;
  runId: number | null;
  dryRun?: boolean;
  now?: Date;
  entries?: ShouldMoveEntry[];
}): Promise<ChangeOutcomesResult> {
  const db = options.db ?? sql;
  const entries = options.entries ?? SHOULD_MOVE;
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const result: ChangeOutcomesResult = { ready: false, entries: entries.length, started: 0, judged: [], pending: 0, hitRate: null };
  const [table] = await db<{ ready: boolean }[]>`SELECT to_regclass('public.change_outcomes') IS NOT NULL AS ready`;
  if (!table?.ready) return result;
  result.ready = true;

  // Each snapshot carries the scorer version behind its answer-key numbers (#1354).
  const [latest] = await db<Array<Record<string, unknown>>>`
    SELECT s.*, COALESCE((s.detail->>'accuracy_scorer_version')::int, r.scorer_version) AS accuracy_scorer_version
      FROM pipeline_scoreboard_snapshots s
      LEFT JOIN answer_key_score_runs r ON r.id = s.accuracy_score_run_id
     WHERE s.snapshot_date <= ${today}::date ORDER BY s.snapshot_date DESC LIMIT 1
  `;
  const existing = await db<OutcomeRow[]>`
    SELECT pr_number, metric, first_seen_date, before_value, before_snapshot_date, verdict FROM change_outcomes
  `;
  const byKey = new Map(existing.map((row) => [`${Number(row.pr_number)}|${row.metric}`, row]));

  for (const entry of entries) {
    const row = byKey.get(`${entry.pr}|${entry.metric}`);
    if (!row) {
      result.started += 1;
      result.pending += 1;
      if (options.dryRun) continue;
      await inSavepoint(db, (scope) => scope`
        INSERT INTO change_outcomes (pr_number, issue_number, metric, direction, min_change, note,
                                     first_seen_date, before_snapshot_date, before_value, agent_run_id)
        VALUES (${entry.pr}, ${entry.issue ?? null}, ${entry.metric}, ${entry.direction}, ${entry.min_change ?? null},
                ${entry.note ?? null}, ${today}::date, ${isoDay(latest?.snapshot_date)}::date,
                ${metricValue(latest, entry.metric)}, ${options.runId})
        ON CONFLICT (pr_number, metric) DO NOTHING
      `);
      continue;
    }
    if (row.verdict !== "pending") continue;
    const firstSeen = isoDay(row.first_seen_date) ?? today;
    const due = addDays(firstSeen, CHANGE_OUTCOME_DAYS);
    if (today < due) {
      result.pending += 1;
      continue;
    }
    const [after] = await db<Array<Record<string, unknown>>>`
      SELECT s.*, COALESCE((s.detail->>'accuracy_scorer_version')::int, r.scorer_version) AS accuracy_scorer_version
        FROM pipeline_scoreboard_snapshots s
        LEFT JOIN answer_key_score_runs r ON r.id = s.accuracy_score_run_id
       WHERE s.snapshot_date >= ${due}::date ORDER BY s.snapshot_date ASC LIMIT 1
    `;
    const before = row.before_value == null ? null : Number(row.before_value);
    let afterValue = metricValue(after, entry.metric);
    // A new scorer version is not a change in the pipeline: never compare across one (#1354).
    let scorerChanged = false;
    if (SCORER_METRICS.has(entry.metric)) {
      const beforeDay = isoDay(row.before_snapshot_date);
      const [beforeRow] = beforeDay
        ? await db<Array<Record<string, unknown>>>`
            SELECT COALESCE((s.detail->>'accuracy_scorer_version')::int, r.scorer_version) AS accuracy_scorer_version
              FROM pipeline_scoreboard_snapshots s
              LEFT JOIN answer_key_score_runs r ON r.id = s.accuracy_score_run_id
             WHERE s.snapshot_date = ${beforeDay}::date
          `
        : [];
      scorerChanged = !sameScorer(beforeRow, after);
      if (scorerChanged) afterValue = null;
    }
    const verdict = changeVerdict(entry, before, afterValue);
    result.judged.push({ pr: entry.pr, metric: entry.metric, verdict, before, after: afterValue, ...(scorerChanged ? { scorerChanged } : {}) });
    if (options.dryRun) continue;
    await inSavepoint(db, (scope) => scope`
      UPDATE change_outcomes
         SET after_snapshot_date = ${isoDay(after?.snapshot_date)}::date,
             after_value = ${afterValue},
             verdict = ${verdict},
             checked_at = NOW(),
             updated_at = NOW(),
             agent_run_id = ${options.runId}
       WHERE pr_number = ${entry.pr} AND metric = ${entry.metric} AND verdict = 'pending'
    `);
  }
  result.hitRate = await inSavepoint(db, (scope) => readHitRate(scope)).catch(() => null);
  return result;
}

export function summarizeChangeOutcomes(result: ChangeOutcomesResult): string {
  if (!result.ready) return "Skipped the 7-day change check: the change_outcomes table is not in the database yet.";
  const count = (verdict: ChangeVerdict) => result.judged.filter((row) => row.verdict === verdict).length;
  const judged = result.judged.length;
  const flagged = result.judged
    .filter((row) => row.verdict === "no_change" || row.verdict === "wrong_way")
    .map((row) => `#${row.pr} ${row.verdict === "wrong_way" ? "moved the wrong way" : "did not move"} ${row.metric}`);
  const rescored = result.judged.filter((row) => row.scorerChanged).length;
  const hitRate = result.hitRate ? ` So far ${hitRateLine(result.hitRate)}.` : "";
  return `Checked ${judged} change${judged === 1 ? "" : "s"} a week after merge: ${count("moved_as_expected")} moved as expected, ${count("no_change")} no change, ${count("wrong_way")} the wrong way, ${count("unreadable")} unreadable${rescored > 0 ? ` (${rescored} because the answer-key scorer changed in between)` : ""}. Started ${result.started}; ${result.pending} still within their week.${flagged.length > 0 ? ` To explain or revert: ${flagged.join("; ")}.` : ""}${hitRate}`;
}
