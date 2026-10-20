import { DARWIN_VERIFY_STRATEGY, darwinDueSql } from "@/lib/agents/darwin/verify";
import { DARWIN_HELD_REASON_CODES } from "@/lib/agents/agent-health";
import { HAMILTON_PUBLISH_MIN_INSTITUTION_FEES } from "@/lib/agents/hamilton/publish";
import { RANGE_BAND_FLAG } from "@/lib/agents/knox/held-recheck";
import type { LessonAgent } from "@/lib/agents/learning/lesson-types";

/**
 * Every pile of work in the pipeline, with its owner and its alarm (#1108). Reviews on
 * 2026-10-12 found piles nobody owned: about 38,000 Knox held lines (#1102), Darwin's unverified
 * backlog (#1052) and 1,235 banks held back by the 3-fee rule because their only document is a
 * product page (#1051). Each entry names the agent that owns the pile, one read-only query for its
 * size and its oldest item, how old an item may get, and how long a pile may grow before the
 * scorecard alarms. The daily scoreboard measures them all (`queue-board.ts`).
 *
 * `scripts/ci-guards.sh queue-owner-kill` fails when a migration creates a `*_queue` table that no
 * entry here lists in `tables`, so a new queue cannot ship without an owner and an alarm.
 */

export interface PipelineQueue {
  /** Stable key; the board's history is matched on it. Lower-case words joined by underscores. */
  key: string;
  label: string;
  /** The agent whose work moves the pile. */
  owner: LessonAgent;
  /** The tables the query reads. `queue-owner-kill` looks a `*_queue` table up here. */
  tables: readonly string[];
  /** One read-only SELECT returning `size` (int) and `oldest` (timestamptz or null). */
  sql: string;
  /** What `oldest` measures, in plain words. */
  ageMeans: string;
  /** An item older than this many days fires the age alarm. */
  ageLimitDays: number;
  /** A pile bigger today than this many days ago fires the growth alarm. */
  growthWindowDays: number;
  /** How the pile empties today, or "none" and why. */
  wayOut: string;
  issues: readonly number[];
}

/** James, #1108: an alarm fires when a pile has grown for two weeks. */
export const QUEUE_GROWTH_WINDOW_DAYS = 14;

const lit = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Knox lines kept without going to Darwin and still waiting (the shapes `held-queue.ts` groups). */
const KNOX_HELD_SQL = `
  SELECT COUNT(*)::int AS size, MIN(fr.created_at) AS oldest
    FROM raw_fee_observations fr
   WHERE fr.source = 'knox'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(fr.outlier_flags) f
                  WHERE f LIKE 'knox_review:%' AND f <> 'knox_review:taken_down')
     AND NOT (fr.outlier_flags ? 'needs_darwin_verification')
     AND NOT (fr.outlier_flags ? 'knox_set_aside')
     AND NOT (fr.outlier_flags ? ${lit(RANGE_BAND_FLAG)})
     AND NOT (fr.outlier_flags ?| array['superseded_by_newer_copy', 'superseded_by_reread'])`;

/** Rows Darwin's verify step would select now; age counts only rows with no decision at this rule version. */
const DARWIN_UNDECIDED_SQL = `
  SELECT COUNT(*)::int AS size,
         MIN(fr.created_at) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM pipeline_attempts first
            WHERE first.input_fingerprint = 'raw:' || fr.fee_raw_id::text
              AND first.strategy = ${lit(DARWIN_VERIFY_STRATEGY.strategy)}
              AND first.strategy_version = ${Number(DARWIN_VERIFY_STRATEGY.version)}
         )) AS oldest
    FROM raw_fee_observations fr
   WHERE ${darwinDueSql()}`;

/** Not due, latest rules decision a hold the release review looks at (as agent-health's `heldForReview`). */
const DARWIN_HELD_SQL = `
  SELECT COUNT(*)::int AS size, MIN(flagged.created_at) AS oldest
    FROM (
      SELECT fr.created_at,
             (${darwinDueSql()}) AS due,
             (SELECT pa.detail->>'reason_code' FROM pipeline_attempts pa
               WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
                 AND pa.strategy = ${lit(DARWIN_VERIFY_STRATEGY.strategy)}
                 AND pa.strategy_version = ${Number(DARWIN_VERIFY_STRATEGY.version)}
               ORDER BY pa.created_at DESC, pa.id DESC
               LIMIT 1) AS latest_reason
        FROM raw_fee_observations fr
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         AND NOT (fr.outlier_flags ? 'audience_correction_required')
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
      OFFSET 0
    ) flagged
   WHERE NOT flagged.due
     AND flagged.latest_reason IN (${DARWIN_HELD_REASON_CODES.map(lit).join(", ")})`;

/** Active banks with verified fees but too few categories for the catalog (#1051). */
const HIDDEN_BANKS_SQL = `
  SELECT COUNT(*)::int AS size, MIN(hidden.since) AS oldest
    FROM (
      SELECT fv.institution_id, MAX(fv.created_at) AS since
        FROM verified_fee_observations fv
        JOIN institution_sources inst ON inst.id = fv.institution_id
       WHERE fv.review_status <> 'rejected'
         AND COALESCE(inst.status, 'active') = 'active'
         AND NOT EXISTS (SELECT 1 FROM published_fee_catalog c WHERE c.institution_id = fv.institution_id)
       GROUP BY fv.institution_id
      HAVING COUNT(DISTINCT fv.canonical_fee_key) < ${Number(HAMILTON_PUBLISH_MIN_INSTITUTION_FEES)}
    ) hidden`;

