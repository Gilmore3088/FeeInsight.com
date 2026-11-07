/** Read-only corroboration. Receipts, check names and caller JSON never establish provenance. */
import { createHash } from 'node:crypto';
import { Unzip, UnzipInflate } from 'fflate';
import { assessProofBundle, contractDigest, validateContract } from './contract.mjs';
import { isGithubEvidence } from './github.mjs';

const NATIVE_FETCH = globalThis.fetch;
const collected = new WeakSet();
const WORKFLOW = '.github/workflows/engineering-verification.yml';
const DAY = 86400000, JSON_LIMIT = 2 * 1024 * 1024, ZIP_LIMIT = 8 * 1024 * 1024;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const at = value => typeof value === 'string' ? Date.parse(value) : NaN;
const hash = value => createHash('sha256').update(value).digest('hex');
const freeze = value => {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item && typeof item === 'object' && !Object.isFrozen(item)) { for (const child of Object.values(item)) pending.push(child); Object.freeze(item); }
  }
  return value;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fresh = (observedAt, now) => Number.isFinite(at(observedAt)) && at(observedAt) <= now.getTime() && now.getTime() - at(observedAt) <= 15 * 60000;

async function bytes(response, limit) {
  const declared = response.headers.get('content-length');
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('Response exceeds bounded byte limit');
  if (!response.body) throw new Error('Response body unavailable');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > limit) throw new Error('Response exceeds bounded byte limit');
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, length);
}

