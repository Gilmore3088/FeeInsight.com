import { sql } from '@/lib/data-store/connection';

type SqlTag = typeof sql;
export interface EngineeringEvidenceRequest { deployedSha: string; since: string; until: string; changeKeys: string[] }
type SourceRow = Record<string, unknown>;
const MAX_DEMING_ROWS = 512;

export function parseEngineeringEvidenceRequest(params: URLSearchParams, now = new Date()): EngineeringEvidenceRequest {
  const deployedSha = params.get('deployedSha') ?? '', since = params.get('since') ?? '', until = params.get('until') ?? '';
  if (!/^[a-f0-9]{40}$/i.test(deployedSha)) throw new Error('Valid deployed SHA required');
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > now.getTime() + 60_000 || end - start > 90 * 86_400_000) throw new Error('Observation bounds must span at most 90 days and cannot be future dates');
  const changeKeys = params.getAll('changeKey');
  if (changeKeys.length > 50 || new Set(changeKeys).size !== changeKeys.length || changeKeys.some(key => !/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]{1,100}$/.test(key))) throw new Error('At most 50 unique replay change keys required');
  return { deployedSha, since, until, changeKeys };
}
const iso = (value: unknown): string | null => {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const at = new Date(value); return Number.isFinite(at.getTime()) ? at.toISOString() : null;
};
function executionIdentity(row: SourceRow) {
  const detail = row.execution as Record<string, unknown> | null;
  if (detail?.protocol !== 1 || !/^[a-f0-9]{40}$/i.test(String(detail?.deployment_sha ?? '')) || !['production', 'preview', 'development'].includes(String(detail?.environment ?? ''))) return null;
  return { deployedSha: String(detail.deployment_sha), environment: String(detail.environment), eventId: row.execution_event_id == null ? null : Number(row.execution_event_id) };
}

/** Existing schema only. Missing historical execution identities and independent exclusion approvals stay unknown. */
export async function readEngineeringRuntimeEvidence(request: EngineeringEvidenceRequest, db: SqlTag = sql, now = new Date()) {
  const problems: string[] = [];
  const read = async (label: string, work: () => Promise<SourceRow[]>) => {
    try { return await work(); } catch { problems.push(`${label} ledger read unavailable`); return []; }
  };
  const [scores, replayChecks] = await Promise.all([
    read('Deming', async () => db<SourceRow[]>`
      SELECT e.id AS event_id, e.agent_run_id AS run_id, e.step_id, e.detail AS score,
             e.created_at AS event_at, r.agent_name AS run_agent, s.status AS step_status,
             x.detail AS execution, x.id AS execution_event_id
        FROM agent_run_events e
        JOIN agent_run_steps s ON s.id = e.step_id AND s.agent_run_id = e.agent_run_id
        JOIN agent_runs r ON r.id = e.agent_run_id
        LEFT JOIN LATERAL (
          SELECT x.id, x.detail FROM agent_run_events x
           WHERE x.agent_run_id = e.agent_run_id AND x.step_id = e.step_id
             AND x.event_type = 'step.execution' AND x.created_at <= e.created_at
           ORDER BY x.created_at DESC, x.id DESC LIMIT 1
        ) x ON TRUE
       WHERE e.event_type = 'deming.fixed_cohort_accuracy' AND s.step_key = 'score-answer-key'
         AND e.created_at >= ${request.since}::timestamptz AND e.created_at <= ${request.until}::timestamptz
       ORDER BY e.created_at, e.id LIMIT ${MAX_DEMING_ROWS + 1}`),
    request.changeKeys.length === 0 ? Promise.resolve([] as SourceRow[]) : read('Bayes', async () => db<SourceRow[]>`
      SELECT DISTINCT ON (j.change_key) c.id AS check_id, c.agent_run_id AS run_id,
             s.id AS step_id, s.status AS step_status, j.change_key, j.manifest_key,
             c.status, c.affected, c.done, c.queued, c.excluded, c.exclusions, c.note, c.checked_at,
             x.detail AS execution, x.id AS execution_event_id
        FROM replay_jobs j JOIN replay_job_checks c ON c.job_id = j.id
        LEFT JOIN agent_run_steps s ON s.agent_run_id = c.agent_run_id AND s.step_key = 'bayes-replay-ledger'
        LEFT JOIN LATERAL (
          SELECT x.id, x.detail FROM agent_run_events x
           WHERE x.agent_run_id = c.agent_run_id AND x.step_id = s.id
             AND x.event_type = 'step.execution' AND x.created_at <= c.checked_at
           ORDER BY x.created_at DESC, x.id DESC LIMIT 1
        ) x ON TRUE
       WHERE j.change_key = ANY(${request.changeKeys}::text[])
         AND c.checked_at >= ${request.since}::timestamptz AND c.checked_at <= ${request.until}::timestamptz
       ORDER BY j.change_key, c.checked_at DESC, c.id DESC LIMIT 50`),
  ]);
  if (scores.length > MAX_DEMING_ROWS) problems.push('Deming ledger inventory truncated; shorten observation bounds');
  const deming = scores.slice(0, MAX_DEMING_ROWS).map(row => ({ eventId: Number(row.event_id), runId: Number(row.run_id), stepId: Number(row.step_id), runAgent: String(row.run_agent), stepKey: 'score-answer-key', eventType: 'deming.fixed_cohort_accuracy', stepStatus: String(row.step_status), eventAt: iso(row.event_at), execution: executionIdentity(row), score: row.score }));
  const bayes = replayChecks.map(row => ({ checkId: Number(row.check_id), runId: row.run_id == null ? null : Number(row.run_id), stepId: row.step_id == null ? null : Number(row.step_id), stepKey: 'bayes-replay-ledger', stepStatus: String(row.step_status ?? ''), changeKey: String(row.change_key), manifestKey: String(row.manifest_key), checkedAt: iso(row.checked_at), status: String(row.status), affected: Number(row.affected), done: Number(row.done), queued: Number(row.queued), excluded: Number(row.excluded), exclusions: row.exclusions, note: row.note, execution: executionIdentity(row) }));
  const atlas = [...deming, ...bayes].map(row => ({ runId: row.runId, stepId: row.stepId, status: row.stepStatus, execution: row.execution }));
  return { schemaVersion: 1, collectedAt: now.toISOString(), request, provenance: { kind: 'authenticated-admin-ledger', apiBuildSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, environment: process.env.VERCEL_ENV ?? null, identityMeaning: 'apiBuildSha identifies this response server only; step.execution identifies historical work' }, atlas, deming, bayes, exclusionAuthorizations: [], problems };
}
