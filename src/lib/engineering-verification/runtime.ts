import { sql } from '@/lib/data-store/connection';
import { normalizeRequiredExecution, type RequiredExecutionPolicy } from './evidence.mjs';

type SqlTag = typeof sql;
export interface EngineeringEvidenceRequest { deployedSha: string; since: string; until: string; changeKeys: string[]; requiredExecution?: RequiredExecutionPolicy | null }
type SourceRow = Record<string, unknown>;
const MAX_DEMING_ROWS = 512;
const MAX_OWNING_ROWS = 512;

export function parseEngineeringEvidenceRequest(params: URLSearchParams, now = new Date()): EngineeringEvidenceRequest {
  const deployedSha = params.get('deployedSha') ?? '', since = params.get('since') ?? '', until = params.get('until') ?? '';
  if (!/^[a-f0-9]{40}$/i.test(deployedSha)) throw new Error('Valid deployed SHA required');
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > now.getTime() + 60_000 || end - start > 90 * 86_400_000) throw new Error('Observation bounds must span at most 90 days and cannot be future dates');
  const changeKeys = params.getAll('changeKey');
  if (changeKeys.length > 50 || new Set(changeKeys).size !== changeKeys.length || changeKeys.some(key => !/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]{1,100}$/.test(key))) throw new Error('At most 50 unique replay change keys required');
  const declarations = params.getAll('requiredExecution');
  let requiredExecution: RequiredExecutionPolicy | null = null;
  if (declarations.length) {
    if (declarations.length !== 1 || declarations[0].length > 12_000) throw new Error('One bounded owning execution policy required');
    try { requiredExecution = normalizeRequiredExecution(JSON.parse(declarations[0])); } catch { /* Invalid JSON is never a policy. */ }
    if (!requiredExecution) throw new Error('Invalid or unsupported owning execution policy');
  }
  return { deployedSha, since, until, changeKeys, requiredExecution };
}
const iso = (value: unknown): string | null => {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const at = new Date(value); return Number.isFinite(at.getTime()) ? at.toISOString() : null;
};
function executionIdentity(row: SourceRow) {
  const detail = row.execution as Record<string, unknown> | null;
  if (detail?.protocol !== 1 || !/^[a-f0-9]{40}$/i.test(String(detail?.deployment_sha ?? '')) || !['production', 'preview', 'development'].includes(String(detail?.environment ?? ''))) return null;
  return { deployedSha: String(detail.deployment_sha), environment: String(detail.environment), eventId: row.execution_event_id == null ? null : Number(row.execution_event_id), eventAt: iso(row.execution_event_at) };
}

