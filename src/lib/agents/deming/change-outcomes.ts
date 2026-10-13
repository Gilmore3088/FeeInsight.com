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
 * - `unreadable`: the scoreboard does not hold the number on one of the two days.
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
  judged: Array<{ pr: number; metric: string; verdict: ChangeVerdict; before: number | null; after: number | null }>;
  pending: number;
}

interface OutcomeRow {
  pr_number: number | string;
  metric: string;
  first_seen_date: string | Date;
  before_value: number | string | null;
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
  const result: ChangeOutcomesResult = { ready: false, entries: entries.length, started: 0, judged: [], pending: 0 };
  const [table] = await db<{ ready: boolean }[]>`SELECT to_regclass('public.change_outcomes') IS NOT NULL AS ready`;
  if (!table?.ready) return result;
  result.ready = true;

  const [latest] = await db<Array<Record<string, unknown>>>`
    SELECT * FROM pipeline_scoreboard_snapshots WHERE snapshot_date <= ${today}::date ORDER BY snapshot_date DESC LIMIT 1
  `;
  const existing = await db<OutcomeRow[]>`SELECT pr_number, metric, first_seen_date, before_value, verdict FROM change_outcomes`;
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
      SELECT * FROM pipeline_scoreboard_snapshots WHERE snapshot_date >= ${due}::date ORDER BY snapshot_date ASC LIMIT 1
    `;
    const before = row.before_value == null ? null : Number(row.before_value);
    const afterValue = metricValue(after, entry.metric);
    const verdict = changeVerdict(entry, before, afterValue);
    result.judged.push({ pr: entry.pr, metric: entry.metric, verdict, before, after: afterValue });
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
  return result;
}

export function summarizeChangeOutcomes(result: ChangeOutcomesResult): string {
  if (!result.ready) return "Skipped the 7-day change check: the change_outcomes table is not in the database yet.";
  const count = (verdict: ChangeVerdict) => result.judged.filter((row) => row.verdict === verdict).length;
  const judged = result.judged.length;
  const flagged = result.judged
    .filter((row) => row.verdict === "no_change" || row.verdict === "wrong_way")
    .map((row) => `#${row.pr} ${row.verdict === "wrong_way" ? "moved the wrong way" : "did not move"} ${row.metric}`);
  return `Checked ${judged} change${judged === 1 ? "" : "s"} a week after merge: ${count("moved_as_expected")} moved as expected, ${count("no_change")} no change, ${count("wrong_way")} the wrong way, ${count("unreadable")} unreadable. Started ${result.started}; ${result.pending} still within their week.${flagged.length > 0 ? ` To explain or revert: ${flagged.join("; ")}.` : ""}`;
}
