// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertNativeContractPath, validateRevisionContract, expectedWorkflowDigest } from './proof.mjs';
import { resolveContractRevision } from './contract-registry.mjs';
import { nativeBlobSha, nativeTreeResponse } from './native-tree.fixture';

const REF = 'a'.repeat(40), revision = resolveContractRevision('1048-v3');
const files = { [revision.path]: '{"fixture":"contract metadata only"}' };
function graph(change?: (value: Record<string, unknown>, path: string) => void) {
  return vi.fn(async (path: string) => {
    const value = structuredClone(nativeTreeResponse(path, files)) as Record<string, unknown>;
    if (!value) throw new Error('Unexpected fixture API path');
    change?.(value, path);
    return value;
  });
}
describe('canonical immutable native contract path', () => {
  it('requires Git commit and every regular directory mode before returning the exact blob identity', async () => {
    const get = graph();
    expect(await assertNativeContractPath(revision, REF, get)).toBe(nativeBlobSha(files[revision.path]));
    expect(get.mock.calls[0][0]).toBe('/git/commits/' + REF);
    expect(get.mock.calls).toHaveLength(6);
    expect(get.mock.calls.every(([path]) => /^\/git\/(commits|trees)\/[a-f0-9]{40}$/.test(path))).toBe(true);
    expect(get.mock.calls.some(([path]) => path.includes('contents') || path.includes('remote'))).toBe(false);
  });
  it('allows executable regular Git blobs, while immutable graph reads share one bounded cache', async () => {
    const get = graph(value => { for (const row of (Array.isArray(value.tree) ? value.tree : []) as Array<Record<string, unknown>>) if (row.type === 'blob') row.mode = '100755'; });
    const cache = new Map();
    await assertNativeContractPath(revision, REF, get, cache);
    await assertNativeContractPath(revision, REF, get, cache);
    expect(get.mock.calls).toHaveLength(6);
  });
  it.each([
    ['file symlink', (row: Record<string, unknown>) => { if (row.type === 'blob') row.mode = '120000'; }],
    ['parent symlink', (row: Record<string, unknown>) => { if (row.path === 'docs') { row.mode = '120000'; row.type = 'blob'; } }],
    ['submodule', (row: Record<string, unknown>) => { if (row.type === 'blob') { row.mode = '160000'; row.type = 'commit'; } }],
    ['directory mode mismatch', (row: Record<string, unknown>) => { if (row.path === 'docs') row.mode = '100644'; }],
    ['malformed object identity', (row: Record<string, unknown>) => { row.sha = '../outside-canary'; }],
    ['unsafe slash segment', (row: Record<string, unknown>) => { row.path = '../outside-canary'; }],
  ])('rejects %s before any Contents or outside path request', async (_name, mutate) => {
    const get = graph(value => { for (const row of (Array.isArray(value.tree) ? value.tree : []) as Array<Record<string, unknown>>) mutate(row); });
    await expect(assertNativeContractPath(revision, REF, get)).rejects.toThrow();
    expect(JSON.stringify(get.mock.calls)).not.toContain('outside-canary');
    expect(get.mock.calls.some(([path]) => path.includes('/contents/'))).toBe(false);
  });
  it.each(['missing', 'truncated', 'duplicate', 'wrong commit', 'wrong tree'])('rejects %s native metadata', async kind => {
    const get = graph((value, path) => {
      if (path.includes('/commits/')) { if (kind === 'wrong commit') value.sha = 'b'.repeat(40); return; }
      if (kind === 'missing') value.tree = [];
      if (kind === 'truncated') value.truncated = true;
      if (kind === 'wrong tree') value.sha = 'b'.repeat(40);
      if (kind === 'duplicate') { const rows = value.tree as unknown[]; rows.push(structuredClone(rows[0])); }
    });
    await expect(assertNativeContractPath(revision, REF, get)).rejects.toThrow();
  });
  it('resolves only the registered path even if a caller adds a path override, and rejects unknown revision/ref before reads', async () => {
    const get = graph();
    expect(await assertNativeContractPath({ ...revision, path: '../outside-canary' }, REF, get)).toBe(nativeBlobSha(files[revision.path]));
    for (const key of ['latest', '../1048-v3', '1048-v3.json']) await expect(assertNativeContractPath({ key }, REF, vi.fn())).rejects.toThrow();
    const untouched = vi.fn();
    await expect(assertNativeContractPath(revision, '../outside-canary', untouched)).rejects.toThrow();
    expect(untouched).not.toHaveBeenCalled();
  });
});
describe('accepted revision preserves original declared identity', () => {
  for (const key of ['1048', '2285', '1048-v2']) it(`retains exact ${key} raw identity but rejects whitespace-only rewrite and same-issue substitution`, () => {
    const legacy = resolveContractRevision(key), raw = readFileSync(new URL('../../../' + legacy.path, import.meta.url), 'utf8');
    const contract = JSON.parse(raw);
    expect(validateRevisionContract(legacy, contract, raw)).toEqual({ ok: true, errors: [] });
    expect(validateRevisionContract(legacy, contract, raw + '\n').ok).toBe(false);
    expect(validateRevisionContract(resolveContractRevision('1048-v3'), contract, raw).ok).toBe(false);
    expect(validateRevisionContract(legacy, { ...contract, issue: '#9999' }, raw).ok).toBe(false);
  });
});


