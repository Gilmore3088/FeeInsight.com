import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { changeKey, loadManifests, type ReplayCount, type ReplayManifest } from "@/lib/agents/bayes/manifests";

type SqlTag = typeof sql;

/**
 * Bayes's replay ledger step (`bayes-replay-ledger`, Agentic OS PRD 8 and WP-06/07).
 *
 * For every declared change (`manifests.ts`) it counts the records an older version processed:
 * done at this version, queued by the owner's own selection, or excluded with a reason. It writes
 * one `replay_jobs` row per change and appends one `replay_job_checks` row per count. A job
 * closes when nothing is queued; it is `stuck` when its queue has not moved across
 * `STUCK_AFTER_CHECKS` counts (the PRD's no-progress loop). Bayes only counts: the agents that
 * own each rerun keep doing the re-processing, inside their own budgets and pause controls.
 *
 * A row keyed at an older version of a manifest the code still declares is superseded: the code no
 * longer counts it, so without a close it would stay open or stuck with its last count forever and
 * every version bump would add a frozen row to the backlog. Each run closes those rows with the note
 * `superseded by <current change key>` and one check row, and names them in the step detail (v2).
 *
 * Deterministic: no model calls, no fee rows written.
 */

export const BAYES_LEDGER_VERSION = 2;
export const SUPERSEDED_NOTE_PREFIX = "superseded by ";
export const STUCK_AFTER_CHECKS = 3;

export type ReplayStatus = "open" | "closed" | "stuck" | "not_counted";

export interface ReplayCheck {
  done: number;
  queued: number;
  excluded: number;
}

export interface ReplayJobResult {
  changeKey: string;
  owner: string;
  unit: string;
  status: ReplayStatus;
  affected: number;
  done: number;
  queued: number;
  excluded: number;
  exclusions: Record<string, number>;
  note: string | null;
  error?: string;
}

/** An older version's row closed because the code now declares a newer version of its manifest. */
export interface SupersededJob {
  changeKey: string;
  manifestKey: string;
  supersededBy: string;
  /** The status and queue it had at its last count, kept on the row as history. */
  previousStatus: string;
  lastQueued: number;
}

export interface BayesLedgerResult {
  schemaReady: boolean;
  dryRun: boolean;
  jobs: ReplayJobResult[];
  /** Open or stuck rows of an older version closed (dry run: that would be closed) this run. */
  superseded: SupersededJob[];
  /** Set when closing superseded rows failed; the counts above still stand. */
  supersededError?: string;
  closed: number;
  open: number;
  stuck: number;
  notCounted: number;
  failed: number;
  queuedRecords: number;
}

const sumValues = (record: Record<string, number>): number => Object.values(record).reduce((total, value) => total + value, 0);

/**
 * Pure: a change's status from today's count and its earlier checks (newest first). Done and
 * excluded records are terminal, so a job with nothing queued is closed.
 */
export function replayStatus(count: ReplayCount | null, history: ReplayCheck[]): ReplayStatus {
  if (!count) return "not_counted";
  if (count.queued <= 0) return "closed";
  const needed = STUCK_AFTER_CHECKS - 1;
  if (history.length < needed) return "open";
  const oldest = history[needed - 1];
  const settled = count.done + sumValues(count.exclusions);
  const allQueued = history.slice(0, needed).every((check) => check.queued > 0);
  return allQueued && settled <= oldest.done + oldest.excluded ? "stuck" : "open";
}

export async function replayLedgerSchemaReady(db: SqlTag): Promise<boolean> {
  const [row] = await db`
    SELECT to_regclass('public.replay_jobs') IS NOT NULL AND to_regclass('public.replay_job_checks') IS NOT NULL AS ready
  `;
  return row?.ready === true;
}

async function loadHistory(db: SqlTag, key: string): Promise<ReplayCheck[]> {
  const rows = await db<Array<{ done: number; queued: number; excluded: number }>>`
    SELECT c.done, c.queued, c.excluded
      FROM replay_job_checks c
      JOIN replay_jobs j ON j.id = c.job_id
     WHERE j.change_key = ${key}
     ORDER BY c.checked_at DESC, c.id DESC
     LIMIT ${STUCK_AFTER_CHECKS}
  `;
  return rows.map((row) => ({ done: Number(row.done), queued: Number(row.queued), excluded: Number(row.excluded) }));
}

