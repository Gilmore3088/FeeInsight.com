/** Evidence assessment is read-only. No result authorizes deployment, merge, rollback or production writes. */
import { isGithubEvidence } from './github.mjs';
const SHA = { test: value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) }, HASH = { test: value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) };
const trustedFetch = globalThis.fetch;
const DAY = 86400000, runtimeSources = new WeakSet();
const text = value => typeof value === 'string' && value.trim().length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const authenticGithub = snapshot => isGithubEvidence(snapshot) && snapshot.provenance?.kind === 'authenticated-github-api';
const unique = items => [...new Set(items)];

export function assessRetention({ createdAt, expiresAt = null, expired = false, now = new Date(), retentionDays = 90 }) {
  const created = time(createdAt), declaredExpiry = expiresAt == null ? Infinity : time(expiresAt), at = now.getTime();
  if (!Number.isFinite(created) || !Number.isFinite(at) || created > at || !Number.isFinite(retentionDays) || retentionDays <= 0 || Number.isNaN(declaredExpiry)) return { status: 'INVALID', expiresAt: null };
  const expiry = Math.min(created + retentionDays * DAY, declaredExpiry);
  return { status: expired || at >= expiry ? 'EXPIRED' : 'AVAILABLE', expiresAt: new Date(expiry).toISOString() };
}

