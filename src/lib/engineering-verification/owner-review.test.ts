import { afterEach, describe, expect, it, vi } from 'vitest';
const { sourceFetch } = vi.hoisted(() => { const sourceFetch = vi.fn(); vi.stubGlobal('fetch', sourceFetch); return { sourceFetch }; });
import { collectGithubEvidence } from './github.mjs';
import { assessReviewEvidence } from './evidence.mjs';

const headSha = 'a'.repeat(40), contractSha256 = 'b'.repeat(64), policySha256 = 'c'.repeat(64);
const now = new Date('2026-11-09T00:00:00Z');
const earlier = '2026-11-08T20:00:00Z', later = '2026-11-08T22:00:00Z';
const binding = { head_sha: headSha, contract_sha256: contractSha256, policy_sha256: policySha256, reviewed_scope: ['src/lib/a.ts'], findings: [] };
const body = (value: unknown) => `<!-- engineering-verification: ${JSON.stringify(value)} -->`;
const owner = { id: 1, login: 'builder', type: 'User' };
function comment(signoff: boolean, extra: Record<string, unknown> = {}) {
  return { id: 10, user: owner, created_at: earlier, updated_at: earlier, body: body({ ...binding, owner_signoff: signoff }), html_url: 'https://github.com/o/r/pull/1#issuecomment-10', ...extra };
}
function ownerReview(state: string, extra: Record<string, unknown> = {}) {
  return { id: 11, user: owner, state, commit_id: headSha, submitted_at: later, body: body({ ...binding, owner_signoff: true }), html_url: 'https://github.com/o/r/pull/1#pullrequestreview-11', ...extra };
}
async function collected(comments: unknown[], ownerReviews: unknown[] = []) {
  const independent = { id: 20, user: { id: 2, login: 'reviewer', type: 'User' }, state: 'APPROVED', author_association: 'COLLABORATOR', commit_id: headSha, submitted_at: later, body: body(binding) };
  const values: Record<string, unknown> = {
    '': { default_branch: 'main' }, '/commits/main': { sha: 'd'.repeat(40) }, '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('trusted workflow') },
    '/pulls/1': { number: 1, head: { sha: headSha }, user: owner, state: 'open', mergeable: true },
    '/pulls/1/files': [{ filename: 'src/lib/a.ts', status: 'modified' }], '/pulls/1/reviews': [...ownerReviews, independent], '/issues/1/comments': comments,
    [`/commits/${headSha}/check-runs`]: { check_runs: [] }, '/actions/workflows/test.yml': { id: 7, path: '.github/workflows/test.yml' }, '/actions/workflows/7/runs': { workflow_runs: [] },
  };
  sourceFetch.mockImplementation(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    const key = url.pathname.replace('/repos/o/r', '');
    return key in values ? Response.json(values[key]) : Response.json({ message: 'missing' }, { status: 404 });
  });
  return collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'private', includeDeployments: false, now });
}
const assess = (snapshot: unknown) => assessReviewEvidence(snapshot, { headSha, contractSha256, policySha256, ownerLogins: ['builder'], now });

describe('authenticated owner authorization decisions', () => {
  afterEach(() => sourceFetch.mockReset());
  it('keeps owner authorization separate and exposes the native decision timestamp and kind', async () => {
    const result = assess(await collected([comment(true)]));
    expect(result.status).toBe('INDEPENDENT_REVIEW_VERIFIED');
    expect(result.ownerSignoff).toMatchObject({ actor: 'builder', id: 10, decidedAt: earlier, eventKind: 'comment' });
    expect(result.independentReviewers.map(row => row.actor)).toEqual(['reviewer']);
  });
  it('revokes an earlier grant regardless of endpoint array order', async () => {
    const result = assess(await collected([comment(false, { id: 12, created_at: later, updated_at: later }), comment(true)]));
    expect(result.ownerSignoff).toBeNull();
  });
  it('uses native comment edit time so an edited revocation supersedes a later-created grant', async () => {
    const result = assess(await collected([comment(false, { updated_at: '2026-11-08T23:00:00Z' }), comment(true, { id: 12, created_at: later, updated_at: later })]));
    expect(result.ownerSignoff).toBeNull();
  });
  it.each(['DISMISSED', 'CHANGES_REQUESTED'])('a current %s review cannot grant owner authorization or preserve an earlier comment grant', async state => {
    expect(assess(await collected([], [ownerReview(state)])).ownerSignoff).toBeNull();
    expect(assess(await collected([comment(true)], [ownerReview(state, { body: body(binding) })])).ownerSignoff).toBeNull();
  });
  it('does not infer that a comment followed dismissal from the dismissed review original submission time', async () => {
    const result = assess(await collected([comment(true, { created_at: later, updated_at: later })], [ownerReview('DISMISSED', { submitted_at: earlier })]));
    expect(result.ownerSignoff).toBeNull();
  });
  it('uses revocation on timestamp ties across comment and review identities', async () => {
    const result = assess(await collected([comment(false, { created_at: later, updated_at: later })], [ownerReview('APPROVED')]));
    expect(result.ownerSignoff).toBeNull();
  });
  it('accepts a later explicit regrant after revocation and records the new native event', async () => {
    const result = assess(await collected([comment(false)], [ownerReview('APPROVED')]));
    expect(result.ownerSignoff).toMatchObject({ id: 11, decidedAt: later, eventKind: 'review' });
  });
  it.each([
    { user: { ...owner, type: 'Bot' } }, { user: { ...owner, id: 0 } }, { user: { ...owner, login: 'stranger' } },
    { body: body({ ...binding, head_sha: 'd'.repeat(40), owner_signoff: true }) },
    { body: body({ ...binding, contract_sha256: 'd'.repeat(64), owner_signoff: true }) },
    { body: body({ ...binding, policy_sha256: 'd'.repeat(64), owner_signoff: true }) },
    { body: body({ ...binding, reviewed_scope: [], owner_signoff: true }) },
    { created_at: '2026-01-01', updated_at: earlier }, { created_at: '2026-11-10', updated_at: '2026-11-10' },
    { updated_at: 'invalid' }, { updated_at: '2026-11-08T19:00:00Z' },
  ])('requires a native human identity, exact binding, retained record and valid decision time: %j', async extra => {
    expect(assess(await collected([comment(true, extra)])).ownerSignoff).toBeNull();
  });
  it('requires owner reviews to bind the native commit as well as the marker and ignores pending drafts', async () => {
    expect(assess(await collected([], [ownerReview('APPROVED', { commit_id: 'd'.repeat(40) })])).ownerSignoff).toBeNull();
    expect(assess(await collected([], [ownerReview('PENDING')])).ownerSignoff).toBeNull();
  });
  it('does not mint authenticated owner authorization from a serialized collector result', async () => {
    const snapshot = await collected([comment(true)]);
    expect(assess(JSON.parse(JSON.stringify(snapshot))).ownerSignoff).toBeNull();
  });
});
