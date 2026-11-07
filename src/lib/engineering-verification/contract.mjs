/**
 * Fee Insight engineering verification M0/M1 — pure, zero-write policy/receipt utilities.
 * This module does not query GitHub, run tests, approve a PR or touch production data.
 * Never treat author-supplied JSON as trusted CI evidence.
 */
import { createHash } from 'node:crypto';

const TIERS = ['R0', 'R1', 'R2', 'R3'];
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const ID = /^[A-Z][A-Z0-9-]{2,79}$/;
const NONEMPTY = value => typeof value === 'string' && value.trim().length > 0;

export function contractDigest(rawText) {
  return createHash('sha256').update(rawText, 'utf8').digest('hex');
}

export function isPolicySensitive(path) {
  return /(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(path)
    || path.startsWith('.claude/skills/')
    || path.startsWith('.agents/skills/')
    || path.startsWith('.github/')
    || path.startsWith('docs/project/acceptance/engineering/')
    || path.startsWith('src/lib/engineering-verification/')
    || path === 'scripts/ci-guards.sh';
}

export function classifyPath(path) {
  if (!NONEMPTY(path)) return 'R3'; // An unknown path cannot safely be assumed inert.
  if (/^(supabase\/migrations\/|src\/app\/api\/auth\/|src\/lib\/auth|src\/lib\/payment|src\/lib\/stripe|src\/lib\/billing|src\/lib\/api-hardening\/)/.test(path)
    || /(^|\/)(\.env[^/]*|secrets?[^/]*|permissions?[^/]*|CODEOWNERS)$/.test(path)
    || path.startsWith('.github/workflows/')
    || /\.sql$/i.test(path)) return 'R3';
  if (isPolicySensitive(path)
    || /^src\/lib\/(agents\/|data-store\/|fee-|custom-report\/|hamilton\/|engineering-verification\/)/.test(path)
    || /^src\/app\/api\/admin\//.test(path)) return 'R2';
  if (/\.mdx?$/i.test(path) || path.startsWith('docs/')) return 'R0';
  return 'R1';
}

export function classifyChange(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { risk_tier: 'R3', policy_sensitive: true, reasons: ['No changed paths supplied'] };
  }
  const risk_tier = paths.map(classifyPath).reduce((max, tier) => TIERS.indexOf(tier) > TIERS.indexOf(max) ? tier : max, 'R0');
  return { risk_tier, policy_sensitive: paths.some(isPolicySensitive), reasons: paths.map(path => `${path}: ${classifyPath(path)}`) };
}

const SKILL_ROUTES = [
  [/src\/lib\/agents\/rosetta\//, ['tdd', 'adversarial-document-testing']],
  [/src\/lib\/agents\/knox\//, ['tdd', 'adversarial-document-testing', 'error-to-test']],
  [/src\/lib\/agents\/darwin\//, ['source-evidence-audit', 'fee-taxonomy-regression', 'tdd']],
  [/src\/lib\/agents\/magellan\//, ['source-evidence-audit', 'tdd', 'diagnosing-bugs']],
  [/src\/lib\/agents\/deming\//, ['data-quality-audit', 'error-to-test']],
  [/src\/lib\/agents\/bayes\//, ['audit-data', 'recover']],
  [/src\/lib\/agents\/atlas\//, ['diagnosing-bugs', 'recover']],
  [/src\/lib\/agents\/hamilton\//, ['report-reconciliation', 'fee-evaluation']],
];

export function routeSkills(paths) {
  const skills = new Set();
  for (const path of paths) {
    for (const [pattern, names] of SKILL_ROUTES) if (pattern.test(path)) names.forEach(skill => skills.add(skill));
  }
  return [...skills].sort();
}

/** Validates a declarative contract, not any claimed result or runtime state. */
export function validateContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return { ok: false, errors: ['Contract must be an object'] };
  if (contract.schema_version !== '1.0') errors.push('schema_version must equal 1.0');
  if (!ID.test(contract.contract_id ?? '')) errors.push('contract_id must be a stable uppercase ID');
  if (!/^#\d+$/.test(contract.issue ?? '')) errors.push('issue must be a GitHub issue number (#123)');
  if (!TIERS.includes(contract.risk_tier)) errors.push('risk_tier must be R0, R1, R2 or R3');
  if (!SHA40.test(contract.base_sha ?? '')) errors.push('base_sha must be a 40-character commit SHA');
  if (!Array.isArray(contract.scope) || contract.scope.length === 0 || contract.scope.some(path => !NONEMPTY(path) || path.startsWith('/') || path.includes('..'))) errors.push('scope must contain safe repo-relative path patterns');
  if (!Array.isArray(contract.required_skills) || contract.required_skills.some(skill => !NONEMPTY(skill))) errors.push('required_skills must be string array');
  if (contract.production_boundary !== 'NO_PROD_MUTATION') errors.push('MVP production_boundary must be NO_PROD_MUTATION');
  if (typeof contract.human_approval_required !== 'boolean') errors.push('human_approval_required must be boolean');
  const requirements = contract.requirements;
  if (!Array.isArray(requirements) || (TIERS.indexOf(contract.risk_tier) >= 2 && requirements.length === 0)) errors.push('R2/R3 require at least one acceptance requirement');
  const requirementIds = new Set();
  const testIds = new Set();
  for (const [i, req] of (Array.isArray(requirements) ? requirements : []).entries()) {
    if (!req || typeof req !== 'object') { errors.push(`requirements[${i}] must be object`); continue; }
    if (!ID.test(req.id ?? '') || requirementIds.has(req.id)) errors.push(`requirements[${i}].id missing/duplicate`);
    requirementIds.add(req.id);
    if (!NONEMPTY(req.behavior)) errors.push(`requirements[${i}].behavior missing`);
    if (!NONEMPTY(req.authority)) errors.push(`requirements[${i}].authority missing`);
    if (!NONEMPTY(req.test_id) || testIds.has(req.test_id)) errors.push(`requirements[${i}].test_id missing/duplicate`);
    testIds.add(req.test_id);
    if (!NONEMPTY(req.test_path) || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(req.test_path)) errors.push(`requirements[${i}].test_path must name an existing-style test file`);
    if (TIERS.indexOf(contract.risk_tier) >= 2 && !NONEMPTY(req.failure_signature)) errors.push(`requirements[${i}].failure_signature missing`);
    if (req.fixture_sha256 != null && !SHA256.test(req.fixture_sha256)) errors.push(`requirements[${i}].fixture_sha256 invalid`);
  }
  if (Array.isArray(contract.scope) && contract.scope.length && TIERS.includes(contract.risk_tier)) {
    const inferred = classifyChange(contract.scope);
    if (TIERS.indexOf(contract.risk_tier) < TIERS.indexOf(inferred.risk_tier)) errors.push(`Risk down-classification: scope requires ${inferred.risk_tier}`);
    if (Array.isArray(contract.required_skills)) {
      for (const skill of routeSkills(contract.scope)) {
        if (!contract.required_skills.includes(skill)) errors.push(`Missing required routed skill: ${skill}`);
      }
    }
  }
  if (contract.risk_tier === 'R3' && contract.human_approval_required !== true) errors.push('R3 requires explicit human approval');
  return { ok: errors.length === 0, errors };
}

const FAILURE_KINDS = new Set(['ASSERTION_FAILURE', 'SETUP_FAILURE', 'TIMEOUT', 'MISSING_DEPENDENCY', 'NETWORK_FAILURE', 'UNKNOWN']);
/**
 * Parses structural properties of a RED/GREEN pair. This is never an authorization
 * verdict: GitHub must independently corroborate runner, commit, logs and checks.
 */
export function assessProofPair(contract, pair, currentHeadSha, expectedContractSha256) {
  const problems = [];
  const validated = validateContract(contract);
  problems.push(...validated.errors);
  const red = pair?.red ?? {};
  const green = pair?.green ?? {};
  if (!SHA40.test(currentHeadSha ?? '')) problems.push('Current head SHA missing');
  if (!SHA256.test(expectedContractSha256 ?? '')) problems.push('Frozen contract SHA256 missing');
  if (red.base_sha !== contract?.base_sha) problems.push('RED did not run on frozen baseline SHA');
  if (green.head_sha !== currentHeadSha) problems.push('GREEN did not run on exact current head SHA');
  if (red.contract_sha256 !== expectedContractSha256 || green.contract_sha256 !== expectedContractSha256) problems.push('Contract identity drift');
  if (!SHA256.test(red.test_sha256 ?? '') || red.test_sha256 !== green.test_sha256) problems.push('Test code hash missing/mismatched');
  if (!SHA256.test(red.fixture_sha256 ?? '') || red.fixture_sha256 !== green.fixture_sha256) problems.push('Fixture hash missing/mismatched');
  if (!NONEMPTY(red.test_id) || red.test_id !== green.test_id) problems.push('Test ID missing/mismatched');
  if (!NONEMPTY(red.command) || red.command !== green.command) problems.push('RED and GREEN must use the same targeted command');
  if (!NONEMPTY(red.artifact_url) || !NONEMPTY(green.artifact_url)) problems.push('Run log artifact URLs required');
  if (!Number.isInteger(red.exit_code) || red.exit_code === 0) problems.push('RED must exit nonzero');
  if (!FAILURE_KINDS.has(red.failure_kind) || red.failure_kind !== 'ASSERTION_FAILURE') problems.push('RED must be behavioral assertion failure, not setup/timeout/network');
  if (green.exit_code !== 0 || green.status !== 'PASSED') problems.push('GREEN must have zero exit and PASSED status');
  const req = contract?.requirements?.find(item => item.test_id === red.test_id);
  if (!req) problems.push('RED test ID does not map to a contract requirement');
  else if (!NONEMPTY(red.failure_log_excerpt) || !red.failure_log_excerpt.includes(req.failure_signature)) problems.push('RED log does not match expected assertion signature');
  if (Array.isArray(green.required_checks) && green.required_checks.length > 0) {
    if (!green.required_checks.some(check => check.name === 'app-tests')) problems.push('Required app-tests aggregate missing');
    for (const check of green.required_checks) if (check.conclusion !== 'success') problems.push(`Required check ${check.name ?? 'unknown'} not successful: ${check.conclusion ?? 'missing'}`);
  } else problems.push('GREEN required_checks inventory missing');
  return { status: problems.length ? 'BLOCKED' : 'STRUCTURALLY_VALID_UNTRUSTED', problems };
}

/** Production verification is intentionally orthogonal to engineering GREEN. */
export function assessProductionEvidence(evidence) {
  const blockers = [];
  if (!SHA40.test(evidence?.deployed_sha ?? '') || !NONEMPTY(evidence?.environment)) blockers.push('Deployment SHA and environment absent');
  if (!NONEMPTY(evidence?.atlas_run_id)) blockers.push('Atlas execution lineage missing');
  if (!NONEMPTY(evidence?.deming?.run_id) || !NONEMPTY(evidence?.deming?.cohort_id) || !NONEMPTY(evidence?.deming?.measurement_version) || evidence?.deming?.verdict !== 'PASS') blockers.push('Independent Deming observation missing, nonpassing or unscoped');
  if (evidence?.replay_required) {
    const r = evidence.bayes;
    if (!r || !NONEMPTY(r.manifest_key) || !['affected', 'done', 'queued', 'excluded', 'not_counted'].every(k => Number.isSafeInteger(r[k]) && r[k] >= 0)) {
      blockers.push('Bayes replay manifest/counts missing or malformed');
    } else {
      if (r.done + r.queued + r.excluded + r.not_counted !== r.affected) blockers.push('Bayes replay counts do not reconcile');
      if (r.queued > 0 || r.not_counted > 0) blockers.push('Bayes replay incomplete');
      if (r.excluded > 0 && r.exclusions_authorized !== true) blockers.push('Bayes exclusions lack independent authorization');
    }
  }
  // A caller must separately attest that these records came from authentic, read-only runtimes.
  // A JSON object supplied by a builder cannot declare its own production verification.
  return { status: blockers.length ? 'PRODUCTION_UNVERIFIED' : 'OPERATIONAL_EVIDENCE_CANDIDATE_UNTRUSTED', blockers };
}

/** No Markdown-only shortcut for protected policy, skills, CI or contract changes. */
export function mayUseDocsOnlyFastPath(changedPaths) {
  return Array.isArray(changedPaths)
    && changedPaths.length > 0
    && changedPaths.every(path => /\.mdx?$/.test(path) || path.startsWith('docs/'))
    && !changedPaths.some(isPolicySensitive);
}
