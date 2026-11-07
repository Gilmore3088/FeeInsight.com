// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { collectGithubEvidence } from './github.mjs';
import { contractDigest } from './contract.mjs';
import { assessCollectedProof, collectProofEvidence, isCollectedProof } from './proof.mjs';

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), ORCHESTRATOR = 'c'.repeat(40);
const NOW = new Date('2026-11-06T12:05:00Z');
const HASH = 'd'.repeat(64), WORKFLOW_PATH = '.github/workflows/engineering-verification.yml';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function fixture() {
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
  const contract = {
    schema_version: '1.1', contract_id: 'EV-KNOX-2285', issue: '#2285', risk_tier: 'R2', base_sha: BASE,
    scope: ['src/lib/agents/knox/**'], required_skills: ['tdd', 'adversarial-document-testing', 'error-to-test'],
    production_boundary: 'NO_PROD_MUTATION', human_approval_required: false,
    execution_files: ['src/lib/engineering-verification/pilot.mjs', 'src/lib/engineering-verification/runner.mjs', 'src/lib/engineering-verification/runtime.json'].map(path => ({ path, sha256: hash(files[path]) })),
    requirements: [{ id: 'KNOX-2285-01', behavior: 'Keep each price', authority: 'Synthetic issue #2285',
      test_id: 'knox-own-price', test_path: 'src/lib/engineering-verification/pilot.test.ts',
      fixture_path: 'src/lib/engineering-verification/__fixtures__/knox-2285.json', adapter_path: 'src/lib/engineering-verification/pilot.mjs',
      test_sha256: hash(files['src/lib/engineering-verification/pilot.test.ts']), fixture_sha256: hash(files['src/lib/engineering-verification/__fixtures__/knox-2285.json']), adapter_sha256: hash(files['src/lib/engineering-verification/pilot.mjs']),
      failure_signature: 'own price', assertion_ids: ['own-price'], baseline_failure_assertion_ids: ['own-price'], baseline_expectation: 'FAIL' }],
  };
  const contractRaw = JSON.stringify(contract), req = contract.requirements[0];
  files['docs/project/acceptance/engineering/2285.json'] = contractRaw;
  const common = { requirement_id: req.id, test_id: req.test_id, command: 'trusted parent', artifact_url: 'https://github.com/o/r/actions/runs/101',
    execution_exit_code: 0,
    test_sha256: req.test_sha256, fixture_sha256: req.fixture_sha256, adapter_sha256: req.adapter_sha256,
    execution_sha256: contractDigest(JSON.stringify(contract.execution_files)), contract_sha256: contractDigest(contractRaw) };
  const receipt = {
    schema_version: '1.0', contract_id: contract.contract_id, base_sha: BASE, head_sha: HEAD, contract_sha256: contractDigest(contractRaw), execution_files: contract.execution_files,
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
  const artifact = () => ({ id: 88, name: 'engineering-verification-1-' + HEAD + '-2285', expired: false, digest: 'sha256:' + hash(archive()), size_in_bytes: archive().length,
    created_at: '2026-11-06T12:01:10Z', expires_at: '2027-02-04T12:01:10Z', workflow_run: { id: 101, repository_id: 17, head_repository_id: 17, head_branch: 'main', head_sha: ORCHESTRATOR } });
  const overrides: Record<string, unknown> = {};
  const fetchImpl = async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin).toBe('https://api.github.com');
    expect(options.method).toBe('GET');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer secret' });
    const path = url.pathname.replace('/repos/o/r', '');
    if (path in overrides) return Response.json(overrides[path]);
    if (path === '/actions/artifacts/88/zip') return new Response(archive());
    if (path.startsWith('/contents/')) {
      const file = decodeURIComponent(path.slice('/contents/'.length));
      return file in files ? Response.json({ type: 'file', path: file, encoding: 'base64', content: Buffer.from(files[file]).toString('base64') }) : new Response('', { status: 404 });
    }
    const routes: Record<string, unknown> = {
      '': { id: 17, full_name: 'o/r', default_branch: 'main' }, '/commits/main': { sha: ORCHESTRATOR },
      '/pulls/1': { head: { sha: HEAD } },
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
async function githubSnapshot() {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(String(input)), path = url.pathname.replace('/repos/o/r', '');
    if (url.pathname === '/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    if (path === '/pulls/1') return Response.json({ head: { sha: HEAD }, user: { id: 1, login: 'builder' } });
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
    f.overrides['/actions/runs/202/artifacts'] = { artifacts: [{ ...f.artifact(), id: 99, name: `engineering-verification-1-${HEAD}-1048` }] };
    const result = await collectProofEvidence({ github: await githubSnapshot(), ...f, token: 'secret', now: NOW });
    expect(result.receipt?.contract_id).toBe('EV-KNOX-2285');
    expect(result.validation.problems).toEqual(['GitHub snapshot provenance is not authenticated in this process']);
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
  it('rejects wrong job identity, receipt hashes, run attempts and changed current head', async () => {
    const cases = [
      (f: ReturnType<typeof fixture>) => { f.overrides['/actions/runs/101/attempts/2/jobs'] = { jobs: [{ name: 'app-tests', status: 'completed', conclusion: 'success' }] }; },
      (f: ReturnType<typeof fixture>) => { f.receipt.provenance.run_attempt = '1'; },
      (f: ReturnType<typeof fixture>) => { f.receipt.pairs[0].green.test_sha256 = '0'.repeat(64); },
      (f: ReturnType<typeof fixture>) => { f.receipt.pairs[0].red.execution_exit_code = 1; },
      (f: ReturnType<typeof fixture>) => { f.overrides['/pulls/1'] = { head: { sha: BASE } }; },
      (f: ReturnType<typeof fixture>) => { f.files['src/lib/engineering-verification/runner.mjs'] = 'changed trusted source'; },
      (f: ReturnType<typeof fixture>) => { delete f.files['docs/project/acceptance/engineering/2285.json']; },
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

  it('invalidates old proof when the current default-branch dependency inputs change', async () => {
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