/** Stream only receipt.json; neither archive paths nor other contents touch disk. */
function readReceipt(archive) {
  let count = 0, complete = false, length = 0;
  const chunks = [];
  const unzip = new Unzip(file => {
    if (file.name !== 'receipt.json') return;
    if (++count !== 1 || (file.originalSize != null && file.originalSize > JSON_LIMIT)) throw new Error('Duplicate or oversized receipt.json');
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error('Invalid receipt ZIP entry');
      length += chunk.length;
      if (length > JSON_LIMIT) { file.terminate(); throw new Error('Receipt exceeds bounded byte limit'); }
      chunks.push(Buffer.from(chunk));
      complete = final;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < archive.length; offset += 1024) unzip.push(archive.subarray(offset, offset + 1024), offset + 1024 >= archive.length);
  if (count !== 1 || !complete) throw new Error('Complete receipt.json unavailable in artifact');
  return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
}

export const isCollectedProof = value => value != null && collected.has(value);

/** Authority exists only on this live, authenticated, immutable in-process object. */
export function assessCollectedProof(snapshot, { now = new Date() } = {}) {
  const blockers = [...(snapshot?.validation?.problems ?? [])];
  if (!isCollectedProof(snapshot)) blockers.push('Proof artifact provenance is not authenticated in this process');
  if (snapshot?.validation?.status !== 'PASSED') blockers.push('Proof artifact validation did not pass');
  if (!fresh(snapshot?.observedAt, now)) blockers.push('Proof collection is stale or has no valid observation time');
  const expiry = Math.min(at(snapshot?.artifact?.created_at) + 90 * DAY, at(snapshot?.artifact?.expires_at));
  if (!Number.isFinite(expiry) || now.getTime() >= expiry || snapshot?.artifact?.expired !== false) blockers.push('Proof artifact expired or retention evidence is missing');
  return { status: blockers.length ? 'BLOCKED' : 'VERIFIED', blockers: [...new Set(blockers)],
    runId: snapshot?.run?.id ?? null, runAttempt: snapshot?.run?.run_attempt ?? null,
    artifactId: snapshot?.artifact?.id ?? null, artifactDigest: snapshot?.artifact?.digest ?? null };
}

export async function collectProofEvidence({ github, contract, contractRaw, token, now = new Date(), fetchImpl = NATIVE_FETCH }) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Authenticated GitHub read token required');
  const problems = [], testTransport = fetchImpl !== NATIVE_FETCH;
  const authenticGithub = isGithubEvidence(github) && github.provenance?.kind === 'authenticated-github-api';
  if (!authenticGithub) problems.push('GitHub snapshot provenance is not authenticated in this process');
  if (!fresh(github?.observedAt, now)) problems.push('GitHub snapshot is stale or missing observation time');
  problems.push(...(github?.problems ?? []));
  const validation = validateContract(contract);
  problems.push(...validation.errors);
  if (typeof contractRaw !== 'string') problems.push('Exact frozen contract bytes required');
  else {
    try { if (!same(JSON.parse(contractRaw), contract)) problems.push('Frozen contract bytes differ from supplied declaration'); }
    catch { problems.push('Frozen contract bytes are not valid JSON'); }
  }
  const repository = github?.repository, prNumber = github?.prNumber, headSha = github?.pullRequest?.headSha;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !positive(prNumber) || !sha(headSha)) problems.push('Authenticated repository, PR and current head identity required');
  const snapshot = { schemaVersion: 1, repository, prNumber, headSha, observedAt: now.toISOString(),
    provenance: { kind: testTransport ? 'test-transport-untrusted' : 'authenticated-github-proof-artifact' },
    run: null, artifact: null, receipt: null, validation: null, status: 'BLOCKED' };
  const finish = () => {
    snapshot.validation = { status: problems.length ? 'BLOCKED' : 'PASSED', problems: [...new Set(problems)] };
    if (!problems.length && !testTransport && authenticGithub) { snapshot.status = 'VERIFIED'; collected.add(snapshot); }
    return freeze(snapshot);
  };
  // Read-only fixture collection may exercise the parser; it can never mint authority.
  if ((!authenticGithub && !testTransport)
    || problems.some(problem => problem !== 'GitHub snapshot provenance is not authenticated in this process')) return finish();
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const request = (url, authenticated = true, redirect = 'error') => fetchImpl(url, { method: 'GET', headers: authenticated ? headers : { Accept: 'application/zip' }, redirect, signal: AbortSignal.timeout(20000) });
  const get = async path => {
    const response = await request(base + path);
    if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]} returned ${response.status}`);
    return JSON.parse((await bytes(response, JSON_LIMIT)).toString('utf8'));
  };
  const content = async (path, ref) => {
    const result = await get(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
    if (result.type !== 'file' || result.path !== path || result.encoding !== 'base64' || typeof result.content !== 'string') throw new Error(`Trusted source file unavailable: ${path}`);
    const value = Buffer.from(result.content, 'base64');
    if (value.length > JSON_LIMIT) throw new Error('Trusted source file exceeds byte limit');
    return value;
  };
  try {
    const repo = await get('');
    if (repo.full_name !== repository || !positive(repo.id) || repo.default_branch !== 'main') throw new Error('Expected main repository identity unavailable');
    const branch = await get('/commits/main');
    if (!sha(branch.sha)) throw new Error('Trusted default-branch commit unavailable');
    const workflow = await get('/actions/workflows/engineering-verification.yml');
    if (!positive(workflow.id) || workflow.path !== WORKFLOW || workflow.state !== 'active') throw new Error('Registered engineering verification workflow unavailable');
    const inventory = await get(`/actions/workflows/${workflow.id}/runs?event=workflow_dispatch&branch=main&per_page=20&page=1`);
    if (!Array.isArray(inventory.workflow_runs) || inventory.workflow_runs.length > 20) throw new Error('Bounded workflow-run inventory unavailable');
    const expectedName = `engineering-verification-${prNumber}-${headSha}-${contract.issue.slice(1)}`;
    let selected;
    for (const run of [...inventory.workflow_runs].sort((a, b) => b.id - a.id)) {
      if (!positive(run.id)) continue;
      const artifacts = await get(`/actions/runs/${run.id}/artifacts?per_page=100&page=1`);
      if (!Array.isArray(artifacts.artifacts) || artifacts.artifacts.length >= 100) throw new Error('Proof artifact inventory unavailable or exceeds bound');
      const matches = artifacts.artifacts.filter(item => item.name === expectedName);
      if (matches.length > 1) throw new Error('Ambiguous proof artifacts for exact target');
      if (matches.length) { selected = { run, artifact: matches[0] }; break; }
    }
    if (!selected) throw new Error('Exact-head proof artifact unavailable in the latest 20 dispatch runs');
    const run = selected.run;
    const validRun = row => positive(row?.id) && row.id === run.id && row.workflow_id === workflow.id
      && positive(row.run_attempt) && row.head_branch === 'main' && sha(row.head_sha)
      && row.event === 'workflow_dispatch' && row.status === 'completed' && row.conclusion === 'success'
      && row.repository?.id === repo.id && row.repository?.full_name === repository
      && row.head_repository?.id === repo.id && row.head_repository?.full_name === repository
      && typeof row.path === 'string' && row.path.split('@')[0] === WORKFLOW
      && row.html_url === `https://github.com/${repository}/actions/runs/${row.id}`;
    if (!validRun(run)) throw new Error('Proof workflow identity, event, repository, branch or conclusion mismatched');
    const attempt = await get(`/actions/runs/${run.id}/attempts/${run.run_attempt}`);
    if (!validRun(attempt) || attempt.head_sha !== run.head_sha || attempt.run_attempt !== run.run_attempt) throw new Error('Proof run attempt identity mismatch');
    snapshot.run = attempt;
    const jobs = await get(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`);
    const proofJobs = Array.isArray(jobs.jobs) ? jobs.jobs.filter(job => job.name === 'historical-proof') : [];
    if (proofJobs.length !== 1 || proofJobs[0].run_id !== run.id || proofJobs[0].run_attempt !== run.run_attempt
      || proofJobs[0].head_sha !== run.head_sha || proofJobs[0].status !== 'completed' || proofJobs[0].conclusion !== 'success') throw new Error('Successful proof job bound to this run attempt is missing');
    const artifact = await get(`/actions/artifacts/${selected.artifact.id}`);
    snapshot.artifact = artifact;
    const created = at(artifact.created_at), expires = at(artifact.expires_at), started = at(attempt.run_started_at), updated = at(attempt.updated_at);
    if (!positive(artifact.id) || artifact.id !== selected.artifact.id || artifact.name !== expectedName || artifact.expired !== false
      || typeof artifact.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(artifact.digest)
      || !positive(artifact.size_in_bytes) || artifact.size_in_bytes > ZIP_LIMIT
      || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.repository_id !== repo.id || artifact.workflow_run?.head_repository_id !== repo.id
      || artifact.workflow_run?.head_sha !== run.head_sha || artifact.workflow_run?.head_branch !== 'main'
      || !Number.isFinite(created) || !Number.isFinite(expires) || !Number.isFinite(started) || !Number.isFinite(updated)
      || created < started || created > updated || created > now.getTime() || expires < created + 90 * DAY - 60000
      || now.getTime() >= Math.min(expires, created + 90 * DAY)) throw new Error('Proof artifact identity, digest, retention or run-attempt timestamp invalid');
    const download = await request(`${base}/actions/artifacts/${artifact.id}/zip`, true, 'manual');
    let response = download;
    if (download.status === 302) {
      const location = new URL(download.headers.get('location') ?? '');
      if (location.protocol !== 'https:' || location.username || location.password
        || !(/\.blob\.core\.windows\.net$/.test(location.hostname) || /\.actions\.githubusercontent\.com$/.test(location.hostname))) throw new Error('Unexpected artifact storage redirect');
      response = await request(location.toString(), false);
    }
    if (!response.ok) throw new Error(`Proof artifact download returned ${response.status}`);
    const archive = await bytes(response, ZIP_LIMIT);
    if (archive.length !== artifact.size_in_bytes || `sha256:${hash(archive)}` !== artifact.digest.toLowerCase()) throw new Error('Downloaded proof artifact digest or size mismatch');
    const receipt = readReceipt(archive);
    snapshot.receipt = receipt;
    if (receipt.schema_version !== '1.0' || receipt.contract_id !== contract.contract_id || receipt.base_sha !== contract.base_sha
      || receipt.head_sha !== headSha || receipt.contract_sha256 !== contractDigest(contractRaw) || !same(receipt.execution_files, contract.execution_files)
      || receipt.provenance?.claimed_origin !== 'GITHUB_ACTIONS_UNCORROBORATED' || receipt.provenance?.workflow_sha !== run.head_sha
      || receipt.provenance?.run_id !== String(run.id) || receipt.provenance?.run_attempt !== String(run.run_attempt)) throw new Error('Proof receipt contract, target or authenticated run identity mismatch');
    if (!Number.isFinite(at(receipt.started_at)) || !Number.isFinite(at(receipt.completed_at))
      || at(receipt.started_at) < started - 60000 || at(receipt.completed_at) < at(receipt.started_at)
      || at(receipt.completed_at) > updated + 60000 || at(receipt.completed_at) > now.getTime()) throw new Error('Proof receipt execution timestamps invalid');
    const behavior = assessProofBundle(contract, receipt, headSha, contractDigest(contractRaw));
    if (behavior.status !== 'STRUCTURALLY_VALID_UNTRUSTED') problems.push(...behavior.problems);
    if (receipt.pairs.some(pair => pair.red.execution_exit_code !== 0 || pair.green.execution_exit_code !== 0)) problems.push('Source execution failed; infrastructure failure cannot establish behavioral RED or GREEN');
    if (receipt.pairs.some(pair => pair.red.artifact_url !== run.html_url || pair.green.artifact_url !== run.html_url)) problems.push('Proof pair log reference is not the authenticated run');
    const requiredFiles = new Map(contract.execution_files.map(file => [file.path, file.sha256]));
    for (const requirement of contract.requirements) for (const kind of ['test', 'fixture', 'adapter']) requiredFiles.set(requirement[`${kind}_path`], requirement[`${kind}_sha256`]);
    requiredFiles.set(`docs/project/acceptance/engineering/${contract.issue.slice(1)}.json`, contractDigest(contractRaw));
    const workflowBytes = await content(WORKFLOW, run.head_sha), currentWorkflow = await content(WORKFLOW, branch.sha);
    if (hash(workflowBytes) !== hash(currentWorkflow)) problems.push('Proof workflow differs from trusted current default-branch source');
    for (const [path, expected] of requiredFiles) {
      const historical = await content(path, run.head_sha), current = run.head_sha === branch.sha ? historical : await content(path, branch.sha);
      if (hash(historical) !== expected || hash(current) !== expected) problems.push(`Trusted source identity changed or is not bootstrapped: ${path}`);
    }
    const lock = await content('package-lock.json', run.head_sha);
    const currentLock = run.head_sha === branch.sha ? lock : await content('package-lock.json', branch.sha);
    if (receipt.runtime?.dependency_lock_sha256 !== hash(lock) || hash(lock) !== hash(currentLock)) problems.push('Proof dependency lock identity changed or mismatched current default branch');
    const packageJson = await content('package.json', run.head_sha), currentPackage = run.head_sha === branch.sha ? packageJson : await content('package.json', branch.sha);
    if (hash(packageJson) !== hash(currentPackage)) problems.push('Proof package configuration changed on current default branch');
    const runtimePath = contract.execution_files.find(file => file.path.endsWith('/runtime.json'))?.path;
    if (!runtimePath || receipt.runtime?.image !== JSON.parse((await content(runtimePath, run.head_sha)).toString('utf8')).image) problems.push('Proof runtime image identity mismatch');
    const current = await get(`/pulls/${prNumber}`), latestBranch = await get('/commits/main'), latestRun = await get(`/actions/runs/${run.id}`);
    if (current.head?.sha !== headSha) problems.push('Pull request head changed while collecting proof');
    if (latestBranch.sha !== branch.sha) problems.push('Trusted default branch changed while collecting proof');
    if (!validRun(latestRun) || latestRun.run_attempt !== run.run_attempt || latestRun.head_sha !== run.head_sha) problems.push('Proof run changed or a newer attempt began while collecting proof');
  } catch (error) { problems.push(error instanceof Error ? error.message.split(token).join('[redacted]') : 'Proof collection failed'); }
  return finish();
}
