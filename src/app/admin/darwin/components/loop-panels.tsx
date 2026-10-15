import { sql } from "@/lib/data-store/connection";
import { DARWIN_VERIFY_STRATEGY } from "@/lib/agents/darwin/verify";

/**
 * Darwin's loop, read from the current ledgers (#1115 step 4): its steps (`agent_run_steps`), its
 * decisions (`pipeline_attempts`, `verify.rules`), the daily health numbers stored with the
 * scoreboard (`pipeline_scoreboard_snapshots.detail.agent_health`), and the learning store
 * (`pipeline_feedback`). The tables these cards read before (`agent_events`, `agent_lessons`,
 * `classification_cache`, `knox_overrides`, `agent_messages`) are no longer written.
 */

interface StepRow {
  id: string;
  step_key: string;
  status: string;
  summary: string | null;
  at: string | null;
}

interface StepStats {
  steps_24h: number;
  completed_24h: number;
  failed_24h: number;
  last_at: string | null;
  last_status: string | null;
}

interface PoolStats {
  snapshot_date: string | null;
  undecided: number | null;
  held: number | null;
  final_rejects: number | null;
  waiting_over_7d: number | null;
  rejected_24h: number;
}

interface ReasonRow {
  reason: string;
  count: number;
}

interface LearningRow {
  label: string;
  count: number;
  hint: string;
}

async function getSteps(): Promise<StepRow[]> {
  try {
    const rows = await sql<StepRow[]>`
      SELECT id::text, step_key, status, summary, COALESCE(completed_at, started_at)::text AS at
        FROM agent_run_steps
       WHERE agent_name = 'darwin' AND started_at IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 8
    `;
    return rows;
  } catch {
    return [];
  }
}

async function getStepStats(): Promise<StepStats> {
  try {
    const [row] = await sql<Array<{ steps_24h: string; completed_24h: string; failed_24h: string; last_at: string | null; last_status: string | null }>>`
      SELECT COUNT(*)::text AS steps_24h,
             COUNT(*) FILTER (WHERE status = 'completed')::text AS completed_24h,
             COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_24h,
             MAX(COALESCE(completed_at, started_at))::text AS last_at,
             (ARRAY_AGG(status ORDER BY started_at DESC))[1] AS last_status
        FROM agent_run_steps
       WHERE agent_name = 'darwin'
         AND started_at > NOW() - INTERVAL '24 hours'
    `;
    return {
      steps_24h: Number(row?.steps_24h ?? 0),
      completed_24h: Number(row?.completed_24h ?? 0),
      failed_24h: Number(row?.failed_24h ?? 0),
      last_at: row?.last_at ?? null,
      last_status: row?.last_status ?? null,
    };
  } catch {
    return { steps_24h: 0, completed_24h: 0, failed_24h: 0, last_at: null, last_status: null };
  }
}

/** The pool split from the newest daily health check (#1375), plus today's rejections. */
async function getPool(): Promise<PoolStats> {
  const empty: PoolStats = { snapshot_date: null, undecided: null, held: null, final_rejects: null, waiting_over_7d: null, rejected_24h: 0 };
  try {
    const [snapshot] = await sql<Array<{ snapshot_date: string; numbers: Record<string, number | null> | null }>>`
      SELECT s.snapshot_date::text AS snapshot_date, section->'numbers' AS numbers
        FROM pipeline_scoreboard_snapshots s,
             jsonb_array_elements(s.detail->'agent_health'->'agents') section
       WHERE s.detail ? 'agent_health' AND section->>'agent' = 'darwin'
       ORDER BY s.snapshot_date DESC
       LIMIT 1
    `;
    const [rejected] = await sql<Array<{ n: string }>>`
      SELECT COUNT(*)::text AS n FROM pipeline_attempts
       WHERE stage = 'verify' AND strategy = ${DARWIN_VERIFY_STRATEGY.strategy} AND outcome = 'rejected'
         AND created_at > NOW() - INTERVAL '24 hours'
    `;
    const numbers = snapshot?.numbers ?? {};
    const read = (key: string) => (typeof numbers[key] === "number" ? (numbers[key] as number) : null);
    return {
      snapshot_date: snapshot?.snapshot_date ?? null,
      undecided: read("undecided"),
      held: read("heldForReview"),
      final_rejects: read("finalRejects"),
      waiting_over_7d: read("waitingOver7d"),
      rejected_24h: Number(rejected?.n ?? 0),
    };
  } catch {
    return empty;
  }
}

/** Darwin's most common rejection and hold reasons over the last 7 days. */
async function getReasons(): Promise<ReasonRow[]> {
  try {
    const rows = await sql<Array<{ reason: string; count: string }>>`
      SELECT COALESCE(detail->>'reason_code', 'none') AS reason, COUNT(*)::text AS count
        FROM pipeline_attempts
       WHERE stage = 'verify' AND strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
         AND outcome <> 'ok'
         AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY 1
       ORDER BY COUNT(*) DESC
       LIMIT 5
    `;
    return rows.map((row) => ({ reason: row.reason, count: Number(row.count) }));
  } catch {
    return [];
  }
}

