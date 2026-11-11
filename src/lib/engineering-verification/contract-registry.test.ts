// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_PROOF_INPUTS, FORBIDDEN_PROOF_INPUTS, HISTORICAL_PROOF_SOURCE } from './proof-inputs.fixture';
import { CONTRACT_REVISIONS, parseContractMarker, resolveContractRevision } from './contract-registry.mjs';

const accepted = [
  { key: '1048', path: 'docs/project/acceptance/engineering/1048.json', contractId: 'EV-FOUNDATION-1048', issueNumber: 1048, executionStatus: 'HISTORICAL_ONLY', adapter: 'engineering.policy.v1', historicalWorkflowSha256: '07f2b3c1cd35f9ba91f61da3c14c11fea75ccd3d5b50b9db61ffe5b75f66dfb3', requiredProofInputs: [], forbiddenProofInputs: [], historicalTrustedSourceRefs: [HISTORICAL_PROOF_SOURCE] },
  { key: '2285', path: 'docs/project/acceptance/engineering/2285.json', contractId: 'EV-KNOX-2285', issueNumber: 2285, executionStatus: 'HISTORICAL_ONLY', adapter: 'knox.free-specialists.v1', historicalWorkflowSha256: '07f2b3c1cd35f9ba91f61da3c14c11fea75ccd3d5b50b9db61ffe5b75f66dfb3', requiredProofInputs: [], forbiddenProofInputs: [], historicalTrustedSourceRefs: [HISTORICAL_PROOF_SOURCE] },
  { key: '1048-v2', path: 'docs/project/acceptance/engineering/1048-v2.json', contractId: 'EV-FOUNDATION-1048-V2', issueNumber: 1048, executionStatus: 'CURRENT', adapter: 'engineering.policy.v2', historicalWorkflowSha256: null, requiredProofInputs: [...CURRENT_PROOF_INPUTS], forbiddenProofInputs: [...FORBIDDEN_PROOF_INPUTS], historicalTrustedSourceRefs: [] },
];

describe('accepted contract revision selection', () => {
  it.each(accepted)('resolves only the exact accepted identity $key', expected => {
    const actual = resolveContractRevision(expected.key);
    expect(actual).toEqual(expected);
    expect(Object.isFrozen(actual)).toBe(true);
  });
  it('exposes one immutable unambiguous registry without an issue-number winner', () => {
    expect(CONTRACT_REVISIONS.map(row => row.key).sort()).toEqual(['1048', '1048-v2', '2285']);
    expect(new Set(CONTRACT_REVISIONS.map(row => row.key)).size).toBe(CONTRACT_REVISIONS.length);
    expect(Object.isFrozen(CONTRACT_REVISIONS)).toBe(true);
    for (const row of CONTRACT_REVISIONS) {
      expect(Object.isFrozen(row)).toBe(true);
      for (const field of ['requiredProofInputs', 'forbiddenProofInputs', 'historicalTrustedSourceRefs'] as const) expect(Object.isFrozen(row[field])).toBe(true);
    }
  });
  it('allows current execution only through its explicit accepted revision key', () => {
    expect(resolveContractRevision('1048-v2', { requireRunnable: true })).toEqual(accepted[2]);
    expect(() => resolveContractRevision('1048', { requireRunnable: true })).toThrow();
    expect(() => resolveContractRevision('2285', { requireRunnable: true })).toThrow();
  });
  it('does not treat the same logical issue as the same contract revision', () => {
    const old = resolveContractRevision('1048'), current = resolveContractRevision('1048-v2');
    expect(old.issueNumber).toBe(current.issueNumber);
    expect(old.contractId).not.toBe(current.contractId);
    expect(old.path).not.toBe(current.path);
    expect(old.adapter).not.toBe(current.adapter);
    expect(old.executionStatus).toBe('HISTORICAL_ONLY');
    expect(current.executionStatus).toBe('CURRENT');
  });
  it('cannot be rewritten by a caller to re-enable a historical pilot or escape the canonical path', () => {
    const old = resolveContractRevision('1048');
    expect(Reflect.set(old, 'executionStatus', 'CURRENT')).toBe(false);
    expect(Reflect.set(old, 'path', '/tmp/outside-contract.json')).toBe(false);
    expect(Reflect.set(old, 'historicalWorkflowSha256', '0'.repeat(64))).toBe(false);
    expect(Reflect.set(CONTRACT_REVISIONS, '0', accepted[2])).toBe(false);
    expect(() => resolveContractRevision('1048', { requireRunnable: true })).toThrow();
  });
  it.each([
    undefined, null, 1048, ['1048-v2'], { key: '1048-v2' }, '', 'latest', 'current', '1048-v1', '#1048',
    'EV-FOUNDATION-1048-V2', '1048-v2.json', '1048-V2', ' 1048-v2', '1048-v2 ', '1048-v2\n',
    '../1048-v2', '/1048-v2', '..\\1048-v2', '%2e%2e/1048-v2', '1048%2dv2', '1048-v2\0',
    '1048-v2;echo CANARY', 'file:///tmp/1048-v2.json', 'https://example.invalid/1048-v2', '*',
  ])('rejects unaccepted, ambiguous or unsafe selector %j', value => {
    expect(() => resolveContractRevision(value)).toThrow();
  });
});

