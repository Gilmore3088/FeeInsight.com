import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessReviewEvidence } from './evidence.mjs';
const { sourceFetch } = vi.hoisted(() => { const sourceFetch = vi.fn(); vi.stubGlobal('fetch', sourceFetch); return { sourceFetch }; });
import { collectGithubEvidence, isGithubEvidence } from './github.mjs';
const sha = 'a'.repeat(40);
const ciRun = { id: 9, repository: { full_name: 'o/r' }, workflow_id: 7, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1, pull_requests: [{ number: 1 }] };
function api(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    '': { default_branch: 'main' }, '/commits/main': { sha: 'c'.repeat(40) }, '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('trusted workflow') },
    '/pulls/1': { number: 1, head: { sha }, user: { login: 'builder', id: 1 }, state: 'open', mergeable: true, html_url: 'https://github.com/o/r/pull/1' },
    '/pulls/1/files': [{ filename: 'src/lib/a.ts', status: 'modified' }],
    '/pulls/1/reviews': [], '/issues/1/comments': [],
    [`/commits/${sha}/check-runs`]: { check_runs: [{ id: 8, name: 'app-tests', head_sha: sha, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, details_url: 'https://github.com/o/r/actions/runs/9/job/10' }] },
    '/actions/workflows/test.yml': { id: 7, path: '.github/workflows/test.yml' },
    '/actions/workflows/7/runs': { workflow_runs: [ciRun] },
    '/actions/runs/9': ciRun,
    '/actions/runs/9/jobs': { jobs: [{ id: 10, run_id: 9, run_attempt: 1, head_sha: sha, name: 'app-tests', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/10' }] },
    '/actions/runs/9/attempts/1/jobs': { jobs: [{ id: 10, run_id: 9, run_attempt: 1, head_sha: sha, name: 'app-tests', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/10' }] },
    '/actions/runs/9/artifacts': { artifacts: [] }, '/deployments': [],
    ...overrides,
  };
  return async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://api.github.com/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    expect(options.method ?? 'GET').toBe('GET');
    const key = new URL(url).pathname.replace('/repos/o/r', '');
    return key in values ? Response.json(values[key]) : Response.json({ message: key }, { status: 404 });
  };
}

// Safe identity projection from native PR2995/run42357473949 after its squash merge.
// GitHub returns empty PR arrays on both that run and check suite after merge.
const historicalHead = 'e9ec7db32343af691e175f203108e4bfd7ab665d';
const historicalMerge = 'd28d77a4da9d2fb6edc73d8c264e42a7e380ae77';
const historicalTree = '4ec1fd24f97de3e3f6a413137624f95c1a7808a2';
const historicalRepo = { id: 1159701429, full_name: 'Gilmore3088/FeeInsight.com' };
const historicalPr = { number: 2995, state: 'closed', merged: true, merged_at: '2026-11-08T04:21:18Z', merge_commit_sha: historicalMerge,
  base: { sha: '75ec21c49aa87dfc5739840bf2af4d89fe5fd97c', ref: 'main', repo: historicalRepo },
  head: { sha: historicalHead, ref: 'feat/verification-protocol-m0-m1-20261106', repo: historicalRepo },
  user: { id: 35467558, login: 'Gilmore3088', type: 'User' }, mergeable: null, html_url: 'https://github.com/Gilmore3088/FeeInsight.com/pull/2995' };
const historicalRun = { id: 42357473949, workflow_id: 262504048, event: 'pull_request', head_sha: historicalHead, head_branch: historicalPr.head.ref,
  path: '.github/workflows/test.yml', repository: historicalRepo, head_repository: historicalRepo, run_attempt: 1, check_suite_id: 114761315428,
  status: 'completed', conclusion: 'success', created_at: '2026-11-07T08:54:56Z', updated_at: '2026-11-07T09:07:45Z', pull_requests: [] };
const historicalJob = { id: 128361345999, run_id: historicalRun.id, run_attempt: 1, head_sha: historicalHead, name: 'app-tests', status: 'completed', conclusion: 'success',
  completed_at: '2026-11-07T09:07:44Z', html_url: 'https://github.com/Gilmore3088/FeeInsight.com/actions/runs/42357473949/job/128361345999' };
function historicalApi(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    '': { ...historicalRepo, default_branch: 'main' }, '/commits/main': { sha: historicalMerge },
    '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('same registered workflow source at head and trusted main') },
    '/pulls/2995': historicalPr, '/pulls/2995/files': [{ filename: 'src/lib/a.ts', status: 'modified' }], '/pulls/2995/reviews': [], '/issues/2995/comments': [],
    [`/commits/${historicalHead}/check-runs`]: { check_runs: [{ id: historicalJob.id, name: 'app-tests', head_sha: historicalHead, status: 'completed', conclusion: 'success',
      check_suite: { id: historicalRun.check_suite_id }, app: { id: 15368, slug: 'github-actions' }, details_url: historicalJob.html_url }] },
    '/actions/workflows/test.yml': { id: historicalRun.workflow_id, path: '.github/workflows/test.yml' },
    [`/actions/workflows/${historicalRun.workflow_id}/runs`]: { workflow_runs: [historicalRun] },
    [`/actions/runs/${historicalRun.id}`]: historicalRun,
    [`/actions/runs/${historicalRun.id}/attempts/1/jobs`]: { jobs: [historicalJob] },
    [`/actions/runs/${historicalRun.id}/artifacts`]: { artifacts: [] },
    [`/commits/${historicalHead}/pulls`]: [historicalPr],
    [`/git/commits/${historicalHead}`]: { sha: historicalHead, tree: { sha: historicalTree } },
    [`/git/commits/${historicalMerge}`]: { sha: historicalMerge, tree: { sha: historicalTree }, parents: [{ sha: historicalPr.base.sha }] },
    '/deployments': [], ...overrides,
  };
  return async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://api.github.com/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    expect(options.method ?? 'GET').toBe('GET');
    const key = new URL(url).pathname.replace('/repos/' + historicalRepo.full_name, '');
    return key in values ? Response.json(values[key]) : Response.json({ message: 'native read unavailable' }, { status: 404 });
  };
}
const collectHistorical = (fetchImpl = historicalApi()) => collectGithubEvidence({ repository: historicalRepo.full_name, prNumber: 2995, token: 'secret', fetchImpl, now: new Date('2026-11-08T05:00:00Z') });

describe('native historical merged-head CI association', () => {
  afterEach(() => sourceFetch.mockReset());
  it('corroborates actual empty postmerge run associations through native commit membership and identical squash trees', async () => {
    const snapshot = await collectHistorical();
    expect(snapshot.ci.status).toBe('PASSED');
    expect(snapshot.ci.association).toMatchObject({ kind: 'historical_head_identity', prNumber: 2995, triggerPrNumber: null, headSha: historicalHead, mergeSha: historicalMerge, treeSha: historicalTree });
    expect(snapshot.ci.run.pull_requests).toEqual([]);
    expect(isGithubEvidence(snapshot)).toBe(false);
    expect(isGithubEvidence(JSON.parse(JSON.stringify(snapshot)))).toBe(false);
  });
  it('never treats an open or closed-unmerged PR as historical authority', async () => {
    for (const changes of [{ state: 'open' }, { merged: false }, { merged_at: null }, { merge_commit_sha: null }]) {
      expect((await collectHistorical(historicalApi({ '/pulls/2995': { ...historicalPr, ...changes } }))).ci.status).toBe('BLOCKED');
    }
  });
  it('preserves an open-PR missing-association block even if matching native history is available', async () => {
    const snapshot = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api({
      '/actions/workflows/7/runs': { workflow_runs: [{ ...ciRun, pull_requests: [] }] }, '/actions/runs/9': { ...ciRun, pull_requests: [] },
      [`/commits/${sha}/pulls`]: [{ number: 1 }],
    }) });
    expect(snapshot.ci.status).toBe('BLOCKED');
  });
  it.each([
    [], [{ ...historicalPr, number: 2996 }], [historicalPr, { ...historicalPr, number: 2996 }],
    [{ ...historicalPr, head: { ...historicalPr.head, sha: 'b'.repeat(40) } }],
    [{ ...historicalPr, merge_commit_sha: 'b'.repeat(40) }],
    [{ ...historicalPr, head: { ...historicalPr.head, repo: { ...historicalRepo, full_name: 'other/repository' } } }],
  ].map(association => ({ association })))('rejects absent, counter-PR, ambiguous or mismatched native commit associations', async ({ association }) => {
    expect((await collectHistorical(historicalApi({ [`/commits/${historicalHead}/pulls`]: association }))).ci.status).toBe('BLOCKED');
  });
  it.each([
    { sha: historicalMerge, tree: { sha: 'b'.repeat(40) } },
    { sha: 'b'.repeat(40), tree: { sha: historicalTree } },
    { sha: historicalMerge, tree: {} },
  ])('rejects missing/different immutable merge trees or commit identity', async commit => {
    expect((await collectHistorical(historicalApi({ [`/git/commits/${historicalMerge}`]: commit }))).ci.status).toBe('BLOCKED');
  });
  it.each([
    { repository: { ...historicalRepo, full_name: 'other/repository' } }, { repository: { ...historicalRepo, id: 1 } },
    { head_repository: { ...historicalRepo, full_name: 'other/repository' } }, { head_branch: 'other-branch' },
    { path: '.github/workflows/impostor.yml' }, { pull_requests: [{ number: 2996 }] },
    { updated_at: '2026-11-08T05:00:00Z' },
  ])('rejects mismatched historical run repository/ref/workflow association or postmerge completion', async changes => {
    const run = { ...historicalRun, ...changes };
    expect((await collectHistorical(historicalApi({ [`/actions/workflows/${historicalRun.workflow_id}/runs`]: { workflow_runs: [run] }, [`/actions/runs/${historicalRun.id}`]: run }))).ci.status).toBe('BLOCKED');
  });
  it('fails closed when native commit identity reads are unavailable', async () => {
    const original = historicalApi();
    expect((await collectHistorical(async (input, options) => String(input).includes('/git/commits/') ? Response.json({ message: 'denied' }, { status: 403 }) : original(input, options))).ci.status).toBe('BLOCKED');
  });
  it('requires the historical check suite, App and premerge job completion to agree', async () => {
    const checksPath = `/commits/${historicalHead}/check-runs`;
    for (const changes of [{ app: { id: 1, slug: 'github-actions' } }, { check_suite: { id: 1 } }]) {
      const native = await historicalApi()('https://api.github.com/repos/' + historicalRepo.full_name + checksPath);
      const checks = await native.json();
      expect((await collectHistorical(historicalApi({ [checksPath]: { check_runs: [{ ...checks.check_runs[0], ...changes }] } }))).ci.status).toBe('BLOCKED');
    }
    expect((await collectHistorical(historicalApi({ [`/actions/runs/${historicalRun.id}/attempts/1/jobs`]: { jobs: [{ ...historicalJob, completed_at: '2026-11-08T05:00:00Z' }] } }))).ci.status).toBe('BLOCKED');
  });
  it('rejects a native association that becomes ambiguous before finalization', async () => {
    const original = historicalApi(); let reads = 0;
    const snapshot = await collectHistorical(async (input, options) => new URL(String(input)).pathname.endsWith(`/commits/${historicalHead}/pulls`) && ++reads > 1 ? Response.json([historicalPr, { ...historicalPr, number: 2996 }]) : original(input, options));
    expect(snapshot.ci.status).toBe('BLOCKED');
    expect(snapshot.ci.problems).toContain('Historical native commit association changed while collecting evidence');
  });
  it('rechecks merged PR identity before finalization', async () => {
    for (const changes of [{ state: 'open' }, { merged: false }, { merge_commit_sha: 'b'.repeat(40) }, { head: { ...historicalPr.head, ref: 'changed-branch' } }]) {
      const original = historicalApi(); let reads = 0;
      const snapshot = await collectHistorical(async (input, options) => new URL(String(input)).pathname.endsWith('/pulls/2995') && ++reads > 1 ? Response.json({ ...historicalPr, ...changes }) : original(input, options));
      expect(snapshot.ci.status).toBe('BLOCKED');
    }
  });
  it('rejects a new same-head run or changed attempt during historical collection', async () => {
    for (const mode of ['new-run', 'attempt'] as const) {
      const original = historicalApi(); let reads = 0;
      const snapshot = await collectHistorical(async (input, options) => {
        const path = new URL(String(input)).pathname;
        if (mode === 'new-run' && path.endsWith(`/actions/workflows/${historicalRun.workflow_id}/runs`) && ++reads > 1) return Response.json({ workflow_runs: [{ ...historicalRun, id: historicalRun.id + 1, conclusion: 'failure' }, historicalRun] });
        if (mode === 'attempt' && path.endsWith(`/actions/runs/${historicalRun.id}`)) return Response.json({ ...historicalRun, run_attempt: 2 });
        return original(input, options);
      });
      expect(snapshot.ci.status).toBe('BLOCKED');
    }
  });
  it('does not turn closed-PR history into current merge permission', async () => {
    sourceFetch.mockImplementation(historicalApi());
    const snapshot = await collectGithubEvidence({ repository: historicalRepo.full_name, prNumber: 2995, token: 'secret', now: new Date('2026-11-08T05:00:00Z') });
    expect(snapshot.ci.status).toBe('PASSED');
    const review = assessReviewEvidence(snapshot, { headSha: historicalHead, contractSha256: 'a'.repeat(64), policySha256: 'b'.repeat(64), now: new Date('2026-11-08T05:00:00Z') });
    expect(review.status).toBe('BLOCKED');
    expect(review.blockers).toContain('PR is draft or not open');
  });
});
describe('authenticated GitHub engineering collector', () => {
  afterEach(() => sourceFetch.mockReset());
  it('binds checks to the actual workflow and job, never name-only success', async () => {
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api(), now: new Date('2026-11-06') });
    expect(isGithubEvidence(evidence)).toBe(false);
    expect(isGithubEvidence(JSON.parse(JSON.stringify(evidence)))).toBe(false);
    expect(evidence.ci.status).toBe('PASSED');
    expect(evidence.ci.runId).toBe(9);
    expect(evidence.ci.association).toMatchObject({ kind: 'direct_pr', prNumber: 1, triggerPrNumber: null });
    expect(JSON.stringify(evidence)).not.toContain('secret');
    expect(Object.isFrozen(evidence.pullRequest)).toBe(true);
  });
  it('can omit unrelated deployment reads for engineering-only multi-change collection', async () => {
    const original = api();
    const fetchImpl = async (input: string | URL | Request, options: RequestInit = {}) => {
      expect(String(input)).not.toContain('/deployments');
      return original(input, options);
    };
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', includeDeployments: false, fetchImpl });
    expect(evidence.deploymentsIncluded).toBe(false);
    expect(evidence.deployments).toEqual([]);
  });
  it('rejects a green check from a different workflow job', async () => {
    const wrongJob = { jobs: [{ id: 11, name: 'app-tests', conclusion: 'success', status: 'completed' }] };
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api({ '/actions/runs/9/jobs': wrongJob, '/actions/runs/9/attempts/1/jobs': wrongJob }) });
    expect(evidence.ci.status).toBe('BLOCKED');
  });
  it.each(['in_progress', 'completed'])('invalidates cached success when the same-SHA run is rerun (%s)', async status => {
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api({
      '/actions/runs/9': { ...ciRun, run_attempt: 2, status, conclusion: status === 'completed' ? 'failure' : null },
    }) });
    expect(evidence.ci.status).toBe('BLOCKED');
    expect(evidence.ci.problems.join(' ')).toContain('changed while collecting');
  });
  it('rejects a newer same-head workflow run selected during collection', async () => {
    const original = api(); let runCollections = 0;
    const fetchImpl = async (input: string | URL | Request, options: RequestInit = {}) => {
      if (new URL(String(input)).pathname.endsWith('/actions/workflows/7/runs') && ++runCollections > 1) {
        return Response.json({ workflow_runs: [{ ...ciRun, id: 19, status: 'in_progress', conclusion: null }, ciRun] });
      }
      return original(input, options);
    };
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl });
    expect(evidence.ci.status).toBe('BLOCKED');
    expect(evidence.ci.problems.join(' ')).toContain('changed while collecting');
  });
  it.each([{ run_id: 19 }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) }])('rejects a green job with mismatched run lineage: %j', async changes => {
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api({
      '/actions/runs/9/attempts/1/jobs': { jobs: [{ id: 10, run_id: 9, run_attempt: 1, head_sha: sha, name: 'app-tests', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/10', ...changes }] },
    }) });
    expect(evidence.ci.status).toBe('BLOCKED');
  });
  it('rejects head movement during evidence collection', async () => {
    const original = api(); let calls = 0;
    const fetchImpl = async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).pathname === '/repos/o/r/pulls/1' && ++calls > 1) return Response.json({ head: { sha: 'b'.repeat(40) } });
      return original(url, options);
    };
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl });
    expect(evidence.problems).toContain('Pull request head changed while collecting evidence');
    expect(evidence.ci.status).toBe('BLOCKED');
  });
  it('does not accept API omissions as absence of blockers', async () => {
    const original = api();
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: async (input: string | URL | Request, options: RequestInit = {}) => String(input).endsWith('/graphql') ? Response.json({ errors: [{ message: 'denied' }] }) : original(input, options) });
    expect(evidence.problems.join(' ')).toContain('review threads');
  });
});