/** Existing schema only. Missing historical execution identities and independent exclusion approvals stay unknown. */
export async function readEngineeringRuntimeEvidence(request: EngineeringEvidenceRequest, db: SqlTag = sql, now = new Date()) {
  const problems: string[] = [];
  const requiredExecution = normalizeRequiredExecution(request.requiredExecution);
  const provenance = { kind: 'authenticated-admin-ledger', apiBuildSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, environment: process.env.VERCEL_ENV ?? null, identityMeaning: 'apiBuildSha identifies this response server only; step.execution identifies historical work' };
  if (request.requiredExecution != null && !requiredExecution) return { schemaVersion: 1, collectedAt: now.toISOString(), request, provenance, atlas: [], deming: [], bayes: [], owningExecutions: [], owningExecutionInventoryComplete: false, exclusionAuthorizations: [], problems: ['Invalid or unsupported owning execution policy'] };
  const read = async (label: string, work: () => Promise<SourceRow[]>) => {
    try { return await work(); } catch { problems.push(`${label} ledger read unavailable`); return []; }
  };
  const [scores, replayChecks, owningRows] = await Promise.all([
    read('Deming', async () => db<SourceRow[]>`
      SELECT e.id AS event_id, e.agent_run_id AS run_id, e.step_id, e.detail AS score,
             e.created_at AS event_at, r.agent_name AS run_agent, s.status AS step_status,
             x.detail AS execution, x.id AS execution_event_id, x.created_at AS execution_event_at
        FROM agent_run_events e
        JOIN agent_run_steps s ON s.id = e.step_id AND s.agent_run_id = e.agent_run_id
        JOIN agent_runs r ON r.id = e.agent_run_id
        LEFT JOIN LATERAL (
          SELECT x.id, x.detail, x.created_at FROM agent_run_events x
           WHERE x.agent_run_id = e.agent_run_id AND x.step_id = e.step_id
             AND x.event_type = 'step.execution' AND (x.created_at, x.id) < (e.created_at, e.id)
           ORDER BY x.created_at DESC, x.id DESC LIMIT 1
        ) x ON TRUE
       WHERE e.event_type = 'deming.fixed_cohort_accuracy' AND s.step_key = 'score-answer-key'
         AND e.created_at >= ${request.since}::timestamptz AND e.created_at <= ${request.until}::timestamptz
       ORDER BY e.created_at, e.id LIMIT ${MAX_DEMING_ROWS + 1}`),
    request.changeKeys.length === 0 ? Promise.resolve([] as SourceRow[]) : read('Bayes', async () => db<SourceRow[]>`
      SELECT DISTINCT ON (j.change_key) c.id AS check_id, c.agent_run_id AS run_id,
             s.id AS step_id, s.status AS step_status, j.change_key, j.manifest_key,
             c.status, c.affected, c.done, c.queued, c.excluded, c.exclusions, c.note, c.checked_at,
             x.detail AS execution, x.id AS execution_event_id, x.created_at AS execution_event_at
        FROM replay_jobs j JOIN replay_job_checks c ON c.job_id = j.id
        LEFT JOIN agent_run_steps s ON s.agent_run_id = c.agent_run_id AND s.step_key = 'bayes-replay-ledger'
        LEFT JOIN LATERAL (
          SELECT x.id, x.detail, x.created_at FROM agent_run_events x
           WHERE x.agent_run_id = c.agent_run_id AND x.step_id = s.id
             AND x.event_type = 'step.execution' AND x.created_at < c.checked_at
           ORDER BY x.created_at DESC, x.id DESC LIMIT 1
        ) x ON TRUE
       WHERE j.change_key = ANY(${request.changeKeys}::text[])
         AND c.checked_at >= ${request.since}::timestamptz AND c.checked_at <= ${request.until}::timestamptz
       ORDER BY j.change_key, c.checked_at DESC, c.id DESC LIMIT 50`),
    !requiredExecution ? Promise.resolve([] as SourceRow[]) : read('Owning execution', async () => db<SourceRow[]>`
      SELECT r.id AS run_id, r.agent_name AS run_agent, r.run_kind,
             s.id AS step_id, s.agent_name AS step_agent, s.step_key, s.status AS step_status,
             s.completed_at AS step_completed_at,
             x.detail AS execution, x.id AS execution_event_id, x.created_at AS execution_event_at,
             f.id AS completion_event_id, f.status AS completion_status, f.created_at AS completion_event_at,
             f.detail->'dry_run' AS completion_dry_run,
             f.detail->${requiredExecution.stepKey === 'extract' ? 'processed_text_artifacts' : 'processed'} AS completion_processed_count,
             p.id AS attempt_id, p.institution_id, p.source_document_id, t.id AS document_text_id,
             p.stage, p.strategy, p.strategy_version, p.outcome, p.yield_count,
             p.detail->'inserted' AS inserted_count, p.created_at AS output_at,
             (t.id IS NOT NULL AND p.created_at > x.created_at AND p.created_at < f.created_at
               AND (x.created_at, x.id) < (f.created_at, f.id)
               AND s.completed_at = f.created_at) AS output_bound
        FROM agent_run_steps s
        JOIN agent_runs r ON r.id = s.agent_run_id
        LEFT JOIN LATERAL (
          SELECT x.id, x.created_at, x.detail FROM agent_run_events x
           WHERE x.agent_run_id = s.agent_run_id AND x.step_id = s.id AND x.event_type = 'step.execution'
           ORDER BY x.created_at DESC, x.id DESC LIMIT 1
        ) x ON TRUE
        LEFT JOIN LATERAL (
          SELECT f.id, f.created_at, f.status, f.detail FROM agent_run_events f
           WHERE f.agent_run_id = s.agent_run_id AND f.step_id = s.id
             AND f.event_type IN ('step.finished', 'step.failed', 'step.cancelled')
           ORDER BY f.created_at DESC, f.id DESC LIMIT 1
        ) f ON TRUE
        LEFT JOIN pipeline_attempts p ON p.agent_run_step_id = s.id AND p.agent_run_id = s.agent_run_id
          AND p.stage = 'extract' AND p.strategy = ${requiredExecution.strategy} AND p.strategy_version = ${requiredExecution.strategyVersion}
          AND p.source_document_id = ANY(${requiredExecution.affectedUnits.map(unit => unit.sourceDocumentId)}::bigint[])
          AND p.institution_id = ANY(${requiredExecution.affectedUnits.map(unit => unit.institutionId)}::bigint[])
          AND p.created_at >= ${request.since}::timestamptz AND p.created_at <= ${request.until}::timestamptz
        LEFT JOIN source_documents d ON d.id = p.source_document_id AND d.institution_id = p.institution_id
        LEFT JOIN agent_source_texts t ON t.id::text = p.detail->>'document_text_id'
          AND t.source_document_id = p.source_document_id AND t.institution_id = p.institution_id
          AND t.text_hash = p.input_fingerprint AND d.id IS NOT NULL
       WHERE s.agent_name = ${requiredExecution.agentName} AND s.step_key = ${requiredExecution.stepKey}
         AND ((x.created_at >= ${request.since}::timestamptz AND x.created_at <= ${request.until}::timestamptz)
           OR (f.created_at >= ${request.since}::timestamptz AND f.created_at <= ${request.until}::timestamptz)
           OR (s.started_at >= ${request.since}::timestamptz AND s.started_at <= ${request.until}::timestamptz))
       ORDER BY s.id, p.created_at, p.id LIMIT ${MAX_OWNING_ROWS + 1}`),
  ]);
  if (scores.length > MAX_DEMING_ROWS) problems.push('Deming ledger inventory truncated; shorten observation bounds');
  const deming = scores.slice(0, MAX_DEMING_ROWS).map(row => ({ eventId: Number(row.event_id), runId: Number(row.run_id), stepId: Number(row.step_id), runAgent: String(row.run_agent), stepKey: 'score-answer-key', eventType: 'deming.fixed_cohort_accuracy', stepStatus: String(row.step_status), eventAt: iso(row.event_at), execution: executionIdentity(row), score: row.score }));
  const bayes = replayChecks.map(row => ({ checkId: Number(row.check_id), runId: row.run_id == null ? null : Number(row.run_id), stepId: row.step_id == null ? null : Number(row.step_id), stepKey: 'bayes-replay-ledger', stepStatus: String(row.step_status ?? ''), changeKey: String(row.change_key), manifestKey: String(row.manifest_key), checkedAt: iso(row.checked_at), status: String(row.status), affected: Number(row.affected), done: Number(row.done), queued: Number(row.queued), excluded: Number(row.excluded), exclusions: row.exclusions, note: row.note, execution: executionIdentity(row) }));
  const atlas = [...deming, ...bayes].map(row => ({ runId: row.runId, stepId: row.stepId, status: row.stepStatus, execution: row.execution }));
  if (owningRows.length > MAX_OWNING_ROWS) problems.push('Owning execution ledger inventory truncated; shorten observation bounds');
  const owningExecutions = owningRows.slice(0, MAX_OWNING_ROWS).map(row => {
    const execution = executionIdentity(row);
    return { runId: Number(row.run_id), stepId: Number(row.step_id), runAgent: String(row.run_agent), stepAgent: String(row.step_agent), stepKey: String(row.step_key), runKind: String(row.run_kind), status: String(row.step_status), stepCompletedAt: iso(row.step_completed_at),
      execution: execution ? { ...execution, eventAt: iso(row.execution_event_at) } : null,
      completion: row.completion_event_id == null ? null : { eventId: Number(row.completion_event_id), status: String(row.completion_status), eventAt: iso(row.completion_event_at), dryRun: row.completion_dry_run, processedCount: row.completion_processed_count },
      output: row.attempt_id == null ? null : { kind: 'pipeline_attempt', attemptId: Number(row.attempt_id), institutionId: Number(row.institution_id), sourceDocumentId: Number(row.source_document_id), documentTextId: row.document_text_id == null ? null : Number(row.document_text_id), stage: String(row.stage), strategy: String(row.strategy), strategyVersion: Number(row.strategy_version), outcome: String(row.outcome), yieldCount: Number(row.yield_count), insertedCount: row.inserted_count, createdAt: iso(row.output_at), bindsToExecution: row.output_bound === true } };
  });
  return { schemaVersion: 1, collectedAt: now.toISOString(), request: { ...request, requiredExecution }, provenance, atlas, deming, bayes, owningExecutions, owningExecutionInventoryComplete: requiredExecution !== null && owningRows.length <= MAX_OWNING_ROWS && !problems.some(problem => problem.startsWith('Owning execution')), exclusionAuthorizations: [], problems };
}
