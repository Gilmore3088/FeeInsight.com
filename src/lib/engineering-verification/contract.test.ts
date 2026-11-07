// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  classifyChange,
  classifyPath,
  routeSkills,
  validateContract,
  contractDigest,
  assessProofPair,
  assessProductionEvidence,
  mayUseDocsOnlyFastPath,
} from './contract.mjs';

const SHA = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const HASH = 'c'.repeat(64);
const fixture = {
  schema_version: '1.0',
  contract_id: 'EV-KNOX-2285',
  issue: '#2285',
  risk_tier: 'R2',
  base_sha: SHA,
  scope: ['src/lib/agents/knox/**'],
  required_skills: ['tdd', 'adversarial-document-testing', 'error-to-test'],
  requirements: [{
    id: 'KNOX-2285-01',
    behavior: 'Never borrow an adjacent fee amount',
    authority: 'Issue #2285 synthetic reproducible old-code failure',
    test_id: 'knox-2285-own-direction',
    test_path: 'src/lib/agents/knox/wire-clause-prices.test.ts',
    failure_signature: 'incoming wire at the outgoing price',
  }],
  production_boundary: 'NO_PROD_MUTATION',
  human_approval_required: false,
};

const validPair = () => ({
  red: {
    base_sha: SHA, contract_sha256: HASH, test_sha256: HASH,
    fixture_sha256: HASH, test_id: 'knox-2285-own-direction',
    command: 'vitest run wire-clause-prices.test.ts -t own-direction',
    artifact_url: 'https://github.com/example/runs/1', exit_code: 1,
    failure_kind: 'ASSERTION_FAILURE',
    failure_log_excerpt: 'AssertionError: incoming wire at the outgoing price',
  },
  green: {
    head_sha: HEAD, contract_sha256: HASH, test_sha256: HASH,
    fixture_sha256: HASH, test_id: 'knox-2285-own-direction',
    command: 'vitest run wire-clause-prices.test.ts -t own-direction',
    artifact_url: 'https://github.com/example/runs/2', exit_code: 0,
    status: 'PASSED', required_checks: [{ name: 'app-tests', conclusion: 'success' }],
  },
});

describe('M0/M1 engineering verification contract', () => {
  it('validates stable issue/requirement/test mapping and identifies routed Knox skills', () => {
    expect(validateContract(fixture)).toEqual({ ok: true, errors: [] });
    expect(routeSkills(fixture.scope)).toEqual([...fixture.required_skills].sort());
    expect(contractDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
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

  it('cannot down-classify security mutations or avoid separate approval', () => {
    const invalid = { ...fixture, scope: ['supabase/migrations/**'], risk_tier: 'R2' };
    expect(validateContract(invalid).errors.join(' ')).toContain('Risk down-classification');
    expect(validateContract({ ...invalid, risk_tier: 'R3', human_approval_required: false }).errors.join(' ')).toContain('human approval');
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

  it('rejects same-code GREEN on old baseline, wrong signature, drift and skip', () => {
    const pair = validPair();
    pair.green.head_sha = SHA;
    pair.green.test_sha256 = 'd'.repeat(64);
    pair.green.required_checks = [{ name: 'app-tests', conclusion: 'skipped' }];
    pair.red.failure_log_excerpt = 'Module not found';
    expect(assessProofPair(fixture, pair, HEAD, HASH).problems.length).toBeGreaterThanOrEqual(4);
  });

  it('never accepts no aggregate check or unverifiable requirement/test ID', () => {
    const pair = validPair();
    pair.red.test_id = 'invented';
    pair.green.test_id = 'invented';
    pair.green.required_checks = [];
    expect(assessProofPair(fixture, pair, HEAD, HASH).status).toBe('BLOCKED');
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