describe('independent review authority', () => {
  afterEach(() => sourceFetch.mockReset());
  const contractSha256 = 'b'.repeat(64), policySha256 = 'c'.repeat(64), now = new Date('2026-11-06');
  const binding = { head_sha: sha, contract_sha256: contractSha256, policy_sha256: policySha256, reviewed_scope: ['src/lib/a.ts'], findings: [] };
  const body = (data: unknown) => `<!-- engineering-verification: ${JSON.stringify(data)} -->`;
  function review(extra = {}) { return { id: 1, user: { id: 2, login: 'reviewer', type: 'User' }, state: 'APPROVED', author_association: 'COLLABORATOR', commit_id: sha, submitted_at: now.toISOString(), body: body(binding), ...extra }; }
  async function assess(reviews: unknown[], files: unknown = [{ filename: 'src/lib/a.ts', status: 'modified' }]) {
    sourceFetch.mockImplementation(api({ '/pulls/1/reviews': reviews, '/pulls/1/files': files }));
    const snapshot = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', now });
    return assessReviewEvidence(snapshot, { headSha: sha, contractSha256, policySha256, now, ownerLogins: ['builder'] });
  }
  it('verifies an independently authenticated exact-head scope and frozen hashes', async () => {
    expect((await assess([review()])).status).toBe('INDEPENDENT_REVIEW_VERIFIED');
  });
  it('requires the old protected path and new destination in a pure-rename review', async () => {
    const files = [{ filename: 'docs/old-guide.md', previous_filename: 'AGENTS.md', status: 'renamed' }];
    const partial = review({ body: body({ ...binding, reviewed_scope: ['docs/old-guide.md'] }) });
    expect((await assess([partial], files)).status).toBe('BLOCKED');
    const complete = review({ body: body({ ...binding, reviewed_scope: ['AGENTS.md', 'docs/old-guide.md'] }) });
    expect((await assess([complete], files)).status).toBe('INDEPENDENT_REVIEW_VERIFIED');
  });
  it.each([
    [{ filename: 'docs/old-guide.md', status: 'renamed' }],
    [{ filename: 'docs/old-guide.md', previous_filename: '../AGENTS.md', status: 'renamed' }],
    [{ filename: 'docs/old-guide.md', previous_filename: ['AGENTS.md'], status: 'renamed' }],
    [{ filename: 'docs/old-guide.md', status: 'invented' }],
  ])('does not let a destination-only review hide a malformed changed-file inventory: %j', async file => {
    const partial = review({ body: body({ ...binding, reviewed_scope: ['docs/old-guide.md'] }) });
    expect((await assess([partial], [file])).status).toBe('BLOCKED');
  });
  it('records owner sign-off separately and never counts same-account approval as independent', async () => {
    const result = await assess([review({ user: { id: 1, login: 'builder', type: 'User' }, body: body({ ...binding, owner_signoff: true }) })]);
    expect(result.ownerSignoff?.actor).toBe('builder');
    expect(result.independentReviewers).toEqual([]);
    expect(result.status).toBe('BLOCKED');
  });
  it.each([
    { commit_id: 'd'.repeat(40) }, { body: body({ ...binding, policy_sha256: 'd'.repeat(64) }) },
    { body: body({ ...binding, reviewed_scope: [] }) }, { submitted_at: '2026-01-01' },
    { user: { id: 2, login: 'bot', type: 'Bot' } },
  ])('invalidates stale, policy-shifted, partial-scope and automated approvals', async extra => {
    expect((await assess([review(extra)])).status).toBe('BLOCKED');
  });
  it('rejects malformed findings and fixed findings without root-cause tracking', async () => {
    expect((await assess([review({ body: body({ ...binding, findings: {} }) })])).status).toBe('BLOCKED');
    expect((await assess([review({ body: body({ ...binding, findings: [{ id: 'F1', severity: 'P2', owner: 'builder', reproduction: 'repro', disposition: 'FIXED', resolved_head_sha: sha, resolution_ref: 'https://github.com/o/r/pull/1' }] }) })])).blockers.join(' ')).toContain('root-cause issue');
  });
  it('does not let a later approval by another actor erase an outstanding change request', async () => {
    const result = await assess([review(), review({ id: 3, user: { id: 3, login: 'other', type: 'User' }, state: 'CHANGES_REQUESTED' })]);
    expect(result.blockers).toContain('Blocking change request remains');
  });
});
