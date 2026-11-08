import { afterEach, describe, expect, it, vi } from 'vitest';
const { sourceFetch } = vi.hoisted(() => { const sourceFetch = vi.fn(); vi.stubGlobal('fetch', sourceFetch); return { sourceFetch }; });
import { collectGithubEvidence } from './github.mjs';
import { assessReviewEvidence, assessOperationalEvidence, collectRuntimeEvidence, assessRetention, calculateEngineeringMetrics, renderEvidenceSummary } from './evidence.mjs';
const sha = 'a'.repeat(40), hash = 'b'.repeat(64), policyHash = 'c'.repeat(64);
const now = new Date('2026-11-09T00:00:00Z');
const policy = { headSha: sha, deployedSha: sha, environment: 'production', cohortId: 'answer-key-62@2026-11-02', scorerVersion: 3, protocol: 1, minScoredInstitutions: 1, minExpectedFees: 1, minPredictedFees: 1, minPrecision: 1, minRecall: 1, observationDays: 7, maxSampleGapHours: 24, replayChangeKeys: ['knox.rules@1'] };
function runtime() {
  const sample = (at: string, id: number) => ({ eventId: id, runId: id, stepId: id, runAgent: 'atlas', stepKey: 'score-answer-key', eventType: 'deming.fixed_cohort_accuracy', stepStatus: 'completed', eventAt: at, execution: { deployedSha: sha, environment: 'production', eventId: 20 }, score: { cohortId: policy.cohortId, scorerVersion: 3, protocol: 1, at, cohortSize: 1, scored: 1, unscored: 0, expected: 2, predicted: 2, correct: 2, matched: 2, institutions: [{ answerKeyId: 1, institutionId: 1, state: 'scored', expected: 2, predicted: 2, correct: 2, matched: 2 }] } });
  return { schemaVersion: 1, collectedAt: now.toISOString(), provenance: { kind: 'authenticated-admin-ledger', apiBuildSha: sha, environment: 'production' }, atlas: [{ runId: 1, stepId: 1, status: 'completed', execution: { deployedSha: sha, environment: 'production', eventId: 20 } }], deming: Array.from({ length: 8 }, (_, i) => sample(`2026-11-${String(i + 2).padStart(2, '0')}T00:00:00Z`, i + 1)), bayes: [{ checkId: 1, runId: 1, stepId: 1, stepKey: 'bayes-replay-ledger', stepStatus: 'completed', changeKey: 'knox.rules@1', checkedAt: now.toISOString(), status: 'closed', affected: 2, done: 2, queued: 0, excluded: 0, exclusions: {}, execution: { deployedSha: sha, environment: 'production', eventId: 20 } }], exclusionAuthorizations: [], problems: [] };
}
describe('engineering evidence assessment', () => {
  it('never upgrades imported review JSON to independent verified approval', () => {
    const evidence = { pullRequest: { headSha: sha, author: { login: 'builder' } }, reviews: [{ state: 'APPROVED' }], problems: [], threads: [] };
    expect(assessReviewEvidence(evidence, { headSha: sha, contractSha256: hash, policySha256: policyHash }).status).toBe('BLOCKED');
  });
  it('keeps runtime JSON untrusted without authenticated transport', () => {
    const result = assessOperationalEvidence(runtime(), policy, { now });
    expect(result.status).toBe('PRODUCTION_UNVERIFIED');
    expect(result.blockers.join(' ')).toContain('provenance');
  });
  it('computes candidate completeness from actual Deming counts and Bayes records', () => {
    const result = assessOperationalEvidence(runtime(), policy, { now });
    expect(result.blockers).toEqual(['Runtime evidence provenance is not authenticated in this process', 'Deployment evidence provenance is not authenticated in this process']);
    expect(result.observation.sampleDays).toBe(8);
  });
  it('rejects thin evidence, swapped cohorts, timestamp-only deploy binding, and a claimed PASS', () => {
    const data = runtime();
    data.deming[0].execution.deployedSha = '';
    data.deming[1].score.cohortId = 'other';
    data.deming[2].score.correct = 0; data.deming[2].score.institutions[0].correct = 0;
    const result = assessOperationalEvidence(data, policy, { now });
    expect(result.blockers.join(' ')).toContain('execution lineage');
    expect(result.blockers.join(' ')).toContain('cohort');
    expect(result.blockers.join(' ')).toContain('precision');
  });
  it('not_counted is a Bayes status, and unauthorized exclusions never settle proof', () => {
    const data = runtime();
    data.bayes[0] = { ...data.bayes[0], status: 'not_counted', affected: 0, done: 0 };
    expect(assessOperationalEvidence(data, policy, { now }).blockers.join(' ')).toContain('not_counted');
    data.bayes[0] = { ...data.bayes[0], status: 'closed', affected: 2, done: 1, excluded: 1, exclusions: { unknown: 1 } };
    expect(assessOperationalEvidence(data, policy, { now }).blockers.join(' ')).toContain('authorization');
  });
  it('rejects missing days, malformed counts, outdated and superseded replay rows', () => {
    const data = runtime(); data.deming.splice(2, 3); data.bayes[0].affected = 99;
    const result = assessOperationalEvidence(data, policy, { now });
    expect(result.blockers.join(' ')).toContain('gap');
    expect(result.blockers.join(' ')).toContain('reconcile');
  });
  it('expires evidence after ninety days and rejects future timestamps', () => {
    expect(assessRetention({ createdAt: '2026-08-01', now }).status).toBe('EXPIRED');
    expect(assessRetention({ createdAt: '2026-11-10', now }).status).toBe('INVALID');
    expect(assessRetention({ createdAt: '2026-11-01', now }).status).toBe('AVAILABLE');
  });
  it('derives coverage, recurrence, review latency, lag and CI overhead with missing data as unknown', () => {
    const data = [{ riskTier: 'R2', mergedAt: '2026-11-01T00:00:00Z', openedAt: '2026-10-31T00:00:00Z', reviewedAt: '2026-10-31T02:00:00Z', deployedAt: '2026-11-01T00:00:00Z', productionVerifiedAt: '2026-11-02T00:00:00Z', proofStatus: 'VERIFIED', regression: { id: 'r1', owner: 'knox', deployedSha: sha, affectedUnits: 2, rootCause: '#1', rollbackDisposition: 'not-required' }, baselineCiSeconds: 100, ciSeconds: 110 }, { riskTier: 'R3', mergedAt: '2026-11-02', proofStatus: 'BLOCKED', regression: { id: 'r2', owner: 'knox', deployedSha: sha, affectedUnits: 1, rootCause: '#1', rollbackDisposition: 'pending' } }];
    const result = calculateEngineeringMetrics(data);
    expect(result.verificationCoverage).toBe(0.5);
    expect(result.recurrenceCount).toBe(1);
    expect(result.reviewLatencyMedianHours).toBe(2);
    expect(result.productionVerificationLagMedianHours).toBe(24);
    expect(result.ciOverheadMedian).toBeCloseTo(0.1);
    expect(calculateEngineeringMetrics([]).verificationCoverage).toBeNull();
    expect(renderEvidenceSummary({ review: { status: 'BLOCKED', blockers: ['review missing'] } })).toContain('review missing');
  });
});

