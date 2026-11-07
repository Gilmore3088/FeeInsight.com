// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  changedPaths,
  classifyChange,
  classifyPath,
  routeSkills,
  routeSkillRequirements,
  validateContract,
  contractDigest,
  assessProofPair,
  assessProofBundle,
  assessProductionEvidence,
  mayUseDocsOnlyFastPath,
} from './contract.mjs';

const SHA = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const HASH = 'c'.repeat(64);
const fixture = {
  schema_version: '1.1',
  contract_id: 'EV-KNOX-2285',
  issue: '#2285',
  risk_tier: 'R2',
  base_sha: SHA,
  execution_files: [{ path: 'src/lib/engineering-verification/pilot.mjs', sha256: HASH }],
  scope: ['src/lib/agents/knox/**'],
  required_skills: ['tdd', 'adversarial-document-testing', 'error-to-test'],
  requirements: [{
    id: 'KNOX-2285-01',
    behavior: 'Never borrow an adjacent fee amount',
    authority: 'Issue #2285 synthetic reproducible old-code failure',
    test_id: 'knox-2285-own-direction',
    test_path: 'src/lib/agents/knox/wire-clause-prices.test.ts',
    failure_signature: 'incoming wire at the outgoing price',
    baseline_expectation: 'FAIL',
    baseline_failure_assertion_ids: ['own-price'],
    assertion_ids: ['own-price', 'business-audience'],
    test_sha256: HASH,
    fixture_sha256: HASH,
    adapter_sha256: HASH,
    fixture_path: 'src/lib/engineering-verification/__fixtures__/knox-2285.json',
    adapter_path: 'src/lib/engineering-verification/pilot.mjs',
  }],
  production_boundary: 'NO_PROD_MUTATION',
  human_approval_required: false,
};

const validPair = () => ({
  red: {
    base_sha: SHA, contract_sha256: HASH, test_sha256: HASH,
    fixture_sha256: HASH, test_id: 'knox-2285-own-direction',
    adapter_sha256: HASH, requirement_id: 'KNOX-2285-01',
    execution_sha256: contractDigest(JSON.stringify(fixture.execution_files)),
    command: 'vitest run wire-clause-prices.test.ts -t own-direction',
    artifact_url: 'https://github.com/example/runs/1', exit_code: 1,
    failure_kind: 'ASSERTION_FAILURE',
    status: 'FAILED',
    failure_log_excerpt: 'AssertionError: incoming wire at the outgoing price',
    assertions: [{ id: 'own-price', status: 'FAILED' }, { id: 'business-audience', status: 'PASSED' }],
  },
  green: {
    head_sha: HEAD, contract_sha256: HASH, test_sha256: HASH,
    fixture_sha256: HASH, test_id: 'knox-2285-own-direction',
    adapter_sha256: HASH, requirement_id: 'KNOX-2285-01',
    execution_sha256: contractDigest(JSON.stringify(fixture.execution_files)),
    command: 'vitest run wire-clause-prices.test.ts -t own-direction',
    artifact_url: 'https://github.com/example/runs/2', exit_code: 0,
    status: 'PASSED', required_checks: [{ name: 'app-tests', conclusion: 'success' }],
    assertions: [{ id: 'own-price', status: 'PASSED' }, { id: 'business-audience', status: 'PASSED' }],
  },
});

