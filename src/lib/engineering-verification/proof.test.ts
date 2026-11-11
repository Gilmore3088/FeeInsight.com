// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CURRENT_PROOF_INPUTS, FORBIDDEN_PROOF_INPUTS, HISTORICAL_PROOF_SOURCE, completeProofFiles } from './proof-inputs.fixture';
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { nativeTreeResponse, nativeBlobSha } from './native-tree.fixture';
import { collectGithubEvidence, isGithubEvidence } from './github.mjs';
import { contractDigest } from './contract.mjs';
import { assessCollectedProof, collectProofEvidence, isCollectedProof } from './proof.mjs';

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), ORCHESTRATOR = 'c'.repeat(40);
const NOW = new Date('2026-11-06T12:05:00Z');
const HASH = 'd'.repeat(64), WORKFLOW_PATH = '.github/workflows/engineering-verification.yml';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function fixture(workflowFreeze: 'valid' | 'missing' | 'wrong' = 'valid') {
  const files: Record<string, string> = {
    [WORKFLOW_PATH]: 'name: Engineering verification\non: workflow_dispatch\n',
    'src/lib/engineering-verification/runner.mjs': 'trusted runner',
    'src/lib/engineering-verification/pilot.mjs': 'trusted assertions',
    'src/lib/engineering-verification/pilot.test.ts': 'trusted tests',
    'src/lib/engineering-verification/__fixtures__/knox-2285.json': 'synthetic source',
    'src/lib/engineering-verification/runtime.json': '{"image":"node@sha256:' + HASH + '"}',
    'package-lock.json': '{"trusted":"dependencies"}',
    'package.json': '{"name":"trusted-verification-toolchain"}',
  };
  completeProofFiles(files);
  const contract = {
    schema_version: '1.1', contract_id: 'EV-FOUNDATION-1048-V2', issue: '#1048', risk_tier: 'R2', base_sha: BASE,
    scope: ['src/lib/agents/knox/**'], required_skills: ['tdd', 'adversarial-document-testing', 'error-to-test'],
    production_boundary: 'NO_PROD_MUTATION', human_approval_required: false,
    execution_files: CURRENT_PROOF_INPUTS.filter(path => workflowFreeze !== 'missing' || path !== WORKFLOW_PATH).map(path => ({ path, sha256: workflowFreeze === 'wrong' && path === WORKFLOW_PATH ? '0'.repeat(64) : hash(files[path]) })),
    requirements: [{ id: 'KNOX-2285-01', behavior: 'Keep each price', authority: 'Synthetic issue #2285',
      test_id: 'knox-own-price', test_path: 'src/lib/engineering-verification/pilot.test.ts',
      fixture_path: 'src/lib/engineering-verification/__fixtures__/knox-2285.json', adapter_path: 'src/lib/engineering-verification/pilot.mjs',
      test_sha256: hash(files['src/lib/engineering-verification/pilot.test.ts']), fixture_sha256: hash(files['src/lib/engineering-verification/__fixtures__/knox-2285.json']), adapter_sha256: hash(files['src/lib/engineering-verification/pilot.mjs']),
      failure_signature: 'own price', assertion_ids: ['own-price'], baseline_failure_assertion_ids: ['own-price'], baseline_expectation: 'FAIL' }],
  };
  const contractRaw = JSON.stringify(contract), req = contract.requirements[0];
  files['docs/project/acceptance/engineering/1048-v2.json'] = contractRaw;
  const common = { requirement_id: req.id, test_id: req.test_id, command: 'trusted parent', artifact_url: 'https://github.com/o/r/actions/runs/101',
    execution_exit_code: 0,
    test_sha256: req.test_sha256, fixture_sha256: req.fixture_sha256, adapter_sha256: req.adapter_sha256,
    execution_sha256: contractDigest(JSON.stringify(contract.execution_files)), contract_sha256: contractDigest(contractRaw) };
  const receipt = {
    schema_version: '1.0', contract_key: '1048-v2', contract_id: contract.contract_id, base_sha: BASE, head_sha: HEAD, contract_sha256: contractDigest(contractRaw), execution_files: contract.execution_files,
    started_at: '2026-11-06T12:00:10Z', completed_at: '2026-11-06T12:01:00Z',
    runtime: { image: 'node@sha256:' + HASH, dependency_lock_sha256: hash(files['package-lock.json']) },
    provenance: { claimed_origin: 'GITHUB_ACTIONS_UNCORROBORATED', workflow_sha: ORCHESTRATOR, run_id: '101', run_attempt: '2' },
    pairs: [{ red: { ...common, base_sha: BASE, exit_code: 1, status: 'FAILED', failure_kind: 'ASSERTION_FAILURE', assertions: [{ id: 'own-price', status: 'FAILED' }] },
      green: { ...common, head_sha: HEAD, exit_code: 0, status: 'PASSED', failure_kind: 'NONE', assertions: [{ id: 'own-price', status: 'PASSED' }] } }],
  };
  const archive = () => zipSync({ 'receipt.json': strToU8(JSON.stringify(receipt)), 'summary.md': strToU8('Untrusted claimed status: VERIFIED') }, { mtime: new Date('2026-11-06T12:01:00Z') });
  const run = { id: 101, workflow_id: 33, run_attempt: 2, head_branch: 'main', head_sha: ORCHESTRATOR, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    path: WORKFLOW_PATH, repository: { id: 17, full_name: 'o/r' }, head_repository: { id: 17, full_name: 'o/r' },
    html_url: 'https://github.com/o/r/actions/runs/101', created_at: '2026-11-06T11:00:00Z', run_started_at: '2026-11-06T12:00:00Z', updated_at: '2026-11-06T12:02:00Z' };
  const artifact = () => ({ id: 88, name: 'engineering-verification-1-' + HEAD + '-1048-v2-attempt-2', expired: false, digest: 'sha256:' + hash(archive()), size_in_bytes: archive().length,
    created_at: '2026-11-06T12:01:10Z', expires_at: '2027-02-04T12:01:10Z', workflow_run: { id: 101, repository_id: 17, head_repository_id: 17, head_branch: 'main', head_sha: ORCHESTRATOR } });
  const overrides: Record<string, unknown> = {};
  const fetchImpl = async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe('https://api.github.com');
    expect(options.method).toBe('GET');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer secret' });
    const path = url.pathname.replace('/repos/o/r', '');
    if (path in overrides) return Response.json(overrides[path]);
    const tree = nativeTreeResponse(path, files);
    if (tree) return Response.json(tree);
    if (path === '/actions/artifacts/88/zip') return new Response(archive());
    if (path.startsWith('/contents/')) {
      const file = decodeURIComponent(path.slice('/contents/'.length));
      return file in files ? Response.json({ type: 'file', path: file, sha: nativeBlobSha(files[file]), encoding: 'base64', content: Buffer.from(files[file]).toString('base64') }) : new Response('', { status: 404 });
    }
    const routes: Record<string, unknown> = {
      '': { id: 17, full_name: 'o/r', default_branch: 'main' }, '/commits/main': { sha: ORCHESTRATOR },
      '/pulls/1': { head: { sha: HEAD }, body: '<!-- engineering-contract: 1048-v2 -->' },
      '/actions/workflows/engineering-verification.yml': { id: 33, path: WORKFLOW_PATH, state: 'active' },
      '/actions/workflows/33/runs': { workflow_runs: [run] }, '/actions/runs/101/attempts/2': run, '/actions/runs/101': run,
      '/actions/runs/101/attempts/2/jobs': { jobs: [{ id: 201, run_id: 101, run_attempt: 2, name: 'historical-proof', head_sha: ORCHESTRATOR, status: 'completed', conclusion: 'success' }] },
      '/actions/runs/101/artifacts': { artifacts: [artifact()] }, '/actions/artifacts/88': artifact(),
    };
    return path in routes ? Response.json(routes[path]) : new Response('', { status: 404 });
  };
  return { contract, contractRaw, receipt, files, run, artifact, archive, overrides, fetchImpl };
}

