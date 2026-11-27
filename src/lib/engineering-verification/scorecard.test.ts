// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeTreeResponse, nativeBlobSha } from './native-tree.fixture';
import { CURRENT_PROOF_INPUTS, completeProofFiles } from './proof-inputs.fixture';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { syntheticBatchEvidence } from './ci-domain-collection.fixture';
import { BATCHES, BASELINE_SOURCE_SHA256 } from './ci-domain-pilot.mjs';
import { READER_IMAGE } from './ci-domain-collection.mjs';
import { strToU8, zipSync } from 'fflate';
const { sourceFetch } = vi.hoisted(() => { const sourceFetch = vi.fn(); vi.stubGlobal('fetch', sourceFetch); return { sourceFetch }; });
import { collectScorecard, assessScorecard, renderScorecard, isScorecardEvidence } from './scorecard.mjs';
const REPO = 'Gilmore3088/FeeInsight.com', MAIN = 'c'.repeat(40), BASE = 'b'.repeat(40), NOW = new Date('2026-11-06T12:10:00Z');
const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const head = (n: number) => n.toString(16).padStart(40, 'a');
function fixture(options: { changedHead?: boolean; missingHistoricalPolicy?: boolean; brokenProof?: boolean; ownerRequired?: boolean; finalMarker?: string; missingWorkflowFreeze?: boolean; badAttemptSource?: boolean } = {}) {
  const calls: Array<{ path: string; method: string }> = [];
  const files: Record<string, string> = {
    '.github/workflows/test.yml': 'trusted tests', '.github/workflows/engineering-verification.yml': 'trusted proof workflow',
    'src/lib/engineering-verification/pilot.mjs': 'parent assertions', 'src/lib/engineering-verification/pilot.test.ts': 'parent tests',
    'src/lib/engineering-verification/runner.mjs': 'trusted runner', 'src/lib/engineering-verification/runtime.json': JSON.stringify({ image: READER_IMAGE }),
    'src/lib/engineering-verification/__fixtures__/knox-2285.json': 'synthetic authority', 'package-lock.json': 'locked dependencies', 'package.json': 'package configuration',
  };
  const policy = { schema_version: 1, enforcement_enabled: false, owner_logins: ['owner'], allowed_reviewers: ['reviewer'], required_checks: ['app-tests'] };
  files['src/lib/engineering-verification/policy.json'] = JSON.stringify(policy);
  completeProofFiles(files);
  // Full native reader prerequisites, literal control bytes only; no source execution.
  for (const name of ['github.mjs', 'child.mjs', 'ci-domain-probe.mjs', 'ci-domain-collection.mjs', 'strict-json.mjs',
    '__fixtures__/ci-domain-stimulus-v2.json', '__fixtures__/ci-domain-expectations-v2.json']) {
    files['src/lib/engineering-verification/' + name] = readFileSync(new URL('./' + name, import.meta.url), 'utf8');
  }
  const paths = (n: number) => n === 2 ? ['src/lib/stripe.ts'] : n === 3 ? ['docs/changelog.md'] : n === 5 ? ['src/lib/utility.ts'] : ['src/lib/agents/knox/example.ts'];
  const contract = { schema_version: '1.1', contract_id: 'EV-FOUNDATION-1048-V3', issue: '#1048', risk_tier: 'R2', base_sha: BASE,
    scope: ['src/lib/agents/knox/**', 'src/lib/utility.ts'], required_skills: ['tdd', 'adversarial-document-testing', 'error-to-test'], production_boundary: 'NO_PROD_MUTATION', human_approval_required: options.ownerRequired ?? false,
    execution_files: CURRENT_PROOF_INPUTS.filter(path => !options.missingWorkflowFreeze || path !== '.github/workflows/engineering-verification.yml').map(path => ({ path, sha256: digest(files[path]) })),
    requirements: [{ id: 'KNOX-2285-01', behavior: 'Keep own price', authority: 'Synthetic issue #2285', test_id: 'knox-price', test_path: 'src/lib/engineering-verification/pilot.test.ts', fixture_path: 'src/lib/engineering-verification/__fixtures__/knox-2285.json', adapter_path: 'src/lib/engineering-verification/pilot.mjs', test_sha256: digest(files['src/lib/engineering-verification/pilot.test.ts']), fixture_sha256: digest(files['src/lib/engineering-verification/__fixtures__/knox-2285.json']), adapter_sha256: digest(files['src/lib/engineering-verification/pilot.mjs']), failure_signature: 'own price', assertion_ids: ['own-price'], baseline_failure_assertion_ids: ['own-price'], baseline_expectation: 'FAIL' }] };
  files['docs/project/acceptance/engineering/1048-v3.json'] = JSON.stringify(contract);
  const r1Contract = { schema_version: '1.0', contract_id: 'EV-UTILITY-1001', issue: '#1001', risk_tier: 'R1', base_sha: BASE, scope: ['src/lib/utility.ts'], required_skills: [], requirements: [], production_boundary: 'NO_PROD_MUTATION', human_approval_required: false };
  files['docs/project/acceptance/engineering/1001.json'] = JSON.stringify(r1Contract);
  const run = { id: 101, workflow_id: 33, run_attempt: 1, head_branch: 'main', head_sha: MAIN, event: 'workflow_dispatch', status: 'completed', conclusion: options.brokenProof ? 'failure' : 'success', path: '.github/workflows/engineering-verification.yml', repository: { id: 17, full_name: REPO }, head_repository: { id: 17, full_name: REPO }, html_url: `https://github.com/${REPO}/actions/runs/101`, created_at: '2026-11-06T11:59:00Z', run_started_at: '2026-11-06T12:00:00Z', updated_at: '2026-11-06T12:03:00Z' };
  const req = contract.requirements[0];
  const common = { requirement_id: req.id, test_id: req.test_id, command: 'trusted parent', artifact_url: run.html_url, execution_exit_code: 0, test_sha256: req.test_sha256, fixture_sha256: req.fixture_sha256, adapter_sha256: req.adapter_sha256, execution_sha256: digest(JSON.stringify(contract.execution_files)), contract_sha256: digest(JSON.stringify(contract)) };
  const batchArtifacts: Record<string, Uint8Array> = {};
  const reader_batches = { schemaVersion: 1, adapter: 'engineering.ci-domains.v1', sources: ['red', 'green'].map(label => {
    const sourceRef = label === 'red' ? BASE : head(1);
    return { label, sourceRef, batches: BATCHES.map(batch => {
      const directory = label + '-' + batch.id;
      const sample = syntheticBatchEvidence({ sourceRef, batchId: batch.id, caseIds: [...batch.caseIds],
        ...(label === 'red' ? { sourceSha256: BASELINE_SOURCE_SHA256 } : {}) });
      for (const [path, bytes] of Object.entries(sample.artifacts)) batchArtifacts[directory + '/' + path] = bytes;
      return { directory, receiptSha256: digest(sample.artifacts['receipt.json']), receiptBytes: sample.artifacts['receipt.json'].length, manifest: sample.manifest };
    }) };
  }) };
  const receipt = { reader_batches, schema_version: '1.0', contract_key: '1048-v3', contract_id: contract.contract_id, base_sha: BASE, head_sha: head(1), contract_sha256: digest(JSON.stringify(contract)), execution_files: contract.execution_files, started_at: '2026-11-06T12:00:10Z', completed_at: '2026-11-06T12:01:00Z', runtime: { image: JSON.parse(files['src/lib/engineering-verification/runtime.json']).image, dependency_lock_sha256: digest(files['package-lock.json']) }, provenance: { claimed_origin: 'GITHUB_ACTIONS_UNCORROBORATED', workflow_sha: MAIN, run_id: '101', run_attempt: '1' }, pairs: [{ red: { ...common, base_sha: BASE, exit_code: 1, status: 'FAILED', failure_kind: 'ASSERTION_FAILURE', assertions: [{ id: 'own-price', status: 'FAILED' }] }, green: { ...common, head_sha: head(1), exit_code: 0, status: 'PASSED', failure_kind: 'NONE', assertions: [{ id: 'own-price', status: 'PASSED' }] } }] };
  const archive = zipSync({ ...batchArtifacts, 'receipt.json': strToU8(JSON.stringify(receipt)) });
  const artifact = { id: 88, name: `engineering-verification-1-${head(1)}-1048-v3-attempt-1`, expired: false, digest: 'sha256:' + digest(archive), size_in_bytes: archive.length, created_at: '2026-11-06T12:01:10Z', expires_at: '2027-02-04T12:01:10Z', workflow_run: { id: 101, repository_id: 17, head_repository_id: 17, head_branch: 'main', head_sha: MAIN } };
  const prReads = new Map<number, number>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname.replace(`/repos/${REPO}`, '');
    calls.push({ path, method: init?.method ?? 'GET' });
    if (url.pathname === '/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
    expect(url.origin).toBe('https://api.github.com');
    expect(init?.method ?? 'GET').toBe('GET');
    if (path === '') return Response.json({ id: 17, full_name: REPO, default_branch: 'main' });
    if (path === '/commits/main') return Response.json({ sha: MAIN });
    const tree = nativeTreeResponse(path, files);
    if (tree) return Response.json(tree);
    if (path.startsWith('/contents/')) {
      const name = decodeURIComponent(path.slice('/contents/'.length));
      if (options.missingHistoricalPolicy && name.endsWith('/policy.json') && url.searchParams.get('ref') !== MAIN) return new Response('', { status: 404 });
      return name in files ? Response.json({ type: 'file', path: name, sha: nativeBlobSha(files[name]), encoding: 'base64', content: Buffer.from(files[name]).toString('base64') }) : new Response('', { status: 404 });
    }
    const prMatch = path.match(/^\/pulls\/(\d+)$/);
    if (prMatch) {
      const n = Number(prMatch[1]), reads = (prReads.get(n) ?? 0) + 1; prReads.set(n, reads);
      return Response.json({ number: n, head: { sha: options.changedHead && reads >= 3 ? 'f'.repeat(40) : head(n), ref: 'unit-feature-' + n, repo: { id: 17, full_name: REPO } }, base: { sha: BASE, ref: 'main', repo: { id: 17, full_name: REPO } }, user: { id: 1, login: 'builder', type: 'User' }, body: options.finalMarker != null && reads >= 4 ? options.finalMarker : n === 3 ? '' : '<!-- engineering-contract: 1048-v3 -->', created_at: '2026-11-06T11:00:00Z', state: n === 4 ? 'open' : 'closed', merged: n !== 4, merged_at: n === 4 ? null : '2026-11-06T12:05:00Z', merge_commit_sha: n.toString(16).padStart(40, 'e'), mergeable: n === 4 ? true : null });
    }
    const number = Number(path.match(/^\/(?:pulls|issues)\/(\d+)/)?.[1]);
    if (path.endsWith('/files')) return Response.json(paths(number).map(filename => ({ filename, status: 'modified' })));
    if (path.endsWith('/reviews')) {
      const currentContract = JSON.stringify(contract);
      const binding = { head_sha: head(number), contract_sha256: digest(currentContract), policy_sha256: digest(JSON.stringify(policy)), reviewed_scope: paths(number), findings: [] };
      return Response.json([{ id: 10 + number, user: { id: 2, login: 'reviewer', type: 'User' }, state: 'APPROVED', commit_id: head(number), author_association: 'COLLABORATOR', submitted_at: '2026-11-06T12:02:00Z', body: `<!-- engineering-verification: ${JSON.stringify(binding)} -->` }]);
    }
    if (path.endsWith('/comments')) return Response.json([]);
    if (path.endsWith('/check-runs')) { const n = Number.parseInt(path.split('/')[2].slice(-1), 16); return Response.json({ check_runs: [{ id: 700 + n, name: 'app-tests', head_sha: head(n), status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, details_url: `https://github.com/${REPO}/actions/runs/${500 + n}/job/${600 + n}` }] }); }
    if (path === '/actions/workflows/test.yml') return Response.json({ id: 7, path: '.github/workflows/test.yml' });
    if (path === '/actions/workflows/7/runs') { const n = Number.parseInt((url.searchParams.get('head_sha') ?? '').slice(-1), 16); return Response.json({ workflow_runs: [{ id: 500 + n, workflow_id: 7, head_sha: head(n), repository: { id: 17, full_name: REPO }, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success', pull_requests: [{ number: n }] }] }); }
    if (/^\/actions\/runs\/50\d$/.test(path)) { const n = Number(path.split('/')[3]) - 500; return Response.json({ id: 500 + n, workflow_id: 7, head_sha: head(n), repository: { id: 17, full_name: REPO }, run_attempt: 1, event: 'pull_request', status: 'completed', conclusion: 'success', pull_requests: [{ number: n }] }); }
    if (/^\/actions\/runs\/50\d\/attempts\/1\/jobs$/.test(path)) { const n = Number(path.split('/')[3]) - 500; return Response.json({ jobs: [{ id: 600 + n, name: 'app-tests', run_id: 500 + n, run_attempt: 1, head_sha: head(n), status: 'completed', conclusion: 'success', started_at: '2026-11-06T12:00:00Z', completed_at: '2026-11-06T12:01:00Z', html_url: `https://github.com/${REPO}/actions/runs/${500 + n}/job/${600 + n}` }] }); }
    if (/^\/actions\/runs\/50\d\/artifacts$/.test(path)) return Response.json({ artifacts: [] });
    if (path === '/actions/workflows/engineering-verification.yml') return Response.json({ id: 33, path: '.github/workflows/engineering-verification.yml', state: 'active' });
    if (path === '/actions/workflows/33/runs') return Response.json({ workflow_runs: [run] });
    if (path === '/actions/runs/101/artifacts') return Response.json({ artifacts: [artifact] });
    if (path === '/actions/runs/101/attempts/1' && options.badAttemptSource) return Response.json({ ...run, head_sha: 'f'.repeat(40) });
    if (path === '/actions/runs/101' || path === '/actions/runs/101/attempts/1') return Response.json(run);
    if (path === '/actions/runs/101/attempts/1/jobs') return Response.json({ jobs: [{ id: 201, run_id: 101, run_attempt: 1, name: 'historical-proof', head_sha: MAIN, status: 'completed', conclusion: options.brokenProof ? 'failure' : 'success', started_at: '2026-11-06T12:00:00Z', completed_at: '2026-11-06T12:00:30Z' }] });
    if (path === '/actions/artifacts/88') return Response.json(artifact);
    if (path === '/actions/artifacts/88/zip') return new Response(archive);
    return new Response('', { status: 404 });
  };
  return { fetchImpl, calls };
}
afterEach(() => sourceFetch.mockReset());
describe('authenticated bounded multi-change engineering scorecard', () => {
  it('derives risk-specific denominators and exclusions from actual API data, never rerunning suites', async () => {
    const f = fixture(); sourceFetch.mockImplementation(f.fetchImpl);
    const snapshot = await collectScorecard({ prNumbers: [1, 2, 3, 4, 5], token: 'secret', now: NOW });
    const result = assessScorecard(snapshot, { now: NOW });
    expect(result.metrics.redProofCoverage).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(result.metrics.proofBeforeMergeCoverage).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(result.metrics.independentReviewCoverage).toMatchObject({ numerator: 2, denominator: 3, value: 2 / 3 });
    expect(result.exclusions.map(row => row.reason).sort()).toEqual(['NOT_MERGED', 'R0_INERT_CHANGE']);
    expect(result.metrics.ciRunnerTimeSeconds).toMatchObject({ value: 300, runs: 5 });
    expect(result.metrics.verificationRunnerTimeSeconds).toMatchObject({ value: 30, runs: 1 });
    expect(result.metrics.currencyCost.status).toBe('NOT_MEASURED');
    expect(result.metrics.defectRecurrence.status).toBe('NOT_MEASURED');
    expect(result.metrics.incrementalCiOverhead.status).toBe('NOT_MEASURED');
    expect(f.calls.every(row => row.method === 'GET' || row.path === '/graphql')).toBe(true);
    expect(f.calls.some(row => row.path.includes('/dispatches') || row.path.includes('/deployments'))).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });
  it('does not accept imported or forged passing aggregate records', async () => {
    const f = fixture(); sourceFetch.mockImplementation(f.fetchImpl);
    const snapshot = await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW });
    expect(isScorecardEvidence(snapshot)).toBe(true);
    const forged = JSON.parse(JSON.stringify(snapshot)); forged.metrics.redProofCoverage.value = 1;
    expect(assessScorecard(forged, { now: NOW }).status).toBe('BLOCKED');
    expect(renderScorecard(forged, { now: NOW })).toContain('BLOCKED');
  });
  it('keeps independently reviewed proof separate from missing required owner authorization', async () => {
    sourceFetch.mockImplementation(fixture({ ownerRequired: true }).fetchImpl);
    const result = assessScorecard(await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW }), { now: NOW });
    expect(result.metrics.independentReviewCoverage.numerator).toBe(1);
    expect(result.metrics.redProofCoverage.numerator).toBe(1);
    expect(result.metrics.verifiedEngineeringCoverage.numerator).toBe(0);
  });
  it('keeps injected test transports untrusted even when all fixture values pass', async () => {
    const snapshot = await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW, fetchImpl: fixture().fetchImpl });
    expect(isScorecardEvidence(snapshot)).toBe(false);
    expect(assessScorecard(snapshot, { now: NOW }).status).toBe('BLOCKED');
  });
  it('invalidates the aggregate when a head moves before the final recheck', async () => {
    sourceFetch.mockImplementation(fixture({ changedHead: true }).fetchImpl);
    const result = assessScorecard(await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW }), { now: NOW });
    expect(result.status).toBe('BLOCKED');
    expect(result.problems.join(' ')).toContain('head changed');
  });
  it('never substitutes current policy when historical immutable policy is unavailable', async () => {
    sourceFetch.mockImplementation(fixture({ missingHistoricalPolicy: true }).fetchImpl);
    const result = assessScorecard(await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW }), { now: NOW });
    expect(result.metrics.independentReviewCoverage.numerator).toBe(0);
    expect(result.changes[0].problems.join(' ')).toContain('historical');
  });
  it('reports invalid proof evidence without claiming a measured behavioral failure', async () => {
    sourceFetch.mockImplementation(fixture({ brokenProof: true }).fetchImpl);
    const result = assessScorecard(await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW }), { now: NOW });
    expect(result.metrics.redProofCoverage.numerator).toBe(0);
    expect(result.metrics.proofEvidenceUnavailable.value).toBe(1);
    expect(result.metrics.behavioralProofFailures.status).toBe('NOT_MEASURED');
    expect(result.metrics.proofWorkflowFailures).toMatchObject({ status: 'PARTIAL', value: 1 });
  });
  it('expires a collected scorecard instead of retaining previously verified coverage', async () => {
    sourceFetch.mockImplementation(fixture().fetchImpl);
    const snapshot = await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW });
    const result = assessScorecard(snapshot, { now: new Date(NOW.getTime() + 16 * 60000) });
    expect(result.status).toBe('BLOCKED');
    expect(result.metrics.redProofCoverage.status).toBe('NOT_MEASURED');
  });
  it('rejects empty, duplicate, out-of-range or unbounded scopes before making requests', async () => {
    for (const prNumbers of [[], [1, 1], [0], Array.from({ length: 21 }, (_, i) => i + 1)]) await expect(collectScorecard({ prNumbers, token: 'secret', now: NOW })).rejects.toThrow();
  });
});