describe('M0/M1 engineering verification contract', () => {
  it('validates stable issue/requirement/test mapping and identifies routed Knox skills', () => {
    expect(validateContract(fixture)).toEqual({ ok: true, errors: [] });
    expect(routeSkills(fixture.scope)).toEqual([...fixture.required_skills].sort());
    expect(contractDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('requires frozen executable identities and assertion IDs in proof-capable contracts', () => {
    for (const field of ['assertion_ids', 'baseline_expectation', 'baseline_failure_assertion_ids', 'test_sha256', 'fixture_sha256', 'adapter_sha256', 'fixture_path', 'adapter_path']) {
      const requirement: Record<string, unknown> = { ...fixture.requirements[0] };
      delete requirement[field];
      expect(validateContract({ ...fixture, requirements: [requirement] }).ok).toBe(false);
    }
    expect(validateContract({ ...fixture, schema_version: '8.0' }).ok).toBe(false);
  });

  it('does not coerce JSON arrays into valid contract or proof identities', () => {
    for (const field of ['contract_id', 'issue', 'base_sha'] as const) {
      expect(validateContract({ ...fixture, [field]: [fixture[field]] }).ok).toBe(false);
    }
    for (const field of ['id', 'test_sha256', 'fixture_sha256', 'adapter_sha256']) {
      const requirement: Record<string, unknown> = { ...fixture.requirements[0] };
      requirement[field] = [requirement[field]];
      expect(validateContract({ ...fixture, requirements: [requirement] }).ok).toBe(false);
    }
    expect(assessProofPair(fixture, validPair(), [HEAD], HASH).status).toBe('BLOCKED');
    expect(assessProofPair(fixture, validPair(), HEAD, [HASH]).status).toBe('BLOCKED');
  });

  it('freezes every trusted execution file in a canonical manifest', () => {
    for (const execution_files of [undefined, [], [{ path: '../runner.mjs', sha256: HASH }],
      [{ path: 'runner.mjs', sha256: [HASH] }],
      [{ path: 'z.mjs', sha256: HASH }, { path: 'a.mjs', sha256: HASH }],
      [{ path: 'runner.mjs', sha256: HASH }, { path: 'runner.mjs', sha256: HASH }]]) {
      expect(validateContract({ ...fixture, execution_files }).ok).toBe(false);
    }
    const pair = validPair();
    pair.green.execution_sha256 = 'd'.repeat(64);
    expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
  });

  it('blocks nonexistent authority, duplicated IDs, invalid baseline and incomplete skills', () => {
    const invalid = structuredClone(fixture);
    invalid.base_sha = 'main';
    invalid.required_skills = ['tdd'];
    invalid.requirements[0].authority = '';
    invalid.requirements.push({ ...invalid.requirements[0] });
    expect(validateContract(invalid).ok).toBe(false);
    expect(validateContract(invalid).errors.join(' ')).toMatch(/base_sha|authority|duplicate|skill/i);
  });

  it('classifies the highest-risk changed path and never hides policy files in docs-only', () => {
    expect(classifyPath('docs/changelog.md')).toBe('R0');
    expect(classifyPath('src/lib/agents/knox/specialists.ts')).toBe('R2');
    expect(classifyChange(['docs/README.md', 'supabase/migrations/20261107.sql']).risk_tier).toBe('R3');
    expect(classifyChange(['docs/project/acceptance/engineering/2285.json']).policy_sensitive).toBe(true);
    expect(mayUseDocsOnlyFastPath(['docs/changelog.md'])).toBe(true);
    expect(mayUseDocsOnlyFastPath(['AGENTS.md'])).toBe(false);
    expect(mayUseDocsOnlyFastPath(['.claude/skills/tdd/SKILL.md'])).toBe(false);
    expect(mayUseDocsOnlyFastPath(['docs/project/acceptance/engineering/README.md'])).toBe(false);
    expect(mayUseDocsOnlyFastPath(['.github/workflows/test.yml'])).toBe(false);
  });

  it('includes safe rename/copy origins for risk, skill routing and review scope', () => {
    const inventory = changedPaths([
      { filename: 'docs/old-guide.md', previous_filename: 'AGENTS.md', status: 'renamed' },
      { filename: 'docs/old-extractor.txt', previous_filename: 'src/lib/agents/knox/paid-extract.ts', status: 'renamed' },
      { filename: 'docs/old-provider.txt', previous_filename: 'src/lib/ai-provider.ts', status: 'copied' },
    ]);
    expect(inventory).toEqual({ paths: ['AGENTS.md', 'docs/old-extractor.txt', 'docs/old-guide.md', 'docs/old-provider.txt', 'src/lib/agents/knox/paid-extract.ts', 'src/lib/ai-provider.ts'], problems: [] });
    expect(classifyChange(inventory.paths)).toMatchObject({ risk_tier: 'R3', policy_sensitive: true });
    expect(mayUseDocsOnlyFastPath(inventory.paths)).toBe(false);
    expect(routeSkills(inventory.paths)).toEqual(['adversarial-document-testing', 'error-to-test', 'tdd']);
  });

  it.each([null, {}, [], [null], [4], [{ filename: 'docs/readme.md' }],
    [{ filename: 'docs/readme.md', status: 'unknown' }],
    [{ filename: '../AGENTS.md', status: 'removed' }],
    [{ filename: 'docs/readme.md', status: 'renamed' }],
    [{ filename: 'docs/readme.md', previous_filename: ['AGENTS.md'], status: 'renamed' }],
    [{ filename: 'docs/readme.md', previous_filename: '../AGENTS.md', status: 'renamed' }],
    [{ filename: 'docs/readme.md', previous_filename: 'docs/readme.md', status: 'renamed' }],
    [{ filename: 'docs/readme.md', status: 'added' }, { filename: 'docs/readme.md', status: 'added' }],
  ])('blocks incomplete or malformed changed-file inventory without throwing: %j', files => {
    expect(() => changedPaths(files)).not.toThrow();
    expect(changedPaths(files).problems.length).toBeGreaterThan(0);
  });

  it('cannot down-classify security mutations or avoid separate approval', () => {
    const invalid = { ...fixture, scope: ['supabase/migrations/**'], risk_tier: 'R2' };
    expect(validateContract(invalid).errors.join(' ')).toContain('Risk down-classification');
    expect(validateContract({ ...invalid, risk_tier: 'R3', human_approval_required: false }).errors.join(' ')).toContain('human approval');
  });

  it('keeps payment, spending, executable documentation and unsafe paths out of the docs shortcut', () => {
    for (const path of [
      'src/app/api/webhooks/stripe/route.ts', 'src/lib/ai-provider.ts',
      'src/lib/automation-control.ts', 'src/lib/agents/provider-budget.ts',
      'vercel.json', 'next.config.ts', 'package.json', 'package-lock.json',
      'Dockerfile', 'scripts/ci-golden-gate.mjs',
      '.claude/settings.json', '.codex/config.toml', '.npmrc',
      'vitest.config.ts', 'tsconfig.json', 'pnpm-lock.yaml',
    ]) expect(classifyPath(path)).toBe('R3');
    expect(classifyChange(['vercel.json']).policy_sensitive).toBe(true);
    for (const path of ['docs/run.sh', 'docs/example.ts', 'docs/diagram.svg', 'docs/../src/lib/auth.ts', 'docs\\run.md']) {
      expect(classifyPath(path)).not.toBe('R0');
      expect(mayUseDocsOnlyFastPath([path])).toBe(false);
    }
    for (const path of [null, {}, 4, ['docs/readme.md']]) {
      expect(() => classifyChange([path])).not.toThrow();
      expect(classifyChange([path]).risk_tier).toBe('R3');
    }
  });

  it('rejects malformed requirements and unsafe test paths without throwing', () => {
    for (const changes of [
      { scope: [{}] },
      { scope: ['docs/../src/lib/auth.ts'] },
      { scope: ['docs\\readme.md'] },
      { requirements: 'forged' },
      { requirements: [null] },
      { requirements: [{ ...fixture.requirements[0], test_path: '../outside.test.ts' }] },
      { requirements: [{ ...fixture.requirements[0], test_path: '/tmp/outside.test.ts' }] },
      { requirements: [{ ...fixture.requirements[0], fixture_path: '../outside.json' }] },
      { requirements: [{ ...fixture.requirements[0], adapter_path: '/tmp/executable.mjs' }] },
    ]) {
      expect(() => validateContract({ ...fixture, ...changes })).not.toThrow();
      expect(validateContract({ ...fixture, ...changes }).ok).toBe(false);
    }
  });

  it('routes Hoovie and every Hamilton surface and reports unavailable browser skills explicitly', () => {
    expect(routeSkills(['src/lib/agents/hoovie/sources.ts'])).toEqual(['audit-data', 'data-quality-audit', 'supabase', 'supabase-postgres-best-practices']);
    for (const path of ['src/lib/hamilton/request-contract.ts', 'src/lib/custom-report/report.ts', 'src/app/api/hamilton/chat/route.ts']) {
      expect(routeSkills([path])).toEqual(['fee-evaluation', 'report-reconciliation']);
    }
    const requirements = routeSkillRequirements(['src/app/pro/analyze/page.tsx'], ['fee-evaluation', 'report-reconciliation']);
    expect(requirements.required_skills).toEqual(['buyer-journey-mapper', 'fee-evaluation', 'playwright-ux-simulator', 'report-reconciliation', 'ux-ui-auditor']);
    expect(requirements.unavailable_skills).toEqual(['buyer-journey-mapper', 'playwright-ux-simulator', 'ux-ui-auditor']);
    expect(requirements.available_skills).toEqual(['fee-evaluation', 'report-reconciliation']);
    expect(routeSkillRequirements(['src/app/pro/analyze/page.tsx']).unavailable_skills).toEqual([]);
    expect(routeSkillRequirements(null).required_skills).toEqual([]);
    expect(routeSkills(['src/lib/agents/magellan/registry/fdic.ts'])).toEqual([
      'audit-data', 'data-quality-audit', 'diagnosing-bugs', 'source-evidence-audit',
      'supabase', 'supabase-postgres-best-practices', 'tdd',
    ]);
  });
});

describe('M2 failure-first receipt assessor (not a trusted verdict)', () => {
  it('recognizes shape of real behavioral RED → exact-head GREEN but never calls itself merged/verified', () => {
    expect(assessProofPair(fixture, validPair(), HEAD, HASH)).toEqual({ status: 'STRUCTURALLY_VALID_UNTRUSTED', problems: [] });
  });

  it.each(['SETUP_FAILURE', 'TIMEOUT', 'MISSING_DEPENDENCY', 'NETWORK_FAILURE', 'UNKNOWN'])(
    'rejects fake RED caused by %s', failure_kind => {
      const pair = validPair();
      pair.red.failure_kind = failure_kind;
      expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
    }
  );

  it('rejects same-code GREEN on old baseline, missing assertions and identity drift', () => {
    const pair = validPair();
    pair.green.head_sha = SHA;
    pair.green.test_sha256 = 'd'.repeat(64);
    pair.green.required_checks = [{ name: 'app-tests', conclusion: 'skipped' }];
    pair.red.failure_log_excerpt = 'Module not found';
    pair.red.assertions = [];
    expect(assessProofPair(fixture, pair, HEAD, HASH).problems.length).toBeGreaterThanOrEqual(4);
  });

  it('assesses behavioral proof independently of external app-tests checks', () => {
    const pair = validPair();
    pair.green.required_checks = [];
    expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('STRUCTURALLY_VALID_UNTRUSTED');
  });

  it('never accepts an unverifiable requirement/test ID', () => {
    const pair = validPair();
    pair.red.test_id = 'invented';
    pair.green.test_id = 'invented';
    pair.green.required_checks = [];
    expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
  });

  it('rejects copied assertion-title text when the structured outcome did not fail', () => {
    const pair = validPair();
    pair.red.assertions[0].status = 'PASSED';
    pair.red.assertions[1].status = 'FAILED';
    expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
    pair.red.assertions[0].status = 'FAILED';
    pair.green.fixture_sha256 = 'd'.repeat(64);
    pair.red.fixture_sha256 = 'd'.repeat(64);
    expect(assessProofPair(fixture, pair, HEAD, HASH).problems.join(' ')).toMatch(/fixture.*frozen/i);
  });

  it('rejects contradictory run status or infrastructure failure even with assertion-looking text', () => {
    const pair = validPair();
    pair.red.status = 'PASSED';
    expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
    const malformed = { ...validPair(), green: { ...validPair().green, failure_kind: 'SETUP_FAILURE' } };
    expect(assessProofPair(fixture, malformed, HEAD, HASH).status).toBe('BLOCKED');
  });

  it('requires a repaired target to differ from its historical defective baseline', () => {
    const pair = validPair();
    pair.green.head_sha = SHA;
    expect(assessProofPair(fixture, pair, SHA, HASH).status).toBe('BLOCKED');
  });

  it('requires every contract requirement and every assertion, including passing baseline controls', () => {
    const contract = structuredClone(fixture);
    contract.requirements.push({
      ...contract.requirements[0], id: 'KNOX-2285-02', test_id: 'knox-2285-no-heading-leak',
      assertion_ids: ['heading-boundary'], baseline_expectation: 'PASS',
      baseline_failure_assertion_ids: [],
    });
    expect(assessProofPair(contract, validPair(), HEAD, HASH).status).toBe('BLOCKED');
    const controls = validPair();
    for (const side of [controls.red, controls.green]) {
      side.requirement_id = 'KNOX-2285-02';
      side.test_id = 'knox-2285-no-heading-leak';
      side.assertions = [{ id: 'heading-boundary', status: 'PASSED' }];
    }
    controls.red.exit_code = 0;
    controls.red.failure_kind = 'NONE';
    controls.red.status = 'PASSED';
    const bundle = { pairs: [validPair(), controls] };
    expect(assessProofBundle(contract, bundle, HEAD, HASH).status).toBe('STRUCTURALLY_VALID_UNTRUSTED');
    bundle.pairs[1].green.assertions = [];
    expect(assessProofBundle(contract, bundle, HEAD, HASH).status).toBe('BLOCKED');
    expect(assessProofBundle(contract, { pairs: [validPair(), validPair()] }, HEAD, HASH).status).toBe('BLOCKED');
  });

  it('rejects missing, malformed or duplicate assertion receipts without throwing', () => {
    for (const assertions of [null, {}, ['own-price'], [{ id: 'own-price', status: 'SKIPPED' }], [null]]) {
      const pair = { ...validPair(), red: { ...validPair().red, assertions } };
      expect(() => assessProofPair(fixture, pair, HEAD, HASH)).not.toThrow();
      expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
    }
    expect(() => assessProofBundle({ ...fixture, requirements: null }, { pairs: [validPair()] }, HEAD, HASH)).not.toThrow();
  });
});

describe('Deming + Atlas + Bayes operational boundary', () => {
  const evidence = () => ({
    deployed_sha: HEAD,
    environment: 'production',
    atlas_run_id: 'run-01',
    deming: { run_id: 'audit-01', cohort_id: 'locked-cohort', measurement_version: 'v4', verdict: 'PASS' },
    replay_required: true,
    bayes: { manifest_key: 'manifest-01', affected: 100, done: 80, queued: 20, excluded: 0, not_counted: 0 },
  });

  it('partial Bayes replay remains production-unverified even with an observed Deming pass', () => {
    expect(assessProductionEvidence(evidence()).status).toBe('PRODUCTION_UNVERIFIED');
  });

  it('complete-looking JSON remains untrusted until independent runtime source attestation', () => {
    const e = evidence();
    e.bayes.done = 100;
    e.bayes.queued = 0;
    expect(assessProductionEvidence(e).status).toBe('OPERATIONAL_EVIDENCE_CANDIDATE_UNTRUSTED');
  });

  it('missing observed cohort and unreconciled counts cannot become green', () => {
    const e = evidence();
    e.deming.cohort_id = '';
    e.bayes.affected = 50;
    expect(assessProductionEvidence(e).blockers.length).toBeGreaterThanOrEqual(2);
  });
});
