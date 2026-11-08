// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyExecution, sandboxArguments, validateSnapshotEntries } from './runner.mjs';

describe('trusted parent execution boundary', () => {
  it('rejects symlinks, submodules and escaping archive names before touching the trusted host', () => {
    expect(() => validateSnapshotEntries('120000 blob ' + 'a'.repeat(40) + '\tsrc/lib\0')).toThrow();
    expect(() => validateSnapshotEntries('160000 commit ' + 'a'.repeat(40) + '\tsrc/lib\0')).toThrow();
    expect(() => validateSnapshotEntries('100644 blob ' + 'a'.repeat(40) + '\tsrc/../../escape\0')).toThrow();
  });
  it('does not accept an import error containing an assertion title as behavioral RED', () => {
    const result = classifyExecution({ status: 1, stdout: '', stderr: 'AssertionError: business incoming wire; module not found' });
    expect(result.failure_kind).toBe('SETUP_FAILURE');
    expect(result.outcomes).toEqual([]);
  });
  it('runs static argv in a credentialless, read-only, offline container', () => {
    const args = sandboxArguments({ name: 'verification-test', image: 'node@sha256:' + 'a'.repeat(64), source: '/tmp/source', harness: '/tmp/harness', toolchain: '/tmp/toolchain' });
    expect(args).toContain('--read-only');
    expect(args).toContain('--interactive');
    expect(args).toContain('--network=none');
    expect(args).toContain('--cap-drop=ALL');
    expect(args).not.toContain('sh');
    expect(args.join(' ')).not.toContain('GITHUB_TOKEN');
    expect(args.join(' ')).not.toContain('docker.sock');
  });
});