/** All injected snapshots retain their provenance blocker; no test can mint authority. */
async function githubSnapshot(marker = '<!-- engineering-contract: 1048-v2 -->') {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input)), path = url.pathname.replace('/repos/o/r', '');
    if (url.pathname === '/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    if (path === '/pulls/1') return Response.json({ head: { sha: HEAD }, user: { id: 1, login: 'builder' }, body: marker });
    if (path === '') return Response.json({ default_branch: 'main' });
    if (path === '/commits/main') return Response.json({ sha: ORCHESTRATOR });
    if (path.startsWith('/contents/')) return Response.json({ encoding: 'base64', content: btoa('workflow') });
    if (path === '/actions/workflows/test.yml') return Response.json({ id: 7, path: '.github/workflows/test.yml' });
    if (path.endsWith('/check-runs')) return Response.json({ check_runs: [] });
    if (path.endsWith('/runs')) return Response.json({ workflow_runs: [] });
    return Response.json([]);
  };
  return collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', now: NOW, fetchImpl });
}

/** Finite synthetic history exercises the real reader, without native provenance. */
async function historicalGithubSnapshot(options: {
  equalTrees?: boolean;
  initialMembershipMissing?: boolean;
  lateMembership?: 'missing' | 'ambiguous' | 'wrong-identity' | 'malformed' | 'unavailable';
  latePrChanged?: boolean;
} = {}) {
  const repo = { id: 17, full_name: 'o/r' }, mergeSha = 'e'.repeat(40), treeSha = 'f'.repeat(40);
  const pr = { number: 1, state: 'closed', merged: true, merged_at: '2026-11-06T12:03:00Z', merge_commit_sha: mergeSha,
    body: '<!-- engineering-contract: 1048-v2 -->', base: { sha: BASE, ref: 'main', repo },
    head: { sha: HEAD, ref: 'unit-history', repo }, user: { id: 1, login: 'builder' },
    mergeable: null, html_url: 'https://github.com/o/r/pull/1' };
  const run = { id: 9, workflow_id: 7, event: 'pull_request', head_sha: HEAD, head_branch: pr.head.ref,
    path: '.github/workflows/test.yml', repository: repo, head_repository: repo, run_attempt: 1, check_suite_id: 42,
    status: 'completed', conclusion: 'success', created_at: '2026-11-06T11:00:00Z', updated_at: '2026-11-06T12:02:00Z', pull_requests: [] };
  const job = { id: 10, run_id: 9, run_attempt: 1, head_sha: HEAD, name: 'app-tests', status: 'completed', conclusion: 'success',
    completed_at: '2026-11-06T12:01:00Z', html_url: 'https://github.com/o/r/actions/runs/9/job/10' };
  const values: Record<string, unknown> = {
    '': { ...repo, default_branch: 'main' }, '/commits/main': { sha: ORCHESTRATOR },
    '/contents/.github/workflows/test.yml': { encoding: 'base64', content: btoa('finite CI workflow') },
    '/pulls/1': pr, '/pulls/1/files': [{ filename: 'src/lib/a.ts', status: 'modified' }], '/pulls/1/reviews': [], '/issues/1/comments': [],
    [`/commits/${HEAD}/check-runs`]: { check_runs: [{ ...job, check_suite: { id: 42 }, app: { id: 15368, slug: 'github-actions' }, details_url: job.html_url }] },
    '/actions/workflows/test.yml': { id: 7, path: '.github/workflows/test.yml' }, '/actions/workflows/7/runs': { workflow_runs: [run] },
    '/actions/runs/9': run, '/actions/runs/9/attempts/1/jobs': { jobs: [job] }, '/actions/runs/9/artifacts': { artifacts: [] },
    [`/commits/${HEAD}/pulls`]: [pr], [`/git/commits/${HEAD}`]: { sha: HEAD, tree: { sha: treeSha } },
    [`/git/commits/${mergeSha}`]: { sha: mergeSha, tree: { sha: options.equalTrees ? treeSha : mergeSha } },
  };
  let membershipReads = 0, prReads = 0;
  const unexpectedRequests: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === 'https://api.github.com' && url.pathname === '/graphql' && init?.method === 'POST') {
      return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    }
    const path = url.pathname.replace('/repos/o/r', '');
    if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith('/repos/o/r') || init?.method !== 'GET' || !(path in values)) {
      unexpectedRequests.push(String(input));
      throw new Error('Unmapped synthetic proof-boundary request');
    }
    if (path === `/commits/${HEAD}/pulls`) {
      membershipReads++;
      if (options.initialMembershipMissing) return Response.json([]);
      if (membershipReads === 2) {
        if (options.lateMembership === 'missing') return Response.json([]);
        if (options.lateMembership === 'ambiguous') return Response.json([pr, { ...pr, number: 2 }]);
        if (options.lateMembership === 'wrong-identity') return Response.json([{ ...pr, head: { ...pr.head, ref: 'changed-ref' } }]);
        if (options.lateMembership === 'malformed') return Response.json({ unavailable: true });
        if (options.lateMembership === 'unavailable') return new Response('', { status: 403 });
      }
    }
    if (path === '/pulls/1' && ++prReads === 2 && options.latePrChanged) return Response.json({ ...pr, merged: false });
    return Response.json(values[path]);
  };
  const github = await collectGithubEvidence({ repository: 'o/r', prNumber: 1, token: 'secret', now: NOW,
    requiredChecks: ['app-tests'], includeDeployments: false, fetchImpl });
  return { github, membershipReads, unexpectedRequests };
}

