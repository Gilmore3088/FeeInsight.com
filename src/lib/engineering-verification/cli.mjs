import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, realpathSync, lstatSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { changedPaths, classifyChange, contractDigest, routeSkillRequirements } from './contract.mjs';
import { frozenIdentities } from './runner.mjs';
import { collectGithubEvidence } from './github.mjs';
import { collectProofEvidence, assessCollectedProof, validateRevisionContract } from './proof.mjs';
import { assessReviewEvidence, collectRuntimeEvidence, assessOperationalEvidence, renderEvidenceSummary, calculateEngineeringMetrics } from './evidence.mjs';
import { validateProgram } from './program.mjs';
import { assessChangedScope } from './scope.mjs';
import { resolveWorkflowRun } from './events.mjs';
import { collectScorecard, assessScorecard, renderScorecard } from './scorecard.mjs';
import { CONTRACT_REVISIONS, resolveContractRevision, parseContractMarker } from './contract-registry.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const REPOSITORY = 'Gilmore3088/FeeInsight.com';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
function options(args) {
  if (args.length % 2) throw new Error('Options must be named value pairs');
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || Object.hasOwn(result, args[i].slice(2))) throw new Error('Invalid or duplicate option');
    result[args[i].slice(2)] = args[i + 1];
  }
  return result;
}
function contractAt(root, key) {
  const revision = resolveContractRevision(key);
  const path = revision.path;
  const canonicalRoot = realpathSync(resolve(root));
  let actual = canonicalRoot, selected;
  for (const [index, part] of path.split('/').entries()) {
    actual = join(actual, part);
    const metadata = lstatSync(actual);
    if (metadata.isSymbolicLink() || (index < path.split('/').length - 1 ? !metadata.isDirectory() : !metadata.isFile())) throw new Error('Registered contract path must contain only canonical regular files/directories');
    selected = metadata;
  }
  const canonical = realpathSync(actual), within = relative(canonicalRoot, canonical);
  if (canonical !== actual || within.startsWith('..' + sep) || within === '..' || within !== path) throw new Error('Registered contract path escapes its canonical repository location');
  let raw;
  const descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== selected.dev || opened.ino !== selected.ino || opened.size > 2 * 1024 * 1024) throw new Error('Registered contract identity changed before its bounded read');
    raw = readFileSync(descriptor, 'utf8');
  } finally { closeSync(descriptor); }
  const contract = JSON.parse(raw);
  const verdict = validateRevisionContract(revision, contract, raw);
  if (!verdict.ok) throw new Error(verdict.errors.join('; '));
  return { path, raw, contract, revision };
}
const output = (directory, name, data) => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = args;
  const opts = options(rest);
  // An explicit selector cannot trigger even a metadata read before its trusted mapping resolves.
  const requestedRevision = opts.contract == null ? null : resolveContractRevision(opts.contract);
  if (command === 'prepare' && requestedRevision) resolveContractRevision(requestedRevision.key, { requireRunnable: true });
  const policyRaw = readFileSync(join(root, 'src/lib/engineering-verification/policy.json'), 'utf8');
  const policy = JSON.parse(policyRaw);
  if (command === 'validate') {
    const program = validateProgram(root);
    const contractRevisions = CONTRACT_REVISIONS.map(revision => {
      const { contract, raw } = contractAt(root, revision.key);
      if (revision.executionStatus === 'CURRENT') frozenIdentities(root, contract);
      if (contractAt(root, revision.key).raw !== raw) throw new Error('Frozen contract changed during validation');
      return { key: revision.key, contractId: contract.contract_id, path: revision.path, executionStatus: revision.executionStatus, currentCodeVerified: false };
    });
    const contracts = contractRevisions.map(revision => revision.contractId);
    const result = { ...program, contracts, contractRevisions, operationalStatus: 'PRODUCTION_UNVERIFIED', enforcementEnabled: policy.enforcement_enabled === true };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (program.status !== 'PLAN_TRACEABLE') process.exitCode = 1;
    return result;
  }
  if (command === 'inventory') {
    const available = readdirSync(join(root, '.claude/skills')).filter(name => existsSync(join(root, '.claude/skills', name, 'SKILL.md')));
    const paths = ['atlas','magellan','rosetta','knox','darwin','hamilton','hoovie','deming','bayes','growth'].map(agent => 'src/lib/agents/' + agent + '/');
    const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), availableSkills: available.sort(), routes: paths.map(path => ({ path, ...routeSkillRequirements([path], available) })), controls: { enforcement: policy.enforcement_enabled, paidProviderActivated: false, newProductionTables: false }, ciBaseline: json(join(root, 'docs/project/acceptance/engineering/baseline.json')) };
    if (opts.output) output(resolve(opts.output), 'inventory.json', result);
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Authenticated read token required in GH_TOKEN or GITHUB_TOKEN');
  if (command === 'scorecard') {
    const values = opts.prs?.split(',');
    if (!values?.length || values.some(value => !/^[1-9][0-9]*$/.test(value))) throw new Error('Provide --prs as 1–20 comma-separated PR numbers');
    const directory = resolve(opts.output ?? 'test-results/engineering-verification/scorecard');
    let snapshot;
    try { snapshot = await collectScorecard({ prNumbers: values.map(Number), token }); }
    catch (error) {
      const reason = String(error?.message ?? 'Trusted scorecard collection unavailable').replaceAll(token, '[redacted]').slice(0, 4096);
      const result = { schemaVersion: 1, status: 'BLOCKED', provenance: 'COLLECTION_FAILED', prNumbers: values.map(Number), metrics: null, problems: [reason] };
      output(directory, 'scorecard.json', result);
      output(directory, 'summary.md', '# Engineering scorecard\n\nStatus: BLOCKED\n\n' + reason + '\n');
      process.stdout.write(JSON.stringify(result) + '\n');
      return result;
    }
    const assessment = assessScorecard(snapshot);
    output(directory, 'scorecard.json', { ...snapshot, assessment });
    output(directory, 'summary.md', renderScorecard(snapshot));
    process.stdout.write(JSON.stringify({ status: assessment.status, changes: snapshot.changes.length, problems: assessment.problems }) + '\n');
    return assessment;
  }
  if (command === 'resolve-run') {
    const result = await resolveWorkflowRun({ runId: Number(opts.run), token });
    if (opts.output) output(resolve(opts.output), 'event.json', result);
    if (process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_OUTPUT, 'resolved=' + result.resolved + '\npr_number=' + (result.prNumber ?? '') + '\ncontract_key=' + (result.contractKey ?? '') + '\n');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  const prNumber = Number(opts.pr);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Positive --pr number required');
  const directory = resolve(opts.output ?? 'test-results/engineering-verification/audit');
  const github = await collectGithubEvidence({ repository: REPOSITORY, prNumber, token, requiredChecks: policy.required_checks,
    includeDeployments: command === 'audit' && Boolean(opts['operational-policy']) });
  const marked = parseContractMarker(github.pullRequest.body);
  const revision = requestedRevision ?? marked;
  if (revision.key !== marked.key) throw new Error('Explicit contract revision differs from the authenticated PR marker');
  const { contract, raw, path: contractPath } = contractAt(root, revision.key);
  const inventory = changedPaths(github.files);
  const paths = inventory.paths;
  const actualRisk = inventory.problems.length
    ? { risk_tier: 'R3', policy_sensitive: true, reasons: inventory.problems }
    : classifyChange(paths);
  if (command === 'prepare') {
    if (inventory.problems.length) throw new Error(inventory.problems.join('; '));
    if (github.problems.some(problem => /head changed/.test(problem))) throw new Error('Head changed during preparation');
    if (!/^[a-f0-9]{40}$/.test(github.pullRequest.headSha)) throw new Error('Exact PR head unavailable');
    resolveContractRevision(revision.key, { requireRunnable: true });
    frozenIdentities(root, contract);
    if (contractAt(root, revision.key).raw !== raw) throw new Error('Frozen contract changed during preparation');
    const result = { prNumber, contractKey: revision.key, executionStatus: revision.executionStatus, headSha: github.pullRequest.headSha, baseSha: contract.base_sha, contractPath, contractSha256: contractDigest(raw), actualRisk, actualChangedPaths: paths };
    output(directory, 'inputs.json', result);
    if (process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_OUTPUT, 'head_sha=' + result.headSha + '\nbase_sha=' + result.baseSha + '\ncontract_key=' + result.contractKey + '\n');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  if (command !== 'audit') throw new Error('Supported commands: validate, inventory, prepare, audit, resolve-run, scorecard');
  const proofSnapshot = await collectProofEvidence({ github, contract, contractRaw: raw, contractKey: revision.key, token });
  const proof = assessCollectedProof(proofSnapshot);
  if (revision.executionStatus !== 'CURRENT') proof.blockers.push('Historical contract evidence cannot verify current code; select an explicitly reviewed runnable successor revision');
  const review = assessReviewEvidence(github, { headSha: github.pullRequest.headSha, contractSha256: contractDigest(raw), policySha256: hash(policyRaw), allowedReviewers: policy.allowed_reviewers, ownerLogins: policy.owner_logins });
  review.blockers.push(...inventory.problems, ...assessChangedScope(contract, paths).problems);
  const availableSkills = readdirSync(join(root, '.claude/skills')).filter(name => existsSync(join(root, '.claude/skills', name, 'SKILL.md')));
  for (const skill of routeSkillRequirements(paths, availableSkills).unavailable_skills) review.blockers.push('Required skill unavailable: ' + skill);
  if (actualRisk.risk_tier > contract.risk_tier) review.blockers.push('Contract understates actual changed-path risk');
  const ownerRequired = contract.human_approval_required === true || actualRisk.risk_tier === 'R3';
  const ownerAuthorized = !ownerRequired || review.ownerSignoff != null;
  if (!ownerAuthorized) review.blockers.push('Required owner authorization for R3 risk or contract approval is missing');
  if (review.blockers.length) review.status = 'BLOCKED';
  let operational = { status: 'PRODUCTION_UNVERIFIED', blockers: ['No frozen operational policy and authenticated runtime observation supplied'] };
  if (opts['operational-policy']) {
    const operationalRaw = readFileSync(resolve(opts['operational-policy']), 'utf8');
    const operationalPolicy = JSON.parse(operationalRaw);
    if (!contract.operational_policy_sha256 || hash(operationalRaw) !== contract.operational_policy_sha256) throw new Error('Operational policy is not frozen by the reviewed contract');
    if (!process.env.ENGINEERING_ADMIN_COOKIE) throw new Error('Authenticated admin cookie required in ENGINEERING_ADMIN_COOKIE');
    const runtime = await collectRuntimeEvidence({ adminCookie: process.env.ENGINEERING_ADMIN_COOKIE, deployedSha: operationalPolicy.deployedSha,
      since: operationalPolicy.since, until: operationalPolicy.until, changeKeys: operationalPolicy.replayChangeKeys, requiredExecution: operationalPolicy.requiredExecution });
    operational = assessOperationalEvidence(runtime, operationalPolicy, { github });
  }
  // A runtime read can take time: independently reread exact PR identity before publishing a result.
  try {
    const response = await fetch('https://api.github.com/repos/' + REPOSITORY + '/pulls/' + prNumber, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('PR head could not be rechecked before finalization');
    const current = await response.json();
    if (current.head?.sha !== github.pullRequest.headSha) throw new Error('PR head changed before finalization');
    if (parseContractMarker(current.body).key !== revision.key) throw new Error('PR contract revision changed before finalization');
  } catch {
    proof.status = 'BLOCKED'; proof.currentCodeVerified = false;
    proof.blockers = [...(proof.blockers ?? []), 'PR head or contract marker/revision changed or could not be rechecked before finalization'];
  }
  try { if (contractAt(root, revision.key).raw !== raw) throw new Error('Frozen contract changed before finalization'); }
  catch (error) { review.blockers.push(error instanceof Error ? error.message : 'Frozen contract source recheck unavailable'); review.status = 'BLOCKED'; }
  const codeReady = revision.executionStatus === 'CURRENT' && proof.currentCodeVerified === true && proof.status === 'VERIFIED' && github.ci.status === 'PASSED' && review.status === 'INDEPENDENT_REVIEW_VERIFIED' && ownerAuthorized;
  const audit = { schemaVersion: 1, repository: REPOSITORY, prNumber, contractKey: revision.key, executionStatus: revision.executionStatus, currentCodeVerified: codeReady, headSha: github.pullRequest.headSha, contractPath, contractSha256: contractDigest(raw), policySha256: hash(policyRaw), actualRisk, actualChangedPaths: paths,
    status: codeReady ? 'CODE_VERIFIED' : 'BLOCKED', enforcementEnabled: policy.enforcement_enabled === true, proof, ci: github.ci, review, operational,
    authorization: actualRisk.risk_tier === 'R3' ? 'SEPARATE_OWNER_AUTHORIZATION_REQUIRED' : 'EXISTING_REPOSITORY_MERGE_RULES_APPLY' };
  const metrics = calculateEngineeringMetrics([{ riskTier: actualRisk.risk_tier, mergedAt: github.pullRequest.mergedAt, proofStatus: proof.status }]);
  output(directory, 'audit.json', audit);
  output(directory, 'summary.md', renderEvidenceSummary({ proof, ci: github.ci, review, operational, metrics }) + '\n\nActual risk: ' + actualRisk.risk_tier + '. Authorization: ' + audit.authorization + '. Enforcement enabled: ' + audit.enforcementEnabled + '.\n');
  if (opts.publish === 'true') {
    if (!policy.enforcement_enabled || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Check publication is disabled until separately authorized main policy activation');
    const post = await fetch('https://api.github.com/repos/' + REPOSITORY + '/check-runs', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'engineering-verification', head_sha: audit.headSha, status: 'completed', conclusion: codeReady ? 'success' : 'failure',
        output: { title: audit.status, summary: readFileSync(join(directory, 'summary.md'), 'utf8').slice(0, 60000) } }),
    });
    if (!post.ok) throw new Error('GitHub check publication failed: ' + post.status);
  }
  process.stdout.write(JSON.stringify({ status: audit.status, headSha: audit.headSha, proof: proof.status, review: review.status, operational: operational.status }) + '\n');
  if (!codeReady && opts.publish === 'true') process.exitCode = 1;
  return audit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write('BLOCKED: ' + error.message + '\n'); process.exitCode = 1; });
}
