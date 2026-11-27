// @vitest-environment node
/** Actual trusted Node child lifecycle/error checks. No candidate, DB, browser or provider. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DRIVER = fileURLToPath(new URL('./contained-probe.mjs', import.meta.url));
const ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const PROOF = join(ROOT, 'test-results/engineering-verification/hamilton-proof-adapter/contained-driver-harness');
const RAW_BUDGET = 2097152;
const CAPTURE_BUDGET = RAW_BUDGET - 65536; // Reserve bounded metadata; source input/output caps stay unchanged.
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const runtimeFiles = ['contained-probe.mjs', 'transparent-hold.mjs', 'http-framing.mjs', '__fixtures__/transport-probe.mjs'];
const sourceHashes = () => Object.fromEntries(runtimeFiles.map(path => [path, sha(readFileSync(join(dirname(DRIVER), path)))]));

function freshProof() {
  mkdirSync(PROOF, { recursive: true, mode: 0o700 });
  if (realpathSync(PROOF) !== PROOF || lstatSync(PROOF).isSymbolicLink()) throw new Error('Canonical owned proof root required');
  return mkdtempSync(join(PROOF, 'owned-child-'));
}

async function observeDriver(label: string, waitMs: number, input?: Buffer) {
  const directory = freshProof(), before = sourceHashes(), begun = performance.now();
  const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  const stdinErrors: string[] = [];
  let capturedBytes = 0, captureOverflow = false, harnessKilled = false;
  let spawnError: string | null = null, closeCode: number | null = null, closeSignal: string | null = null;
  let nativeCloseObserved = false, naturalClose = false, stdinWriteCompleted = input === undefined;
  // This is a trusted literal program. PATH is inherited; NODE_ENV is controlled. No host credentials.
  const child = spawn(process.execPath, [DRIVER], {
    cwd: dirname(DRIVER), env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stopOwned = () => {
    if (!nativeCloseObserved) {
      harnessKilled = true;
      child.kill('SIGKILL');
    }
  };
  for (const stream of ['stdout', 'stderr'] as const) {
    child[stream].on('data', (piece: Buffer) => {
      const bytes = Buffer.from(piece), remaining = Math.max(0, CAPTURE_BUDGET - capturedBytes);
      if (remaining) {
        const retained = bytes.subarray(0, remaining);
        chunks[stream].push(Buffer.from(retained));
        capturedBytes += retained.length;
      }
      if (bytes.length > remaining) { captureOverflow = true; stopOwned(); }
    });
  }
  child.stdin.on('error', (error: NodeJS.ErrnoException) => stdinErrors.push(error.code ?? error.name));
  child.once('error', (error: NodeJS.ErrnoException) => { spawnError = error.code ?? error.name; });
  const closed = new Promise<void>(done => child.once('close', (code, signal) => {
    closeCode = code; closeSignal = signal; nativeCloseObserved = true; naturalClose = !harnessKilled; done();
  }));
  if (input) {
    // Deliberately keep stdin open: overflow must be detected before EOF.
    child.stdin.write(input, error => {
      stdinWriteCompleted = !error;
      if (error) stdinErrors.push((error as NodeJS.ErrnoException).code ?? error.name);
    });
  }
  let timer: NodeJS.Timeout | undefined;
  const closedWithin = async (milliseconds: number) => {
    const result = await Promise.race([
      closed.then(() => true),
      new Promise<boolean>(done => { timer = setTimeout(() => done(false), milliseconds); }),
    ]);
    clearTimeout(timer);
    return result;
  };
  try {
    if (!await closedWithin(waitMs)) {
      stopOwned();
      await closedWithin(1000);
    }
  } finally {
    clearTimeout(timer);
    if (!nativeCloseObserved) {
      stopOwned();
      await closedWithin(500);
    }
    // Only after native exit or the owned kill attempt; this cannot supply the missing input EOF.
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  }
  const elapsedMs = performance.now() - begun, after = sourceHashes();
  const stdout = Buffer.concat(chunks.stdout), stderr = Buffer.concat(chunks.stderr);
  const diagnostic = {
    label, pid: child.pid ?? null, executable: process.execPath, nodeVersion: process.versions.node,
    hostPlatform: process.platform, hostArch: process.arch, childEnvironmentKeys: ['PATH', 'NODE_ENV'], shell: false,
    inputBytes: input?.length ?? 0, inputSha256: input ? sha(input) : null, stdinEOFRequested: false,
    stdinWriteCompleted, stdinErrors, closeCode, closeSignal, nativeCloseObserved, naturalClose,
    harnessKilled, spawnError, captureOverflow, elapsedMs, waitMs, sourceBefore: before, sourceAfter: after,
    stdout: { bytes: stdout.length, sha256: sha(stdout), path: 'stdout.bin' },
    stderr: { bytes: stderr.length, sha256: sha(stderr), path: 'stderr.bin' },
    scope: 'Trusted host Node child and raw pipes only; no product/native acceptance or full cleanup qualification.',
  };
  const metadata = Buffer.from(JSON.stringify(diagnostic, null, 2) + '\n');
  if (metadata.length + stdout.length + stderr.length > RAW_BUDGET) throw new Error('Harness artifact budget exceeded');
  writeFileSync(join(directory, 'stdout.bin'), stdout, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'stderr.bin'), stderr, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'receipt.json'), metadata, { flag: 'wx', mode: 0o600 });
  console.info('CONTAINED_DRIVER_CHILD_OBSERVATION', JSON.stringify({ directory, ...diagnostic }));
  expect(after).toEqual(before);
  expect(spawnError).toBeNull();
  expect(child.pid).toBeGreaterThan(0);
  expect(nativeCloseObserved).toBe(true);
  expect(captureOverflow).toBe(false);
  return { stdout, stderr, diagnostic };
}

function record(stdout: Buffer) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  return JSON.parse(text) as {
    schemaVersion: number; executionComplete: boolean; executionError: string;
    primaryError?: { name: string; message: string; code: string | null };
    requiredNativeStatus: string; registrationStatus: string;
  };
}

describe('prospective contained driver process boundaries and retained native errors', () => {
  it('kept-open empty stdin is terminated by the actual45000ms driver deadline without parent EOF or a fabricated completion', async () => {
    const { stdout, diagnostic } = await observeDriver('DRIVER-STDIN-DEADLINE', 47000);
    expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(44900);
    expect(diagnostic.elapsedMs).toBeLessThan(49000);
    expect(diagnostic.harnessKilled).toBe(false);
    expect(diagnostic.naturalClose).toBe(true);
    expect(diagnostic.closeCode).toBe(1);
    expect(diagnostic.closeSignal).toBeNull();
    expect(diagnostic.stdinEOFRequested).toBe(false);
    const result = record(stdout);
    expect(result.schemaVersion).toBe(1);
    expect(result.executionComplete).toBe(false);
    expect(result.executionError).toBe('whole_case_deadline');
    expect(result.primaryError).toEqual(expect.objectContaining({ name: 'Error', message: 'whole_case_deadline', code: null }));
    expect(result.requiredNativeStatus).toBe('BLOCKED');
    expect(result.registrationStatus).toBe('UNREGISTERED');
  }, 50000);

  it('2097153 actual input bytes reject before EOF and retain Error input_bound instead of only a generic classifier', async () => {
    const input = Buffer.alloc(2097153, 0x61);
    expect(input.length).toBe(2097153);
    const { stdout, diagnostic } = await observeDriver('DRIVER-INPUT-BOUND-ERROR', 7000, input);
    expect(diagnostic.harnessKilled).toBe(false);
    expect(diagnostic.naturalClose).toBe(true);
    expect(diagnostic.closeCode).toBe(1);
    expect(diagnostic.closeSignal).toBeNull();
    expect(diagnostic.inputBytes).toBe(2097153);
    expect(diagnostic.stdinEOFRequested).toBe(false);
    const result = record(stdout);
    expect(result.executionComplete).toBe(false);
    expect(result.executionError).toBe('probe_execution_incomplete');
    expect(result.primaryError).toEqual(expect.objectContaining({ name: 'Error', message: 'input_bound', code: null }));
    expect(result.requiredNativeStatus).toBe('BLOCKED');
    expect(result.registrationStatus).toBe('UNREGISTERED');
  }, 10000);
});
