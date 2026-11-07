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
const IS_SHA40 = value => NONEMPTY(value) && SHA40.test(value);
const IS_SHA256 = value => NONEMPTY(value) && SHA256.test(value);
const IS_ID = value => NONEMPTY(value) && ID.test(value);
const RECORD = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const SAFE_PATH = value => NONEMPTY(value)
  && !value.startsWith('/') && !/[\\\x00-\x20\x7f:%]/.test(value)
  && !value.split('/').some(segment => segment === '' || segment === '.' || segment === '..');
const INERT_DOCUMENT = value => SAFE_PATH(value) && /\.(md|txt|rst|png|jpe?g|gif|webp|pdf)$/i.test(value);
const EXECUTION_POLICY = /^(vercel\.json|(?:next|vite|vitest|playwright)\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json|package(?:-lock)?\.json|(?:pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)|\.npmrc|\.claude\/settings(?:\.[^/]+)?\.json|\.codex\/config\.toml|(?:[^/]*\/)?Dockerfile(?:\.[^/]*)?|scripts\/ci-[^/]+)$/;
// Repository authentication and authority ownership includes modules outside lib/auth and api/auth.
const ACCESS_CONTROL = /^src\/(?:proxy\.[^/]+$|lib\/(?:password[^/]*|session-cookie|api-auth|api-v1-auth|api-keys|api-subscriber-access|access|report-access)(?:\.|\/)|lib\/(?:hamilton\/(?:institution-membership|workspace-invite-link|workspace-seats)|custom-report\/link(?:-access)?)(?:\.|\/)|app\/(?:\(auth\)\/|workspace-invite\/|api\/session\/|pro\/\(hamilton\)\/settings\/actions\.|admin\/quality\/actions\.))/;

export function contractDigest(rawText) {
  return createHash('sha256').update(rawText, 'utf8').digest('hex');
}

/** GitHub rename/copy metadata is part of the diff; the destination alone is incomplete. */
export function changedPaths(files) {
  const paths = new Set(), problems = [];
  if (!Array.isArray(files) || files.length === 0) return { paths: [], problems: ['Changed-file inventory missing'] };
  const filenames = new Set();
  for (const [index, file] of files.entries()) {
    if (!RECORD(file)) { problems.push(`Changed-file entry ${index} is malformed`); continue; }
    if (!['added', 'removed', 'modified', 'renamed', 'copied', 'changed'].includes(file.status)) problems.push(`Changed-file entry ${index} has unknown status`);
    if (!SAFE_PATH(file.filename)) problems.push(`Changed-file entry ${index} has an unsafe filename`);
    else {
      if (filenames.has(file.filename)) problems.push(`Changed-file entry ${index} duplicates a filename`);
      filenames.add(file.filename); paths.add(file.filename);
    }
    if (Object.hasOwn(file, 'previous_filename')) {
      if (!SAFE_PATH(file.previous_filename) || file.previous_filename === file.filename) problems.push(`Changed-file entry ${index} has an unsafe previous filename`);
      else paths.add(file.previous_filename);
    } else if (['renamed', 'copied'].includes(file.status)) problems.push(`Changed-file entry ${index} is missing its previous filename`);
  }
  return { paths: [...paths].sort(), problems };
}