describe('independent proof inspection with blocked historical CI', () => {
  it('reads the independent proof receipt and native sources after only valid unequal CI trees fail', async () => {
    const { github, membershipReads, unexpectedRequests } = await historicalGithubSnapshot();
    expect(unexpectedRequests).toEqual([]);
    expect(membershipReads).toBe(2);
    expect(github.problems).toEqual([]);
    expect(github.ci).toMatchObject({ status: 'BLOCKED', association: null, actualCheckoutSha: null });
    expect(github.ci.problems).toContain('Native head and merge commit trees are not identical');
    expect(isGithubEvidence(github)).toBe(false);
    const f = fixture(), fetchImpl = vi.fn(f.fetchImpl);
    const result = await collectProofEvidence({ github, ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.receipt?.head_sha).toBe(HEAD);
    const paths = fetchImpl.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).toContain('/repos/o/r/actions/artifacts/88/zip');
    expect(paths.some(path => path.includes('/git/trees/'))).toBe(true);
    expect(paths).toContain('/repos/o/r/contents/src/lib/engineering-verification/runner.mjs');
    expect(result.validation.problems).toEqual(['GitHub snapshot provenance is not authenticated in this process']);
    expect(result).toMatchObject({ status: 'BLOCKED', currentCodeVerified: false });
    expect(isCollectedProof(result)).toBe(false);
  });
  it.each([
    ['initial membership missing', { initialMembershipMissing: true }],
    ['late merged PR identity', { latePrChanged: true }],
  ] as const)('does not start proof reads after globally invalid %s', async (_kind, changes) => {
    const { github, unexpectedRequests } = await historicalGithubSnapshot(changes);
    expect(unexpectedRequests).toEqual([]);
    expect(github.problems.length).toBeGreaterThan(0);
    const f = fixture(), fetchImpl = vi.fn(f.fetchImpl);
    const result = await collectProofEvidence({ github, ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems).toEqual(expect.arrayContaining(github.problems));
    expect(result.receipt).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.currentCodeVerified).toBe(false);
  });
  it.each([false, true])('keeps late native membership globally required before proof reads (equal trees: %s)', async equalTrees => {
    for (const lateMembership of ['missing', 'ambiguous', 'wrong-identity', 'malformed', 'unavailable'] as const) {
      const { github, membershipReads, unexpectedRequests } = await historicalGithubSnapshot({ equalTrees, lateMembership });
      expect(unexpectedRequests).toEqual([]);
      expect(membershipReads).toBe(2);
      expect(github.ci.status).toBe('BLOCKED');
      expect(github.problems.join(' ')).toMatch(/historical.*association/i);
      const f = fixture(), fetchImpl = vi.fn(f.fetchImpl);
      const result = await collectProofEvidence({ github, ...f, fetchImpl, token: 'secret', now: NOW });
      expect(result.receipt).toBeNull();
      expect(result.validation.problems).toEqual(expect.arrayContaining(github.problems));
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.currentCodeVerified).toBe(false);
    }
  });
  it('never upgrades imported lookalike JSON to GitHub or proof authority', async () => {
    const { github } = await historicalGithubSnapshot();
    const imported = JSON.parse(JSON.stringify(github));
    imported.provenance.kind = 'authenticated-github-api';
    expect(isGithubEvidence(imported)).toBe(false);
    const result = await collectProofEvidence({ github: imported, ...fixture(), token: 'secret', now: NOW });
    expect(result.receipt?.head_sha).toBe(HEAD);
    expect(result.validation.problems).toEqual(['GitHub snapshot provenance is not authenticated in this process']);
    expect(isCollectedProof(result)).toBe(false);
    expect(result.currentCodeVerified).toBe(false);
  });
  it.each([
    ['stale', new Date(NOW.getTime() - 15 * 60000 - 1).toISOString()],
    ['future', new Date(NOW.getTime() + 1).toISOString()],
    ['missing', undefined],
  ])('keeps %s snapshot time blocking before proof reads after CI-only refusal', async (_kind, observedAt) => {
    const { github } = await historicalGithubSnapshot();
    const f = fixture(), fetchImpl = vi.fn(f.fetchImpl);
    const result = await collectProofEvidence({ github: { ...github, observedAt }, ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems).toContain('GitHub snapshot is stale or missing observation time');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.receipt).toBeNull();
    expect(isCollectedProof(result)).toBe(false);
  });
  it('still blocks final proof default-branch drift after CI-only refusal allowed artifact inspection', async () => {
    const { github } = await historicalGithubSnapshot();
    const f = fixture(); let mainReads = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname === '/repos/o/r/commits/main' && ++mainReads === 2) return Response.json({ sha: '9'.repeat(40) });
      return f.fetchImpl(input, init);
    };
    const result = await collectProofEvidence({ github, ...f, fetchImpl, token: 'secret', now: NOW });
    expect(mainReads).toBe(2);
    expect(result.receipt?.head_sha).toBe(HEAD);
    expect(result.validation.problems).toContain('Trusted default branch changed while collecting proof');
    expect(result.currentCodeVerified).toBe(false);
  });
});

