import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/data-store/connection', () => ({ sql: vi.fn() }));
import { readEngineeringRuntimeEvidence, parseEngineeringEvidenceRequest } from './runtime';
const sha = 'a'.repeat(40);
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
});
