// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, unlinkSync, rmSync, realpathSync, writeSync, openSync, closeSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BoundedArtifactStore, BoundedCapturer, CollectionClock, COLLECTION_LIMITS,
  admitBuiltinNone, admitNativeConfiguration, canonicalPath, cleanupOwnedContainer, ownedNativeContainer,
  processCaptureComplete, readBoundedRegular, validateBatchManifest, validateChildBatchRecord,
  writeAll, finalizeBatchReceipt, probeOwnedProcessGroup } from './ci-domain-collection.mjs';
import type { CaptureFunction, CaptureRecord } from './ci-domain-collection.mjs';
import { syntheticBatchEvidence, syntheticNativeFixture } from './ci-domain-collection.fixture';

const roots: string[] = [];
const fresh = () => { const path = realpathSync(mkdtempSync(join(tmpdir(), 'verification-collection-unit-'))); roots.push(path); return path; };
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe('reader native configuration admission is a pure structural prerequisite', () => {
  it('admits only the synthetic created/no-network/nonroot limits and ignores harmless object key order', () => {
    const f = syntheticNativeFixture();
    expect(admitBuiltinNone(f.builtin)).toBe(true);
    expect(ownedNativeContainer(f.native, f.identity)).toBe(true);
    expect(admitNativeConfiguration(f.native, f.image, f.identity, f.harness, f.builtin)).toBe(true);
    f.native.NetworkSettings.Networks.none.NetworkID = f.builtin.Id;
    expect(admitNativeConfiguration(f.native, f.image, f.identity, f.harness, f.builtin)).toBe(true);
  });
  const mutations: [string, (native: ReturnType<typeof syntheticNativeFixture>['native']) => void][] = [
    ['wrong owner', value => { value.Config.Labels['org.feeinsight.verification.owner'] = 'foreign'; }],
    ['wrong role', value => { value.Config.Labels['org.feeinsight.verification.kind'] = 'foreign'; }],
    ['wrong batch', value => { value.Config.Labels['org.feeinsight.verification.case'] = 'foreign'; }],
    ['wrong image', value => { value.Image = 'sha256:' + 'd'.repeat(64); }],
    ['extra env', value => { value.Config.Env.push('FORBIDDEN=literal'); }],
    ['unexpected command', value => { value.Config.Cmd = ['node', '/unreviewed.mjs']; }],
    ['root user', value => { value.Config.User = '0'; }],
    ['boolean PID', value => { Object.assign(value.State, { Pid: false }); }],
    ['running', value => { value.State.Running = true; }],
    ['started status', value => { value.State.Status = 'running'; }],
    ['sandbox started', value => { value.NetworkSettings.SandboxID = 'started'; }],
    ['host network', value => { value.HostConfig.NetworkMode = 'host'; }],
    ['extra endpoint', value => { Object.assign(value.NetworkSettings.Networks, { bridge: {} }); }],
    ['foreign none identity', value => { value.NetworkSettings.Networks.none.NetworkID = 'a'.repeat(64); }],
    ['IP address', value => { value.NetworkSettings.Networks.none.IPAddress = '192.0.2.1'; }],
    ['writable root', value => { value.HostConfig.ReadonlyRootfs = false; }],
    ['privilege', value => { value.HostConfig.Privileged = true; }],
    ['extra swap', value => { value.HostConfig.MemorySwap *= 2; }],
    ['PID expansion', value => { value.HostConfig.PidsLimit++; }],
    ['CPU expansion', value => { value.HostConfig.NanoCpus *= 2; }],
    ['extra capability', value => { Object.assign(value.HostConfig, { CapAdd: ['NET_ADMIN'] }); }],
    ['DNS', value => { Object.assign(value.HostConfig, { Dns: ['192.0.2.1'] }); }],
    ['writable mount', value => { value.Mounts[0].RW = true; }],
    ['extra mount', value => { value.Mounts.push({ ...value.Mounts[0], Source: '/unrelated', Destination: '/socket' }); }],
    ['wrong bind', value => { value.Mounts[0].Source = '/unrelated'; }],
  ];
  it.each(mutations)('refuses %s before start', (_name, mutate) => {
    const f = syntheticNativeFixture(); mutate(f.native);
    expect(admitNativeConfiguration(f.native, f.image, f.identity, f.harness, f.builtin)).toBe(false);
  });
  it.each(['missing image ID', 'wrong repository digest', 'image credential env', 'unexpected entrypoint'])('refuses %s in image identity', mode => {
    const f = syntheticNativeFixture();
    if (mode === 'missing image ID') Object.assign(f.image, { Id: undefined });
    if (mode === 'wrong repository digest') f.image.RepoDigests = ['node@sha256:' + 'f'.repeat(64)];
    if (mode === 'image credential env') { f.image.Config.Env.push('TOKEN=literal'); f.native.Config.Env.push('TOKEN=literal'); }
    if (mode === 'unexpected entrypoint') { f.image.Config.Entrypoint = ['unreviewed']; f.native.Config.Entrypoint = ['unreviewed']; }
    expect(admitNativeConfiguration(f.native, f.image, f.identity, f.harness, f.builtin)).toBe(false);
  });
});