describe('reviewed proof workflow origin pin', () => {
  const path = '.github/workflows/engineering-verification.yml', pin = '07f2b3c1cd35f9ba91f61da3c14c11fea75ccd3d5b50b9db61ffe5b75f66dfb3';
  it.each(['1048', '2285'])('uses the exact reviewed historical pin for %s, ignoring caller-supplied replacement fields', key => {
    const legacy = resolveContractRevision(key);
    expect(expectedWorkflowDigest(legacy, {})).toBe(pin);
    expect(expectedWorkflowDigest({ ...legacy, historicalWorkflowSha256: '0'.repeat(64), executionStatus: 'CURRENT' }, { execution_files: [{ path, sha256: '1'.repeat(64) }] })).toBe(pin);
  });
  it('keeps v2 original workflow and Baf source distinct from original d28 history', async () => {
    const legacy = resolveContractRevision('1048-v2');
    expect(expectedWorkflowDigest(legacy, {})).toBe('02c17ecbd29b154cd667f868a7beed2b59ba70ec6ce3274face95c82be45f60a');
    expect(legacy.historicalTrustedSourceRefs).toEqual(['baf057d9e87f7f1c48306eb0ad2ef4e60dea787f']);
    expect(() => resolveContractRevision('1048-v2', { requireRunnable: true })).toThrow(/historical/i);
  });
  it('uses the current reviewed contract entry instead of caller-declared historical authority', () => {
    const current = resolveContractRevision('1048-v3');
    expect(expectedWorkflowDigest({ ...current, historicalWorkflowSha256: pin, executionStatus: 'HISTORICAL_ONLY' }, { execution_files: [{ path, sha256: 'a'.repeat(64) }] })).toBe('a'.repeat(64));
  });
  it.each([
    {},
    { execution_files: [] },
    { execution_files: [{ path: 'different.yml', sha256: 'a'.repeat(64) }] },
    { execution_files: [{ path, sha256: 'a'.repeat(64) }, { path, sha256: 'a'.repeat(64) }] },
    { execution_files: [{ path, sha256: ['a'.repeat(64)] }] },
    { execution_files: [{ path, sha256: 'not-a-digest' }] },
  ])('rejects missing, ambiguous or non-string CURRENT workflow authority %j', contract => {
    expect(() => expectedWorkflowDigest(resolveContractRevision('1048-v3'), contract)).toThrow();
  });
});
