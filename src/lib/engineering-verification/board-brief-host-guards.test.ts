// @vitest-environment node
/** Trusted temporary filesystem/fake process inputs only; no candidate or Docker execution. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ownedCleanupAssessment, validateDraftOutputDirectory, type ProcessResult } from './board-brief-runner.mjs';

const roots: string[] = [];
const clean: ProcessResult = { status: 0, signal: null, stdout: '', stderr: '' };
function fakeRepository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hamilton-host-guards-')));
  roots.push(root);
  const ignored = join(root, 'test-results/engineering-verification/hamilton-proof-adapter');
  mkdirSync(ignored, { recursive: true });
  return { root, ignored };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('independent explicit native absence output', () => {
  it('accepts an explicitly observed empty string inventory', () => {
    expect(ownedCleanupAssessment(clean, clean)).toEqual({ ok: true, problems: [] });
  });
  it('accepts an explicitly observed empty native Buffer inventory', () => {
    expect(ownedCleanupAssessment(clean, { ...clean, stdout: Buffer.alloc(0) })).toEqual({ ok: true, problems: [] });
  });
  it('does not infer resource absence from a missing stdout field', () => {
    const result = ownedCleanupAssessment(clean, { status: 0, signal: null, stderr: '' });
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
  it.each<[string, unknown]>([
    ['null', null],
    ['an object', { empty: true }],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28])],
  ])('does not infer resource absence from %s output', (_label, stdout) => {
    const result = ownedCleanupAssessment(clean, { ...clean, stdout } as ProcessResult);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe('independent canonical ignored output ownership', () => {
  it('returns the fresh canonical absolute path without creating its destination', () => {
    const { root, ignored } = fakeRepository(), destination = join(ignored, 'attempt-valid');
    expect(validateDraftOutputDirectory(root, destination)).toBe(destination);
    expect(existsSync(destination)).toBe(false);
  });
  it('does not create absent nested parents during pure validation', () => {
    const { root, ignored } = fakeRepository(), parent = join(ignored, 'new-parent'), destination = join(parent, 'new-child/attempt');
    expect(validateDraftOutputDirectory(root, destination)).toBe(destination);
    expect(existsSync(parent)).toBe(false);
    expect(existsSync(destination)).toBe(false);
  });
  it('rejects the ignored root itself', () => {
    const { root, ignored } = fakeRepository();
    expect(() => validateDraftOutputDirectory(root, ignored)).toThrow();
  });
  it('rejects a pre-existing destination and preserves its contents', () => {
    const { root, ignored } = fakeRepository(), destination = join(ignored, 'already-owned');
    mkdirSync(destination); writeFileSync(join(destination, 'receipt.txt'), 'EXISTING RECEIPT');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(readFileSync(join(destination, 'receipt.txt'), 'utf8')).toBe('EXISTING RECEIPT');
  });
  it('rejects an ordinary source path outside the ignored subtree', () => {
    const { root } = fakeRepository(), destination = join(root, 'src/new-output');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(destination)).toBe(false);
  });
  it('rejects a sibling path sharing only the ignored-root string prefix', () => {
    const { root, ignored } = fakeRepository(), destination = ignored + '-outside/attempt';
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(destination)).toBe(false);
  });
  it('rejects a direct symlink parent into another repository directory', () => {
    const { root, ignored } = fakeRepository(), target = join(root, 'src/foreign');
    mkdirSync(target, { recursive: true }); symlinkSync(target, join(ignored, 'alias'), 'dir');
    const destination = join(ignored, 'alias/attempt');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(join(target, 'attempt'))).toBe(false);
  });
  it('rejects an earlier symlink even when the nearest existing parent is an ordinary directory inside the repository', () => {
    const { root, ignored } = fakeRepository(), target = join(root, 'src/foreign');
    mkdirSync(join(target, 'ordinary-parent'), { recursive: true });
    writeFileSync(join(target, 'ordinary-parent/sentinel.txt'), 'FOREIGN CONTENT');
    symlinkSync(target, join(ignored, 'alias'), 'dir');
    const destination = join(ignored, 'alias/ordinary-parent/attempt');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(join(target, 'ordinary-parent/attempt'))).toBe(false);
    expect(readFileSync(join(target, 'ordinary-parent/sentinel.txt'), 'utf8')).toBe('FOREIGN CONTENT');
  });
  it('rejects alias ancestry even when its target remains inside the ignored subtree', () => {
    const { root, ignored } = fakeRepository(), target = join(ignored, 'another-attempt');
    mkdirSync(join(target, 'ordinary-parent'), { recursive: true }); symlinkSync(target, join(ignored, 'alias'), 'dir');
    const destination = join(ignored, 'alias/ordinary-parent/attempt');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(join(target, 'ordinary-parent/attempt'))).toBe(false);
  });
  it('rejects a symlink in the ignored-root ancestry itself', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'hamilton-host-guards-'))); roots.push(root);
    const redirected = join(root, 'src/redirected');
    mkdirSync(join(redirected, 'engineering-verification/hamilton-proof-adapter'), { recursive: true });
    symlinkSync(redirected, join(root, 'test-results'), 'dir');
    const destination = join(root, 'test-results/engineering-verification/hamilton-proof-adapter/attempt');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(join(redirected, 'engineering-verification/hamilton-proof-adapter/attempt'))).toBe(false);
  });
  it('rejects a regular file masquerading as an output ancestor', () => {
    const { root, ignored } = fakeRepository(), file = join(ignored, 'ordinary-file');
    writeFileSync(file, 'RETAIN FILE');
    expect(() => validateDraftOutputDirectory(root, join(file, 'attempt'))).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('RETAIN FILE');
  });
  it('rejects an existing dangling symlink destination', () => {
    const { root, ignored } = fakeRepository(), destination = join(ignored, 'dangling');
    symlinkSync(join(root, 'does-not-exist'), destination, 'dir');
    expect(() => validateDraftOutputDirectory(root, destination)).toThrow();
    expect(existsSync(join(root, 'does-not-exist'))).toBe(false);
  });
});