/**
 * Pure: for each manifest key the code declares, its current change key. A manifest key declared
 * twice keeps the first (`loadManifests` keys are unique; its test checks that).
 */
export function currentChangeKeys(manifests: ReplayManifest[]): Map<string, string> {
  const current = new Map<string, string>();
  for (const manifest of manifests) if (!current.has(manifest.key)) current.set(manifest.key, changeKey(manifest));
  return current;
}

export const supersededNote = (currentKey: string): string => `${SUPERSEDED_NOTE_PREFIX}${currentKey}`;

/**
 * Closes every open or stuck row whose manifest the code declares at another change key, with the
 * note `superseded by <current key>` and one appended check row. The row keeps its last counts as
 * history. Touches only `replay_jobs` and `replay_job_checks`; a closed or not_counted row is left
 * as it is, so a second run closes nothing more (idempotent). A dry run only reads.
 */
export async function closeSupersededJobs(
  db: SqlTag,
  current: Map<string, string>,
  { runId, dryRun }: { runId: number | null; dryRun: boolean },
): Promise<SupersededJob[]> {
  if (current.size === 0) return [];
  const manifestKeys = [...current.keys()];
  const currentKeys = manifestKeys.map((key) => current.get(key) as string);
  const rows = await db<Array<{ id: number | string; change_key: string; manifest_key: string; status: string; queued: number | string }>>`
    SELECT j.id, j.change_key, j.manifest_key, j.status, j.queued
      FROM replay_jobs j
      JOIN UNNEST(${manifestKeys}::text[], ${currentKeys}::text[]) AS c(manifest_key, change_key)
        ON c.manifest_key = j.manifest_key
     WHERE j.status IN ('open', 'stuck')
       AND j.change_key <> c.change_key
     ORDER BY j.manifest_key, j.id
  `;
  const closed: SupersededJob[] = [];
  for (const row of rows) {
    const supersededBy = current.get(row.manifest_key) as string;
    const job: SupersededJob = {
      changeKey: row.change_key,
      manifestKey: row.manifest_key,
      supersededBy,
      previousStatus: row.status,
      lastQueued: Number(row.queued ?? 0),
    };
    if (!dryRun) {
      const note = supersededNote(supersededBy);
      const [updated] = await db<Array<{ id: number | string }>>`
        UPDATE replay_jobs
           SET status = 'closed', note = ${note}, closed_at = COALESCE(closed_at, NOW()),
               last_run_id = ${runId}, updated_at = NOW()
         WHERE id = ${Number(row.id)} AND status IN ('open', 'stuck')
        RETURNING id
      `;
      if (!updated) continue;
      await db`
        INSERT INTO replay_job_checks (job_id, agent_run_id, status, affected, done, queued, excluded, exclusions, note)
        SELECT id, ${runId}, 'closed', affected, done, queued, excluded, exclusions, ${note}
          FROM replay_jobs WHERE id = ${Number(row.id)}
      `;
    }
    closed.push(job);
  }
  return closed;
}

async function writeJob(db: SqlTag, manifest: ReplayManifest, job: ReplayJobResult, runId: number | null): Promise<void> {
  const [row] = await db<Array<{ id: number | string }>>`
    INSERT INTO replay_jobs (
      change_key, manifest_key, owner_agent, stage, strategy, version, unit, affects, status,
      affected, done, queued, excluded, exclusions, note, closed_at, last_checked_at, last_run_id
    ) VALUES (
      ${job.changeKey}, ${manifest.key}, ${manifest.owner}, ${manifest.stage}, ${manifest.strategy}, ${manifest.version},
      ${manifest.unit}, ${manifest.affects}, ${job.status}, ${job.affected}, ${job.done}, ${job.queued}, ${job.excluded},
      ${JSON.stringify(job.exclusions)}::jsonb, ${job.note},
      CASE WHEN ${job.status}::text = 'closed' THEN NOW() END, NOW(), ${runId}
    )
    ON CONFLICT (change_key) DO UPDATE SET
      status = EXCLUDED.status,
      affected = EXCLUDED.affected,
      done = EXCLUDED.done,
      queued = EXCLUDED.queued,
      excluded = EXCLUDED.excluded,
      exclusions = EXCLUDED.exclusions,
      note = EXCLUDED.note,
      closed_at = CASE WHEN EXCLUDED.status = 'closed' THEN COALESCE(replay_jobs.closed_at, NOW()) ELSE NULL END,
      last_checked_at = NOW(),
      last_run_id = EXCLUDED.last_run_id,
      updated_at = NOW()
    RETURNING id
  `;
  await db`
    INSERT INTO replay_job_checks (job_id, agent_run_id, status, affected, done, queued, excluded, exclusions, note)
    VALUES (${Number(row.id)}, ${runId}, ${job.status}, ${job.affected}, ${job.done}, ${job.queued}, ${job.excluded},
            ${JSON.stringify(job.exclusions)}::jsonb, ${job.note})
  `;
}