function fakeCapture(reply: (label: string, argv: string[]) => Buffer, failLabels: string[] = []) {
  return vi.fn<CaptureFunction>(async (label, argv) => {
    const stdout = reply(label, argv), stderr = Buffer.alloc(0);
    const record: CaptureRecord = { label, argv, phase: 'cleanup', startedOffsetMs: 0, absoluteDeadlineOffsetMs: 44000,
      inputBytes: 0, status: failLabels.includes(label) ? 1 : 0, signal: null, pid: 123, processReaped: true,
      endedOffsetMs: 1, milliseconds: 1, timeout: false, overflow: false, interrupted: false, spawnError: null,
      ioErrors: [], streamsComplete: true, inputBytesWritten: 0, inputComplete: true,
      processGroupAbsent: true, processGroupProbeError: null, processGroupCleanupRequired: false,
      processGroupProbes: [{ offsetMs: 0.5, absent: true, error: null }],
      stdout: { path: label + '.stdout.bin', bytes: stdout.length, sha256: sha(stdout), retained: true },
      stderr: { path: label + '.stderr.bin', bytes: 0, sha256: sha(stderr), retained: true } };
    return { record, stdout, stderr };
  });
}

describe('owned cleanup never broadens discovery or deletes a foreign resource', () => {
  const replies = (f: ReturnType<typeof syntheticNativeFixture>) => (label: string) => {
    if (label === 'cleanup-owned-discovery') return Buffer.from(f.identity.containerId + '\n');
    if (label.includes('owner-inspect')) return Buffer.from(JSON.stringify([f.native]));
    return Buffer.alloc(0);
  };
  it('uses name and owner selectors, full ID, fresh ownership before removal and all exact absence queries', async () => {
    const f = syntheticNativeFixture(); const capture = fakeCapture(replies(f));
    const result = await cleanupOwnedContainer(capture, f.identity, true);
    expect(result.verified).toBe(true);
    const discovery = capture.mock.calls.find(([label]) => label === 'cleanup-owned-discovery')![1];
    expect(discovery).toContain('label=org.feeinsight.verification.owner=' + f.identity.owner);
    expect(discovery).toContain('name=^/' + f.identity.name + '$');
    expect(capture.mock.calls.map(([label]) => label)).toEqual(['cleanup-owned-discovery', 'cleanup-owner-inspect', 'stop',
      'cleanup-remove-owner-inspect', 'remove', 'absence-name', 'absence-owner', 'absence-id']);
    expect(capture.mock.calls.find(([label]) => label === 'stop')![1]).toEqual(['docker', 'stop', '--timeout=1', f.identity.containerId]);
    for (const [label, argv] of capture.mock.calls) if (['stop', 'remove'].includes(label)) expect(argv.at(-1)).toBe(f.identity.containerId);
  });
  it('recovers a partially-created owned ID without assuming name-only ownership', async () => {
    const f = syntheticNativeFixture(), capture = fakeCapture(replies(f));
    const result = await cleanupOwnedContainer(capture, { ...f.identity, containerId: null }, true);
    expect(result.containerId).toBe(f.identity.containerId);
    expect(result.absence.id).toBe(true);
  });
  it.each(['ambiguous', 'foreign', 'changed-id'])('refuses %s discovery and preserves an unrelated sentinel', async mode => {
    const f = syntheticNativeFixture(), path = join(fresh(), 'unrelated-sentinel'); writeFileSync(path, 'untouched');
    const capture = fakeCapture(label => {
      if (label === 'cleanup-owned-discovery') return Buffer.from(mode === 'ambiguous' ? f.identity.containerId + '\n' + 'f'.repeat(64) + '\n' : (mode === 'changed-id' ? 'f'.repeat(64) : f.identity.containerId) + '\n');
      if (label === 'cleanup-owner-inspect') return Buffer.from(JSON.stringify([{ ...f.native, Config: { ...f.native.Config, Labels: {} } }]));
      return Buffer.alloc(0);
    });
    const result = await cleanupOwnedContainer(capture, f.identity, true);
    expect(result.verified).toBe(false);
    expect(capture.mock.calls.some(([label]) => ['stop', 'remove'].includes(label))).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('untouched');
  });
  it('attempts owned removal after stop failure but keeps the entire collection blocked', async () => {
    const f = syntheticNativeFixture(), capture = fakeCapture(replies(f), ['stop']);
    const result = await cleanupOwnedContainer(capture, f.identity, true);
    expect(result.verified).toBe(false);
    expect(capture.mock.calls.map(([label]) => label)).toContain('remove');
    expect(result.errors.join(' ')).toContain('stop:');
  });
  it('does not remove a container whose owner changes between stop and removal', async () => {
    const f = syntheticNativeFixture(), capture = fakeCapture(label => label === 'cleanup-remove-owner-inspect'
      ? Buffer.from(JSON.stringify([{ ...f.native, Config: { ...f.native.Config, Labels: {} } }])) : replies(f)(label));
    const result = await cleanupOwnedContainer(capture, f.identity, true);
    expect(result.verified).toBe(false);
    expect(capture.mock.calls.some(([label]) => label === 'remove')).toBe(false);
  });
  it.each(['nonempty', 'failed'])('requires successful empty exact inventories (%s)', async mode => {
    const f = syntheticNativeFixture(), capture = fakeCapture(label => label === 'absence-id' && mode === 'nonempty' ? Buffer.from(f.identity.containerId + '\n') : replies(f)(label), mode === 'failed' ? ['absence-id'] : []);
    expect((await cleanupOwnedContainer(capture, f.identity, true)).verified).toBe(false);
  });
  it('preserves a known ID even when discovery is empty and still requires exact-ID absence', async () => {
    const f = syntheticNativeFixture(), capture = fakeCapture(() => Buffer.alloc(0));
    const result = await cleanupOwnedContainer(capture, f.identity, true);
    expect(result.containerId).toBe(f.identity.containerId);
    expect(capture.mock.calls.map(([label]) => label)).toContain('absence-id');
    expect(capture.mock.calls.some(([label]) => ['stop', 'remove'].includes(label))).toBe(false);
  });
});