describe('exactly one supported PR contract marker', () => {
  it.each(accepted)('preserves explicit revision $key in a normal PR body', expected => {
    const record = parseContractMarker(`A scoped change.\n<!-- engineering-contract: ${expected.key} -->\nEvidence follows.`);
    expect(record).toEqual(expected);
    expect(Object.isFrozen(record)).toBe(true);
  });
  it.each([
    '', null, undefined, '<!-- engineering-contract: latest -->', '<!-- engineering-contract: #1048 -->',
    '<!-- engineering-contract: EV-FOUNDATION-1048-V2 -->', '<!-- engineering-contract: 1048-v2.json -->',
    '<!-- engineering-contract: 1048-v2 -->\n<!-- engineering-contract: 1048-v2 -->',
    '<!-- engineering-contract: 1048 -->\n<!-- engineering-contract: 1048-v2 -->',
    '<!-- engineering-contract: 2285 -->\n<!-- engineering-contract: 1048-v2 -->',
    '<!-- engineering-contract: unknown -->\n<!-- engineering-contract: 1048-v2 -->',
    '<!-- engineering-contract: 1048-v2 -->\n<!-- engineering-contract: unknown -->',
    '<!-- engineering-contract: ../1048-v2 -->', '<!-- engineering-contract: %2e%2e/1048-v2 -->',
    '<!-- engineering-contract: file:///tmp/1048-v2.json -->', '<!-- engineering-contract: 1048-v2;echo CANARY -->',
    '<!-- engineering-contract: 1048-v2\0 -->', '<!-- Engineering-Contract: 1048-v2 -->',
  ])('blocks absence, ambiguity and marker aliases %j', body => {
    expect(() => parseContractMarker(body)).toThrow();
  });
});

describe('immutable original pilot bytes', () => {
  it.each([
    ['1048', '433742496a19144f88c326faadae79562540f85a99cf9ed3201089f3db98349b'],
    ['2285', 'e7b47a13b62ba06fe75b77480f2dc68f4d53dcf1820f499a4e2a18791a6d9cc5'],
  ])('retains the exact historical %s raw digest', (key, digest) => {
    const bytes = readFileSync(`docs/project/acceptance/engineering/${key}.json`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  });
});

describe('complete explicit HTML marker boundary', () => {
  it.each([
    'engineering-contract: 1048-v2',
    '<!-- engineering-contract: 1048-v2',
    '<!-- engineering-contract: 1048-v2 garbage -->',
    '<!-- engineering-contract: 1048-v2 --!>',
    'engineering-contract: 1048-v2\n<!-- engineering-contract: 1048-v2 -->',
    '<!-- engineering-contract: 1048-v2\n<!-- engineering-contract: 1048-v2 -->',
  ])('rejects an incomplete, prose or mixed marker: %s', body => {
    expect(() => parseContractMarker(body)).toThrow();
  });
});
