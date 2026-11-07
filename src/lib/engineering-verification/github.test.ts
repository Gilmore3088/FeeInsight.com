import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessReviewEvidence } from './evidence.mjs';
const { sourceFetch } = vi.hoisted(() => { const sourceFetch = vi.fn(); vi.stubGlobal('fetch', sourceFetch); return { sourceFetch }; });
import { collectGithubEvidence, isGithubEvidence } from './github.mjs';
const sha = 'a'.repeat(40);
function api(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    '': { default_branch: 'main' }, '/commits/main': { sha: 'c'.repeat(40) }, '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('trusted workflow') },
    '/pulls/1': { number: 1, head: { sha }, user: { login: 'builder', id: 1 }, state: 'open', mergeable: true, html_url: 'https://github.com/o/r/pull/1' },
    '/pulls/1/files': [{ filename: 'src/lib/a.ts', status: 'modified' }],
    '/pulls/1/reviews': [], '/issues/1/comments': [],
    [`/commits/${sha}/check-runs`]: { check_runs: [{ id: 8, name: 'app-tests', head_sha: sha, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, details_url: 'https://github.com/o/r/actions/runs/9/job/10' }] },
    '/actions/workflows/test.yml': { id: 7, path: '.github/workflows/test.yml' },
    '/actions/workflows/7/runs': { workflow_runs: [{ id: 9, repository: { full_name: 'o/r' }, workflow_id: 7, head_sha: sha, event: 'pull_request', status: 'completed', conclusion: 'success', run_attempt: 1, pull_requests: [{ number: 1 }] }] },
    '/actions/runs/9/jobs': { jobs: [{ id: 10, name: 'app-tests', status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/9/job/10' }] },
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
describe('authenticated GitHub engineering collector', () => {
  afterEach(() => sourceFetch.mockReset());
  it('binds checks to the actual workflow and job, never name-only success', async () => {
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api(), now: new Date('2026-11-06') });
    expect(isGithubEvidence(evidence)).toBe(false);
    expect(isGithubEvidence(JSON.parse(JSON.stringify(evidence)))).toBe(false);
    expect(evidence.ci.status).toBe('PASSED');
    expect(evidence.ci.runId).toBe(9);
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
    const evidence = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', fetchImpl: api({ '/actions/runs/9/jobs': { jobs: [{ id: 11, name: 'app-tests', conclusion: 'success', status: 'completed' }] } }) });
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