export async function runBayesLedger({
  runId,
  dryRun = false,
  db = sql,
  manifests,
}: {
  runId: number | null;
  dryRun?: boolean;
  db?: SqlTag;
  manifests?: ReplayManifest[];
}): Promise<BayesLedgerResult> {
  const result: BayesLedgerResult = {
    schemaReady: false,
    dryRun,
    jobs: [],
    superseded: [],
    closed: 0,
    open: 0,
    stuck: 0,
    notCounted: 0,
    failed: 0,
    queuedRecords: 0,
  };
  result.schemaReady = await replayLedgerSchemaReady(db);
  if (!result.schemaReady) return result;

  const declared = manifests ?? (await loadManifests());
  for (const manifest of declared) {
    const key = changeKey(manifest);
    let count: ReplayCount | null = null;
    let error: string | undefined;
    if (manifest.count) {
      const counter = manifest.count;
      try {
        count = await inSavepoint(db, (scope) => counter(scope));
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
    if (error) {
      // A count that failed is reported, never written as a check: it would read as no progress.
      result.failed += 1;
      result.jobs.push({
        changeKey: key, owner: manifest.owner, unit: manifest.unit, status: "open",
        affected: 0, done: 0, queued: 0, excluded: 0, exclusions: {}, note: null, error,
      });
      continue;
    }
    const history = await inSavepoint(db, (scope) => loadHistory(scope, key));
    const status = replayStatus(count, history);
    const job: ReplayJobResult = {
      changeKey: key,
      owner: manifest.owner,
      unit: manifest.unit,
      status,
      affected: count?.affected ?? 0,
      done: count?.done ?? 0,
      queued: count?.queued ?? 0,
      excluded: count ? sumValues(count.exclusions) : 0,
      exclusions: count?.exclusions ?? {},
      note: count?.note ?? manifest.notCounted ?? null,
    };
    result.jobs.push(job);
    if (status === "closed") result.closed += 1;
    if (status === "open") result.open += 1;
    if (status === "stuck") result.stuck += 1;
    if (status === "not_counted") result.notCounted += 1;
    result.queuedRecords += job.queued;
    if (!dryRun) await writeJob(db, manifest, job, runId);
  }
  // After the current rows are written, so each superseded row points at a row that exists.
  try {
    result.superseded = await inSavepoint(db, (scope) => closeSupersededJobs(scope, currentChangeKeys(declared), { runId, dryRun }));
  } catch (caught) {
    result.supersededError = caught instanceof Error ? caught.message : String(caught);
  }
  return result;
}

export function summarizeBayesLedger(result: BayesLedgerResult): string {
  if (!result.schemaReady) return "Bayes counted nothing: the replay ledger tables are not created yet.";
  const counted = result.jobs.length - result.notCounted - result.failed;
  const parts = [
    `${result.closed} closed`,
    `${result.open} open with ${result.queuedRecords} records queued`,
    result.stuck > 0 ? `${result.stuck} stuck (queue not moving)` : null,
  ].filter(Boolean);
  const tail = [
    result.notCounted > 0 ? `${result.notCounted} not countable yet` : null,
    result.failed > 0 ? `${result.failed} counts failed` : null,
    result.superseded.length > 0
      ? `${result.dryRun ? "Would close" : "Closed"} ${result.superseded.length} superseded older-version ${result.superseded.length === 1 ? "row" : "rows"} (${result.superseded.reduce((total, job) => total + job.lastQueued, 0)} stale queued, not in the queue)`
      : null,
    result.supersededError ? `closing superseded rows failed (${result.supersededError})` : null,
  ].filter(Boolean);
  return `${result.dryRun ? "Would record" : "Recorded"} ${counted} rule changes: ${parts.join(", ")}.${tail.length > 0 ? ` ${tail.join("; ")}.` : ""}`;
}