describe('authenticated deployment to runtime observation', () => {
  afterEach(() => sourceFetch.mockReset());
  type CollectionOptions = {
    wrongDeployment?: boolean; wrongMerge?: boolean; newerWrongDeployment?: boolean;
    environment?: string; deploymentEnvironment?: string; statusEnvironment?: string; runtimeEnvironment?: string;
    githubObservedAt?: Date; runtimeObservedAt?: Date;
  };
  async function collected({ wrongDeployment = false, wrongMerge = false, environment = 'production', deploymentEnvironment = environment, statusEnvironment = deploymentEnvironment, runtimeEnvironment = environment, newerWrongDeployment = false, githubObservedAt = now, runtimeObservedAt = now }: CollectionOptions = {}) {
    const deployedSha = 'd'.repeat(40);
    const observationPolicy = { ...policy, deployedSha, environment };
    const data = runtime();
    data.atlas.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    data.deming.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    data.bayes.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    const since = '2026-11-02T00:00:00Z', until = now.toISOString();
    const request = { deployedSha, since, until, changeKeys: policy.replayChangeKeys };
    const values: Record<string, unknown> = {
      '': { default_branch: 'main' }, '/commits/main': { sha: 'c'.repeat(40) }, '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('trusted workflow') },
      '/pulls/1': { number: 1, head: { sha }, user: { login: 'builder', id: 1 }, state: 'closed', merged: true, merge_commit_sha: wrongMerge ? 'e'.repeat(40) : deployedSha, merged_at: '2026-11-01T00:00:00Z' },
      '/pulls/1/files': [], '/pulls/1/reviews': [], '/issues/1/comments': [],
      [`/commits/${sha}/check-runs`]: { check_runs: [] }, '/actions/workflows/test.yml': { id: 7, path: '.github/workflows/test.yml' }, '/actions/workflows/7/runs': { workflow_runs: [] },
      '/deployments': [{ id: 10, sha: wrongDeployment ? 'e'.repeat(40) : deployedSha, environment: deploymentEnvironment, created_at: '2026-11-01T23:00:00Z' }, ...(newerWrongDeployment ? [{ id: 12, sha: 'e'.repeat(40), environment: 'Production', created_at: '2026-11-08T00:00:00Z' }] : [])],
      '/deployments/10/statuses': [{ id: 11, state: 'success', environment: statusEnvironment, created_at: since }],
      '/deployments/12/statuses': [{ id: 13, state: 'success', environment: 'Production', created_at: '2026-11-08T00:00:00Z' }],
    };
    sourceFetch.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === 'feeinsight.com') return Response.json({ ...data, request });
      if (url.pathname === '/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      const key = url.pathname.replace('/repos/o/r', '');
      return key in values ? Response.json(values[key]) : Response.json({ message: 'missing' }, { status: 404 });
    });
    const github = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'token', now: githubObservedAt });
    const evidence = await collectRuntimeEvidence({ adminCookie: 'session=private', deployedSha, since, until, changeKeys: policy.replayChangeKeys, now: runtimeObservedAt });
    return { github, evidence, observationPolicy };
  }
  it('accepts only authenticated, reconciled, versioned observations with head-to-merge lineage', async () => {
    const { github, evidence, observationPolicy } = await collected();
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
    expect(assessOperationalEvidence(JSON.parse(JSON.stringify(evidence)), observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
    expect(JSON.stringify(evidence)).not.toContain('session=private');
  });
  it('binds native GitHub Production labels to runtime production while retaining both raw labels', async () => {
    const { github, evidence, observationPolicy } = await collected({ deploymentEnvironment: 'Production' });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_VERIFIED');
    expect(result.deployment).toMatchObject({ environment: 'production', rawEnvironment: 'Production', rawStatusEnvironment: 'Production' });
    const imported = assessOperationalEvidence(evidence, observationPolicy, { github: JSON.parse(JSON.stringify(github)), now });
    expect(imported.status).toBe('PRODUCTION_UNVERIFIED');
    expect(imported.deployment).toBeNull();
  });
  it.each([
    { deploymentEnvironment: 'Production', statusEnvironment: 'production' },
    { deploymentEnvironment: 'production', statusEnvironment: 'Production' },
  ])('accepts only the two exact native deployment/status spellings: %j', async options => {
    const { github, evidence, observationPolicy } = await collected(options);
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });
  it.each([
    { deploymentEnvironment: 'preview' },
    { deploymentEnvironment: 'Production', statusEnvironment: 'preview' },
    { deploymentEnvironment: 'PRODUCTION' }, { deploymentEnvironment: 'prod' },
    { deploymentEnvironment: ' production' }, { deploymentEnvironment: 'Production ' },
    { deploymentEnvironment: 'Production', statusEnvironment: 'PRODUCTION' },
    { deploymentEnvironment: 'Production', statusEnvironment: 'prod' },
    { deploymentEnvironment: 'Production', statusEnvironment: 'production ' },
    { deploymentEnvironment: 'Production', runtimeEnvironment: 'Production' },
    { environment: 'Production', deploymentEnvironment: 'Production' },
  ])('never broadens deployment aliases, runtime execution or policy environment identity: %j', async options => {
    const { github, evidence, observationPolicy } = await collected(options);
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not hide a newer native Production deployment behind an older lowercase production record', async () => {
    const { github, evidence, observationPolicy } = await collected({ newerWrongDeployment: true });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_UNVERIFIED');
    expect(result.deployment).toBeNull();
  });
  it.each([{ wrongDeployment: true }, { wrongMerge: true }])('rejects a different current production deployment or an unrelated merge SHA', async options => {
    const { github, evidence, observationPolicy } = await collected(options);
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('never reports a fully observed preview environment as production verified', async () => {
    const { github, evidence, observationPolicy } = await collected({ environment: 'preview', wrongMerge: true });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_UNVERIFIED');
    expect(result.blockers).toContain('Production verification requires the production environment');
  });
  it.each([
    { githubObservedAt: new Date(now.getTime() - 15 * 60000 - 1) },
    { runtimeObservedAt: new Date(now.getTime() - 15 * 60000 - 1) },
    { githubObservedAt: new Date(now.getTime() + 1) },
    { runtimeObservedAt: new Date(now.getTime() + 1) },
  ])('requires both native snapshots to have been observed within fifteen minutes: %j', async options => {
    const { github, evidence, observationPolicy } = await collected(options);
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_UNVERIFIED');
    expect(result.blockers.join(' ')).toContain('snapshot is stale');
  });
  it('accepts the inclusive fifteen-minute freshness boundary for both snapshots', async () => {
    const observedAt = new Date(now.getTime() - 15 * 60000);
    const { github, evidence, observationPolicy } = await collected({ githubObservedAt: observedAt, runtimeObservedAt: observedAt });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });
});