describe('complete raw records remain data, never authored behavioral verdicts', () => {
  it('validates a fully synthetic batch manifest and all identity bindings without minting authority', () => {
    const f = syntheticBatchEvidence();
    expect(validateBatchManifest(f.manifest, { sourceRef: f.manifest.source.commit, sourceSha256: f.manifest.source.sha256,
      childSha256: f.manifest.harness.childSha256, collectionSha256: f.manifest.harness.collectionSha256,
      parserSha256: f.manifest.harness.parserSha256 })).toBe(f.manifest);
    expect(f.manifest.currentCodeVerified).toBe(false);
    expect(f.manifest.registered).toBe(false);
    expect(f.manifest.source.sha256).toBe(sha(f.artifacts['subject-git-bytes.stdout.bin']));
  });
  it('retains literal old Baf source bytes for a synthetic historical batch without executing them', () => {
    const f = syntheticBatchEvidence({ sourceRef: 'baf057d9e87f7f1c48306eb0ad2ef4e60dea787f', sourceSha256: '87a9210baf62c30dab3e3b83863a6b9399cafd6159755b239bbc80ffdd0e996d' });
    expect(sha(f.artifacts['subject-git-bytes.stdout.bin'])).toBe(f.manifest.source.sha256);
    expect(() => validateBatchManifest(f.manifest)).not.toThrow();
  });
  it('refuses the exact retained first-attempt warning bytes despite coherent modern command metadata', () => {
    // Inert literal bytes from formal-reviewed-01/red-reader-01-32/stop.stdout.bin;
    // no original receipt or output is changed, repaired, or replayed as acceptance.
    const containerId = '3e4f042ea36ab0a82255291dd6af45a592329d4eab784eb3bf15c22633aba3be';
    const retained = Buffer.from('Flag --time has been deprecated, use --timeout instead\n3e4f042ea36ab0a82255291dd6af45a592329d4eab784eb3bf15c22633aba3be\n');
    expect(retained.length).toBe(120);
    expect(sha(retained)).toBe('8709c7e38073a32649872882300070fae168d08080473e2e856ae8ab34a1f1f1');
    const f = syntheticBatchEvidence({ nativeContainerId: containerId, stopStdoutBytes: retained });
    expect(f.artifacts['stop.stdout.bin']).toEqual(retained);
    expect(f.manifest.processes.find(row => row.label === 'stop')!.argv).toEqual(['docker', 'stop', '--timeout=1', containerId]);
    expect(() => validateBatchManifest(f.manifest)).toThrow('Native status or exact-absence output identity mismatch');
  });
  it('admits literal --timeout=1 with ID-only stdout and refuses legacy argv without accepting repaired output', () => {
    const current = syntheticBatchEvidence();
    expect(current.manifest.processes.find(row => row.label === 'stop')!.argv).toEqual(['docker', 'stop', '--timeout=1', current.manifest.nativeContainer.id]);
    expect(current.artifacts['stop.stdout.bin']).toEqual(Buffer.from(current.manifest.nativeContainer.id + '\n'));
    expect(current.artifacts['stop.stdout.bin'].length).toBe(65);
    expect(() => validateBatchManifest(current.manifest)).not.toThrow();
    const legacy = syntheticBatchEvidence({ stopArgument: '--time=1' });
    expect(() => validateBatchManifest(legacy.manifest)).toThrow('Native command identity mismatch');
  });
  it.each([
    ['extra authority', (v: Record<string, unknown>) => { v.currentCodeVerified = true; }],
    ['extra key', (v: Record<string, unknown>) => { v.nativeProofVerified = true; }],
    ['missing case', (v: Record<string, unknown>) => { (v.caseIds as string[]).pop(); }],
    ['duplicate case', (v: Record<string, unknown>) => { (v.caseIds as string[])[1] = (v.caseIds as string[])[0]; }],
    ['failed cleanup', (v: Record<string, unknown>) => { v.cleanupVerified = false; }],
    ['source bookend', (v: Record<string, unknown>) => { v.sourceBookendMatches = false; }],
    ['missing lifecycle', (v: Record<string, unknown>) => { (v.processes as unknown[]).pop(); }],
    ['duplicate lifecycle', (v: Record<string, unknown>) => { (v.processes as unknown[])[1] = (v.processes as unknown[])[0]; }],
    ['missing raw inventory', (v: Record<string, unknown>) => { (v.artifacts as unknown[]).pop(); }],
    ['expanded deadline', (v: Record<string, unknown>) => { v.absoluteDeadlines = { workMs: 30000, cleanupEndMs: 45000, wholeMs: 46000 }; }],
  ])('refuses %s rather than producing a passing source result', (_name, change) => {
    const value = clone(syntheticBatchEvidence().manifest) as unknown as Record<string, unknown>; change(value);
    expect(() => validateBatchManifest(value)).toThrow();
  });
  it.each(['timeout', 'overflow', 'interrupted'] as const)('refuses an otherwise shaped record with %s', key => {
    const value = clone(syntheticBatchEvidence().manifest); value.processes[8][key] = true;
    expect(() => validateBatchManifest(value)).toThrow();
  });
  it.each(['extra authority', 'wrong process target', 'unbounded create', 'wrong input bytes'])('refuses %s in native process metadata', mode => {
    const value = clone(syntheticBatchEvidence().manifest);
    if (mode === 'extra authority') Object.assign(value.processes[8], { currentCodeVerified: true });
    if (mode === 'wrong process target') value.processes[8].argv[value.processes[8].argv.length - 1] = 'f'.repeat(64);
    if (mode === 'unbounded create') value.processes[6].argv = value.processes[6].argv.filter(item => item !== '--network=none');
    if (mode === 'wrong input bytes') value.processes[8].inputBytes++;
    expect(() => validateBatchManifest(value)).toThrow();
  });
  it('accepts observed API authentication claims as ordinary values while rejecting protocol authority', () => {
    const f = syntheticBatchEvidence({ batchId: 'reader-33-39' });
    const value = JSON.parse(f.artifacts['start-attach.stdout.bin'].toString());
    value.cases[0].observation.provenanceKind = 'authenticated-github-api'; value.cases[0].observation.inProcessEvidenceClaim = true;
    expect(() => validateChildBatchRecord(value, f.manifest.caseIds, [])).not.toThrow();
    value.currentCodeVerified = true;
    expect(() => validateChildBatchRecord(value, f.manifest.caseIds, [])).toThrow();
  });
  it('refuses caught setup faults and forged read counters despite plausible source refusals', () => {
    const f = syntheticBatchEvidence({ batchId: 'reader-33-39' });
    const value = JSON.parse(f.artifacts['start-attach.stdout.bin'].toString());
    value.cases[0].observation.globalProblems = ['Plausible refusal']; value.cases[0].wrapper.setupErrors = ['caught unmapped URL'];
    expect(() => validateChildBatchRecord(value, f.manifest.caseIds, [])).toThrow();
    value.cases[0].wrapper.setupErrors = []; value.cases[0].wrapper.membershipReadCount = 2;
    expect(() => validateChildBatchRecord(value, f.manifest.caseIds, [])).toThrow();
  });
});