export function isPolicySensitive(path) {
  if (!SAFE_PATH(path)) return true;
  return /(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(path)
    || path.startsWith('.claude/skills/')
    || path.startsWith('.agents/skills/')
    || path.startsWith('.github/')
    || path.startsWith('docs/project/acceptance/engineering/')
    || path.startsWith('src/lib/engineering-verification/')
    || EXECUTION_POLICY.test(path)
    || path === 'scripts/ci-guards.sh';
}

export function classifyPath(path) {
  if (!SAFE_PATH(path)) return 'R3'; // An unknown path cannot safely be assumed inert.
  if (ACCESS_CONTROL.test(path)
    || /^(supabase\/migrations\/|src\/app\/api\/auth\/|src\/lib\/auth|src\/lib\/payment|src\/lib\/stripe|src\/lib\/billing|src\/lib\/api-hardening\/)/.test(path)
    || /(^|\/)(\.env[^/]*|secrets?[^/]*|permissions?[^/]*|CODEOWNERS)$/.test(path)
    || path.startsWith('.github/workflows/')
    || EXECUTION_POLICY.test(path)
    || /^src\/app\/api\/(webhooks\/stripe|stripe|billing|checkout|payments?)(\/|\.)/.test(path)
    || /^src\/lib\/(ai-provider|automation-control|provider[^/]*|agents\/[^/]*(provider|budget)[^/]*)(\/|\.)/.test(path)
    || /\.sql$/i.test(path)) return 'R3';
  if (isPolicySensitive(path)
    || /^src\/lib\/(agents\/|data-store\/|fee-|custom-report\/|hamilton\/|engineering-verification\/)/.test(path)
    || /^src\/app\/api\/admin\//.test(path)) return 'R2';
  if (INERT_DOCUMENT(path)) return 'R0';
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
  [/src\/lib\/agents\/rosetta\//, ['tdd', 'adversarial-document-testing', 'error-to-test']],
  [/src\/lib\/agents\/knox\//, ['tdd', 'adversarial-document-testing', 'error-to-test']],
  [/src\/lib\/agents\/darwin\//, ['source-evidence-audit', 'fee-taxonomy-regression', 'tdd']],
  [/src\/lib\/agents\/magellan\//, ['source-evidence-audit', 'tdd', 'diagnosing-bugs']],
  [/^src\/lib\/agents\/hoovie\//, ['audit-data', 'data-quality-audit', 'supabase', 'supabase-postgres-best-practices']],
  [/^src\/lib\/agents\/magellan\/registry\//, ['audit-data', 'data-quality-audit', 'supabase', 'supabase-postgres-best-practices']],
  [/src\/lib\/agents\/deming\//, ['data-quality-audit', 'error-to-test', 'adversarial-document-testing']],
  [/src\/lib\/agents\/bayes\//, ['audit-data', 'diagnosing-bugs', 'recover']],
  [/src\/lib\/agents\/atlas\//, ['audit-data', 'diagnosing-bugs', 'recover']],
  [/^src\/(lib\/(agents\/hamilton|hamilton|custom-report)\/|app\/(pro\/|api\/(hamilton|research\/hamilton)\/))/, ['report-reconciliation', 'fee-evaluation']],
  [/^src\/(app\/(?!api\/)|components\/).*\.(tsx|jsx|css|mdx)$/, ['buyer-journey-mapper', 'ux-ui-auditor', 'playwright-ux-simulator']],
  [/^src\/lib\/agents\/growth\//, ['buyer-journey-mapper', 'ux-ui-auditor', 'playwright-ux-simulator']],
];

// Repository capabilities, not a claim that a globally installed skill is available in CI.
const AVAILABLE_SKILLS = new Set([
  'adversarial-document-testing', 'audit-data', 'data-quality-audit', 'diagnosing-bugs',
  'error-to-test', 'fee-evaluation', 'fee-taxonomy-regression', 'recover',
  'report-reconciliation', 'source-evidence-audit', 'supabase', 'supabase-postgres-best-practices', 'tdd',
  'buyer-journey-mapper', 'ux-ui-auditor', 'playwright-ux-simulator',
]);

export function routeSkills(paths) {
  const skills = new Set();
  for (const path of (Array.isArray(paths) ? paths : [])) {
    if (!SAFE_PATH(path)) continue;
    for (const [pattern, names] of SKILL_ROUTES) if (pattern.test(path)) names.forEach(skill => skills.add(skill));
  }
  return [...skills].sort();
}

/** Missing routed capabilities are visible blockers for adoption, never silently omitted. */
export function routeSkillRequirements(paths, availableSkills = [...AVAILABLE_SKILLS]) {
  const required_skills = routeSkills(paths);
  const available = new Set(Array.isArray(availableSkills) ? availableSkills.filter(NONEMPTY) : []);
  return {
    required_skills,
    available_skills: required_skills.filter(skill => available.has(skill)),
    unavailable_skills: required_skills.filter(skill => !available.has(skill)),
  };
}

/** Validates a declarative contract, not any claimed result or runtime state. */
export function validateContract(contract) {
  const errors = [];
  if (!RECORD(contract)) return { ok: false, errors: ['Contract must be an object'] };
  if (!['1.0', '1.1'].includes(contract.schema_version)) errors.push('schema_version must equal 1.0 or 1.1');
  if (!IS_ID(contract.contract_id)) errors.push('contract_id must be a stable uppercase ID');
  if (!NONEMPTY(contract.issue) || !/^#\d+$/.test(contract.issue)) errors.push('issue must be a GitHub issue number (#123)');
  if (!TIERS.includes(contract.risk_tier)) errors.push('risk_tier must be R0, R1, R2 or R3');
  if (!IS_SHA40(contract.base_sha)) errors.push('base_sha must be a 40-character commit SHA');
  if (!Array.isArray(contract.scope) || contract.scope.length === 0 || contract.scope.some(path => !SAFE_PATH(path))) errors.push('scope must contain safe repo-relative path patterns');
  if (!Array.isArray(contract.required_skills) || contract.required_skills.some(skill => !NONEMPTY(skill))) errors.push('required_skills must be string array');
  if (contract.production_boundary !== 'NO_PROD_MUTATION') errors.push('MVP production_boundary must be NO_PROD_MUTATION');
  if (typeof contract.human_approval_required !== 'boolean') errors.push('human_approval_required must be boolean');
  if (contract.schema_version === '1.1') {
    if (!Array.isArray(contract.execution_files) || contract.execution_files.length === 0) errors.push('execution_files must freeze the trusted executable chain');
    else {
      let previousPath = '';
      for (const file of contract.execution_files) {
        if (!RECORD(file) || !SAFE_PATH(file.path) || /[*?]/.test(file.path) || !IS_SHA256(file.sha256)) errors.push('execution_files must contain safe paths and SHA256 identities');
        else {
          if (file.path <= previousPath) errors.push('execution_files must be unique and sorted by path');
          previousPath = file.path;
        }
      }
    }
  }
  const requirements = contract.requirements;
  if (!Array.isArray(requirements) || (TIERS.indexOf(contract.risk_tier) >= 2 && requirements.length === 0)) errors.push('R2/R3 require at least one acceptance requirement');
  const requirementIds = new Set();
  const testIds = new Set();
  for (const [i, req] of (Array.isArray(requirements) ? requirements : []).entries()) {
    if (!RECORD(req)) { errors.push(`requirements[${i}] must be object`); continue; }
    if (!IS_ID(req.id) || requirementIds.has(req.id)) errors.push(`requirements[${i}].id missing/duplicate`);
    requirementIds.add(req.id);
    if (!NONEMPTY(req.behavior)) errors.push(`requirements[${i}].behavior missing`);
    if (!NONEMPTY(req.authority)) errors.push(`requirements[${i}].authority missing`);
    if (!NONEMPTY(req.test_id) || testIds.has(req.test_id)) errors.push(`requirements[${i}].test_id missing/duplicate`);
    testIds.add(req.test_id);
    if (!SAFE_PATH(req.test_path) || /[*?]/.test(req.test_path) || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(req.test_path)) errors.push(`requirements[${i}].test_path must name a safe repo-relative test file`);
    if (TIERS.indexOf(contract.risk_tier) >= 2 && !NONEMPTY(req.failure_signature)) errors.push(`requirements[${i}].failure_signature missing`);
    if (req.fixture_sha256 != null && !IS_SHA256(req.fixture_sha256)) errors.push(`requirements[${i}].fixture_sha256 invalid`);
    if (contract.schema_version === '1.1') {
      for (const field of ['fixture_path', 'adapter_path']) {
        if (!SAFE_PATH(req[field]) || /[*?]/.test(req[field])) errors.push(`requirements[${i}].${field} must name a safe repo-relative file`);
      }
      for (const field of ['test_sha256', 'fixture_sha256', 'adapter_sha256']) {
        if (!IS_SHA256(req[field])) errors.push(`requirements[${i}].${field} must freeze the executable proof identity`);
      }
      if (!['FAIL', 'PASS'].includes(req.baseline_expectation)) errors.push(`requirements[${i}].baseline_expectation must be FAIL or PASS`);
      if (!Array.isArray(req.assertion_ids) || req.assertion_ids.length === 0
        || req.assertion_ids.some(id => !NONEMPTY(id) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id))
        || new Set(req.assertion_ids).size !== req.assertion_ids.length) errors.push(`requirements[${i}].assertion_ids must contain unique stable assertion IDs`);
      if (req.baseline_expectation === 'FAIL'
        && (!Array.isArray(req.baseline_failure_assertion_ids) || req.baseline_failure_assertion_ids.length === 0
          || req.baseline_failure_assertion_ids.some(id => !NONEMPTY(id) || !Array.isArray(req.assertion_ids) || !req.assertion_ids.includes(id))
          || new Set(req.baseline_failure_assertion_ids).size !== req.baseline_failure_assertion_ids.length)) errors.push(`requirements[${i}].baseline_failure_assertion_ids must freeze expected failed assertion IDs`);
      if (req.baseline_expectation === 'PASS' && req.baseline_failure_assertion_ids != null
        && (!Array.isArray(req.baseline_failure_assertion_ids) || req.baseline_failure_assertion_ids.length !== 0)) errors.push(`requirements[${i}] passing baseline cannot require failing assertions`);
    }
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

function assessAssertions(receipt, requirement, side, problems) {
  if (!Array.isArray(receipt.assertions)) {
    problems.push(`${requirement.id} ${side} structured assertion inventory missing`);
    return;
  }
  const ids = new Set();
  for (const assertion of receipt.assertions) {
    if (!RECORD(assertion) || !NONEMPTY(assertion.id) || ids.has(assertion.id)
      || !requirement.assertion_ids.includes(assertion.id)
      || !['PASSED', 'FAILED'].includes(assertion.status)) {
      problems.push(`${requirement.id} ${side} assertion missing, duplicated, unexpected or not executed`);
      continue;
    }
    ids.add(assertion.id);
  }
  for (const id of requirement.assertion_ids) if (!ids.has(id)) problems.push(`${requirement.id} ${side} assertion not counted: ${id}`);
}

function assessRequirementPair(contract, requirement, pair, currentHeadSha, expectedContractSha256) {
  const problems = [];
  const red = RECORD(pair?.red) ? pair.red : {};
  const green = RECORD(pair?.green) ? pair.green : {};
  if (red.base_sha !== contract.base_sha) problems.push('RED did not run on frozen baseline SHA');
  if (green.head_sha !== currentHeadSha) problems.push('GREEN did not run on exact current head SHA');
  if (red.contract_sha256 !== expectedContractSha256 || green.contract_sha256 !== expectedContractSha256) problems.push('Contract identity drift');
  const executionSha256 = contractDigest(JSON.stringify(contract.execution_files));
  if (red.execution_sha256 !== executionSha256 || green.execution_sha256 !== executionSha256) problems.push('Trusted execution file identities drifted from frozen contract');
  for (const field of ['test_sha256', 'fixture_sha256', 'adapter_sha256']) {
    if (red[field] !== requirement[field] || green[field] !== requirement[field]) problems.push(`${requirement.id} ${field} does not match frozen contract identity`);
  }
  if (red.requirement_id !== requirement.id || green.requirement_id !== requirement.id) problems.push('Requirement ID missing/mismatched');
  if (red.test_id !== requirement.test_id || green.test_id !== requirement.test_id) problems.push('Test ID missing/mismatched');
  if (!NONEMPTY(red.command) || red.command !== green.command) problems.push('RED and GREEN must use the same targeted harness command');
  if (!NONEMPTY(red.artifact_url) || !NONEMPTY(green.artifact_url)) problems.push('Run log artifact URLs required');
  assessAssertions(red, requirement, 'RED', problems);
  assessAssertions(green, requirement, 'GREEN', problems);
  if (requirement.baseline_expectation === 'FAIL') {
    if (!Number.isInteger(red.exit_code) || red.exit_code <= 0) problems.push('RED must exit nonzero');
    if (red.status !== 'FAILED' || red.failure_kind !== 'ASSERTION_FAILURE') problems.push('RED must be behavioral assertion failure, not setup/timeout/network');
    if (!Array.isArray(red.assertions) || !red.assertions.some(assertion => RECORD(assertion) && requirement.baseline_failure_assertion_ids.includes(assertion.id) && assertion.status === 'FAILED')) problems.push('RED has no frozen expected behavioral assertion failure');
  } else {
    if (red.exit_code !== 0 || red.status !== 'PASSED' || ![undefined, null, 'NONE'].includes(red.failure_kind)
      || !Array.isArray(red.assertions) || red.assertions.some(assertion => assertion?.status !== 'PASSED')) problems.push('Baseline negative controls must pass every assertion');
  }
  if (green.exit_code !== 0 || green.status !== 'PASSED' || ![undefined, null, 'NONE'].includes(green.failure_kind)
    || !Array.isArray(green.assertions) || green.assertions.some(assertion => assertion?.status !== 'PASSED')) problems.push('GREEN must pass every assertion with zero exit and PASSED status');
  return problems;
}

/**
 * Every requirement needs its own frozen baseline/target pair. Assertion output is
 * produced by trusted orchestration outside candidate code; author JSON remains
 * untrusted even when structurally valid. CI and review are assessed separately.
 */
export function assessProofBundle(contract, bundle, currentHeadSha, expectedContractSha256) {
  const problems = [];
  const validated = validateContract(contract);
  problems.push(...validated.errors);
  if (!IS_SHA40(currentHeadSha)) problems.push('Current head SHA missing');
  if (currentHeadSha === contract?.base_sha) problems.push('Target head must differ from the defective baseline SHA');
  if (!IS_SHA256(expectedContractSha256)) problems.push('Frozen contract SHA256 missing');
  if (contract?.schema_version !== '1.1') problems.push('Proof requires schema_version 1.1 frozen assertions and identities');
  if (!Array.isArray(bundle?.pairs) || bundle.pairs.length === 0) problems.push('Requirement proof pairs missing');
  if (problems.length) return { status: 'BLOCKED', problems };
  if (!contract.requirements.some(requirement => requirement.baseline_expectation === 'FAIL')) problems.push('Proof bundle needs at least one behavioral baseline failure');
  const byRequirement = new Map();
  for (const pair of bundle.pairs) {
    const id = pair?.red?.requirement_id;
    if (!contract.requirements.some(requirement => requirement.id === id)) {
      problems.push('Unmapped requirement proof pair');
      continue;
    }
    if (byRequirement.has(id)) problems.push(`Duplicate proof pair: ${id}`);
    byRequirement.set(id, pair);
  }
  for (const requirement of contract.requirements) {
    const pair = byRequirement.get(requirement.id);
    if (!pair) problems.push(`Requirement proof missing: ${requirement.id}`);
    else problems.push(...assessRequirementPair(contract, requirement, pair, currentHeadSha, expectedContractSha256));
  }
  return { status: problems.length ? 'BLOCKED' : 'STRUCTURALLY_VALID_UNTRUSTED', problems };
}

/** Backward-compatible single-pair entry point, still requiring complete coverage. */
export function assessProofPair(contract, pair, currentHeadSha, expectedContractSha256) {
  return assessProofBundle(contract, { pairs: [pair] }, currentHeadSha, expectedContractSha256);
}

/** Production verification is intentionally orthogonal to engineering GREEN. */
export function assessProductionEvidence(evidence) {
  const blockers = [];
  if (!IS_SHA40(evidence?.deployed_sha) || !NONEMPTY(evidence?.environment)) blockers.push('Deployment SHA and environment absent');
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
    && changedPaths.every(path => classifyPath(path) === 'R0')
    && !changedPaths.some(isPolicySensitive);
}
