import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { classifyChange, contractDigest, validateContract, routeSkillRequirements } from './contract.mjs';
import { frozenIdentities } from './runner.mjs';
import { collectGithubEvidence } from './github.mjs';
import { collectProofEvidence, assessCollectedProof } from './proof.mjs';
import { assessReviewEvidence, collectRuntimeEvidence, assessOperationalEvidence, renderEvidenceSummary, calculateEngineeringMetrics } from './evidence.mjs';
import { validateProgram } from './program.mjs';
import { assessChangedScope } from './scope.mjs';
import { resolveWorkflowRun } from './events.mjs';
import { collectScorecard, assessScorecard, renderScorecard } from './scorecard.mjs';

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
function contractAt(root, number) {
  if (!/^[1-9][0-9]*$/.test(number)) throw new Error('Numeric contract issue required');
  const path = 'docs/project/acceptance/engineering/' + number + '.json';
  const raw = readFileSync(join(root, path), 'utf8');
  const contract = JSON.parse(raw);
  const verdict = validateContract(contract);
  if (!verdict.ok) throw new Error(verdict.errors.join('; '));
  return { path, raw, contract };
}
const output = (directory, name, data) => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};

export async function main(args = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = args;
  const opts = options(rest);
  const policyRaw = readFileSync(join(root, 'src/lib/engineering-verification/policy.json'), 'utf8');
  const policy = JSON.parse(policyRaw);
  if (command === 'validate') {
    const program = validateProgram(root);
    const contracts = readdirSync(join(root, 'docs/project/acceptance/engineering')).filter(name => /^\d+\.json$/.test(name)).map(name => {
      const { contract } = contractAt(root, name.slice(0, -5));
      frozenIdentities(root, contract);
      return contract.contract_id;
    });
    const result = { ...program, contracts, operationalStatus: 'PRODUCTION_UNVERIFIED', enforcementEnabled: policy.enforcement_enabled === true };
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
    const snapshot = await collectScorecard({ prNumbers: values.map(Number), token });
    const assessment = assessScorecard(snapshot);
    const directory = resolve(opts.output ?? 'test-results/engineering-verification/scorecard');
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
      appendFileSync(process.env.GITHUB_OUTPUT, 'resolved=' + result.resolved + '\npr_number=' + (result.prNumber ?? '') + '\ncontract_number=' + (result.contractNumber ?? '') + '\n');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  const prNumber = Number(opts.pr);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Positive --pr number required');
  const directory = resolve(opts.output ?? 'test-results/engineering-verification/audit');
  const github = await collectGithubEvidence({ repository: REPOSITORY, prNumber, token, requiredChecks: policy.required_checks });
  const contractNumber = opts.contract ?? github.pullRequest.body?.match(/<!--\s*engineering-contract:\s*([1-9][0-9]*)\s*-->/)?.[1];
  if (!contractNumber) throw new Error('PR needs an explicit engineering-contract marker; a historical pilot cannot substitute for its acceptance contract');
  const { contract, raw, path: contractPath } = contractAt(root, contractNumber);
  const actualRisk = classifyChange(github.files.map(file => file.filename));
  if (command === 'prepare') {
    if (github.problems.some(problem => /head changed/.test(problem))) throw new Error('Head changed during preparation');
    if (!/^[a-f0-9]{40}$/.test(github.pullRequest.headSha)) throw new Error('Exact PR head unavailable');
    frozenIdentities(root, contract);
    const result = { prNumber, headSha: github.pullRequest.headSha, baseSha: contract.base_sha, contractPath, contractSha256: contractDigest(raw), actualRisk };
    output(directory, 'inputs.json', result);
    if (process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_OUTPUT, 'head_sha=' + result.headSha + '\nbase_sha=' + result.baseSha + '\n');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }
  if (command !== 'audit') throw new Error('Supported commands: validate, inventory, prepare, audit, resolve-run, scorecard');
  const proofSnapshot = await collectProofEvidence({ github, contract, contractRaw: raw, token });
  const proof = assessCollectedProof(proofSnapshot);
  const review = assessReviewEvidence(github, { headSha: github.pullRequest.headSha, contractSha256: contractDigest(raw), policySha256: hash(policyRaw), allowedReviewers: policy.allowed_reviewers, ownerLogins: policy.owner_logins });
  review.blockers.push(...assessChangedScope(contract, github.files.map(file => file.filename)).problems);
  const availableSkills = readdirSync(join(root, '.claude/skills')).filter(name => existsSync(join(root, '.claude/skills', name, 'SKILL.md')));
  for (const skill of routeSkillRequirements(github.files.map(file => file.filename), availableSkills).unavailable_skills) review.blockers.push('Required skill unavailable: ' + skill);
  if (actualRisk.risk_tier > contract.risk_tier) review.blockers.push('Contract understates actual changed-path risk');
  if (review.blockers.length) review.status = 'BLOCKED';
  let operational = { status: 'PRODUCTION_UNVERIFIED', blockers: ['No frozen operational policy and authenticated runtime observation supplied'] };
  if (opts['operational-policy']) {
    const operationalRaw = readFileSync(resolve(opts['operational-policy']), 'utf8');
    const operationalPolicy = JSON.parse(operationalRaw);
    if (!contract.operational_policy_sha256 || hash(operationalRaw) !== contract.operational_policy_sha256) throw new Error('Operational policy is not frozen by the reviewed contract');
    if (!process.env.ENGINEERING_ADMIN_COOKIE) throw new Error('Authenticated admin cookie required in ENGINEERING_ADMIN_COOKIE');
    const runtime = await collectRuntimeEvidence({ adminCookie: process.env.ENGINEERING_ADMIN_COOKIE, deployedSha: operationalPolicy.deployedSha,
      since: operationalPolicy.since, until: operationalPolicy.until, changeKeys: operationalPolicy.replayChangeKeys });
    operational = assessOperationalEvidence(runtime, operationalPolicy, { github });
  }
  // A runtime read can take time: independently reread exact PR identity before publishing a result.
  const response = await fetch('https://api.github.com/repos/' + REPOSITORY + '/pulls/' + prNumber, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok || (await response.json()).head?.sha !== github.pullRequest.headSha) {
    proof.status = 'BLOCKED'; proof.blockers = [...(proof.blockers ?? []), 'PR head changed or could not be rechecked before finalization'];
  }
  const codeReady = proof.status === 'VERIFIED' && github.ci.status === 'PASSED' && review.status === 'INDEPENDENT_REVIEW_VERIFIED';
  const audit = { schemaVersion: 1, repository: REPOSITORY, prNumber, headSha: github.pullRequest.headSha, contractPath, contractSha256: contractDigest(raw), policySha256: hash(policyRaw), actualRisk,
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