export const PIPELINE_QUEUES: readonly PipelineQueue[] = [
  {
    key: "knox_held_lines",
    label: "Knox held lines",
    owner: "knox",
    tables: ["raw_fee_observations"],
    sql: KNOX_HELD_SQL,
    ageMeans: "the oldest held line's extraction",
    ageLimitDays: 30,
    growthWindowDays: QUEUE_GROWTH_WINDOW_DAYS,
    wayOut: "Knox's held re-checks (held-recheck.ts) and the weekly name labels at /admin/knox/labels; ranges wait on range storage (#1060).",
    issues: [1102],
  },
  {
    key: "darwin_undecided",
    label: "Darwin's undecided Knox rows",
    owner: "darwin",
    tables: ["raw_fee_observations", "verified_fee_observations", "pipeline_attempts"],
    sql: DARWIN_UNDECIDED_SQL,
    ageMeans: "the oldest due row with no decision at today's rule version",
    ageLimitDays: 7,
    growthWindowDays: QUEUE_GROWTH_WINDOW_DAYS,
    wayOut: "Darwin's verify step, oldest first.",
    issues: [1052],
  },
  {
    key: "darwin_held_for_review",
    label: "Fees Darwin holds for review",
    owner: "darwin",
    tables: ["raw_fee_observations", "verified_fee_observations", "pipeline_attempts"],
    sql: DARWIN_HELD_SQL,
    ageMeans: "the oldest held fee's extraction",
    ageLimitDays: 30,
    growthWindowDays: QUEUE_GROWTH_WINDOW_DAYS,
    wayOut: "Darwin's release review (release-held.ts): rejects leave the pile; releases stay paused until its 20-fee hand check passes.",
    issues: [1052],
  },
  {
    key: "hidden_by_fee_minimum",
    label: "Banks held back by the 3-fee rule",
    owner: "magellan",
    tables: ["verified_fee_observations", "institution_sources", "published_fee_catalog"],
    sql: HIDDEN_BANKS_SQL,
    ageMeans: "the bank waiting longest since its newest verified fee",
    ageLimitDays: 30,
    growthWindowDays: QUEUE_GROWTH_WINDOW_DAYS,
    wayOut: "Magellan's companion finder searches these banks for the real fee schedule; the product page stays as context (#1051).",
    issues: [1051],
  },
  {
    key: "community_submissions_pending",
    label: "Submitted fee sources to review",
    owner: "magellan",
    tables: ["community_fee_submissions"],
    sql: `
  SELECT COUNT(*)::int AS size, MIN(created_at) AS oldest
    FROM community_fee_submissions
   WHERE review_status = 'pending'`,
    ageMeans: "the oldest pending submission",
    ageLimitDays: 14,
    growthWindowDays: QUEUE_GROWTH_WINDOW_DAYS,
    wayOut: "A person accepts or rejects each at /admin/quality; an accepted link becomes a hand-found source Magellan's priority path reads (#1038).",
    issues: [1038],
  },
  {
    key: "source_validation_queue_open",
    label: "Open rows in the old source validation queue",
    owner: "magellan",
    tables: ["source_validation_queue"],
    sql: `
  SELECT COUNT(*)::int AS size, MIN(created_at) AS oldest
    FROM source_validation_queue
   WHERE queue_status NOT IN ('completed', 'canceled')`,
    ageMeans: "the oldest open row",
    ageLimitDays: 30,
    growthWindowDays: QUEUE_GROWTH_WINDOW_DAYS,
    wayOut: "None: no agent reads this table since #1038 sent accepted links to hand-found sources. Any open row is a leftover for its owner to close.",
    issues: [1038],
  },
];

const WRITE_WORDS = /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|copy|call|do|lock|vacuum|refresh|set|reset|nextval|setval)\b/i;

/** Pure: why a queue entry is not well formed (empty when it is). The registry test runs this on every entry. */
export function queueEntryProblems(entry: PipelineQueue): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(entry.key)) problems.push(`key "${entry.key}" must be lower-case words joined by underscores`);
  if (!entry.label.trim()) problems.push("label is empty");
  if (!entry.wayOut.trim()) problems.push("wayOut is empty");
  if (!entry.ageMeans.trim()) problems.push("ageMeans is empty");
  if (!(entry.ageLimitDays > 0)) problems.push("ageLimitDays must be positive");
  if (!(entry.growthWindowDays > 0)) problems.push("growthWindowDays must be positive");
  if (entry.tables.length === 0) problems.push("tables is empty");
  const body = entry.sql.trim();
  if (!/^(select|with)\b/i.test(body)) problems.push("sql must be one SELECT (or WITH ... SELECT)");
  // Strip quoted literals first: a flag such as 'superseded_by_reread' is data, not a statement.
  const words = body.replace(/'(?:[^']|'')*'/g, "''");
  const write = words.match(WRITE_WORDS);
  if (write) problems.push(`sql must be read-only (found "${write[0]}")`);
  if (words.includes(";")) problems.push("sql must be one statement (no semicolon)");
  if (!/\bAS size\b/.test(body) || !/\bAS oldest\b/.test(body)) problems.push("sql must return the columns size and oldest");
  for (const table of entry.tables) {
    if (!new RegExp(`\\b${table}\\b`).test(body)) problems.push(`sql does not read the listed table ${table}`);
  }
  return problems;
}