describe('trusted GitHub proof artifact collection', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('checks real run/source/artifact identities while every injected transport stays untrusted', async () => {
    const f = fixture(), github = await githubSnapshot();
    const result = await collectProofEvidence({ github, ...f, token: 'secret', now: NOW });
    expect(result.validation).toEqual({ status: 'BLOCKED', problems: ['GitHub snapshot provenance is not authenticated in this process'] });
    expect(result.status).toBe('BLOCKED');
    expect(assessCollectedProof(result, { now: NOW }).status).toBe('BLOCKED');
    expect(isCollectedProof(result)).toBe(false);
    expect(isCollectedProof(JSON.parse(JSON.stringify(result)))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(Object.isFrozen(result.receipt)).toBe(true);
  });
  it('never accepts caller JSON as authenticated GitHub provenance', async () => {
    const f = fixture();
    const result = await collectProofEvidence({ github: { repository: 'o/r', prNumber: 1, pullRequest: { headSha: HEAD }, provenance: { kind: 'authenticated-github-api' } }, ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.join(' ')).toMatch(/provenance/i);
  });
  it('does not expose the token when a transport error echoes credentials', async () => {
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...fixture(), token: 'secret', now: NOW,
      fetchImpl: async () => { throw new Error('Request failed for secret'); } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('does not let a newer run for another contract mask the requested proof', async () => {
    const f = fixture();
    f.overrides['/actions/workflows/33/runs'] = { workflow_runs: [{ ...f.run, id: 202 }, f.run] };
    f.overrides['/actions/runs/202/artifacts'] = { artifacts: [{ ...f.artifact(), id: 99, name: `engineering-verification-1-${HEAD}-1048-attempt-2` }] };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.receipt?.contract_id).toBe('EV-FOUNDATION-1048-V2');
    expect(result.validation.problems).toEqual(['GitHub snapshot provenance is not authenticated in this process']);
  });
  it('keeps rerun artifacts separate and cannot reuse an earlier attempt receipt', async () => {
    const f = fixture();
    const prior = { ...f.artifact(), id: 87, name: `engineering-verification-1-${HEAD}-1048-v2-attempt-1` };
    f.overrides['/actions/runs/101/artifacts'] = { artifacts: [prior, f.artifact()] };
    const current = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(current.receipt?.head_sha).toBe(HEAD);
    f.overrides['/actions/runs/101/artifacts'] = { artifacts: [prior] };
    const stale = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(stale.receipt).toBeNull();
    expect(stale.validation.problems.join(' ')).toContain('Exact-head proof artifact unavailable');
  });
  it.each([
    { workflow_id: 999 }, { event: 'pull_request_target' }, { head_branch: 'attacker' },
    { repository: { id: 99, full_name: 'attacker/r' } }, { conclusion: 'failure' }, { path: '.github/workflows/forged.yml' },
  ])('rejects a spoofed or unsuccessful workflow even when it has a matching artifact', async extra => {
    const f = fixture(); Object.assign(f.run, extra);
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).length).toBeGreaterThan(0);
  });
  it('rejects an artifact from a prior attempt and missing or expired artifacts', async () => {
    for (const changes of [{ expired: true }, { created_at: '2026-11-06T11:00:10Z' }, { digest: 'sha256:' + '0'.repeat(64) }, { expires_at: '2026-11-07T12:01:10Z' }]) {
      const f = fixture();
      f.overrides['/actions/artifacts/88'] = { ...f.artifact(), ...changes };
      const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
      expect(result.validation.problems.filter(problem => !problem.includes('provenance')).length).toBeGreaterThan(0);
    }
  });
  it.each([71_000, 88_000, 6 * 60 * 60 * 1000, 89 * 86400000])('corroborates run-retained artifacts uploaded %i ms after workflow creation', async delay => {
    const f = fixture();
    f.run.created_at = new Date(Date.parse(f.artifact().created_at) - delay).toISOString();
    const expires_at = new Date(Date.parse(f.run.created_at) + 90 * 86400000 + 1000).toISOString();
    f.overrides['/actions/artifacts/88'] = { ...f.artifact(), expires_at };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.receipt?.head_sha).toBe(HEAD);
    expect(result.validation.problems).toEqual(['GitHub snapshot provenance is not authenticated in this process']);
    // Native API fixtures exercise corroboration, but cannot create live provenance.
    expect(isCollectedProof(result)).toBe(false);
  });
  it('rejects shortened retention, missing run epochs and an expired original run even after a fresh upload', async () => {
    const cases = [
      (f: ReturnType<typeof fixture>) => { f.overrides['/actions/artifacts/88'] = { ...f.artifact(), expires_at: new Date(Date.parse(f.run.created_at) + 90 * 86400000 - 1000).toISOString() }; },
      (f: ReturnType<typeof fixture>) => { f.run.created_at = ''; },
      (f: ReturnType<typeof fixture>) => { f.run.created_at = 'not-a-date'; },
      (f: ReturnType<typeof fixture>) => { f.run.created_at = '2026-11-06T12:00:01Z'; },
      (f: ReturnType<typeof fixture>) => { f.run.created_at = new Date(NOW.getTime() - 90 * 86400000).toISOString(); },
      (f: ReturnType<typeof fixture>) => { f.overrides['/actions/runs/101/attempts/2'] = { ...f.run, created_at: '2026-11-06T10:00:00Z' }; },
    ];
    for (const mutate of cases) {
      const f = fixture(); mutate(f);
      const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
      expect(result.receipt).toBeNull();
      expect(result.validation.problems.filter(problem => !problem.includes('provenance')).length).toBeGreaterThan(0);
    }
  });
  it('reassesses the original run age and the exact API expiry without extending either boundary', () => {
    const f = fixture();
    const runExpiry = Date.parse(f.run.created_at) + 90 * 86400000;
    const snapshot = (expiresAt: number, now: number) => ({ run: f.run, artifact: { ...f.artifact(), expires_at: new Date(expiresAt).toISOString() },
      observedAt: new Date(now).toISOString(), validation: { status: 'PASSED', problems: [] } });
    const expired = (expiresAt: number, now: number) => assessCollectedProof(snapshot(expiresAt, now), { now: new Date(now) }).blockers.some(problem => problem.includes('expired'));
    expect(expired(runExpiry + 86400000, runExpiry - 1)).toBe(false);
    expect(expired(runExpiry + 86400000, runExpiry)).toBe(true);
    expect(expired(runExpiry - 1000, runExpiry - 1001)).toBe(false);
    expect(expired(runExpiry - 1000, runExpiry - 1000)).toBe(true);
    // A fresh artifact cannot erase a missing original-run epoch.
    expect(assessCollectedProof({ ...snapshot(runExpiry, NOW.getTime()), run: {} }, { now: NOW }).blockers.join(' ')).toContain('expired');
  });
  it('rejects wrong job identity, receipt hashes, run attempts and changed current head', async () => {
    const cases = [
      (f: ReturnType<typeof fixture>) => { f.overrides['/actions/runs/101/attempts/2/jobs'] = { jobs: [{ name: 'app-tests', status: 'completed', conclusion: 'success' }] }; },
      (f: ReturnType<typeof fixture>) => { f.receipt.provenance.run_attempt = '1'; },
      (f: ReturnType<typeof fixture>) => { f.receipt.pairs[0].green.test_sha256 = '0'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.receipt.pairs[0].red.execution_exit_code = 1; },
      (f: ReturnType<typeof fixture>) => { f.overrides['/pulls/1'] = { head: { sha: BASE } }; },
      (f: ReturnType<typeof fixture>) => { f.files['src/lib/engineering-verification/runner.mjs'] = 'changed trusted source'; },
      (f: ReturnType<typeof fixture>) => { delete f.files['docs/project/acceptance/engineering/1048-v2.json']; },
      (f: ReturnType<typeof fixture>) => { f.overrides['/actions/runs/101'] = { ...f.run, run_attempt: 3 }; },
      (f: ReturnType<typeof fixture>) => { f.overrides['/actions/runs/101/artifacts'] = { artifacts: [] }; },
    ];
    for (const mutate of cases) {
      const f = fixture(); mutate(f);
      const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
      expect(result.validation.problems.filter(problem => !problem.includes('provenance')).length).toBeGreaterThan(0);
    }
  });

  it('follows only signed storage redirects without forwarding the GitHub token', async () => {
    const f = fixture(); let storageReads = 0;
    const fetchImpl: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.hostname === 'proof.blob.core.windows.net') {
        storageReads++;
        expect(options?.headers).toEqual({ Accept: 'application/zip' });
        expect(JSON.stringify(options)).not.toContain('secret');
        return new Response(f.archive());
      }
      if (url.pathname.endsWith('/88/zip')) return new Response(null, { status: 302, headers: { Location: 'https://proof.blob.core.windows.net/signed?signature=not-a-token' } });
      return f.fetchImpl(input, options);
    };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(storageReads).toBe(1);
    expect(result.receipt?.head_sha).toBe(HEAD);
    expect(result.validation.problems).toEqual(['GitHub snapshot provenance is not authenticated in this process']);
  });

  it('invalidates current revision proof when the current default-branch dependency inputs change', async () => {
    const f = fixture(), currentMain = 'e'.repeat(40);
    f.overrides['/commits/main'] = { sha: currentMain };
    const fetchImpl: typeof fetch = async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/contents/package-lock.json') && url.searchParams.get('ref') === currentMain) return Response.json({ type: 'file', path: 'package-lock.json', encoding: 'base64', content: Buffer.from('new dependencies').toString('base64') });
      return f.fetchImpl(input, options);
    };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems.join(' ')).toMatch(/dependency|package-lock/);
  });

  it('rejects duplicate and oversized receipts before treating any assertion as RED', async () => {
    const duplicate = Buffer.from(zipSync({ 'receipt.json': strToU8('{}'), 'reCeipt.json': strToU8('{}') }));
    const needle = Buffer.from('reCeipt.json');
    for (let index = duplicate.indexOf(needle); index >= 0; index = duplicate.indexOf(needle)) Buffer.from('receipt.json').copy(duplicate, index);
    for (const archive of [duplicate, zipSync({ 'receipt.json': strToU8('a'.repeat(2 * 1024 * 1024 + 1)) })]) {
      const f = fixture();
      f.overrides['/actions/artifacts/88'] = { ...f.artifact(), size_in_bytes: archive.length, digest: 'sha256:' + hash(archive) };
      const fetchImpl: typeof fetch = async (input, options) => new URL(String(input)).pathname.endsWith('/88/zip') ? new Response(archive) : f.fetchImpl(input, options);
      const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
      expect(result.validation.problems.join(' ')).toMatch(/Duplicate|oversized|bounded/);
      expect(result.receipt).toBeNull();
    }
  });
});


