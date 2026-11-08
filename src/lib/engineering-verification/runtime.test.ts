import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/data-store/connection', () => ({ sql: vi.fn() }));
import { readEngineeringRuntimeEvidence, parseEngineeringEvidenceRequest } from './runtime';
const sha = 'a'.repeat(40);
const requiredExecution = { agentName: 'knox', stepKey: 'extract', strategy: 'extract.rules', strategyVersion: 186,
  affectedUnits: [{ institutionId: 1, sourceDocumentId: 101 }], outputWitness: 'knox-extraction-attempt-v1' };
const request = { deployedSha: sha, since: '2026-11-01T00:00:00Z', until: '2026-11-08T00:00:00Z', changeKeys: [], requiredExecution };
const scopeParams = (value: unknown) => new URLSearchParams({ deployedSha: sha, since: request.since, until: request.until, requiredExecution: JSON.stringify(value) });

describe('read-only engineering runtime evidence', () => {
  it('accepts bounded authenticated evidence queries and rejects broad inventories', () => {
    const params = new URLSearchParams({ deployedSha: sha, since: '2026-11-01T00:00:00Z', until: '2026-11-08T00:00:00Z' });
    expect(parseEngineeringEvidenceRequest(params, new Date('2026-11-08')).deployedSha).toBe(sha);
    params.set('since', '2020-01-01');
    expect(() => parseEngineeringEvidenceRequest(params, new Date('2026-11-08'))).toThrow('90');
    params.set('since', '2026-11-01'); params.set('deployedSha', '../main');
    expect(() => parseEngineeringEvidenceRequest(params, new Date('2026-11-08'))).toThrow('SHA');
  });
  it('retains actual run/step/event identities and never infers historical deployment from API build', async () => {
    const queries: string[] = [];
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      const query = parts.join('?'); queries.push(query);
      return query.includes('deming.fixed_cohort_accuracy') ? [{ event_id: 1, run_id: 2, step_id: 3, run_agent: 'atlas', step_status: 'completed', event_at: '2026-11-07T00:00:00Z', score: { cohortId: 'fixed' }, execution: null }] : [];
    });
    const evidence = await readEngineeringRuntimeEvidence({ deployedSha: sha, since: '2026-11-01', until: '2026-11-08', changeKeys: [] }, db as never, new Date('2026-11-08'));
    expect(evidence.deming[0]).toMatchObject({ eventId: 1, runId: 2, stepId: 3, execution: null });
    expect(evidence.atlas[0].execution).toBeNull();
    expect(queries.every(query => /^\s*SELECT/.test(query))).toBe(true);
    expect(queries.join(' ')).toContain("x.event_type = 'step.execution'");
  });
  it('maps real Bayes check rows, preserving not_counted and exclusions without inventing authorization', async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => parts.join('?').includes('replay_job_checks') ? [{ check_id: 4, run_id: 2, step_id: 3, change_key: 'knox.rules@1', manifest_key: 'knox.rules', status: 'not_counted', affected: 0, done: 0, queued: 0, excluded: 0, exclusions: {}, checked_at: '2026-11-07', execution: { protocol: 1, deployment_sha: sha, environment: 'production' }, execution_event_id: 9, step_status: 'completed' }] : []);
    const evidence = await readEngineeringRuntimeEvidence({ deployedSha: sha, since: '2026-11-01', until: '2026-11-08', changeKeys: ['knox.rules@1'] }, db as never);
    expect(evidence.bayes[0]).toMatchObject({ status: 'not_counted', checkId: 4, execution: { deployedSha: sha, environment: 'production', eventId: 9 } });
    expect(evidence.exclusionAuthorizations).toEqual([]);
  });
  it('marks truncated or unavailable source reads unknown', async () => {
    const db = vi.fn(async () => { throw new Error('database failed with secret'); });
    const evidence = await readEngineeringRuntimeEvidence({ deployedSha: sha, since: '2026-11-01', until: '2026-11-08', changeKeys: [] }, db as never);
    expect(evidence.problems).toEqual(['Deming ledger read unavailable']);
    expect(JSON.stringify(evidence)).not.toContain('secret');
  });
  it('retains and canonically sorts exact affected source-document pairs in the authenticated request', () => {
    const value = { ...requiredExecution, affectedUnits: [{ institutionId: 2, sourceDocumentId: 201 }, { institutionId: 1, sourceDocumentId: 102 }, { institutionId: 1, sourceDocumentId: 101 }] };
    expect(parseEngineeringEvidenceRequest(scopeParams(value), new Date('2026-11-08')).requiredExecution).toEqual({ ...requiredExecution,
      affectedUnits: [{ institutionId: 1, sourceDocumentId: 101 }, { institutionId: 1, sourceDocumentId: 102 }, { institutionId: 2, sourceDocumentId: 201 }] });
  });
  it.each([
    ['institution-only legacy policy', { agentName: 'knox', stepKey: 'extract', institutionIds: [1] }],
    ['unknown owner', { ...requiredExecution, agentName: 'atlas' }],
    ['measurement step', { ...requiredExecution, stepKey: 'score-answer-key' }],
    ['crossed strategy', { ...requiredExecution, strategy: 'extract.paid' }],
    ['missing reviewed strategy version', { ...requiredExecution, strategyVersion: 0 }],
    ['unknown output witness', { ...requiredExecution, outputWitness: 'raw-fees' }],
    ['no affected units', { ...requiredExecution, affectedUnits: [] }],
    ['duplicate native pair', { ...requiredExecution, affectedUnits: [...requiredExecution.affectedUnits, ...requiredExecution.affectedUnits] }],
    ['fractional native identity', { ...requiredExecution, affectedUnits: [{ institutionId: 1.5, sourceDocumentId: 101 }] }],
    ['string native identity', { ...requiredExecution, affectedUnits: [{ institutionId: '1', sourceDocumentId: 101 }] }],
    ['unknown field selector', { ...requiredExecution, outputSelector: 'detail.success' }],
    ['unknown affected-unit field', { ...requiredExecution, affectedUnits: [{ institutionId: 1, sourceDocumentId: 101, inferredFromParams: true }] }],
    ['scope above the fifty-unit cap', { ...requiredExecution, affectedUnits: Array.from({ length: 51 }, (_, i) => ({ institutionId: i + 1, sourceDocumentId: i + 101 })) }],
  ])('rejects an unreviewed or ambiguous requested execution policy: %s', (_name, value) => {
    expect(() => parseEngineeringEvidenceRequest(scopeParams(value), new Date('2026-11-08'))).toThrow();
  });
  it('rejects malformed and duplicate execution-scope query values rather than selecting one', () => {
    const params = scopeParams(requiredExecution); params.set('requiredExecution', '{');
    expect(() => parseEngineeringEvidenceRequest(params, new Date('2026-11-08'))).toThrow();
    const duplicated = scopeParams(requiredExecution); duplicated.append('requiredExecution', JSON.stringify(requiredExecution));
    expect(() => parseEngineeringEvidenceRequest(duplicated, new Date('2026-11-08'))).toThrow();
  });
  it('keeps a measurement-only read separate from owning-agent work', async () => {
    const db = vi.fn(async () => []);
    const evidence = await readEngineeringRuntimeEvidence({ deployedSha: sha, since: request.since, until: request.until, changeKeys: [] }, db as never);
    expect(evidence.owningExecutions).toEqual([]);
    expect(evidence.owningExecutionInventoryComplete).toBe(false);
  });
  it('does not manufacture an output receipt from a valid requested affected scope', async () => {
    const db = vi.fn(async () => []);
    const evidence = await readEngineeringRuntimeEvidence(request, db as never);
    expect(evidence.owningExecutions).toEqual([]);
    expect(evidence.owningExecutionInventoryComplete).toBe(true);
  });
  it('does not issue a ledger query for an invalid direct execution-policy request', async () => {
    const db = vi.fn(async () => []);
    const evidence = await readEngineeringRuntimeEvidence({ ...request, requiredExecution: { ...requiredExecution, strategy: 'unreviewed' } }, db as never);
    expect(db).not.toHaveBeenCalled();
    expect(evidence.owningExecutionInventoryComplete).toBe(false);
    expect(evidence.problems.length).toBeGreaterThan(0);
  });
  it('maps native owning-step and output ledger identities, with no raw attempt detail', async () => {
    const queries: string[] = [];
    const native = { run_id: 11, run_agent: 'atlas', run_kind: 'workflow', step_id: 21, step_agent: 'knox', step_key: 'extract', step_status: 'completed', step_completed_at: new Date('2026-11-07T12:01:00Z'),
      execution: { protocol: 1, deployment_sha: sha, environment: 'production' }, execution_event_id: 31, execution_event_at: new Date('2026-11-07T12:00:00Z'),
      completion_event_id: 32, completion_status: 'completed', completion_event_at: new Date('2026-11-07T12:01:00Z'), completion_dry_run: false, completion_processed_count: 1,
      attempt_id: 41, institution_id: 1, source_document_id: 101, document_text_id: 1001, stage: 'extract', strategy: 'extract.rules', strategy_version: 186, outcome: 'ok_partial', yield_count: 3, inserted_count: 2, output_at: new Date('2026-11-07T12:00:30Z'), output_bound: true,
      detail: { private_canary: 'do-not-retain-raw-attempt-detail' } };
    const db = vi.fn(async (parts: TemplateStringsArray) => { const query = parts.join('?'); queries.push(query); return query.includes('pipeline_attempts') ? [native] : []; });
    const evidence = await readEngineeringRuntimeEvidence(request, db as never);
    expect(evidence.owningExecutionInventoryComplete).toBe(true);
    expect(evidence.owningExecutions).toEqual([{ runId: 11, runAgent: 'atlas', runKind: 'workflow', stepId: 21, stepAgent: 'knox', stepKey: 'extract', status: 'completed', stepCompletedAt: '2026-11-07T12:01:00.000Z',
      execution: { deployedSha: sha, environment: 'production', eventId: 31, eventAt: '2026-11-07T12:00:00.000Z' },
      completion: { eventId: 32, status: 'completed', eventAt: '2026-11-07T12:01:00.000Z', dryRun: false, processedCount: 1 },
      output: { kind: 'pipeline_attempt', attemptId: 41, institutionId: 1, sourceDocumentId: 101, documentTextId: 1001, stage: 'extract', strategy: 'extract.rules', strategyVersion: 186, outcome: 'ok_partial', yieldCount: 3, insertedCount: 2, createdAt: '2026-11-07T12:00:30.000Z', bindsToExecution: true } }]);
    expect(queries.every(query => /^\s*SELECT/.test(query))).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('do-not-retain-raw-attempt-detail');
  });
  it('marks an inaccessible owning-output inventory incomplete using a fixed safe problem', async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => { if (parts.join('?').includes('pipeline_attempts')) throw new Error('private-database-error-canary'); return []; });
    const evidence = await readEngineeringRuntimeEvidence(request, db as never);
    expect(evidence.owningExecutions).toEqual([]);
    expect(evidence.owningExecutionInventoryComplete).toBe(false);
    expect(evidence.problems.length).toBeGreaterThan(0);
    expect(JSON.stringify(evidence)).not.toContain('private-database-error-canary');
  });

  it('does not convert a completed step without a native pipeline attempt into an output witness', async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => parts.join('?').includes('pipeline_attempts') ? [{ run_id: 11, run_agent: 'atlas', run_kind: 'workflow', step_id: 21, step_agent: 'knox', step_key: 'extract', step_status: 'completed', attempt_id: null }] : []);
    const evidence = await readEngineeringRuntimeEvidence(request, db as never);
    expect(evidence.owningExecutions[0].output).toBeNull();
  });
  it('marks a capped owning-output inventory incomplete rather than certifying the retained prefix', async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => parts.join('?').includes('pipeline_attempts') ? Array.from({ length: 513 }, (_, index) => ({ run_id: index + 1, step_id: index + 1, attempt_id: index + 1 })) : []);
    const evidence = await readEngineeringRuntimeEvidence(request, db as never);
    expect(evidence.owningExecutionInventoryComplete).toBe(false);
    expect(evidence.owningExecutions.length).toBeLessThanOrEqual(512);
    expect(evidence.problems.length).toBeGreaterThan(0);
  });

  it('retains the native pre-read executor timestamp for Deming and requested Bayes records', async () => {
    const db = vi.fn(async (parts: TemplateStringsArray) => parts.join('?').includes('deming.fixed_cohort_accuracy') ? [{ event_id: 31, run_id: 11, step_id: 21, run_agent: 'atlas', step_status: 'completed', event_at: '2026-11-07T12:01:00Z', execution: { protocol: 1, deployment_sha: sha, environment: 'production' }, execution_event_id: 30, execution_event_at: new Date('2026-11-07T12:00:00Z'), score: {} }] : parts.join('?').includes('replay_job_checks') ? [{ check_id: 41, run_id: 12, step_id: 22, status: 'closed', execution: { protocol: 1, deployment_sha: sha, environment: 'production' }, execution_event_id: 40, execution_event_at: new Date('2026-11-07T12:02:00Z') }] : []);
    const evidence = await readEngineeringRuntimeEvidence({ ...request, changeKeys: ['knox.rules@1'] }, db as never);
    expect(evidence.deming[0].execution).toMatchObject({ eventId: 30, eventAt: '2026-11-07T12:00:00.000Z' });
    expect(evidence.bayes[0].execution).toMatchObject({ eventId: 40, eventAt: '2026-11-07T12:02:00.000Z' });
  });

});