/** What Darwin wrote to the shared learning store this week, and the labels people gave. */
async function getLearning(): Promise<LearningRow[]> {
  try {
    const [row] = await sql<Array<{ darwin_7d: string; labels: string }>>`
      SELECT (SELECT COUNT(*) FROM pipeline_feedback
               WHERE reported_by = 'darwin' AND created_at > NOW() - INTERVAL '7 days')::text AS darwin_7d,
             -- A label's key is 'knox.name_label:<name>': a range on the unique index, not a scan.
             (SELECT COUNT(*) FROM pipeline_feedback
               WHERE dedupe_key >= 'knox.name_label:' AND dedupe_key < 'knox.name_label;')::text AS labels
    `;
    return [
      { label: "Darwin verdicts logged (7d)", count: Number(row?.darwin_7d ?? 0), hint: "pipeline_feedback rows Darwin wrote" },
      { label: "Fee-name labels", count: Number(row?.labels ?? 0), hint: "a person's labels, /admin/knox/labels" },
    ];
  } catch {
    return [];
  }
}

function formatAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const count = (value: number | null) => (value == null ? "not recorded" : value.toLocaleString());

export async function LoopPanels() {
  const [steps, stats, pool, reasons, learning] = await Promise.all([getSteps(), getStepStats(), getPool(), getReasons(), getLearning()]);

  const healthy = stats.last_at !== null && stats.last_status === "completed";

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      {/* LOG */}
      <div className="admin-card p-4 min-h-52">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          LOG
        </div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-1">
          Log
        </div>
        <div className="text-[11px] text-gray-400">latest Darwin steps → agent_run_steps</div>
        <ul className="mt-3 space-y-1 text-[11px] text-gray-600 dark:text-gray-400">
          {steps.length === 0 && <li className="text-gray-400">No steps yet.</li>}
          {steps.map((step) => (
            <li key={step.id} className="truncate" title={step.summary ?? undefined}>
              <span className="text-gray-900 dark:text-gray-200">{step.step_key}</span> — {step.status}{" "}
              <span className="text-gray-400">{formatAgo(step.at)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* REVIEW */}
      <div className="admin-card p-4 min-h-52">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          REVIEW
        </div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-1">
          Review
        </div>
        <div className="text-[11px] text-gray-400">Darwin steps in the last 24 hours</div>
        <div className="mt-3 space-y-1.5 text-[11px]">
          <div>
            <span className="text-gray-400">Last step:</span>{" "}
            <span
              className={`font-semibold tabular-nums ${
                healthy
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {formatAgo(stats.last_at)}
              {stats.last_status ? ` (${stats.last_status})` : ""}
            </span>
          </div>
          <div>
            <span className="text-gray-400">24h steps:</span>{" "}
            <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
              {stats.steps_24h}
            </span>{" "}
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
              {stats.completed_24h} completed
            </span>
            {stats.failed_24h > 0 && (
              <>
                {" "}
                <span className="text-[10px] text-red-600 dark:text-red-400">
                  {stats.failed_24h} failed
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* DISSECT */}
      <div className="admin-card p-4 min-h-52">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          DISSECT
        </div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-1">
          Dissect
        </div>
        <div className="text-[11px] text-gray-400">
          {pool.snapshot_date ? `Knox rows not verified, health check of ${pool.snapshot_date}` : "Knox rows not verified"}
        </div>
        <div className="mt-3 space-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-gray-500">Due for a decision</span>
            <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{count(pool.undecided)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Held for review</span>
            <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{count(pool.held)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Rejected (final)</span>
            <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{count(pool.final_rejects)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">No first decision after 7 days</span>
            <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">{count(pool.waiting_over_7d)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Rejected in the last 24h</span>
            <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{pool.rejected_24h.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* UNDERSTAND */}
      <div className="admin-card p-4 min-h-52">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          UNDERSTAND
        </div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-1">
          Understand
        </div>
        <div className="text-[11px] text-gray-400">
          top reasons Darwin did not verify (7d)
        </div>
        <ul className="mt-3 space-y-1.5 text-[11px]">
          {reasons.length === 0 && (
            <li className="text-gray-400 italic">No rejections or holds in the last 7 days.</li>
          )}
          {reasons.map((row) => (
            <li key={row.reason} className="truncate">
              <span className="font-mono text-[10px] text-gray-700 dark:text-gray-300">{row.reason}</span>{" "}
              <span className="tabular-nums text-red-600 dark:text-red-400">×{row.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* IMPROVE */}
      <div className="admin-card p-4 min-h-52">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          IMPROVE
        </div>
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-1">
          Improve
        </div>
        <div className="text-[11px] text-gray-400">the shared learning store</div>
        <ul className="mt-3 space-y-1.5 text-[11px]">
          {learning.length === 0 && (
            <li className="text-gray-400 italic">The learning store could not be read.</li>
          )}
          {learning.map((row) => (
            <li key={row.label}>
              <div className="flex justify-between">
                <span className="text-gray-500">{row.label}</span>
                <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                  {row.count.toLocaleString()}
                </span>
              </div>
              <div className="text-[10px] text-gray-400">{row.hint}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