describe('proof explicit revision and canonical native identity', () => {
  it('refuses an explicit historical selector for the same-issue current marker before artifact reads', async () => {
    const f = fixture(), fetchImpl = vi.fn(f.fetchImpl);
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, contractKey: '1048', token: 'secret', now: NOW });
    expect(result.validation.problems.join(' ')).toMatch(/differs.*marker|identity/);
    expect(result.currentCodeVerified).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['', 'engineering-contract: 1048-v2', '<!-- engineering-contract: 1048-v2 -->\n<!-- engineering-contract: 1048 -->'])('rejects absent/malformed/mixed markers before artifact reads: %s', async marker => {
    const f = fixture(), fetchImpl = vi.fn(f.fetchImpl);
    const result = await collectProofEvidence({ github: await githubSnapshot(marker), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.receipt).toBeNull();
    expect(result.currentCodeVerified).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['missing', 'wrong'])('requires the exact current revision in receipt (%s key)', async mode => {
    const f = fixture();
    if (mode === 'missing') Reflect.deleteProperty(f.receipt, 'contract_key'); else f.receipt.contract_key = '1048';
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.join(' ')).toContain('revision key mismatch');
    expect(result.currentCodeVerified).toBe(false);
  });
  it('rejects a Contents payload whose blob identity differs from its immutable regular Git tree', async () => {
    const f = fixture();
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await f.fetchImpl(input, init);
      if (new URL(String(input)).pathname.endsWith('/1048-v2.json')) return Response.json({ ...await response.json(), sha: 'f'.repeat(40) });
      return response;
    };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems.join(' ')).toContain('canonical Git blob');
    expect(result.currentCodeVerified).toBe(false);
  });
  it('never follows a symlink contract mode into Contents even when its payload could parse', async () => {
    const f = fixture(), contractReads: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/contents/docs/project/acceptance/engineering/1048-v2.json')) contractReads.push(path);
      const response = await f.fetchImpl(input, init);
      if (path.includes('/git/trees/')) {
        const body = await response.json();
        for (const row of body.tree) if (row.path === '1048-v2.json') row.mode = '120000';
        return Response.json(body);
      }
      return response;
    };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems.join(' ')).toContain('regular canonical Git blob');
    expect(contractReads).toEqual([]);
  });
});