describe('bounded capture preserves raw streams and refuses incomplete processes', () => {
  const capturer = () => new BoundedCapturer(new BoundedArtifactStore(fresh()), new CollectionClock());
  it('retains exact binary stdout/stderr and complete input, without inherited non-whitelisted credentials', async () => {
    const c = capturer(), payload = Buffer.from([0, 255, 10]);
    process.env.CI_DOMAIN_LITERAL_TEST_SECRET = 'literal-marker';
    try {
      const result = await c.capture('binary', [process.execPath, '-e', "if(process.env.CI_DOMAIN_LITERAL_TEST_SECRET)process.exit(3);process.stdin.on('data',v=>process.stdout.write(v));process.stdin.on('end',()=>process.stderr.write(Buffer.from([0,255,10])))"], { payload, milliseconds: 2000 });
      expect(processCaptureComplete(result.record)).toBe(true);
      expect(result.stdout).toEqual(payload); expect(result.stderr).toEqual(payload);
      expect(result.record.inputBytesWritten).toBe(payload.length);
      expect(c.store.inventory().some(row => row.path === 'binary.stdout.bin' && row.sha256 === sha(payload))).toBe(true);
    } finally { delete process.env.CI_DOMAIN_LITERAL_TEST_SECRET; }
  });
  it('marks overflow, keeps only the finite prefix, and kills/reaps the source process', async () => {
    const result = await capturer().capture('overflow', [process.execPath, '-e', "process.stdout.write(Buffer.alloc(8192,65));setInterval(()=>{},10000)"], { limit: 128, milliseconds: 1500 });
    expect(result.record.overflow).toBe(true); expect(result.stdout.length).toBe(128);
    expect(result.record.processReaped).toBe(true); expect(processCaptureComplete(result.record)).toBe(false);
  });
  it('kills and reaps a timed-out process without accepting exit status as behavior', async () => {
    const result = await capturer().capture('timeout', [process.execPath, '-e', 'setInterval(()=>{},10000)'], { milliseconds: 500 });
    expect(result.record.timeout).toBe(true); expect(result.record.processReaped).toBe(true);
    expect(processCaptureComplete(result.record)).toBe(false);
  });
  it('kills descendants holding inherited pipes even after the original process exits zero', async () => {
    const code = "const{spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:['ignore',process.stdout,process.stderr]});process.exit(0)";
    const result = await capturer().capture('descendant', [process.execPath, '-e', code], { milliseconds: 600 });
    expect(result.record.status).toBe(0); expect(result.record.timeout).toBe(true);
    expect(processCaptureComplete(result.record)).toBe(false);
  });
  it('does not infer process-group absence from a leader whose descendant closes its pipes and lives', async () => {
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},10000)'], { detached: true, stdio: 'ignore' });
    let result: Awaited<ReturnType<BoundedCapturer['capture']>> | undefined;
    try {
      const code = "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:'ignore'});c.unref();process.stdout.write(String(c.pid));process.exit(0)";
      result = await capturer().capture('closed-pipes', [process.execPath, '-e', code], { milliseconds: 1500 });
      expect(result.record.status).toBe(0);
      expect(processCaptureComplete(result.record)).toBe(false);
      expect(result.record.processGroupCleanupRequired).toBe(true);
      expect(result.record.processGroupProbes.some(probe => probe.absent === false)).toBe(true);
      if (result.record.processGroupAbsent) expect(result.record.processGroupProbes.at(-1)?.absent).toBe(true);
      else expect(processCaptureComplete(result.record)).toBe(false);
      expect(() => process.kill(sentinel.pid!, 0)).not.toThrow();
    } finally {
      if (result?.record.pid) { try { process.kill(-result.record.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
      const ended = once(sentinel, 'exit'); process.kill(-sentinel.pid!, 'SIGKILL'); await ended;
    }
  });
  it('keeps an interruption sticky through process teardown', async () => {
    const c = capturer(); const timer = setTimeout(() => c.clock.interrupt('SIGTERM'), 30);
    const result = await c.capture('interrupted', [process.execPath, '-e', 'setInterval(()=>{},10000)'], { milliseconds: 1500 });
    clearTimeout(timer); expect(result.record.interrupted).toBe(true); expect(c.clock.interruptions).toEqual(['SIGTERM']);
    expect(processCaptureComplete(result.record)).toBe(false);
  });
  it('records a spawn failure and never labels it behavioral RED', async () => {
    const result = await capturer().capture('missing', ['/literal-missing-fixture-binary'], { milliseconds: 1000 });
    expect(result.record.spawnError).toBeTruthy(); expect(processCaptureComplete(result.record)).toBe(false);
  });
  it('refuses work after its absolute deadline before spawning or opening streams', async () => {
    const c = new BoundedCapturer(new BoundedArtifactStore(fresh()), new CollectionClock(performance.now() - COLLECTION_LIMITS.workMs));
    await expect(c.capture('late', [process.execPath, '-e', 'process.exit(0)'])).rejects.toThrow('deadline');
    expect(c.records).toEqual([]); expect(c.store.inventory()).toEqual([]);
  });
});

describe('aggregate evidence includes controls, metadata, streams, removed harness bytes and receipt reserve', () => {
  it.each([0, -1, 0.5, Number.NaN, 8])('rejects zero/invalid write progress %s in one call', count => {
    const writer = vi.fn(() => count);
    expect(() => writeAll(123, Buffer.from('literal'), { writer })).toThrow('write progress');
    expect(writer).toHaveBeenCalledTimes(1);
  });
  it('handles genuine partial writes without dropping or duplicating bytes', () => {
    const path = join(fresh(), 'partial.bin'), fd = openSync(path, 'wx'); const progress: number[] = [];
    try {
      const total = writeAll(fd, Buffer.from('literal'), { writer: (handle, bytes, offset, length) => writeSync(handle, bytes, offset, Math.min(2, length)),
        onProgress: count => progress.push(count) });
      expect(total).toBe(7); expect(progress).toEqual([2, 2, 2, 1]);
    } finally { closeSync(fd); }
    expect(readFileSync(path, 'utf8')).toBe('literal');
  });
  it('accounts only actual partial progress before a failed artifact write', () => {
    let calls = 0;
    const store = new BoundedArtifactStore(fresh(), new CollectionClock(), (fd, bytes, offset, length) => ++calls === 1 ? writeSync(fd, bytes, offset, Math.min(2, length)) : 0);
    expect(() => store.save('partial.bin', Buffer.from('literal'))).toThrow('write progress');
    expect(store.written).toBe(2); expect(store.entries.get('partial.bin')?.bytes).toBe(2);
    expect(readFileSync(join(store.output, 'partial.bin'), 'utf8')).toBe('li');
    expect(store.inventory()[0].bytes).toBe(2);
  });
  it('uses the same progress guard for receipt writes and removes a failed partial receipt', () => {
    const clock = new CollectionClock(), store = new BoundedArtifactStore(fresh(), clock);
    store.save('literal.txt', Buffer.from('literal')); let calls = 0;
    store.writer = (fd, bytes, offset, length) => ++calls === 1 ? writeSync(fd, bytes, offset, Math.min(2, length)) : 0;
    expect(() => finalizeBatchReceipt(store, { kind: 'PURE_TRUSTED_FIXTURE' }, clock)).toThrow('write progress');
    expect(existsSync(join(store.output, 'receipt.json'))).toBe(false);
    expect(store.inventory()).toHaveLength(1);
  });
  it('checks the absolute write deadline before any native write', () => {
    const writer = vi.fn(() => 1);
    expect(() => writeAll(123, Buffer.from('x'), { writer, deadlineMs: performance.now() - 1 })).toThrow('deadline');
    expect(writer).not.toHaveBeenCalled();
  });
  it('does not refund removed owned harness writes or consume cleanup/receipt reserves during work', () => {
    const store = new BoundedArtifactStore(fresh());
    const before = store.available(); store.save('owned-source.mjs', Buffer.from('literal'));
    unlinkSync(join(store.output, 'owned-source.mjs')); store.entries.get('owned-source.mjs')!.retained = false;
    expect(store.inventory()).toEqual([]); expect(store.available()).toBe(before - 7);
    expect(store.available('cleanup') - store.available('work')).toBe(COLLECTION_LIMITS.cleanupReserve);
    expect(() => store.save('oversized.bin', Buffer.alloc(store.available() + 1))).toThrow('budget');
    expect(store.written).toBe(7);
  });
  it('rejects mutated or untracked retained files and canonical symlink escapes', () => {
    const root = fresh(), store = new BoundedArtifactStore(root); store.save('known.bin', Buffer.from('known'));
    writeFileSync(join(root, 'known.bin'), 'changed'); expect(() => store.inventory()).toThrow();
    const outside = fresh(); writeFileSync(join(outside, 'target'), 'literal');
    symlinkSync(join(outside, 'target'), join(root, 'alias'));
    expect(() => readBoundedRegular(join(root, 'alias'))).toThrow();
    mkdirSync(join(root, 'directory')); symlinkSync(outside, join(root, 'directory', 'ancestor'));
    expect(() => readBoundedRegular(join(root, 'directory', 'ancestor', 'target'))).toThrow();
    expect(() => canonicalPath(root + '/../alias')).toThrow();
    expect(() => readBoundedRegular(join(outside, 'target'), 2)).toThrow();
  });
});

describe('owned PGID probes distinguish absence from permission failures', () => {
  it('uses only the exact negative owned PGID and accepts ESRCH alone', () => {
    const absent = vi.fn(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
    expect(probeOwnedProcessGroup(123, absent)).toEqual({ absent: true, error: null });
    expect(absent).toHaveBeenCalledExactlyOnceWith(-123, 0);
    expect(probeOwnedProcessGroup(123, () => {})).toEqual({ absent: false, error: null });
    expect(probeOwnedProcessGroup(123, () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); })).toEqual({ absent: false, error: 'EPERM' });
    expect(() => probeOwnedProcessGroup(0, absent)).toThrow();
  });
});