describe('final same-head scorecard marker freshness', () => {
  it('retains current coverage when the final native body still has exactly the selected marker', async () => {
    sourceFetch.mockImplementation(fixture().fetchImpl);
    const snapshot = await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW });
    expect(snapshot.changes[0]).toMatchObject({ currentCodeVerified: true, proof: { status: 'VERIFIED', currentCodeVerified: true }, review: { status: 'VERIFIED' } });
    expect(assessScorecard(snapshot, { now: NOW }).status).toBe('SOURCE_BACKED');
  });
  it.each([
    ['same-issue historical revision', '<!-- engineering-contract: 1048 -->'],
    ['unknown revision', '<!-- engineering-contract: 1048-v4 -->'],
    ['duplicate marker', '<!-- engineering-contract: 1048-v3 -->\n<!-- engineering-contract: 1048-v3 -->'],
    ['malformed marker', '<!-- engineering-contract: 1048-v3'],
    ['missing marker', ''],
  ])('invalidates previously current positive proof and review after %s', async (_kind, finalMarker) => {
    const f = fixture({ finalMarker }); sourceFetch.mockImplementation(f.fetchImpl);
    const snapshot = await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW });
    const result = assessScorecard(snapshot, { now: NOW });
    expect(result.status).toBe('BLOCKED');
    expect(result.problems.join(' ')).toMatch(/marker|revision/i);
    expect(result.metrics.redProofCoverage.status).toBe('NOT_MEASURED');
    expect(snapshot.changes[0]).toMatchObject({ currentCodeVerified: false, proof: { status: 'BLOCKED', currentCodeVerified: false } });
  });
});