describe('final same-head proof marker freshness', () => {
  it.each([
    ['same-issue historical revision', '<!-- engineering-contract: 1048 -->'],
    ['unknown revision', '<!-- engineering-contract: 1048-v3 -->'],
    ['duplicate marker', '<!-- engineering-contract: 1048-v2 -->\n<!-- engineering-contract: 1048-v2 -->'],
    ['malformed marker', '<!-- engineering-contract: 1048-v2'],
    ['missing marker', ''],
  ])('adds a real validation blocker when the final PR body has %s', async (_kind, body) => {
    const f = fixture();
    f.overrides['/pulls/1'] = { head: { sha: HEAD }, body };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.receipt?.head_sha).toBe(HEAD);
    // Custom transports still cannot mint authority; the changed marker must independently invalidate parsing.
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/marker|revision/i);
    expect(isCollectedProof(result)).toBe(false);
  });
});


describe('CURRENT reviewed workflow source binding', () => {
  it('requires the exact workflow in the current frozen execution inventory', async () => {
    const f = fixture('missing');
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/workflow/i);
    expect(result.currentCodeVerified).toBe(false);
  });
  it('rejects a validly shaped but incorrect frozen workflow digest', async () => {
    const f = fixture('wrong');
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/workflow/i);
    expect(result.currentCodeVerified).toBe(false);
  });
});

