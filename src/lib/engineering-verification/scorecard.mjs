/** Read-only sampled engineering measurements. No imported status or aggregate JSON establishes authority. */
import { createHash } from 'node:crypto';
import { collectGithubEvidence, isGithubEvidence } from './github.mjs';
import { collectProofEvidence, assessCollectedProof, validateRevisionContract, assertNativeContractPath, assertNativeSourcePath, assertNativeProofSource, expectedWorkflowDigest } from './proof.mjs';
import { assessReviewEvidence } from './evidence.mjs';
import { classifyChange, changedPaths } from './contract.mjs';
import { parseContractMarker, CONTRACT_REVISIONS } from './contract-registry.mjs';
const NATIVE_FETCH = globalThis.fetch, collected = new WeakSet();
export const SCORECARD_REPOSITORY = 'Gilmore3088/FeeInsight.com';
const POLICY_PATH = 'src/lib/engineering-verification/policy.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const at = value => typeof value === 'string' ? Date.parse(value) : NaN;
const text = value => typeof value === 'string' && value.trim().length > 0;
const median = values => { if (!values.length) return null; const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2; };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const unknown = reason => ({ status: 'NOT_MEASURED', value: null, reason });
const ratio = (numerator, denominator) => ({ status: denominator ? 'MEASURED' : 'NOT_MEASURED', numerator, denominator, value: denominator ? numerator / denominator : null });
function unknownMetrics(reason) {
  return Object.fromEntries(['redProofCoverage', 'historicalRedProofCoverage', 'independentReviewCoverage', 'verifiedEngineeringCoverage', 'reviewLatencyMedianHours', 'ciRunnerTimeSeconds', 'verificationRunnerTimeSeconds', 'proofEvidenceUnavailable', 'proofBeforeMergeCoverage', 'proofWorkflowFailures', 'behavioralProofFailures', 'defectRecurrence', 'currencyCost', 'incrementalCiOverhead', 'productionVerificationLag'].map(name => [name, unknown(reason)]));
}
function policyOf(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Trusted policy is not valid JSON'); }
  if (value?.schema_version !== 1 || typeof value.enforcement_enabled !== 'boolean' || !['owner_logins', 'allowed_reviewers', 'required_checks'].every(key => Array.isArray(value[key]) && value[key].every(text)) || !value.required_checks.includes('app-tests')) throw new Error('Trusted policy schema or required app-tests inventory missing');
  return value;
}
function scopeCovers(paths, scope) {
  const escape = value => value.replace(/[\\^$+?.()|{}\[\]]/g, '\\$&');
  return Array.isArray(scope) && paths.every(path => scope.some(pattern => typeof pattern === 'string' && new RegExp('^' + pattern.split('**').map(part => part.split('*').map(escape).join('[^/]*')).join('.*') + '$').test(path)));
}
function historicalReview(github, contractRaw, policyRaw, policy, now) {
  const review = assessReviewEvidence(github, { headSha: github.pullRequest.headSha, contractSha256: hash(contractRaw), policySha256: hash(policyRaw), ownerLogins: policy.owner_logins, allowedReviewers: policy.allowed_reviewers, now });
  const mergedAt = at(github.pullRequest.mergedAt);
  const blockers = review.blockers.filter(problem => !['PR mergeability is not confirmed', 'PR is draft or not open'].includes(problem));
  const approvals = review.independentReviewers.filter(actor => github.reviews.some(event => event.id === actor.id && at(event.submitted_at) <= mergedAt));
  if (!github.pullRequest.merged || !Number.isFinite(mergedAt) || !approvals.length) blockers.push('Independent approval before authenticated merge is missing');
  const approvedAt = Math.min(...approvals.map(actor => at(github.reviews.find(event => event.id === actor.id).submitted_at)));
  const latency = (approvedAt - at(github.pullRequest.openedAt)) / 3600000;
  return { status: blockers.length ? 'BLOCKED' : 'VERIFIED', blockers, ownerSignoff: review.ownerSignoff, approvedAt: Number.isFinite(approvedAt) ? new Date(approvedAt).toISOString() : null, latencyHours: !blockers.length && Number.isFinite(latency) && latency >= 0 ? latency : null, actors: approvals };
}
function runnerSeconds(jobs, run, now) {
  if (!run || !positive(run.id) || !positive(run.run_attempt) || !Array.isArray(jobs) || !jobs.length) return null;
  const seen = new Set(); let total = 0;
  for (const job of jobs) {
    const start = at(job.started_at), end = at(job.completed_at);
    if (!positive(job.id) || seen.has(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha || job.status !== 'completed' || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end > now.getTime()) return null;
    seen.add(job.id); total += (end - start) / 1000;
  }
  return total;
}
function deriveMetrics(changes, ciRuns, proofRuns, proofFailures, proofAttemptInventoryRead) {
  const proofEligible = changes.filter(row => row.merged && ['R2', 'R3'].includes(row.riskTier));
  const reviewEligible = changes.filter(row => row.merged && ['R1', 'R2', 'R3'].includes(row.riskTier));
  const unknownDenominator = changes.some(row => row.riskTier === null || row.merged === null);
  const coverage = (rows, predicate) => unknownDenominator ? unknown('Selected PR inventory or changed-path risk is incomplete; denominator is unknown') : ratio(rows.filter(predicate).length, rows.length);
  const ciSamples = [...ciRuns.values()].filter(value => value != null), proofSamples = [...proofRuns.values()].filter(value => value != null);
  const timing = (samples, total) => samples.length ? { status: samples.length === total ? 'MEASURED' : 'PARTIAL', value: samples.reduce((sum, value) => sum + value, 0), runs: samples.length, unknownRuns: total - samples.length } : unknown('No complete authenticated run/job timing available');
  const latencies = reviewEligible.map(row => row.review.latencyHours).filter(value => typeof value === 'number');
  return {
    redProofCoverage: coverage(proofEligible, row => row.proof.status === 'VERIFIED'),
    historicalRedProofCoverage: coverage(proofEligible, row => row.proof.status === 'HISTORICAL_VERIFIED'),
    proofBeforeMergeCoverage: coverage(proofEligible, row => row.proof.status === 'VERIFIED' && row.proof.completedBeforeMerge === true),
    independentReviewCoverage: coverage(reviewEligible, row => row.review.status === 'VERIFIED'),
    verifiedEngineeringCoverage: coverage(proofEligible, row => row.currentCodeVerified === true && row.proof.status === 'VERIFIED' && row.review.status === 'VERIFIED' && ['AUTHORIZED', 'NOT_REQUIRED'].includes(row.ownerAuthorization.status) && row.ci.status === 'PASSED' && row.contractSha256 === row.historicalContractSha256),
    reviewLatencyMedianHours: latencies.length ? { status: 'MEASURED', value: median(latencies), samples: latencies.length } : unknown('No independently verified exact-head review latency available'),
    ciRunnerTimeSeconds: timing(ciSamples, ciRuns.size), verificationRunnerTimeSeconds: timing(proofSamples, proofRuns.size),
    proofEvidenceUnavailable: { status: 'MEASURED', value: proofEligible.filter(row => !['VERIFIED', 'HISTORICAL_VERIFIED'].includes(row.proof.status)).length, eligibleChanges: proofEligible.length, meaning: 'Missing, expired or invalid evidence; historical-only evidence is reported separately and never verifies current code' },
    proofWorkflowFailures: proofAttemptInventoryRead ? { status: 'PARTIAL', value: proofFailures.size, scope: 'Observed artifact-bearing matching attempts among latest 20 proof dispatches; preparation failures without target artifacts are not attributed' } : unknown('No authenticated proof-attempt inventory was observed'),
    behavioralProofFailures: unknown('Successful proof artifacts do not establish a complete inventory of failed behavioral attempts'),
    defectRecurrence: unknown('Confirmed Deming issue-class recurrence after merge and planned replay is not collected by this GitHub-only scorecard'),
    currencyCost: unknown('Runner seconds are consumption, not an invoice or authenticated billing price'),
    incrementalCiOverhead: unknown('No independently comparable before/after control cohort is supplied; the 15% target is not a measurement'),
    productionVerificationLag: unknown('Sufficient deployment-to-outcome observations are not collected by this GitHub-only scorecard'),
  };
}
export const isScorecardEvidence = value => value != null && collected.has(value);
export function assessScorecard(snapshot, { now = new Date() } = {}) {
  const problems = [...(Array.isArray(snapshot?.problems) ? snapshot.problems : [])];
  if (!isScorecardEvidence(snapshot)) problems.push('Scorecard provenance is not authenticated in this process');
  if (!Number.isFinite(at(snapshot?.observedAt)) || at(snapshot.observedAt) > now.getTime() || now.getTime() - at(snapshot.observedAt) > 15 * 60000) problems.push('Scorecard observation is stale or missing');
  const blocked = problems.length > 0;
  return { status: blocked ? 'BLOCKED' : snapshot.changes.some(row => row.problems.length) ? 'SOURCE_BACKED_PARTIAL' : 'SOURCE_BACKED', scope: snapshot?.scope ?? null,
    metrics: blocked ? unknownMetrics('Authenticated current-scope evidence is unavailable') : snapshot.metrics,
    changes: isScorecardEvidence(snapshot) ? snapshot.changes : [], exclusions: isScorecardEvidence(snapshot) ? snapshot.exclusions : [], problems: [...new Set(problems)] };
}

/** Explicit sample, never repository-wide coverage. At most two PR collectors run at once. */
export async function collectScorecard({ prNumbers, token, now = new Date(), fetchImpl = NATIVE_FETCH }) {
  if (!Array.isArray(prNumbers) || !prNumbers.length || prNumbers.length > 20 || prNumbers.some(number => !positive(number)) || new Set(prNumbers).size !== prNumbers.length) throw new Error('Select 1-20 unique positive PR numbers');
  if (!text(token) || !Number.isFinite(now.getTime())) throw new Error('Authenticated read token and valid observation time required');
  const testTransport = fetchImpl !== NATIVE_FETCH, base = `https://api.github.com/repos/${SCORECARD_REPOSITORY}`;
  const problems = [], cache = new Map(); let requests = 0;
  const get = async path => {
    if (++requests > 300) throw new Error('Scorecard metadata request budget exceeded');
    let response;
    try { response = await fetchImpl(base + path, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Scorecard GitHub metadata request unavailable'); }
    if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]} returned ${response.status}`);
    const raw = await response.text(); if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Scorecard metadata exceeds byte budget');
    try { return JSON.parse(raw); } catch { throw new Error('Scorecard GitHub metadata is not valid JSON'); }
  };
  const nativeTrees = new Map();
  const content = (path, ref) => {
    const key = ref + ':' + path;
    if (!cache.has(key)) cache.set(key, (async () => {
      if (!sha(ref)) throw new Error('Immutable source SHA required');
      const registered = CONTRACT_REVISIONS.find(revision => revision.path === path);
      const blobSha = registered ? await assertNativeContractPath(registered, ref, get, nativeTrees) : await assertNativeSourcePath(path, ref, get, nativeTrees);
      const value = await get(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
      if (value.type !== 'file' || value.path !== path || value.encoding !== 'base64' || typeof value.content !== 'string' || (blobSha && value.sha !== blobSha)) throw new Error('Immutable source file unavailable or differs from its canonical Git blob: ' + path);
      return Buffer.from(value.content, 'base64').toString('utf8');
    })());
    return cache.get(key);
  };
  const repo = await get(''), branch = await get('/commits/main');
  if (repo.full_name !== SCORECARD_REPOSITORY || !positive(repo.id) || repo.default_branch !== 'main' || !sha(branch.sha)) throw new Error('Expected fixed repository and trusted main identity unavailable');
  const currentPolicyRaw = await content(POLICY_PATH, branch.sha), policy = policyOf(currentPolicyRaw);
  const ciRuns = new Map(), proofRuns = new Map(), proofFailures = new Set(), metadataCache = new Map();
  const metadata = path => { if (!metadataCache.has(path)) metadataCache.set(path, get(path)); return metadataCache.get(path); };
  let attempts, proofAttemptInventoryRead = false, proofAttemptInventoryUnavailable = false;
  const failedAttempts = async (prNumber, headSha, revision, contract) => {
    const frozenWorkflowDigest = expectedWorkflowDigest(revision, contract);
    const source = async ref => {
      await assertNativeProofSource(revision, ref, get, nativeTrees);
      if (revision.executionStatus === 'CURRENT') {
        for (const file of contract.execution_files) {
          if (hash(await content(file.path, ref)) !== file.sha256) throw new Error('Proof-attempt frozen source input changed: ' + file.path);
        }
      }
    };
    if (revision.executionStatus === 'CURRENT') await source(branch.sha);
    if (!attempts) attempts = (async () => {
      const workflow = await metadata('/actions/workflows/engineering-verification.yml');
      if (!positive(workflow.id) || workflow.path !== '.github/workflows/engineering-verification.yml' || workflow.state !== 'active') throw new Error('Known proof workflow unavailable');
      const inventory = await metadata(`/actions/workflows/${workflow.id}/runs?event=workflow_dispatch&branch=main&per_page=20&page=1`);
      if (!Array.isArray(inventory.workflow_runs) || inventory.workflow_runs.length > 20) throw new Error('Bounded proof-attempt inventory unavailable');
      const trustedBytes = await content(workflow.path, branch.sha);
      return { workflow, runs: inventory.workflow_runs, trustedBytes };
    })();
    const inventory = await attempts;
    for (const run of inventory.runs) {
      const expectedName = `engineering-verification-${prNumber}-${headSha}-${revision.key}-attempt-${run.run_attempt}`;
      if (run.conclusion !== 'failure' || run.status !== 'completed' || run.event !== 'workflow_dispatch' || run.head_branch !== 'main' || !sha(run.head_sha) || !positive(run.id) || !positive(run.run_attempt) || run.workflow_id !== inventory.workflow.id || run.repository?.id !== repo.id || run.repository?.full_name !== SCORECARD_REPOSITORY || run.head_repository?.id !== repo.id || run.head_repository?.full_name !== SCORECARD_REPOSITORY || run.path?.split('@')[0] !== inventory.workflow.path) continue;
      const artifacts = await metadata(`/actions/runs/${run.id}/artifacts?per_page=100&page=1`);
      if (!Array.isArray(artifacts.artifacts) || artifacts.artifacts.length >= 100) throw new Error('Proof-attempt artifact association inventory unavailable');
      const matching = artifacts.artifacts.filter(artifact => artifact.name === expectedName && artifact.workflow_run?.id === run.id && artifact.workflow_run?.repository_id === repo.id && artifact.workflow_run?.head_sha === run.head_sha && at(artifact.created_at) >= at(run.run_started_at) && at(artifact.created_at) <= at(run.updated_at));
      if (matching.length !== 1) continue;
      await source(run.head_sha);
      const workflowDigest = hash(await content(inventory.workflow.path, run.head_sha));
      if (workflowDigest !== frozenWorkflowDigest || (revision.executionStatus === 'CURRENT' && workflowDigest !== hash(inventory.trustedBytes))) throw new Error('Proof-attempt workflow differs from its revision-authorized frozen source');
      const attempt = await metadata(`/actions/runs/${run.id}/attempts/${run.run_attempt}`);
      if (attempt.id !== run.id || attempt.run_attempt !== run.run_attempt || attempt.head_sha !== run.head_sha
        || attempt.workflow_id !== inventory.workflow.id || attempt.head_branch !== 'main' || attempt.event !== 'workflow_dispatch'
        || attempt.status !== 'completed' || attempt.conclusion !== 'failure' || attempt.path?.split('@')[0] !== inventory.workflow.path
        || attempt.repository?.id !== repo.id || attempt.repository?.full_name !== SCORECARD_REPOSITORY
        || attempt.head_repository?.id !== repo.id || attempt.head_repository?.full_name !== SCORECARD_REPOSITORY) throw new Error('Proof-attempt native source identity mismatch');
      await assertNativeProofSource(revision, attempt.head_sha, get, nativeTrees);
      const jobs = await metadata(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=1`);
      const proofJobs = Array.isArray(jobs.jobs) ? jobs.jobs.filter(job => job.name === 'historical-proof') : [];
      if (proofJobs.length !== 1 || proofJobs[0].conclusion !== 'failure' || jobs.jobs.length >= 100) continue;
      const seconds = runnerSeconds(jobs.jobs, run, now);
      if (seconds == null) continue;
      const current = await get(`/actions/runs/${run.id}`);
      if (current.head_sha !== run.head_sha || current.run_attempt !== run.run_attempt || current.status !== 'completed' || current.conclusion !== 'failure') continue;
      proofFailures.add(`${run.id}:${run.run_attempt}`); proofRuns.set(`${run.id}:${run.run_attempt}`, seconds);
    }
    proofAttemptInventoryRead = true;
  };
  const readChange = async prNumber => {
    const row = { prNumber, headSha: null, merged: null, mergedAt: null, riskTier: null, contractKey: null, contractExecutionStatus: null, currentCodeVerified: false, contractSha256: null, historicalContractSha256: null, policySha256: null, review: { status: 'BLOCKED', latencyHours: null, blockers: ['Historical review has not been established'] }, ownerAuthorization: { required: null, status: 'UNKNOWN', decidedAt: null }, proof: { status: 'BLOCKED', blockers: ['No authenticated proof artifact established'] }, ci: { status: 'UNKNOWN' }, problems: [] };
    try {
      const github = await collectGithubEvidence({ repository: SCORECARD_REPOSITORY, prNumber, token, requiredChecks: policy.required_checks, includeDeployments: false, now, fetchImpl });
      row.headSha = github.pullRequest.headSha; row.merged = github.pullRequest.merged; row.mergedAt = github.pullRequest.mergedAt;
      row.ci = { status: github.ci.status, runId: github.ci.runId, runAttempt: github.ci.runAttempt };
      if (!isGithubEvidence(github)) row.problems.push('PR source provenance is not authenticated');
      row.problems.push(...github.problems);
      if (github.problems.some(problem => /head changed/.test(problem))) problems.push(`PR #${prNumber} head changed during collection`);
      const inventory = changedPaths(github.files), paths = inventory.paths;
      row.problems.push(...inventory.problems);
      if (paths.length && !inventory.problems.length && !github.problems.some(problem => /changed files/.test(problem))) row.riskTier = classifyChange(paths).risk_tier;
      else row.problems.push('Changed-path risk cannot be determined');
      if (github.ci.run && isGithubEvidence(github)) ciRuns.set(`${github.ci.run.id}:${github.ci.run.run_attempt}`, runnerSeconds(github.ci.jobs, github.ci.run, now));
      if (!row.merged || row.riskTier === 'R0') return row;
      const revision = parseContractMarker(github.pullRequest.body);
      row.contractKey = revision.key; row.contractExecutionStatus = revision.executionStatus;
      const contractPath = revision.path, contractRaw = await content(contractPath, branch.sha), contract = JSON.parse(contractRaw);
      const validation = validateRevisionContract(revision, contract, contractRaw); if (!validation.ok) throw new Error('Trusted contract invalid: ' + validation.errors.join('; '));
      if (!row.riskTier || contract.risk_tier < row.riskTier || !scopeCovers(paths, contract.scope)) throw new Error('Contract association does not cover actual changed-path risk and scope');
      row.contractSha256 = hash(contractRaw);
      try {
        if (!sha(github.pullRequest.mergeSha)) throw new Error('Authenticated merge SHA unavailable');
        const [historicalPolicyRaw, historicalContractRaw] = await Promise.all([content(POLICY_PATH, github.pullRequest.mergeSha), content(contractPath, github.pullRequest.mergeSha)]);
        const historicalPolicy = policyOf(historicalPolicyRaw), historicalContract = JSON.parse(historicalContractRaw);
        if (!validateRevisionContract(revision, historicalContract, historicalContractRaw).ok || historicalContract.risk_tier < row.riskTier || !scopeCovers(paths, historicalContract.scope)) throw new Error('Immutable historical contract does not cover the merge');
        row.policySha256 = hash(historicalPolicyRaw); row.historicalContractSha256 = hash(historicalContractRaw);
        row.review = historicalReview(github, historicalContractRaw, historicalPolicyRaw, historicalPolicy, now);
        const ownerRequired = historicalContract.human_approval_required || row.riskTier === 'R3';
        const decidedAt = row.review.ownerSignoff?.decidedAt ?? null;
        const authorized = decidedAt && at(decidedAt) <= at(row.mergedAt);
        row.ownerAuthorization = { required: ownerRequired, status: ownerRequired ? authorized ? 'AUTHORIZED' : 'BLOCKED' : 'NOT_REQUIRED', decidedAt };
        if (ownerRequired && !authorized) row.problems.push('Required owner authorization before the authenticated merge is unavailable');
      } catch (error) { row.review = { status: 'BLOCKED', latencyHours: null, blockers: ['Immutable historical review policy/contract unavailable: ' + error.message] }; }
      if (['R2', 'R3'].includes(row.riskTier)) {
        const proof = await collectProofEvidence({ github, contract, contractRaw, contractKey: revision.key, token, now, fetchImpl });
        row.proof = assessCollectedProof(proof, { now });
        if (['VERIFIED', 'HISTORICAL_VERIFIED'].includes(row.proof.status)) {
          if (proof.headSha !== row.headSha || proof.repository !== SCORECARD_REPOSITORY || proof.prNumber !== prNumber || proof.contractKey !== revision.key) {
            row.proof.status = 'BLOCKED'; row.proof.blockers.push('Proof collection does not bind this repository, PR and exact head');
          }
          row.proof.completedBeforeMerge = Number.isFinite(at(proof.receipt?.completed_at)) && at(proof.receipt.completed_at) <= at(row.mergedAt);
        }
        try { await failedAttempts(prNumber, row.headSha, revision, contract); }
        catch { proofAttemptInventoryUnavailable = true; row.problems.push('Observed proof-workflow failure inventory or revision-authorized workflow/source identity unavailable'); }
        if (['VERIFIED', 'HISTORICAL_VERIFIED'].includes(row.proof.status) && proof.headSha === row.headSha && proof.repository === SCORECARD_REPOSITORY && proof.prNumber === prNumber && proof.contractKey === revision.key) {
          const jobs = await get(`/actions/runs/${proof.run.id}/attempts/${proof.run.run_attempt}/jobs?per_page=100&page=1`);
          proofRuns.set(`${proof.run.id}:${proof.run.run_attempt}`, Array.isArray(jobs.jobs) && jobs.jobs.length < 100 ? runnerSeconds(jobs.jobs, proof.run, now) : null);
        }
      } else row.proof = { status: 'NOT_REQUIRED', blockers: [] };
      row.currentCodeVerified = revision.executionStatus === 'CURRENT' && row.proof.currentCodeVerified === true && row.proof.status === 'VERIFIED' && row.review.status === 'VERIFIED' && ['AUTHORIZED', 'NOT_REQUIRED'].includes(row.ownerAuthorization.status) && row.ci.status === 'PASSED' && row.contractSha256 === row.historicalContractSha256;
      if (revision.executionStatus === 'HISTORICAL_ONLY') row.problems.push('Historical-only contract evidence cannot establish current code verification');
      row.problems.push(...row.review.blockers, ...(row.proof.blockers ?? []), ...github.ci.problems);
    } catch (error) {
      if (row.merged && ['R2', 'R3'].includes(row.riskTier)) proofAttemptInventoryUnavailable = true;
      row.problems.push(error instanceof Error ? error.message.split(token).join('[redacted]') : 'PR collection unavailable');
    }
    return row;
  };
  const changes = new Array(prNumbers.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, prNumbers.length) }, async () => { while (next < prNumbers.length) { const index = next++; changes[index] = await readChange(prNumbers[index]); } }));
  for (const row of changes) {
    try {
      const current = await get(`/pulls/${row.prNumber}`);
      if (current.head?.sha !== row.headSha || (current.merged === true) !== row.merged || current.merged_at !== row.mergedAt) throw new Error('head changed or merge identity changed');
      if (row.contractKey != null && parseContractMarker(current.body).key !== row.contractKey) throw new Error('Contract revision changed');
    } catch (error) {
      const reason = `PR #${row.prNumber} final head/merge/contract marker/revision recheck failed: ${error instanceof Error ? error.message : 'source unavailable'}`;
      problems.push(reason); row.problems.push(reason); row.currentCodeVerified = false;
      row.proof = { ...row.proof, status: 'BLOCKED', currentCodeVerified: false, blockers: [...row.proof.blockers, reason] };
    }
  }
  try { if ((await get('/commits/main')).sha !== branch.sha) problems.push('Trusted main changed before scorecard finalization'); } catch { problems.push('Trusted main recheck unavailable'); }
  if (testTransport) problems.push('Injected scorecard transport is untrusted');
  const exclusions = changes.filter(row => row.merged === false || row.riskTier === 'R0').map(row => ({ prNumber: row.prNumber, reason: row.merged === false ? 'NOT_MERGED' : 'R0_INERT_CHANGE' }));
  for (const row of changes) {
    row.problems = row.problems.map(problem => String(problem).split(token).join('[redacted]'));
    row.review.blockers = row.review.blockers.map(problem => String(problem).split(token).join('[redacted]'));
    row.proof.blockers = (row.proof.blockers ?? []).map(problem => String(problem).split(token).join('[redacted]'));
  }
  const snapshot = freeze({ schemaVersion: 1, repository: SCORECARD_REPOSITORY, observedAt: now.toISOString(), provenance: { kind: testTransport ? 'test-transport-untrusted' : 'authenticated-github-scorecard' },
    scope: { prNumbers: [...prNumbers], selection: 'Explicit selected PR sample only; not an exhaustive repository trend', trustedMainSha: branch.sha, policySha256: hash(currentPolicyRaw), enforcementEnabled: policy.enforcement_enabled }, changes, exclusions, metrics: deriveMetrics(changes, ciRuns, proofRuns, proofFailures, proofAttemptInventoryRead && !proofAttemptInventoryUnavailable), problems: [...new Set(problems)] });
  if (!testTransport) collected.add(snapshot);
  return snapshot;
}
export function renderScorecard(snapshot, options = {}) {
  const result = assessScorecard(snapshot, options), lines = ['# Engineering scorecard', '', `Status: **${result.status}**`, '', 'Scope: selected PR sample only. Coverage measures currently corroborated evidence, including explicit missing/expired evidence. proofBeforeMergeCoverage separately discloses whether proof preceded merge. Historical behavioral proof is reported separately; it establishes neither accepted code nor review/owner authority at the time or now.', ''];
  for (const [name, metric] of Object.entries(result.metrics)) lines.push(`- ${name}: ${metric.status}${metric.value == null ? '' : ' — ' + metric.value}${metric.denominator != null ? ` (${metric.numerator}/${metric.denominator})` : ''}${metric.reason ? ' — ' + metric.reason : ''}${metric.scope ? ' — ' + metric.scope : ''}`);
  if (result.problems.length) lines.push('', ...result.problems.map(problem => '- BLOCKED: ' + problem));
  lines.push('', 'No suite was executed, workflow dispatched, approval submitted, production action taken or currency cost inferred.');
  return lines.join('\n');
}