describe('scorecard attributes failure inventory only to frozen workflow source', () => {
  it('reports NOT_MEASURED instead of zero observed failures when CURRENT omitted the reviewed workflow digest', async () => {
    sourceFetch.mockImplementation(fixture({ brokenProof: true, missingWorkflowFreeze: true }).fetchImpl);
    const snapshot = await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW });
    const result = assessScorecard(snapshot, { now: NOW });
    expect(result.metrics.proofWorkflowFailures.status).toBe('NOT_MEASURED');
    expect(result.metrics.proofWorkflowFailures.value).toBeNull();
    expect(result.changes[0].problems.join(' ')).toMatch(/workflow.*unavailable|workflow.*digest|workflow.*pin/i);
  });
});


describe('failed-attempt preparer source identity', () => {
  it('keeps failed proof inventory unknown when a matching artifact run and its attempt disagree on source commit', async () => {
    sourceFetch.mockImplementation(fixture({ brokenProof: true, badAttemptSource: true }).fetchImpl);
    const result = assessScorecard(await collectScorecard({ prNumbers: [1], token: 'secret', now: NOW }), { now: NOW });
    expect(result.metrics.proofWorkflowFailures).toMatchObject({ status: 'NOT_MEASURED', value: null });
    expect(result.changes[0].problems.join(' ')).toMatch(/proof-workflow failure inventory.*unavailable/);
  });
});