/** Exact old declaration; all API/source bodies below remain explicitly synthetic and untrusted. */
function legacyCollectorFixture(sourceRef = HISTORICAL_PROOF_SOURCE, attemptSourceRef = sourceRef) {
  const f = fixture(), contractRaw = readFileSync(new URL('../../../docs/project/acceptance/engineering/1048.json', import.meta.url), 'utf8');
  const contract = JSON.parse(contractRaw) as typeof f.contract;
  const contractPath = 'docs/project/acceptance/engineering/1048.json';
  f.files[contractPath] = contractRaw;
  f.run.head_sha = sourceRef;
  const receipt = { ...f.receipt, contract_key: '1048', contract_id: contract.contract_id, base_sha: contract.base_sha,
    contract_sha256: hash(contractRaw), execution_files: contract.execution_files,
    provenance: { ...f.receipt.provenance, workflow_sha: sourceRef },
    pairs: contract.requirements.map(req => {
      const common = { requirement_id: req.id, test_id: req.test_id, command: 'Synthetic untrusted parser fixture', artifact_url: f.run.html_url,
        execution_exit_code: 0, test_sha256: req.test_sha256, fixture_sha256: req.fixture_sha256, adapter_sha256: req.adapter_sha256,
        execution_sha256: hash(JSON.stringify(contract.execution_files)), contract_sha256: hash(contractRaw) };
      return { red: { ...common, base_sha: contract.base_sha, exit_code: 1, status: 'FAILED', failure_kind: 'ASSERTION_FAILURE',
        assertions: req.assertion_ids.map(id => ({ id, status: req.baseline_failure_assertion_ids.includes(id) ? 'FAILED' : 'PASSED' })) },
        green: { ...common, head_sha: HEAD, exit_code: 0, status: 'PASSED', failure_kind: 'NONE', assertions: req.assertion_ids.map(id => ({ id, status: 'PASSED' })) } };
    }) };
  const archive = zipSync({ 'receipt.json': strToU8(JSON.stringify(receipt)) });
  const artifact = { ...f.artifact(), name: `engineering-verification-1-${HEAD}-1048-attempt-2`, digest: 'sha256:' + hash(archive), size_in_bytes: archive.length,
    workflow_run: { ...f.artifact().workflow_run, head_sha: sourceRef } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname.replace('/repos/o/r', '');
    if (path === '/actions/artifacts/88/zip') return new Response(archive);
    if (path === '/actions/artifacts/88') return Response.json(artifact);
    if (path === '/actions/runs/101/artifacts') return Response.json({ artifacts: [artifact] });
    if (path === '/pulls/1') return Response.json({ head: { sha: HEAD }, body: '<!-- engineering-contract: 1048 -->' });
    if (path === '/actions/runs/101/attempts/2') return Response.json({ ...f.run, head_sha: attemptSourceRef });
    if (path === '/actions/runs/101/attempts/2/jobs') {
      const body = await (await f.fetchImpl(input, init)).json();
      return Response.json({ ...body, jobs: body.jobs.map((job: Record<string, unknown>) => ({ ...job, head_sha: sourceRef })) });
    }
    return f.fetchImpl(input, init);
  };
  return { contract, contractRaw, fetchImpl };
}
describe('permanent HISTORICAL_ONLY origin regressions', () => {
  it('requires the reviewed legacy workflow digest even when other synthetic source checks also block', async () => {
    const f = legacyCollectorFixture();
    const result = await collectProofEvidence({ github: await githubSnapshot('<!-- engineering-contract: 1048 -->'), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems).toContain('Proof workflow differs from the revision-authorized frozen workflow digest');
    // The small fixture deliberately has no original full source corpus and never mints a positive proof.
    expect(result.validation.problems).toContain('GitHub snapshot provenance is not authenticated in this process');
    expect(result.validation.problems.some(problem => /Trusted historical source identity|returned 404/.test(problem))).toBe(true);
    expect(isCollectedProof(result)).toBe(false);
    expect(result.currentCodeVerified).toBe(false);
  });
  it('requires the historical run and exact attempt to agree on the approved source commit', async () => {
    const f = legacyCollectorFixture(HISTORICAL_PROOF_SOURCE, 'e'.repeat(40));
    const result = await collectProofEvidence({ github: await githubSnapshot('<!-- engineering-contract: 1048 -->'), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/attempt|source.*identity/i);
    expect(isCollectedProof(result)).toBe(false);
  });
  it('rejects an unapproved legacy preparer source commit independently of workflow/file claims', async () => {
    const f = legacyCollectorFixture('e'.repeat(40));
    const result = await collectProofEvidence({ github: await githubSnapshot('<!-- engineering-contract: 1048 -->'), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.some(problem => /(?:legacy|historical).*source|preparer/i.test(problem) && /commit|ref/i.test(problem) && /not|unapproved|unknown|untrusted|outside/i.test(problem))).toBe(true);
    expect(isCollectedProof(result)).toBe(false);
    expect(result.currentCodeVerified).toBe(false);
  });
});

describe('CURRENT native preparer input modes and absence', () => {
  it.each(CURRENT_PROOF_INPUTS)('rejects a same-content symlink for frozen input %s', async inputPath => {
    const f = fixture();
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      const response = await f.fetchImpl(input, init);
      if (!path.includes('/git/trees/')) return response;
      const body = await response.json();
      const parent = inputPath.slice(0, inputPath.lastIndexOf('/') + 1), name = inputPath.slice(parent.length);
      const expected = nativeTreeResponse(path.replace('/repos/o/r', ''), f.files) as { tree?: Array<{ path: string }> };
      // Every basename is unique in this complete source inventory except package metadata (root only).
      if (expected.tree?.some(row => row.path === name)) for (const row of body.tree) if (row.path === name) { row.mode = '120000'; row.type = 'blob'; }
      return Response.json(body);
    };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/canonical|regular|symlink|source.*mode/i);
  });
  it('rejects a symlinked source parent although Contents still serves every expected byte', async () => {
    const f = fixture();
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await f.fetchImpl(input, init);
      if (!new URL(String(input)).pathname.includes('/git/trees/')) return response;
      const body = await response.json(); for (const row of body.tree) if (row.path === 'src') { row.mode = '120000'; row.type = 'blob'; }
      return Response.json(body);
    };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, fetchImpl, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/canonical|regular|symlink|source.*mode/i);
  });
  it.each(FORBIDDEN_PROOF_INPUTS)('rejects a resolver/install override at %s instead of borrowing the reviewed closure', async path => {
    const f = fixture(); f.files[path] = 'Untrusted override presence';
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.validation.problems.filter(problem => !problem.includes('provenance')).join(' ')).toMatch(/forbidden|shadow|override|absence/i);
  });
});