/** The marker must be on an authenticated review/comment. A builder-supplied attestation file has no authority. */
function attestation(body) {
  const matched = typeof body === 'string' && body.match(/<!--\s*engineering-verification:\s*([\s\S]*?)\s*-->/);
  if (!matched) return null;
  try { const value = JSON.parse(matched[1]); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
}
const sameScope = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().every((path, i) => path === [...b].sort()[i]);
export function assessReviewEvidence(snapshot, { headSha, contractSha256, policySha256, allowedReviewers = [], ownerLogins = ['Gilmore3088'], now = new Date() }) {
  const blockers = [];
  if (!authenticGithub(snapshot)) blockers.push('Review evidence provenance is not authenticated in this process');
  if (!SHA.test(headSha ?? '') || snapshot?.pullRequest?.headSha !== headSha) blockers.push('Review must bind to exact current head');
  if (!HASH.test(contractSha256 ?? '') || !HASH.test(policySha256 ?? '')) blockers.push('Frozen contract and policy hashes required');
  blockers.push(...(snapshot?.problems ?? []));
  if (!Number.isFinite(time(snapshot?.observedAt)) || now.getTime() - time(snapshot.observedAt) > 15 * 60000 || time(snapshot.observedAt) > now.getTime()) blockers.push('GitHub review snapshot is stale or has no observation time');
  if (snapshot?.pullRequest?.mergeable !== true) blockers.push('PR mergeability is not confirmed');
  if (snapshot?.pullRequest?.draft || snapshot?.pullRequest?.state !== 'open') blockers.push('PR is draft or not open');
  if (!Array.isArray(snapshot?.threads)) blockers.push('Review thread inventory missing');
  else if (snapshot.threads.some(thread => thread.isResolved !== true)) blockers.push('Unresolved review threads remain');
  const paths = snapshot?.files?.map(file => file.filename) ?? [];
  const author = snapshot?.pullRequest?.author;
  if (!Number.isSafeInteger(author?.id) || author.id <= 0 || !text(author?.login)) blockers.push('Authenticated PR author identity is missing');
  const bindingsMatch = value => value && value.head_sha === headSha && value.contract_sha256 === contractSha256 && value.policy_sha256 === policySha256 && sameScope(value.reviewed_scope, paths);
  const records = [...(snapshot?.reviews ?? []), ...(snapshot?.comments ?? [])].filter(row => assessRetention({ createdAt: row.submitted_at ?? row.created_at, now }).status === 'AVAILABLE');
  const owner = records.find(row => ownerLogins.includes(row.user?.login) && row.user?.type === 'User' && Number.isSafeInteger(row.user?.id) && row.user.id > 0 && bindingsMatch(attestation(row.body)) && attestation(row.body).owner_signoff === true);
  const latest = new Map();
  for (const review of [...(snapshot?.reviews ?? [])].sort((a, b) => time(a.submitted_at) - time(b.submitted_at) || a.id - b.id)) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user?.id, review);
  }
  const independent = [...latest.values()].filter(review => review.state === 'APPROVED' && review.commit_id === headSha && Number.isSafeInteger(review.user?.id) && review.user.id > 0 && review.user?.id !== author?.id && review.user?.login !== author?.login && review.user?.type === 'User' && (allowedReviewers.includes(review.user.login) || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(review.author_association)) && bindingsMatch(attestation(review.body)) && assessRetention({ createdAt: review.submitted_at, now }).status === 'AVAILABLE');
  if ([...latest.values()].some(review => review.state === 'CHANGES_REQUESTED')) blockers.push('Blocking change request remains');
  if (!independent.length) blockers.push('Independent exact-head approval with frozen contract, policy and scope is missing');
  const findings = independent.flatMap(review => (Array.isArray(attestation(review.body)?.findings) ? attestation(review.body).findings : []).map(finding => ({ ...finding, reviewer: review.user.login, reviewId: review.id })));
  if (independent.some(review => !Array.isArray(attestation(review.body)?.findings))) blockers.push('Independent review must explicitly inventory findings, including an empty list');
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) { blockers.push('Malformed review finding'); continue; }
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(#.*)?$/.test(finding.root_cause_issue ?? '')) blockers.push(`Finding ${finding.id} requires its root-cause issue`);
    if (!text(finding.id) || !['P0', 'P1', 'P2', 'P3'].includes(finding.severity) || !text(finding.owner) || !text(finding.reproduction)) blockers.push('Malformed review finding');
    if (finding.disposition === 'FIXED') {
      if (finding.resolved_head_sha !== headSha || !text(finding.resolution_ref)) blockers.push(`Finding ${finding.id} lacks exact-head resolution`);
    } else if (finding.disposition === 'DEFERRED') {
      if (['P0', 'P1'].includes(finding.severity) || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(#.*)?$/.test(finding.root_cause_issue ?? '')) blockers.push(`Finding ${finding.id} cannot be deferred without a nonblocking root-cause issue`);
    } else blockers.push(`Finding ${finding.id} remains unresolved`);
  }
  return { status: blockers.length ? 'BLOCKED' : 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: owner ? { actor: owner.user.login, id: owner.id, url: owner.html_url } : null, independentReviewers: independent.map(review => ({ actor: review.user.login, id: review.id, url: review.html_url })), findings, blockers: unique(blockers) };
}

/** Reads only the fixed production admin endpoint; credentials never enter returned artifacts. */
export async function collectRuntimeEvidence({ origin = 'https://feeinsight.com', adminCookie, deployedSha, since, until, changeKeys = [], now = new Date(), fetchImpl = trustedFetch }) {
  if (!['https://feeinsight.com', 'https://www.feeinsight.com'].includes(origin) || !SHA.test(deployedSha ?? '') || !text(adminCookie)) throw new Error('Allowed production origin, target SHA and authenticated admin cookie required');
  if (!Number.isFinite(time(since)) || !Number.isFinite(time(until)) || time(until) < time(since)) throw new Error('Bounded observation timestamps required');
  const url = new URL('/api/admin/engineering-verification', origin);
  url.searchParams.set('deployedSha', deployedSha); url.searchParams.set('since', since); url.searchParams.set('until', until);
  changeKeys.forEach(key => url.searchParams.append('changeKey', key));
  const response = await fetchImpl(url.toString(), { method: 'GET', headers: { Cookie: adminCookie, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Runtime evidence endpoint returned ${response.status}`);
  const body = await response.json();
  if (body.schemaVersion !== 1 || body.provenance?.kind !== 'authenticated-admin-ledger' || body.request?.deployedSha !== deployedSha || body.request?.since !== since || body.request?.until !== until) throw new Error('Runtime evidence request identity mismatch');
  const snapshot = freeze({ ...body, transport: { kind: fetchImpl === trustedFetch ? 'authenticated-admin-api' : 'test-transport-untrusted', origin, observedAt: now.toISOString() } });
  if (fetchImpl === trustedFetch) runtimeSources.add(snapshot);
  return snapshot;
}

function validScore(score) {
  if (!score || !['cohortSize', 'scored', 'unscored', 'expected', 'matched', 'predicted', 'correct'].every(key => count(score[key])) || !Array.isArray(score.institutions)) return false;
  if (score.scored + score.unscored !== score.cohortSize || score.institutions.length !== score.cohortSize || score.matched > score.expected || score.correct > score.predicted) return false;
  if (new Set(score.institutions.map(row => row.answerKeyId)).size !== score.cohortSize || new Set(score.institutions.map(row => row.institutionId)).size !== score.cohortSize) return false;
  if (score.institutions.some(row => !['scored', 'unscored'].includes(row.state) || !['answerKeyId', 'institutionId', 'expected', 'matched', 'predicted', 'correct'].every(key => count(row[key])) || row.matched > row.expected || row.correct > row.predicted)) return false;
  const scored = score.institutions.filter(row => row.state === 'scored');
  return scored.length === score.scored && ['expected', 'matched', 'predicted', 'correct'].every(key => scored.reduce((total, row) => total + row[key], 0) === score[key]);
}
const executionMatches = (row, policy) => Number.isSafeInteger(row?.execution?.eventId) && row.execution.eventId > 0 && row.execution.deployedSha === policy.deployedSha && row.execution.environment === policy.environment;
export function assessOperationalEvidence(runtime, policy, { github, now = new Date() } = {}) {
  const blockers = [];
  if (!runtimeSources.has(runtime)) blockers.push('Runtime evidence provenance is not authenticated in this process');
  if (!authenticGithub(github)) blockers.push('Deployment evidence provenance is not authenticated in this process');
  blockers.push(...(runtime?.problems ?? []), ...(github?.problems ?? []));
  if (!SHA.test(policy?.headSha ?? '') || !SHA.test(policy?.deployedSha ?? '') || !text(policy?.environment) || !text(policy?.cohortId) || !count(policy?.scorerVersion) || !count(policy?.protocol)) blockers.push('Scoped deployment, fixed cohort and measurement version policy required');
  if (!['minScoredInstitutions', 'minExpectedFees', 'minPredictedFees'].every(key => count(policy?.[key]) && policy[key] > 0) || !['minPrecision', 'minRecall'].every(key => typeof policy?.[key] === 'number' && policy[key] >= 0 && policy[key] <= 1)) blockers.push('Explicit sample sizes and outcome thresholds required');
  const days = policy?.observationDays ?? 7, gap = policy?.maxSampleGapHours ?? 24;
  if (!(days > 0 && days <= 90 && gap > 0 && gap <= 168)) blockers.push('Observation window and sample cadence invalid');
  if (github && (github.pullRequest?.headSha !== policy.headSha || (policy.environment === 'production' && (!github.pullRequest?.merged || github.pullRequest?.mergeSha !== policy.deployedSha)))) blockers.push('Deployment does not have authenticated PR-head to merged-SHA lineage');
  const activeDeployment = [...(github?.deployments ?? [])].filter(row => row.environment === policy.environment).sort((a, b) => time(b.created_at) - time(a.created_at)).find(row => {
    const latest = [...(row.statuses ?? [])].sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id)[0];
    return latest?.state === 'success' && (!latest.environment || latest.environment === policy.environment);
  });
  const deployment = activeDeployment?.sha === policy.deployedSha ? activeDeployment : null;
  const deployedAt = deployment ? time([...deployment.statuses].sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id)[0].created_at) : NaN;
  if (github && !Number.isFinite(deployedAt)) blockers.push('Successful deployment with exact SHA and environment is missing');
  if (!(runtime?.atlas ?? []).some(row => count(row.runId) && count(row.stepId) && row.status === 'completed' && executionMatches(row, policy))) blockers.push('Completed Atlas execution lineage on deployed SHA and environment missing');
  const samples = [...(runtime?.deming ?? [])].sort((a, b) => time(a.score?.at) - time(b.score?.at));
  if (!samples.length) blockers.push('Deming fixed-cohort observations missing');
  const identities = new Set(), sampleTimes = [];
  for (const sample of samples) {
    const score = sample.score;
    if (sample.runAgent !== 'atlas' || sample.stepKey !== 'score-answer-key' || sample.eventType !== 'deming.fixed_cohort_accuracy' || sample.stepStatus !== 'completed' || !count(sample.eventId) || !count(sample.runId) || !count(sample.stepId) || !executionMatches(sample, policy)) blockers.push('Deming observation lacks exact execution lineage');
    if (!validScore(score)) { blockers.push('Deming observation counts are malformed or do not reconcile'); continue; }
    if (score.cohortId !== policy.cohortId || score.scorerVersion !== policy.scorerVersion || score.protocol !== policy.protocol) blockers.push('Deming cohort or measurement version differs from frozen policy');
    identities.add(score.institutions.map(row => `${row.answerKeyId}:${row.institutionId}:${row.state}`).sort().join('|'));
    if (score.scored < policy.minScoredInstitutions || score.expected < policy.minExpectedFees || score.predicted < policy.minPredictedFees || score.unscored > (policy.maxUnscoredInstitutions ?? 0)) blockers.push('Deming observation has thin or unscored evidence');
    if (!(score.predicted > 0 && score.correct / score.predicted >= policy.minPrecision)) blockers.push('Deming precision threshold not met');
    if (!(score.expected > 0 && score.matched / score.expected >= policy.minRecall)) blockers.push('Deming recall threshold not met');
    const at = time(score.at), eventAt = time(sample.eventAt);
    if (!Number.isFinite(at) || !Number.isFinite(eventAt) || Math.abs(eventAt - at) > 3600000 || at > now.getTime() || (Number.isFinite(deployedAt) && at < deployedAt)) blockers.push('Deming observation timestamp is missing, future or predates deployment');
    else sampleTimes.push(at);
  }
  if (identities.size > 1) blockers.push('Deming fixed-cohort membership changed within the observation window');
  if (!sampleTimes.length || sampleTimes.at(-1) - sampleTimes[0] < days * DAY || (Number.isFinite(deployedAt) && sampleTimes.at(-1) < deployedAt + days * DAY)) blockers.push('Operational observation window is incomplete');
  if (sampleTimes.some((at, i) => i > 0 && at - sampleTimes[i - 1] > gap * 3600000) || (sampleTimes.length && now.getTime() - sampleTimes.at(-1) > gap * 3600000)) blockers.push('Deming observation gap or stale latest sample');
  if (!Array.isArray(policy?.replayChangeKeys)) blockers.push('Explicit replay obligations required (empty list for no replay)');
  for (const key of policy?.replayChangeKeys ?? []) {
    const job = [...(runtime?.bayes ?? [])].filter(row => row.changeKey === key).sort((a, b) => time(b.checkedAt) - time(a.checkedAt) || b.checkId - a.checkId)[0];
    if (!job) { blockers.push(`Bayes ${key} record missing`); continue; }
    if (!executionMatches(job, policy) || job.stepKey !== 'bayes-replay-ledger' || job.stepStatus !== 'completed' || !count(job.checkId) || !count(job.runId) || !count(job.stepId)) blockers.push(`Bayes ${key} execution lineage missing`);
    if (job.status === 'not_counted') blockers.push(`Bayes ${key} is not_counted`);
    if (job.status !== 'closed' || job.queued !== 0 || job.superseded === true || (job.note ?? '').startsWith('superseded by ')) blockers.push(`Bayes ${key} replay incomplete or superseded`);
    if (!['affected', 'done', 'queued', 'excluded'].every(name => count(job[name])) || job.done + job.queued + job.excluded !== job.affected || !job.exclusions || Object.values(job.exclusions).some(value => !count(value)) || Object.values(job.exclusions).reduce((sum, value) => sum + value, 0) !== job.excluded) blockers.push(`Bayes ${key} counts do not reconcile`);
    if (!Number.isFinite(time(job.checkedAt)) || time(job.checkedAt) > now.getTime() || (Number.isFinite(deployedAt) && time(job.checkedAt) < deployedAt) || now.getTime() - time(job.checkedAt) > gap * 3600000) blockers.push(`Bayes ${key} check is stale or predates deployment`);
    for (const [reason, amount] of Object.entries(job.exclusions ?? {})) {
      if (amount <= 0) continue;
      const authorization = (runtime.exclusionAuthorizations ?? []).find(row => row.changeKey === key && row.checkId === job.checkId && row.reason === reason && row.count === amount && row.deployedSha === policy.deployedSha && row.environment === policy.environment && text(row.actorId) && text(row.eventId) && Number.isFinite(time(row.authorizedAt)));
      if (!authorization) blockers.push(`Bayes ${key} exclusion ${reason} lacks independent authorization`);
    }
  }
  return { status: blockers.length ? 'PRODUCTION_UNVERIFIED' : 'PRODUCTION_VERIFIED', deployment: deployment ? { id: deployment.id, sha: deployment.sha, environment: deployment.environment, deployedAt: new Date(deployedAt).toISOString() } : null, observation: { requiredDays: days, sampleDays: unique(sampleTimes.map(at => new Date(at).toISOString().slice(0, 10))).length, sampleCount: samples.length }, blockers: unique(blockers) };
}

const median = values => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const durations = (rows, start, end) => rows.map(row => (time(row[end]) - time(row[start])) / 3600000).filter(value => Number.isFinite(value) && value >= 0);
/** Derived observations only; a metric is not a merge or production-verification gate. */
export function calculateEngineeringMetrics(records) {
  const merged = records.filter(row => Number.isFinite(time(row.mergedAt)) && ['R2', 'R3'].includes(row.riskTier));
  const regressions = records.filter(row => row.regression).map(row => row.regression);
  const regressionProblems = regressions.flatMap(row => !text(row.id) || !text(row.owner) || !SHA.test(row.deployedSha ?? '') || !count(row.affectedUnits) || !text(row.rootCause) || !text(row.rollbackDisposition) ? ['Regression is missing identity, deployed SHA, owner, affected units, root cause or rollback disposition'] : []);
  const rootCounts = new Map(); regressions.forEach(row => { if (text(row.rootCause)) rootCounts.set(row.rootCause, (rootCounts.get(row.rootCause) ?? 0) + 1); });
  const overhead = records.filter(row => typeof row.baselineCiSeconds === 'number' && row.baselineCiSeconds > 0 && typeof row.ciSeconds === 'number' && row.ciSeconds >= 0).map(row => (row.ciSeconds - row.baselineCiSeconds) / row.baselineCiSeconds);
  const blocked = records.filter(row => row.proofStatus === 'BLOCKED');
  return { status: 'DESCRIPTIVE_INPUT_UNTRUSTED', eligibleRiskTiers: ['R2', 'R3'], missingRiskTier: records.filter(row => !['R0', 'R1', 'R2', 'R3'].includes(row.riskTier)).length, mergedChanges: merged.length, verificationCoverage: merged.length ? merged.filter(row => row.proofStatus === 'VERIFIED').length / merged.length : null, recurrenceCount: [...rootCounts.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0), regressionCount: regressions.length, reviewLatencyMedianHours: median(durations(records, 'openedAt', 'reviewedAt')), productionVerificationLagMedianHours: median(durations(records, 'deployedAt', 'productionVerifiedAt')), ciOverheadMedian: median(overhead), ciOverheadTarget: 0.15, ciOverheadSampleCount: overhead.length, falseBlockRate: blocked.length ? blocked.filter(row => row.falseBlockConfirmed === true && text(row.falseBlockReviewRef)).length / blocked.length : null, problems: unique(regressionProblems) };
}
export function renderEvidenceSummary({ proof = null, ci = null, review = null, operational = null, metrics = null, artifacts = [] }) {
  const lines = ['# Engineering verification evidence', ''];
  for (const [name, result] of [['Behavioral proof', proof], ['Existing CI', ci], ['Independent review', review], ['Operational outcomes', operational]]) {
    lines.push(`## ${name}`, '', `Status: **${result?.status ?? 'UNKNOWN'}**`, '');
    for (const problem of result?.blockers ?? result?.problems ?? []) lines.push(`- ${String(problem).replace(/[\r\n]/g, ' ')}`);
    lines.push('');
  }
  if (metrics) lines.push('## Derived metrics', '', '```json', JSON.stringify(metrics, null, 2), '```', '');
  if (artifacts.length) lines.push('## Artifact retention', '', ...artifacts.map(item => `- ${item.name}: ${item.retention?.status ?? 'UNKNOWN'} (90 day retention)`));
  lines.push('', 'Owner sign-off and independent GitHub approval are separate. Missing production evidence remains PRODUCTION_UNVERIFIED.');
  return lines.join('\n');
}
