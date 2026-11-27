import { afterEach, describe, expect, it, vi } from 'vitest';
const { sourceFetch } = vi.hoisted(() => { const sourceFetch = vi.fn(); vi.stubGlobal('fetch', sourceFetch); return { sourceFetch }; });
import { collectGithubEvidence } from './github.mjs';
import { assessReviewEvidence, assessOperationalEvidence, collectRuntimeEvidence, assessRetention, calculateEngineeringMetrics, renderEvidenceSummary } from './evidence.mjs';
const sha = 'a'.repeat(40), hash = 'b'.repeat(64), policyHash = 'c'.repeat(64);
const now = new Date('2026-11-09T00:00:00Z');
const requiredExecution = { agentName: 'knox', stepKey: 'extract', strategy: 'extract.rules', strategyVersion: 186,
  affectedUnits: [{ institutionId: 1, sourceDocumentId: 101 }], outputWitness: 'knox-extraction-attempt-v1' };
function owningExecution() {
  return { runId: 1011, stepId: 2011, runAgent: 'atlas', stepAgent: 'knox', stepKey: 'extract', runKind: 'workflow', status: 'completed',
    execution: { eventId: 5001, deployedSha: sha, environment: 'production', eventAt: '2026-11-01T23:00:00Z' },
    completion: { eventId: 5002, status: 'completed', eventAt: '2026-11-01T23:00:00Z', dryRun: false, processedCount: 1 }, stepCompletedAt: '2026-11-01T23:00:00Z',
    output: { kind: 'pipeline_attempt', attemptId: 7001, institutionId: 1, sourceDocumentId: 101, documentTextId: 1001,
      stage: 'extract', strategy: 'extract.rules', strategyVersion: 186, outcome: 'ok', yieldCount: 2, insertedCount: 2,
      createdAt: '2026-11-01T23:00:00Z', bindsToExecution: true } };
}
const policy = { requiredExecution, headSha: sha, deployedSha: sha, environment: 'production', cohortId: 'answer-key-62@2026-11-02', scorerVersion: 3, protocol: 1, minScoredInstitutions: 1, minExpectedFees: 1, minPredictedFees: 1, minPrecision: 1, minRecall: 1, observationDays: 7, maxSampleGapHours: 24, replayChangeKeys: ['knox.rules@1'] };
function runtime() {
  const sample = (at: string, id: number) => ({ eventId: id, runId: id, stepId: id, runAgent: 'atlas', stepKey: 'score-answer-key', eventType: 'deming.fixed_cohort_accuracy', stepStatus: 'completed', eventAt: at, execution: { deployedSha: sha, environment: 'production', eventId: 20, eventAt: new Date(Date.parse(at) - 1).toISOString() }, score: { cohortId: policy.cohortId, scorerVersion: 3, protocol: 1, at, cohortSize: 1, scored: 1, unscored: 0, expected: 2, predicted: 2, correct: 2, matched: 2, institutions: [{ answerKeyId: 1, institutionId: 1, state: 'scored', expected: 2, predicted: 2, correct: 2, matched: 2 }] } });
  return { owningExecutionInventoryComplete: true, owningExecutions: [owningExecution()], schemaVersion: 1, collectedAt: now.toISOString(), provenance: { kind: 'authenticated-admin-ledger', apiBuildSha: sha, environment: 'production' }, atlas: [{ runId: 1, stepId: 1, status: 'completed', execution: { deployedSha: sha, environment: 'production', eventId: 20 } }], deming: Array.from({ length: 8 }, (_, i) => sample(`2026-11-${String(i + 2).padStart(2, '0')}T00:00:00Z`, i + 1)), bayes: [{ checkId: 1, runId: 1, stepId: 1, stepKey: 'bayes-replay-ledger', stepStatus: 'completed', changeKey: 'knox.rules@1', checkedAt: now.toISOString(), status: 'closed', affected: 2, done: 2, queued: 0, excluded: 0, exclusions: {}, execution: { deployedSha: sha, environment: 'production', eventId: 20, eventAt: new Date(now.getTime() - 1).toISOString() } }], exclusionAuthorizations: [], problems: [] };
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
    githubObservedAt?: Date; runtimeObservedAt?: Date; deploymentAt?: string;
    mutateRuntime?: (data: ReturnType<typeof runtime>) => void;
    requiredExecution?: typeof requiredExecution; echoedRequiredExecution?: typeof requiredExecution | null;
    omitNativeIdentity?: boolean;
  };
  async function collected({ wrongDeployment = false, wrongMerge = false, environment = 'production', deploymentEnvironment = environment, statusEnvironment = deploymentEnvironment, runtimeEnvironment = environment, newerWrongDeployment = false, githubObservedAt = now, runtimeObservedAt = now, deploymentAt = '2026-11-01T23:00:00Z', mutateRuntime, requiredExecution: executionPolicy = requiredExecution, echoedRequiredExecution, omitNativeIdentity = false }: CollectionOptions = {}) {
    const deployedSha = 'd'.repeat(40), nativeRepo = { id: 17, full_name: 'o/r' };
    const observationPolicy = { ...policy, requiredExecution: executionPolicy, deployedSha, environment };
    const data = runtime();
    data.atlas.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    data.deming.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    data.bayes.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    data.owningExecutions.forEach(row => { row.execution.deployedSha = deployedSha; row.execution.environment = runtimeEnvironment; });
    mutateRuntime?.(data);
    const since = deploymentAt, until = now.toISOString();
    const request = { deployedSha, since, until, changeKeys: policy.replayChangeKeys, requiredExecution: echoedRequiredExecution === undefined ? executionPolicy : echoedRequiredExecution };
    const values: Record<string, unknown> = {
      '': { ...nativeRepo, default_branch: 'main' }, '/commits/main': { sha: 'c'.repeat(40) }, '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('trusted workflow') },
      '/pulls/1': { number: 1, head: { sha, ref: 'unit-deployment', ...(omitNativeIdentity ? {} : { repo: nativeRepo }) }, base: { sha: 'b'.repeat(40), ref: 'main', repo: nativeRepo }, user: { login: 'builder', id: 1 }, state: 'closed', merged: true, merge_commit_sha: wrongMerge ? 'e'.repeat(40) : deployedSha, merged_at: '2026-11-01T00:00:00Z' },
      '/pulls/1/files': [], '/pulls/1/reviews': [], '/issues/1/comments': [],
      [`/commits/${sha}/check-runs`]: { check_runs: [] }, '/actions/workflows/test.yml': { id: 7, path: '.github/workflows/test.yml' }, '/actions/workflows/7/runs': { workflow_runs: [] },
      '/deployments': [{ id: 10, sha: wrongDeployment ? 'e'.repeat(40) : deployedSha, environment: deploymentEnvironment, created_at: new Date(Date.parse(deploymentAt) - 3600000).toISOString() }, ...(newerWrongDeployment ? [{ id: 12, sha: 'e'.repeat(40), environment: 'Production', created_at: '2026-11-08T00:00:00Z' }] : [])],
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
    const evidence = await collectRuntimeEvidence({ adminCookie: 'session=private', deployedSha, since, until, changeKeys: policy.replayChangeKeys, requiredExecution: executionPolicy, now: runtimeObservedAt });
    return { github, evidence, observationPolicy };
  }
  it('accepts only authenticated, reconciled, versioned observations with head-to-merge lineage', async () => {
    const { github, evidence, observationPolicy } = await collected();
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
    expect(assessOperationalEvidence(JSON.parse(JSON.stringify(evidence)), observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
    expect(JSON.stringify(evidence)).not.toContain('session=private');
  });
  it('keeps missing native merged-PR identity globally blocking operational acceptance', async () => {
    const { github, evidence, observationPolicy } = await collected({ omitNativeIdentity: true });
    expect(github.problems).toContain('Historical merged PR identity changed while collecting evidence');
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not substitute completed Atlas measurement for the required owning-agent execution and affected scope', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: data => { data.owningExecutions = []; } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
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
  const invalidOwningWitnesses: Array<[string, (data: ReturnType<typeof runtime>) => void]> = [
    ['wrong actual step owner, even when the run owner is Knox', d => { d.owningExecutions[0].stepAgent = 'atlas'; d.owningExecutions[0].runAgent = 'knox'; }],
    ['measurement step instead of extraction', d => { d.owningExecutions[0].stepKey = 'score-answer-key'; }],
    ['wrong extraction strategy', d => { d.owningExecutions[0].output.strategy = 'extract.paid'; }],
    ['wrong strategy version', d => { d.owningExecutions[0].output.strategyVersion = 185; }],
    ['wrong output stage', d => { d.owningExecutions[0].output.stage = 'verify'; }],
    ['wrong output witness kind', d => { d.owningExecutions[0].output.kind = 'sample_results'; }],
    ['different affected institution', d => { d.owningExecutions[0].output.institutionId = 2; }],
    ['different affected source document', d => { d.owningExecutions[0].output.sourceDocumentId = 102; }],
    ['missing native source text identity', d => { d.owningExecutions[0].output.documentTextId = 0; }],
    ['output not bound by the native same-execution join', d => { d.owningExecutions[0].output.bindsToExecution = false; }],
    ['dry-run kind', d => { d.owningExecutions[0].runKind = 'dry-run'; }],
    ['dry-run completion', d => { d.owningExecutions[0].completion.dryRun = true; }],
    ['no processed native work', d => { d.owningExecutions[0].completion.processedCount = 0; }],
    ['incomplete step state', d => { d.owningExecutions[0].status = 'running'; }],
    ['contradictory finish state', d => { d.owningExecutions[0].completion.status = 'failed'; }],
    ['no positive inserted output', d => { d.owningExecutions[0].output.insertedCount = 0; }],
    ['fractional inserted output', d => { d.owningExecutions[0].output.insertedCount = 0.5; }],
    ['failed extraction attempt', d => { d.owningExecutions[0].output.outcome = 'parse_error'; }],
    ['different deployment SHA', d => { d.owningExecutions[0].execution.deployedSha = 'e'.repeat(40); }],
    ['runtime environment alias', d => { d.owningExecutions[0].execution.environment = 'Production'; }],
    ['missing native execution event identity', d => { d.owningExecutions[0].execution.eventId = 0; }],
    ['same execution and finish event identity', d => { d.owningExecutions[0].completion.eventId = 5001; }],
    ['finish before execution at the same timestamp', d => { d.owningExecutions[0].completion.eventId = 5000; }],
    ['predeployment execution', d => { d.owningExecutions[0].execution.eventAt = '2026-11-01T22:59:59Z'; }],
    ['output borrowed from before the latest execution', d => { d.owningExecutions[0].execution.eventAt = '2026-11-02T01:00:00Z'; d.owningExecutions[0].completion.eventAt = '2026-11-02T02:00:00Z'; d.owningExecutions[0].stepCompletedAt = '2026-11-02T02:00:00Z'; }],
    ['output dated after completion', d => { d.owningExecutions[0].output.createdAt = '2026-11-02T00:00:01Z'; }],
    ['future completion', d => { d.owningExecutions[0].completion.eventAt = '2026-11-10T00:00:00Z'; }],
    ['incomplete native execution inventory', d => { d.owningExecutionInventoryComplete = false; }],
  ];
  it.each(invalidOwningWitnesses)('rejects owning execution with %s', async (_name, mutateRuntime) => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('requires coverage of every frozen institution/source-document pair rather than a matching institution alone', async () => {
    const executionPolicy = { ...requiredExecution, affectedUnits: [...requiredExecution.affectedUnits, { institutionId: 1, sourceDocumentId: 102 }] };
    const { github, evidence, observationPolicy } = await collected({ requiredExecution: executionPolicy });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not count duplicate output receipts as coverage for a second affected document', async () => {
    const executionPolicy = { ...requiredExecution, affectedUnits: [...requiredExecution.affectedUnits, { institutionId: 1, sourceDocumentId: 102 }] };
    const { github, evidence, observationPolicy } = await collected({ requiredExecution: executionPolicy, mutateRuntime: d => { d.owningExecutions.push(structuredClone(d.owningExecutions[0])); } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('requires the runtime request echo to retain the frozen execution scope', async () => {
    const { github, evidence, observationPolicy } = await collected({ echoedRequiredExecution: { ...requiredExecution, affectedUnits: [{ institutionId: 1, sourceDocumentId: 102 }] } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not turn input parameters or capped samples into actual extraction output', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.owningExecutions = [];
      Object.assign(d.atlas[0], { input: { institutionIds: [1] }, sample_results: [{ institution_id: 1, source_document_id: 101, inserted: 2 }] });
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('starts the quality observation window after the latest required output completes, rather than reusing seven earlier days', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const row = d.owningExecutions[0];
      row.execution.eventAt = '2026-11-08T23:00:00Z';
      row.output.createdAt = '2026-11-08T23:30:00Z';
      row.completion.eventAt = '2026-11-08T23:59:00Z'; row.stepCompletedAt = row.completion.eventAt;
    } });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_UNVERIFIED');
    expect(result.observation.sampleDays).toBe(1);
  });
  it('accepts actual bound Knox work inside an Atlas workflow, including equal timestamps ordered by native event IDs', async () => {
    const { github, evidence, observationPolicy } = await collected();
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });

  it('requires an explicit reviewed owning-execution policy even when measurements and actual output are present', async () => {
    const { github, evidence, observationPolicy } = await collected();
    const missing = { ...observationPolicy }; delete (missing as Record<string, unknown>).requiredExecution;
    expect(assessOperationalEvidence(evidence, missing, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not ignore an actual scoped failed attempt after the original successful extraction', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const failed = structuredClone(d.owningExecutions[0]);
      failed.runId = 1012; failed.stepId = 2012; failed.execution.eventId = 5011; failed.completion.eventId = 5012; failed.output.attemptId = 7011;
      failed.execution.eventAt = '2026-11-05T00:00:00Z'; failed.completion.eventAt = '2026-11-05T00:01:00Z'; failed.stepCompletedAt = failed.completion.eventAt; failed.output.createdAt = '2026-11-05T00:00:30Z';
      failed.status = 'failed'; failed.completion.status = 'failed'; failed.output.outcome = 'parse_error'; failed.output.yieldCount = 0; failed.output.insertedCount = 0;
      d.owningExecutions.push(failed);
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('moves the eligible quality window after actual recovery rather than borrowing pre-failure success', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const failed = structuredClone(d.owningExecutions[0]);
      failed.runId = 1012; failed.stepId = 2012; failed.execution.eventId = 5011; failed.completion.eventId = 5012; failed.output.attemptId = 7011;
      failed.execution.eventAt = '2026-11-05T00:00:00Z'; failed.completion.eventAt = '2026-11-05T00:01:00Z'; failed.stepCompletedAt = failed.completion.eventAt; failed.output.createdAt = '2026-11-05T00:00:30Z';
      failed.status = 'failed'; failed.completion.status = 'failed'; failed.output.outcome = 'parse_error'; failed.output.yieldCount = 0; failed.output.insertedCount = 0;
      const recovery = structuredClone(d.owningExecutions[0]);
      recovery.runId = 1013; recovery.stepId = 2013; recovery.execution.eventId = 5021; recovery.completion.eventId = 5022; recovery.output.attemptId = 7021;
      recovery.execution.eventAt = '2026-11-08T23:00:00Z'; recovery.output.createdAt = '2026-11-08T23:30:00Z'; recovery.completion.eventAt = '2026-11-08T23:59:00Z'; recovery.stepCompletedAt = recovery.completion.eventAt;
      d.owningExecutions.push(failed, recovery);
    } });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_UNVERIFIED');
    expect(result.observation.sampleDays).toBe(1);
  });
  it('does not reset a valid observation window for an incidental later successful repeat', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const repeat = structuredClone(d.owningExecutions[0]);
      repeat.runId = 1013; repeat.stepId = 2013; repeat.execution.eventId = 5021; repeat.completion.eventId = 5022; repeat.output.attemptId = 7021;
      repeat.execution.eventAt = '2026-11-08T23:00:00Z'; repeat.output.createdAt = '2026-11-08T23:30:00Z'; repeat.completion.eventAt = '2026-11-08T23:59:00Z'; repeat.stepCompletedAt = repeat.completion.eventAt;
      d.owningExecutions.push(repeat);
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });
  it('keeps a missing native output unknown despite a completed extraction step', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => { Object.assign(d.owningExecutions[0], { output: null }); } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it('accepts native free-extractor inserts above candidate yield because rate rows and promoted held lines are additional output', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.owningExecutions[0].output.yieldCount = 1;
      d.owningExecutions[0].output.insertedCount = 2;
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });

  it('accepts actual free rate or promoted-held output even when ordinary candidate yield is zero', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.owningExecutions[0].output.yieldCount = 0;
      d.owningExecutions[0].output.insertedCount = 1;
      d.owningExecutions[0].output.outcome = 'no_candidates';
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });

  it.each([
    { name: 'actual paid accepted output', outcome: 'ok', yieldCount: 2, insertedCount: 2, status: 'PRODUCTION_VERIFIED' },
    { name: 'paid inserts above accepted yield', outcome: 'ok', yieldCount: 1, insertedCount: 2, status: 'PRODUCTION_UNVERIFIED' },
    { name: 'paid no-candidates cannot claim free rate output', outcome: 'no_candidates', yieldCount: 0, insertedCount: 1, status: 'PRODUCTION_UNVERIFIED' },
    { name: 'paid zero output is no work receipt', outcome: 'no_candidates', yieldCount: 0, insertedCount: 0, status: 'PRODUCTION_UNVERIFIED' },
  ])('keeps paid extractor counter semantics distinct: $name', async example => {
    const executionPolicy = { ...requiredExecution, stepKey: 'extract-paid', strategy: 'extract.paid', strategyVersion: 4 };
    const { github, evidence, observationPolicy } = await collected({ requiredExecution: executionPolicy, mutateRuntime: d => {
      const row = d.owningExecutions[0]; row.stepKey = 'extract-paid';
      Object.assign(row.output, { strategy: 'extract.paid', strategyVersion: 4, outcome: example.outcome, yieldCount: example.yieldCount, insertedCount: example.insertedCount });
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe(example.status);
  });
  it.each([false, true])('requires actual coverage and completion of every distinct frozen source pair (last unit late: %s)', async late => {
    const executionPolicy = { ...requiredExecution, affectedUnits: [...requiredExecution.affectedUnits, { institutionId: 1, sourceDocumentId: 102 }] };
    const { github, evidence, observationPolicy } = await collected({ requiredExecution: executionPolicy, mutateRuntime: d => {
      const row = structuredClone(d.owningExecutions[0]); row.runId = 1012; row.stepId = 2012;
      row.execution.eventId = 5011; row.completion.eventId = 5012; row.output.attemptId = 7011;
      row.output.sourceDocumentId = 102; row.output.documentTextId = 1002;
      if (late) {
        row.execution.eventAt = '2026-11-08T23:00:00Z'; row.output.createdAt = '2026-11-08T23:30:00Z';
        row.completion.eventAt = '2026-11-08T23:59:00Z'; row.stepCompletedAt = row.completion.eventAt;
      }
      d.owningExecutions.push(row);
    } });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe(late ? 'PRODUCTION_UNVERIFIED' : 'PRODUCTION_VERIFIED');
    expect(result.observation.sampleDays).toBe(late ? 1 : 8);
  });
  it('does not hide a later owning failure with unknown overlap merely because it has no output receipt', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const row = structuredClone(d.owningExecutions[0]); row.runId = 1012; row.stepId = 2012;
      row.execution.eventId = 5011; row.completion.eventId = 5012;
      row.execution.eventAt = '2026-11-05T00:00:00Z'; row.completion.eventAt = '2026-11-05T00:01:00Z'; row.stepCompletedAt = row.completion.eventAt;
      row.status = 'failed'; row.completion.status = 'failed'; Object.assign(row, { output: null });
      d.owningExecutions.push(row);
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it('keeps bad pre-repair quality visible but does not apply it to a complete good post-repair observation window', async () => {
    const { github, evidence, observationPolicy } = await collected({ deploymentAt: '2026-11-01T00:00:00Z', mutateRuntime: d => {
      const before = structuredClone(d.deming[0]); before.eventId = 99; before.runId = 99; before.stepId = 99;
      before.eventAt = '2026-11-01T12:00:00Z'; before.score.at = before.eventAt; before.execution.eventAt = '2026-11-01T11:59:59.999Z';
      before.score.correct = 0; before.score.matched = 0; before.score.institutions[0].correct = 0; before.score.institutions[0].matched = 0;
      d.deming.unshift(before);
    } });
    const result = assessOperationalEvidence(evidence, observationPolicy, { github, now });
    expect(result.status).toBe('PRODUCTION_VERIFIED');
    expect(result.observation.sampleDays).toBe(8);
    expect(result.observation.eligibleSampleCount).toBe(8);
    expect(result.observation.ineligibleSamples).toContainEqual({ eventId: 99, reason: 'before_owning_completion' });
  });

  it('does not use a later client score clock to hide native measurement execution before the owning work', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.deming.forEach(sample => { sample.execution.eventAt = '2026-11-01T22:59:59Z'; });
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not use a native measurement executor tied with the rounded owning completion as an after-repair witness', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.deming[0].execution.eventAt = d.owningExecutions[0].completion.eventAt;
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('orders failure and actual recovery by native terminal event ID when their timestamps round to the same millisecond', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const failure = structuredClone(d.owningExecutions[0]); failure.runId = 1010; failure.stepId = 2010;
      failure.execution.eventId = 4998; failure.completion.eventId = 4999; failure.output.attemptId = 6999;
      failure.status = 'failed'; failure.completion.status = 'failed'; failure.output.outcome = 'parse_error'; failure.output.insertedCount = 0;
      d.owningExecutions.unshift(failure);
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });
  it('does not settle a later repair with a fresh but pre-repair Bayes check under an explicitly shorter observation window', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const owner = d.owningExecutions[0]; owner.execution.eventAt = '2026-11-08T23:00:00Z'; owner.output.createdAt = owner.execution.eventAt;
      owner.completion.eventAt = owner.execution.eventAt; owner.stepCompletedAt = owner.completion.eventAt;
      d.deming = [structuredClone(d.deming[0]), structuredClone(d.deming[1])];
      d.deming.forEach((sample, index) => { const at = index === 0 ? '2026-11-08T23:30:00Z' : '2026-11-09T00:00:00Z'; sample.eventAt = at; sample.score.at = at; sample.execution.eventAt = new Date(Date.parse(at) - 1).toISOString(); });
      d.bayes[0].checkedAt = '2026-11-02T00:00:00Z'; d.bayes[0].execution.eventAt = '2026-11-01T23:30:00Z';
    } });
    observationPolicy.observationDays = 1 / 48; observationPolicy.maxSampleGapHours = 168;
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it('does not stretch six days and twenty-three native hours into seven days using a tolerated client clock offset', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.deming.forEach((sample, index) => {
        const nativeAt = Date.parse(sample.score.at) - index * (3600000 / 7);
        sample.eventAt = new Date(nativeAt).toISOString();
        sample.execution.eventAt = new Date(nativeAt - 1).toISOString();
      });
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it.each(['2026-11-01T22:59:59Z', '2026-11-01T23:00:00Z', null])('requires Bayes native pre-read execution after owning completion even when checkedAt is current: %s', async eventAt => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => { Object.assign(d.bayes[0].execution, { eventAt }); } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });
  it('does not infer an absent Deming executor timestamp from its later score or persisted event time', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => { Object.assign(d.deming[0].execution, { eventAt: null }); } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it('uses native observation order for a complete approved short window despite tolerated client clock reordering', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      d.deming = [structuredClone(d.deming[0]), structuredClone(d.deming[1])];
      d.deming.forEach((sample, index) => {
        sample.eventAt = index === 0 ? '2026-11-08T23:30:00Z' : '2026-11-09T00:00:00Z';
        sample.execution.eventAt = new Date(Date.parse(sample.eventAt) - 1).toISOString();
        sample.score.at = index === 0 ? '2026-11-08T23:55:00Z' : '2026-11-08T23:35:00Z';
      });
    } });
    observationPolicy.observationDays = 1 / 48; observationPolicy.maxSampleGapHours = 1;
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_VERIFIED');
  });
  it('does not clear native-unbound output at a rounded timestamp using the earlier finish event ID as its output order', async () => {
    const { github, evidence, observationPolicy } = await collected({ mutateRuntime: d => {
      const ambiguous = structuredClone(d.owningExecutions[0]); ambiguous.runId = 1010; ambiguous.stepId = 2010;
      ambiguous.execution.eventId = 4998; ambiguous.completion.eventId = 4999; ambiguous.output.attemptId = 6999;
      ambiguous.status = 'failed'; ambiguous.completion.status = 'failed'; ambiguous.output.outcome = 'parse_error'; ambiguous.output.insertedCount = 0;
      ambiguous.output.bindsToExecution = false;
      d.owningExecutions.unshift(ambiguous);
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it('does not settle still-running unknown-overlap work with success from a different owning step', async () => {
    const { github, evidence, observationPolicy } = await collected({ deploymentAt: '2026-11-01T00:00:00Z', mutateRuntime: d => {
      const running = structuredClone(d.owningExecutions[0]); running.runId = 1010; running.stepId = 2010;
      running.execution.eventId = 4998; running.execution.eventAt = '2026-11-01T22:00:00Z'; running.status = 'running';
      Object.assign(running, { completion: null, stepCompletedAt: null, output: null });
      d.owningExecutions.unshift(running);
    } });
    expect(assessOperationalEvidence(evidence, observationPolicy, { github, now }).status).toBe('PRODUCTION_UNVERIFIED');
  });

});
