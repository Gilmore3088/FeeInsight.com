/** Trusted finite reader collection. No command or subject runs at module import. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, fstatSync, readSync, writeSync, lstatSync, realpathSync,
  mkdirSync, chmodSync, readdirSync, unlinkSync, rmdirSync, constants } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { parseStrictJson } from './strict-json.mjs';

export const COLLECTION_LIMITS = Object.freeze({ wholeMs: 45000, workMs: 26000, cleanupEndMs: 44000,
  artifactBytes: 2097152, receiptReserve: 65536, cleanupReserve: 262144, teardownMs: 350,
  memoryBytes: 805306368, pids: 128, cpus: 1, tmpfsBytes: 33554432, maxCases: 32 });
export const READER_IMAGE = 'node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d';
const SUBJECT = 'src/lib/engineering-verification/github.mjs';
const STIMULUS_SHA = 'c89dfc33d196fdbd002a36fd778c7daf921f0fa3e06b1de57f3415fec0a742f9';
const ORACLE_SHA = '9a017645c7467ce56f9cea9e367e5fcd93693c7b673fb9f514aefba78a5da723';
const PROBE_SHA = '5956dece3930fdcddc048f533307b84495ded5997eba624c52b9614f57756640';
const ADAPTER = 'engineering.ci-domains.v1';
const OWNER = 'org.feeinsight.verification.owner', KIND = 'org.feeinsight.verification.kind', CASE = 'org.feeinsight.verification.case';
const ROLE = 'offline-reader-values';
const HARNESS_NAMES = ['child.mjs', 'ci-domain-probe.mjs', 'ci-domain-stimulus-v2.json'];
const SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const same = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
const empty = value => value == null || value === '' || Array.isArray(value) && value.length === 0 || record(value) && Object.keys(value).length === 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const gitBlob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const cleanEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'TMPDIR']
  .filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));

export function canonicalPath(path, leafMayBeMissing = false) {
  if (typeof path !== 'string' || path !== resolve(path) || /[,\x00-\x20\x7f]/.test(path)) throw new Error('Canonical absolute control path required');
  const parts = path.split(sep); let current = sep, missing = false;
  for (let index = 1; index < parts.length; index++) {
    current = join(current, parts[index]);
    if (missing) continue;
    let info;
    try { info = lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && leafMayBeMissing) { missing = true; continue; }
      throw error;
    }
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory()) throw new Error('Symlink or nondirectory control ancestry refused');
  }
  if (!missing && realpathSync(path) !== path) throw new Error('Noncanonical control path refused');
  return path;
}

export function readBoundedRegular(path, maximum = 1048576) {
  canonicalPath(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maximum) throw new Error('Bounded regular control required');
    const pieces = []; let size = 0;
    while (size <= maximum) {
      const piece = Buffer.alloc(Math.min(65536, maximum + 1 - size));
      const count = readSync(fd, piece, 0, piece.length, null);
      if (!count) break;
      pieces.push(piece.subarray(0, count)); size += count;
    }
    const after = fstatSync(fd);
    if (size > maximum || size !== before.size || before.size !== after.size) throw new Error('Control changed or exceeded bound while reading');
    return Buffer.concat(pieces, size);
  } finally { closeSync(fd); }
}

export class CollectionClock {
  constructor(started = performance.now()) { this.started = started; this.interruptions = []; this.active = new Set(); }
  end(phase) { return this.started + (phase === 'work' ? COLLECTION_LIMITS.workMs : COLLECTION_LIMITS.cleanupEndMs); }
  require(phase, headroom = 0) {
    if (phase === 'work' && this.interruptions.length) throw new Error('Collection interrupted');
    if (performance.now() + headroom >= this.end(phase)) throw new Error('Absolute ' + phase + ' deadline exhausted');
  }
  interrupt(signal) { this.interruptions.push(signal); for (const abort of this.active) abort(); }
}

/** Every positive byte is accounted as written; zero/invalid progress never loops. */
export function writeAll(fd, bytes, { writer = writeSync, deadlineMs = Infinity, onProgress = () => {} } = {}) {
  if (!Number.isSafeInteger(fd) || fd < 0 || !types.isUint8Array(bytes) || bytes.length > COLLECTION_LIMITS.artifactBytes
    || typeof writer !== 'function' || typeof onProgress !== 'function' || typeof deadlineMs !== 'number' || Number.isNaN(deadlineMs)) throw new Error('Invalid bounded write intent');
  let offset = 0;
  while (offset < bytes.length) {
    if (performance.now() >= deadlineMs) throw new Error('Absolute write deadline exhausted');
    const count = writer(fd, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) throw new Error('Invalid or zero write progress');
    offset += count; onProgress(count);
  }
  if (performance.now() >= deadlineMs) throw new Error('Bounded write crossed absolute deadline');
  return offset;
}

export class BoundedArtifactStore {
  constructor(output, clock = new CollectionClock(), writer = writeSync) {
    this.output = canonicalPath(output); this.clock = clock; this.writer = writer; this.written = 0; this.entries = new Map();
  }
  available(phase = 'work') {
    return Math.max(0, COLLECTION_LIMITS.artifactBytes - this.written - COLLECTION_LIMITS.receiptReserve
      - (phase === 'work' ? COLLECTION_LIMITS.cleanupReserve : 0));
  }
  path(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_./-]{1,200}$/.test(name) || name.split('/').some(part => ['', '.', '..'].includes(part))) throw new Error('Unsafe artifact path');
    const target = join(this.output, name); canonicalPath(target, true);
    try { lstatSync(target); throw new Error('Artifact path is not fresh'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return target;
  }
  stream(name) {
    const path = this.path(name); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    this.entries.set(name, { path: name, bytes: 0, retained: true }); return fd;
  }
  append(name, fd, bytes, phase = 'work') {
    if (bytes.length > this.available(phase)) throw new Error('Aggregate artifact byte budget exhausted');
    writeAll(fd, bytes, { writer: this.writer, deadlineMs: this.clock.end(phase), onProgress: count => {
      this.written += count; this.entries.get(name).bytes += count;
    } });
  }
  close(name, fd) {
    closeSync(fd); const data = readBoundedRegular(join(this.output, name), COLLECTION_LIMITS.artifactBytes);
    const entry = this.entries.get(name);
    if (data.length !== entry.bytes) throw new Error('Retained stream length changed');
    entry.sha256 = hash(data); return { ...entry };
  }
  save(name, bytes, phase = 'work', mode = 0o600) {
    if (!types.isUint8Array(bytes) || bytes.length > this.available(phase)) throw new Error('Aggregate artifact byte budget exhausted');
    const fd = this.stream(name); let result;
    try { this.append(name, fd, bytes, phase); } finally { result = this.close(name, fd); }
    chmodSync(join(this.output, name), mode); return result;
  }
  inventory() {
    const result = [];
    const walk = path => {
      for (const item of readdirSync(path, { withFileTypes: true })) {
        const target = join(path, item.name); const info = lstatSync(target);
        if (info.isSymbolicLink()) throw new Error('Unexpected output symlink');
        if (info.isDirectory()) { walk(target); continue; }
        if (!info.isFile()) throw new Error('Unexpected nonregular output');
        const name = relative(this.output, target).split(sep).join('/'), expected = this.entries.get(name);
        const bytes = readBoundedRegular(target, COLLECTION_LIMITS.artifactBytes);
        if (!expected || !expected.retained || bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw new Error('Retained artifact changed or was not owned');
        result.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
      }
    };
    walk(this.output);
    if (result.length !== [...this.entries.values()].filter(row => row.retained).length) throw new Error('Retained artifact is missing');
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
}

export function processCaptureComplete(value, status = 0) {
  return record(value) && value.status === status && value.timeout === false && value.overflow === false
    && value.spawnError === null && value.interrupted === false && value.ioErrors?.length === 0
    && value.streamsComplete === true && value.inputComplete === true && value.processReaped === true
    && value.processGroupAbsent === true && value.processGroupProbeError === null && value.processGroupCleanupRequired === false;
}

/** ESRCH alone proves absence. EPERM and every other probe failure are inconclusive. */
export function probeOwnedProcessGroup(pid, probe = process.kill.bind(process)) {
  if (!Number.isSafeInteger(pid) || pid < 1 || typeof probe !== 'function') throw new Error('Exact detached owned PGID required');
  try { probe(-pid, 0); return { absent: false, error: null }; }
  catch (error) { return error.code === 'ESRCH' ? { absent: true, error: null } : { absent: false, error: String(error.code ?? error.name).slice(0, 100) }; }
}

/** Async process groups, bounded incremental binary capture, kill/drain/reap reserve. */
export class BoundedCapturer {
  constructor(store, clock) { this.store = store; this.clock = clock; this.records = []; this.environment = cleanEnvironment(); }
  async capture(label, argv, { phase = 'work', payload, milliseconds = 4000, limit = 65536 } = {}) {
    if (!/^[a-z0-9-]{1,64}$/.test(label) || !Array.isArray(argv) || !argv.length || argv.some(item => typeof item !== 'string')
      || !['work', 'cleanup'].includes(phase) || !Number.isFinite(milliseconds) || milliseconds <= 0
      || !Number.isSafeInteger(limit) || limit < 0 || limit > COLLECTION_LIMITS.artifactBytes
      || payload !== undefined && !types.isUint8Array(payload)) throw new Error('Invalid bounded process intent');
    this.clock.require(phase, COLLECTION_LIMITS.teardownMs);
    const begun = performance.now(), deadline = Math.min(this.clock.end(phase), begun + milliseconds), runEnd = deadline - COLLECTION_LIMITS.teardownMs;
    if (runEnd <= begun) throw new Error('No bounded process execution time remains');
    const intent = { label, argv: [...argv], phase, startedOffsetMs: begun - this.clock.started,
      absoluteDeadlineOffsetMs: deadline - this.clock.started, inputBytes: payload?.length ?? 0 };
    this.store.save(label + '.intent.json', json(intent), phase);
    const names = { stdout: label + '.stdout.bin', stderr: label + '.stderr.bin' };
    const fds = { stdout: this.store.stream(names.stdout), stderr: this.store.stream(names.stderr) };
    const rawLimit = Math.max(0, Math.min(limit, this.store.available(phase) - 16384));
    let outputBytes = 0, inputOffset = 0, timeout = false, overflow = false, interrupted = false;
    let child, status = null, signal = null, spawnError = null, reaped = false, stdoutEnd = false, stderrEnd = false;
    let groupAbsent = false, groupProbeError = 'NOT_SPAWNED', groupCleanupRequired = false;
    const groupProbes = [];
    const ioErrors = [];
    await new Promise(resolveDone => {
      let done = false, killed = false, killTimer, finishTimer, groupTimer, finalizingGroup = false;
      const probeGroup = () => {
        if (!child?.pid) return false;
        const result = probeOwnedProcessGroup(child.pid);
        groupAbsent = result.absent; groupProbeError = result.error;
        if (groupProbes.length < 32) groupProbes.push({ offsetMs: performance.now() - this.clock.started, ...result });
        else { groupAbsent = false; groupProbeError = 'PROBE_BOUND_EXCEEDED'; }
        return groupAbsent;
      };
      const finish = () => {
        if (done) return;
        if (child?.pid && !probeGroup()) { groupCleanupRequired = true; kill(); }
        done = true; clearTimeout(runTimer); clearTimeout(killTimer); clearTimeout(finishTimer); clearTimeout(groupTimer);
        this.clock.active.delete(abort); child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy(); resolveDone();
      };
      const kill = () => {
        if (!child?.pid) return;
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') ioErrors.push('kill:' + error.code); }
      };
      const stop = () => {
        if (done || killed) return; killed = true; kill();
        const drain = Math.max(0, Math.min(200, deadline - performance.now() - 100));
        killTimer = setTimeout(() => { kill(); child?.stdout?.destroy(); child?.stderr?.destroy(); child?.stdin?.destroy();
          finishTimer = setTimeout(finish, Math.max(0, Math.min(100, deadline - performance.now()))); }, drain);
      };
      const abort = () => { interrupted = true; stop(); };
      this.clock.active.add(abort);
      const maybeFinish = () => {
        if (!reaped || !stdoutEnd || !stderrEnd || finalizingGroup || done) return;
        finalizingGroup = true;
        if (probeGroup()) { finish(); return; }
        groupCleanupRequired = true; kill();
        const groupEnd = Math.min(deadline - 25, performance.now() + 200);
        const recheck = () => {
          if (done) return;
          if (probeGroup() || performance.now() >= groupEnd) { finish(); return; }
          groupTimer = setTimeout(recheck, Math.max(0, Math.min(10, groupEnd - performance.now())));
        };
        groupTimer = setTimeout(recheck, Math.max(0, Math.min(10, groupEnd - performance.now())));
      };
      const runTimer = setTimeout(() => { timeout = true; stop(); }, Math.max(0, runEnd - performance.now()));
      try {
        child = spawn(argv[0], argv.slice(1), { env: this.environment, cwd: this.cwd,
          detached: true, windowsHide: true, stdio: [payload === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      } catch (error) { spawnError = error.name + ':' + error.message.slice(0, 300); finish(); return; }
      child.on('error', error => { spawnError = error.name + ':' + error.message.slice(0, 300); stop(); });
      child.on('exit', (code, exitedSignal) => { status = code; signal = exitedSignal; reaped = true; maybeFinish(); });
      child.on('close', () => { if (spawnError && !reaped) finish(); else maybeFinish(); });
      for (const kind of ['stdout', 'stderr']) {
        child[kind].on('data', chunk => {
          if (done) return;
          const allowed = Math.max(0, rawLimit - outputBytes), retained = chunk.subarray(0, allowed);
          try { this.store.append(names[kind], fds[kind], retained, phase); outputBytes += retained.length; }
          catch (error) { ioErrors.push(kind + ':' + error.message); overflow = true; stop(); return; }
          if (retained.length !== chunk.length) { overflow = true; stop(); }
        });
        child[kind].on('end', () => { if (kind === 'stdout') stdoutEnd = true; else stderrEnd = true; maybeFinish(); });
        child[kind].on('error', error => { ioErrors.push(kind + ':' + error.code); stop(); });
      }
      if (payload !== undefined) {
        child.stdin.on('error', error => { ioErrors.push('stdin:' + error.code); stop(); });
        const send = () => {
          if (done || killed) return;
          if (inputOffset === payload.length) { child.stdin.end(); return; }
          const piece = payload.subarray(inputOffset, inputOffset + 16384);
          child.stdin.write(piece, error => {
            if (error || done || killed) return;
            inputOffset += piece.length; send();
          });
        };
        send();
      }
    });
    const refs = {};
    for (const kind of ['stdout', 'stderr']) refs[kind] = this.store.close(names[kind], fds[kind]);
    const ended = performance.now();
    const result = { ...intent, status, signal, pid: child?.pid ?? null, processReaped: reaped,
      endedOffsetMs: ended - this.clock.started, milliseconds: ended - begun, timeout: timeout || ended > deadline,
      overflow, interrupted, spawnError, ioErrors: [...ioErrors], streamsComplete: stdoutEnd && stderrEnd,
      processGroupAbsent: groupAbsent, processGroupProbeError: groupProbeError, processGroupCleanupRequired: groupCleanupRequired,
      processGroupProbes: groupProbes,
      inputBytesWritten: inputOffset, inputComplete: payload === undefined || inputOffset === payload.length, ...refs };
    this.records.push(result); this.store.save(label + '.result.json', json(result), phase);
    return { record: result, stdout: readBoundedRegular(join(this.store.output, names.stdout), COLLECTION_LIMITS.artifactBytes),
      stderr: readBoundedRegular(join(this.store.output, names.stderr), COLLECTION_LIMITS.artifactBytes) };
  }
}

const requireComplete = result => { if (!processCaptureComplete(result.record)) throw new Error(result.record.label + ' process capture did not complete'); return result.stdout; };
const oneNative = bytes => { const rows = parseStrictJson(bytes); if (!Array.isArray(rows) || rows.length !== 1 || !record(rows[0])) throw new Error('Exact native object inventory required'); return rows[0]; };

export function admitBuiltinNone(value) {
  return record(value) && value.Name === 'none' && value.Driver === 'null' && value.Scope === 'local' && DIGEST.test(value.Id);
}
export function ownedNativeContainer(native, { containerId, name, owner, batchId }) {
  const labels = native?.Config?.Labels;
  return DIGEST.test(containerId) && native?.Id === containerId && native?.Name === '/' + name && record(labels)
    && labels[OWNER] === owner && labels[KIND] === ROLE && labels[CASE] === batchId;
}
export function admitNativeConfiguration(native, image, identity, harness, builtin) {
  if (!ownedNativeContainer(native, identity) || !admitBuiltinNone(builtin) || !record(image?.Config)
    || typeof image.Id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(image.Id)
    || !Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(READER_IMAGE)
    || !Array.isArray(image.Config.Env) || image.Config.Env.length !== 3
    || !same(image.Config.Entrypoint, ['docker-entrypoint.sh']) || !same(image.Config.Cmd, ['node'])
    || !record(native.HostConfig) || !record(native.Config) || !record(native.State) || !record(native.NetworkSettings)) return false;
  const environment = image.Config.Env;
  if (!environment.every(item => typeof item === 'string' && item.length <= 4096 && /^(PATH|NODE_VERSION|YARN_VERSION)=/.test(item))
    || new Set(environment.map(item => item.slice(0, item.indexOf('=')))).size !== 3
    || !environment.some(item => /^NODE_VERSION=22\.[0-9]+\.[0-9]+$/.test(item))) return false;
  const { HostConfig: host, Config: config, State: state, NetworkSettings: settings } = native;
  if (state.Status !== 'created' || state.Running !== false || !Number.isInteger(state.Pid) || state.Pid !== 0
    || settings.SandboxID !== '' || settings.SandboxKey !== '' || !exact(settings.Networks, ['none'])) return false;
  const endpoint = settings.Networks.none;
  if (!record(endpoint) || !['', builtin.Id].includes(endpoint.NetworkID) || endpoint.EndpointID !== ''
    || ['IPAddress', 'Gateway', 'IPv6Gateway', 'GlobalIPv6Address', 'MacAddress', 'IPPrefixLen', 'GlobalIPv6PrefixLen', 'Aliases', 'Links', 'DNSNames', 'DriverOpts', 'IPAMConfig'].some(key => !empty(endpoint[key]) && endpoint[key] !== 0)) return false;
  const labels = { ...(image.Config.Labels ?? {}), [OWNER]: identity.owner, [KIND]: ROLE, [CASE]: identity.batchId };
  return config.Image === READER_IMAGE && native.Image === image.Id && config.User === '65534:65534' && config.WorkingDir === '/tmp'
    && same(config.Cmd, ['node', '/harness/child.mjs']) && same(config.Env, image.Config.Env)
    && same(config.Labels, labels) && same(config.Entrypoint, image.Config.Entrypoint) && config.Tty === false
    && host.NetworkMode === 'none' && host.ReadonlyRootfs === true && host.Privileged === false
    && same(host.CapDrop, ['ALL']) && empty(host.CapAdd) && same(host.SecurityOpt, ['no-new-privileges'])
    && host.PidsLimit === 128 && host.Memory === 805306368 && host.MemorySwap === 805306368 && host.NanoCpus === 1000000000
    && host.AutoRemove === false && host.PublishAllPorts === false && same(host.RestartPolicy, { Name: 'no', MaximumRetryCount: 0 })
    && ['PortBindings', 'Devices', 'DeviceRequests', 'DeviceCgroupRules', 'ExtraHosts', 'Links', 'Dns', 'DnsOptions', 'DnsSearch', 'VolumesFrom', 'GroupAdd'].every(key => empty(host[key]))
    && (host.PidMode ?? '') === '' && host.IpcMode === 'private' && (host.UTSMode ?? '') === ''
    && same(host.Tmpfs, { '/tmp': 'rw,noexec,nosuid,size=32m' }) && empty(settings.Ports)
    && Array.isArray(native.Mounts) && native.Mounts.length === 1 && native.Mounts[0].Type === 'bind'
    && native.Mounts[0].Source === harness && native.Mounts[0].Destination === '/harness' && native.Mounts[0].RW === false;
}

export function validateChildBatchRecord(value, caseIds, routes) {
  if (!exact(value, ['schema_version', 'cases']) || value.schema_version !== 1 || !Array.isArray(value.cases)
    || !same(value.cases.map(row => row?.caseId), caseIds)) throw new Error('Incomplete or unauthorized child batch protocol');
  const allowed = new Set(routes.map(row => row.method + '\0' + row.url));
  for (const row of value.cases) {
    if (!exact(row, ['schemaVersion', 'caseId', 'observation', 'wrapper']) || row.schemaVersion !== 1
      || !exact(row.observation, ['provenanceKind', 'inProcessEvidenceClaim', 'globalProblems', 'ciStatus', 'ciProblems', 'ciAssociation', 'actualCheckoutSha'])
      || typeof row.observation.provenanceKind !== 'string' || typeof row.observation.inProcessEvidenceClaim !== 'boolean'
      || typeof row.observation.ciStatus !== 'string' || row.observation.ciAssociation !== null && !record(row.observation.ciAssociation)
      || row.observation.actualCheckoutSha !== null && typeof row.observation.actualCheckoutSha !== 'string') throw new Error('Malformed observed reader values');
    for (const key of ['globalProblems', 'ciProblems']) {
      if (!Array.isArray(row.observation[key]) || row.observation[key].length > 128 || row.observation[key].some(item => typeof item !== 'string' || item.length > 4096)) throw new Error('Malformed reader problem values');
    }
    const wrapper = row.wrapper;
    if (!exact(wrapper, ['executionComplete', 'setupErrors', 'requestCount', 'membershipReadCount', 'requests']) || wrapper.executionComplete !== true
      || !same(wrapper.setupErrors, []) || !Number.isSafeInteger(wrapper.requestCount) || wrapper.requestCount < 0 || wrapper.requestCount > 128
      || !Array.isArray(wrapper.requests) || wrapper.requests.length !== wrapper.requestCount || !Number.isSafeInteger(wrapper.membershipReadCount)) throw new Error('Incomplete trusted wrapper collection');
    const counts = new Map();
    for (const item of wrapper.requests) {
      if (!exact(item, ['method', 'url', 'readIndex']) || typeof item.method !== 'string' || typeof item.url !== 'string') throw new Error('Malformed wrapper request inventory');
      const key = item.method + '\0' + item.url, count = (counts.get(key) ?? 0) + 1;
      if (!allowed.has(key) || item.readIndex !== count) throw new Error('Unknown or forged wrapper request inventory');
      counts.set(key, count);
    }
    const membership = 'GET\0https://api.github.com/repos/fixture-owner/fixture-repo/commits/' + 'a'.repeat(40) + '/pulls?per_page=100&page=1';
    if (wrapper.membershipReadCount !== (counts.get(membership) ?? 0)) throw new Error('Forged membership read count');
  }
  return value.cases;
}

/** Cleanup targets only an unpredictable name+owner+role+batch and immutable full native ID. */
export async function cleanupOwnedContainer(capture, identity, allocated) {
  const errors = [], absence = { name: false, owner: false, id: null };
  let containerId = identity.containerId;
  const run = async (label, argv, limit = 65536) => requireComplete(await capture(label, argv, { phase: 'cleanup', milliseconds: 2500, limit }));
  if (allocated) {
    try {
      const discovered = await run('cleanup-owned-discovery', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'label=' + OWNER + '=' + identity.owner,
        '--filter', 'name=^/' + identity.name + '$', '--format', '{{.ID}}']);
      if (discovered.length) {
        if (!/^[a-f0-9]{64}\n$/.test(discovered.toString('utf8'))) throw new Error('Ambiguous owned cleanup discovery');
        const found = discovered.toString('utf8').trim();
        if (containerId !== null && found !== containerId) throw new Error('Created and discovered native IDs differ');
        const native = oneNative(await run('cleanup-owner-inspect', ['docker', 'container', 'inspect', found], 131072));
        if (!ownedNativeContainer(native, { ...identity, containerId: found })) throw new Error('Cleanup native identity is not owned');
        containerId = found;
        for (const [label, argv] of [['stop', ['docker', 'stop', '--timeout=1', containerId]], ['remove', ['docker', 'rm', '--force', containerId]]]) {
          try {
            if (label === 'remove') {
              const current = oneNative(await run('cleanup-remove-owner-inspect', ['docker', 'container', 'inspect', containerId], 131072));
              if (!ownedNativeContainer(current, { ...identity, containerId })) throw new Error('Cleanup owner changed before removal');
            }
            await run(label, argv);
          } catch (error) { errors.push(label + ':' + error.message.slice(0, 500)); }
        }
      }
    } catch (error) { errors.push('Owned cleanup:' + error.message.slice(0, 500)); }
  }
  const queries = [['name', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'name=^/' + identity.name + '$', '--format', '{{.ID}} {{.Names}}']],
    ['owner', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'label=' + OWNER + '=' + identity.owner, '--format', '{{.ID}}']]];
  if (containerId !== null) queries.push(['id', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + containerId, '--format', '{{.ID}}']]);
  for (const [key, argv] of queries) {
    try { absence[key] = (await run('absence-' + key, argv)).length === 0; if (!absence[key]) errors.push('Exact ' + key + ' inventory is not empty'); }
    catch (error) { errors.push('Absence ' + key + ':' + error.message.slice(0, 500)); }
  }
  return { containerId, absence, errors, verified: absence.name && absence.owner && (containerId === null || absence.id === true) && errors.length === 0 };
}

export function finalizeBatchReceipt(store, manifest, clock) {
  const inventory = store.inventory(), before = inventory.reduce((sum, item) => sum + item.bytes, 0);
  manifest.artifacts = inventory;
  manifest.aggregateAccounting = { capBytes: COLLECTION_LIMITS.artifactBytes, retainedBeforeReceiptBytes: before,
    receiptBytes: 0, totalRetainedBytes: before, cumulativeWrittenIncludingRemovedHarnessBytes: store.written,
    includesSourcesCollectorMetadataAndReceipt: true };
  let bytes;
  for (let attempt = 0; attempt < 16; attempt++) {
    bytes = json(manifest); const account = manifest.aggregateAccounting;
    if (account.receiptBytes === bytes.length) break;
    account.receiptBytes = bytes.length; account.totalRetainedBytes = before + bytes.length;
    account.cumulativeWrittenIncludingRemovedHarnessBytes = store.written + bytes.length;
    if (attempt === 15) throw new Error('Receipt accounting did not settle');
  }
  if (bytes.length > COLLECTION_LIMITS.receiptReserve || store.written + bytes.length > COLLECTION_LIMITS.artifactBytes) throw new Error('Receipt exceeds reserved aggregate artifact budget');
  if (performance.now() >= clock.started + COLLECTION_LIMITS.wholeMs) throw new Error('Absolute finalization deadline exhausted');
  const target = store.path('receipt.json'), fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  let written = false;
  try { writeAll(fd, bytes, { writer: store.writer, deadlineMs: clock.started + COLLECTION_LIMITS.wholeMs }); written = true; }
  finally { closeSync(fd); if (!written) unlinkSync(target); }
  if (performance.now() >= clock.started + COLLECTION_LIMITS.wholeMs) { unlinkSync(target); throw new Error('Receipt write crossed absolute deadline'); }
  return { bytes, target };
}

const batchCases = id => id === 'reader-01-32' ? Array.from({ length: 32 }, (_, index) => 'reader-' + String(index + 1).padStart(2, '0'))
  : id === 'reader-33-39' ? Array.from({ length: 7 }, (_, index) => 'reader-' + String(index + 33).padStart(2, '0')) : null;

export async function collectCiDomainBatch({ repositoryRoot, sourceRef, expectedSourceSha256, outputDirectory,
  batchId, caseIds, request, image = READER_IMAGE, harnessSources, parentOracleBytes }) {
  const clock = new CollectionClock();
  if (typeof sourceRef !== 'string' || !SHA.test(sourceRef) || typeof expectedSourceSha256 !== 'string' || !DIGEST.test(expectedSourceSha256)
    || image !== READER_IMAGE || !Array.isArray(caseIds) || !same(caseIds, batchCases(batchId))
    || !exact(harnessSources, HARNESS_NAMES) || HARNESS_NAMES.some(name => !types.isUint8Array(harnessSources[name]))
    || !types.isUint8Array(parentOracleBytes)) throw new Error('Exact immutable source, fixed batch and trusted harness required');
  if (!exact(request, ['adapter', 'cases']) || request.adapter !== ADAPTER || !Array.isArray(request.cases)
    || !same(request.cases.map(row => row?.id), caseIds) || request.cases.some(row => !exact(row, ['id', 'text']) || row.text !== JSON.stringify({ caseId: row.id }))) throw new Error('Exact selected reader request required');
  const sources = Object.fromEntries(HARNESS_NAMES.map(name => [name, Buffer.from(harnessSources[name])])), oracle = Buffer.from(parentOracleBytes);
  if (hash(sources['ci-domain-probe.mjs']) !== PROBE_SHA || hash(sources['ci-domain-stimulus-v2.json']) !== STIMULUS_SHA || hash(oracle) !== ORACLE_SHA) throw new Error('Frozen reader controls changed');
  const root = canonicalPath(resolve(repositoryRoot)), output = canonicalPath(resolve(outputDirectory), true);
  const helperPath = fileURLToPath(import.meta.url), parserPath = join(dirname(helperPath), 'strict-json.mjs');
  const helperBefore = readBoundedRegular(helperPath), parserBefore = readBoundedRegular(parserPath);
  if (output === root || !output.startsWith(root + sep)) throw new Error('Fresh collection output must be inside repository');
  try { lstatSync(output); throw new Error('Fresh output required'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  mkdirSync(output, { recursive: true, mode: 0o700 }); canonicalPath(output);
  const store = new BoundedArtifactStore(output, clock), capturer = new BoundedCapturer(store, clock); capturer.cwd = root;
  const capture = capturer.capture.bind(capturer), run = async (label, argv, options) => requireComplete(await capture(label, argv, options));
  const harness = join(output, 'owned-harness'); mkdirSync(harness, { mode: 0o755 });
  const files = [...HARNESS_NAMES, 'subject/github.mjs'];
  const identity = { containerId: null, name: 'verification-reader-' + randomUUID(), owner: randomUUID(), batchId };
  const errors = [], cleanupErrors = []; let allocated = false, admitted = false, sourceStable = false, controlsStable = false, harnessAbsent = false;
  let sourceBytes, blob = null, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), exitCode = null, imageInfo = null;
  let cleanup = { containerId: null, absence: { name: false, owner: false, id: null }, errors: [], verified: false };
  const originals = new Map();
  const interrupt = signal => clock.interrupt(signal), onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    store.save('collection-source.mjs.txt', helperBefore); store.save('parser-source.mjs.txt', parserBefore);
    for (const name of HARNESS_NAMES) {
      const path = join(root, 'src/lib/engineering-verification', name.startsWith('ci-domain-stimulus') ? '__fixtures__/' + name : name);
      const actual = readBoundedRegular(path);
      if (!actual.equals(sources[name])) throw new Error('Supplied trusted harness differs from canonical control: ' + name);
      originals.set(path, actual); store.save(name + '.txt', sources[name]);
    }
    const oraclePath = join(root, 'src/lib/engineering-verification/__fixtures__/ci-domain-expectations-v2.json');
    if (!readBoundedRegular(oraclePath).equals(oracle)) throw new Error('Canonical parent oracle differs');
    originals.set(oraclePath, oracle); store.save('parent-expectations-v2.json.txt', oracle);
    const stimulus = parseStrictJson(sources['ci-domain-stimulus-v2.json']), payload = json(request);
    store.save('stdin.json', payload);
    if (!Array.isArray(stimulus.routeBase)) throw new Error('Frozen route inventory unavailable');
    if (!(await run('subject-git-type', ['git', '--no-replace-objects', 'cat-file', '-t', sourceRef])).equals(Buffer.from('commit\n'))) throw new Error('Subject ref is not a native commit');
    const mode = await run('subject-git-mode', ['git', '--no-replace-objects', 'ls-tree', sourceRef, '--', SUBJECT]);
    const match = mode.toString('utf8').match(new RegExp('^100644 blob ([a-f0-9]{40})\\t' + SUBJECT.replaceAll('.', '\\.') + '\\n$'));
    if (!match) throw new Error('Literal canonical regular Git source required'); blob = match[1];
    sourceBytes = await run('subject-git-bytes', ['git', '--no-replace-objects', 'cat-file', 'blob', blob], { limit: 1048576 });
    if (hash(sourceBytes) !== expectedSourceSha256 || gitBlob(sourceBytes) !== blob) throw new Error('Pinned literal Git source identity differs');
    const sourceText = sourceBytes.toString('utf8');
    if (!sourceText.startsWith("import { createHash } from 'node:crypto';\n") || (sourceText.match(/\bimport\b/g) ?? []).length !== 1
      || /\brequire\s*\(|\bexport\b[^;\n]*\bfrom\b/.test(sourceText)) throw new Error('Reader source import closure is not builtin-only');
    for (const name of files) {
      const target = join(harness, name); mkdirSync(dirname(target), { recursive: true, mode: 0o755 }); chmodSync(dirname(target), 0o755);
      store.save(relative(output, target).split(sep).join('/'), name === 'subject/github.mjs' ? sourceBytes : sources[name], 'work', 0o644);
    }
    const create = ['docker', 'create', '--interactive', '--pull=never', '--name', identity.name,
      '--label', OWNER + '=' + identity.owner, '--label', KIND + '=' + ROLE, '--label', CASE + '=' + batchId,
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
      '--memory=768m', '--memory-swap=768m', '--cpus=1', '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m',
      '--workdir=/tmp', '--mount', 'type=bind,source=' + harness + ',target=/harness,readonly', image, 'node', '/harness/child.mjs'];
    store.save('intent.json', json({ argv: create, sourceRef, expectedSourceSha256, batchId, caseIds, image,
      childSha256: hash(sources['child.mjs']), probeSha256: PROBE_SHA, stimulusSha256: STIMULUS_SHA,
      parentOracleSha256: ORACLE_SHA, parentOracleMounted: false, collectionSha256: hash(helperBefore), parserSha256: hash(parserBefore),
      registered: false, currentCodeVerified: false }));
    if ((await run('pre-name-absence', ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'name=^/' + identity.name + '$', '--format', '{{.ID}} {{.Names}}'])).length) throw new Error('Preexisting requested name refused without deletion');
    imageInfo = oneNative(await run('image-inspect', ['docker', 'image', 'inspect', image], { limit: 131072 }));
    const builtin = oneNative(await run('builtin-none-inspect', ['docker', 'network', 'inspect', 'none'], { limit: 131072 }));
    if (!admitBuiltinNone(builtin)) throw new Error('Native builtin none identity unavailable');
    allocated = true;
    const created = await run('create', create);
    if (!/^[a-f0-9]{64}\n$/.test(created.toString('utf8'))) throw new Error('Full native created-container ID unavailable');
    identity.containerId = created.toString('utf8').trim();
    const native = oneNative(await run('inspect-prestart', ['docker', 'container', 'inspect', identity.containerId], { limit: 131072 }));
    admitted = admitNativeConfiguration(native, imageInfo, identity, harness, builtin);
    if (!admitted) throw new Error('Native reader configuration refused before start');
    const started = await capture('start-attach', ['docker', 'start', '--attach', '--interactive', identity.containerId], { payload, milliseconds: 26000, limit: COLLECTION_LIMITS.artifactBytes });
    stdout = started.stdout; stderr = started.stderr; exitCode = started.record.status;
    requireComplete(started); validateChildBatchRecord(parseStrictJson(stdout), caseIds, stimulus.routeBase);
    if (!(await run('wait', ['docker', 'wait', identity.containerId])).equals(Buffer.from('0\n'))) throw new Error('Subject process did not exit zero');
    const after = oneNative(await run('inspect-postexit', ['docker', 'container', 'inspect', identity.containerId], { limit: 131072 }));
    if (!ownedNativeContainer(after, identity) || after.State?.Running !== false || after.State?.ExitCode !== 0 || after.State?.OOMKilled !== false
      || after.State?.Status !== 'exited' || after.State?.Pid !== 0) throw new Error('Native post-exit identity/state unavailable');
  } catch (error) { errors.push(error.name + ':' + error.message.slice(0, 1000)); }
  finally {
    try { cleanup = await cleanupOwnedContainer(capture, identity, allocated); cleanupErrors.push(...cleanup.errors); }
    catch (error) { cleanupErrors.push('Cleanup:' + error.message.slice(0, 1000)); }
    try {
      for (const name of [...files].reverse()) {
        const target = join(harness, name);
        try { const info = lstatSync(target); canonicalPath(target); if (!info.isFile()) throw new Error('Owned harness file is not regular');
          unlinkSync(target); store.entries.get(relative(output, target).split(sep).join('/')).retained = false;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      try { rmdirSync(join(harness, 'subject')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      rmdirSync(harness); harnessAbsent = true;
    } catch (error) { cleanupErrors.push('Harness:' + error.message.slice(0, 1000)); }
    try {
      controlsStable = readBoundedRegular(helperPath).equals(helperBefore) && readBoundedRegular(parserPath).equals(parserBefore)
        && [...originals].every(([path, bytes]) => readBoundedRegular(path).equals(bytes));
      if (sourceBytes) {
        const bytes = await run('subject-git-bookend', ['git', '--no-replace-objects', 'cat-file', 'blob', blob], { phase: 'cleanup', milliseconds: 2500, limit: 1048576 });
        const mode = await run('subject-git-mode-bookend', ['git', '--no-replace-objects', 'ls-tree', sourceRef, '--', SUBJECT], { phase: 'cleanup', milliseconds: 2500 });
        sourceStable = bytes.equals(sourceBytes) && mode.toString('utf8') === '100644 blob ' + blob + '\t' + SUBJECT + '\n';
      }
      if (!controlsStable || !sourceStable) errors.push('Control or literal Git source bookend differs');
    } catch (error) { errors.push('Bookend:' + error.message.slice(0, 1000)); }
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
  const cleanupVerified = cleanup.verified && harnessAbsent && cleanupErrors.length === 0;
  const complete = !errors.length && !clock.interruptions.length && cleanupVerified && admitted && sourceStable && controlsStable && exitCode === 0;
  const manifest = { schemaVersion: 1, kind: 'CI_DOMAIN_NATIVE_BATCH_OBSERVATIONS', adapter: ADAPTER, batchId, caseIds: [...caseIds],
    source: { commit: sourceRef, path: SUBJECT, blob, sha256: expectedSourceSha256, bytes: sourceBytes?.length ?? null },
    harness: { childSha256: hash(sources['child.mjs']), probeSha256: PROBE_SHA, stimulusSha256: STIMULUS_SHA, parentOracleSha256: ORACLE_SHA,
      collectionSha256: hash(helperBefore), parserSha256: hash(parserBefore), parentOracleMounted: false },
    input: { path: 'stdin.json', bytes: json(request).length, sha256: hash(json(request)) },
    output: { path: 'start-attach.stdout.bin', bytes: stdout.length, sha256: hash(stdout) },
    stderr: { path: 'start-attach.stderr.bin', bytes: stderr.length, sha256: hash(stderr) },
    image, nativeContainer: { name: identity.name, id: cleanup.containerId ?? identity.containerId, owner: identity.owner, batchId },
    nativeConfigurationAdmitted: admitted, sourceBookendMatches: sourceStable, controlBookendMatches: controlsStable,
    cleanupVerified, cleanupObservations: { ...cleanup.absence, harnessAbsent }, executionExitCode: exitCode,
    collectionStatus: complete ? 'COMPLETE_UNASSESSED' : 'SETUP_BLOCKED', primaryErrors: errors, cleanupErrors,
    interruptionSignals: [...clock.interruptions], processes: capturer.records,
    absoluteDeadlines: { workMs: 26000, cleanupEndMs: 44000, wholeMs: 45000 },
    secondsBeforeFinalization: (performance.now() - clock.started) / 1000,
    registered: false, currentCodeVerified: false,
    limitations: ['Finite offline observations only; native GitHub/source-run/artifact corroboration remains separate.',
      'No production/provider/database/browser/holdout authority; OS scheduling is not certified by process deadlines.'] };
  const finalized = finalizeBatchReceipt(store, manifest, clock);
  return { collectionStatus: manifest.collectionStatus, execution_exit_code: exitCode, stdout, stderr, manifest,
    receiptPath: finalized.target, receiptSha256: hash(finalized.bytes), source: { commit: sourceRef, blob, sha256: expectedSourceSha256 },
    cleanupVerified, runtime: imageInfo ? { node: 'v' + imageInfo.Config?.Env?.find(item => item.startsWith('NODE_VERSION='))?.slice(13),
      arch: imageInfo.Architecture, platform: imageInfo.Os } : null, error: complete ? undefined : [...errors, ...cleanupErrors].join('; ') };
}

/** Structural evidence validation only; this never grants a native proof brand. */
export function validateBatchManifest(value, expected = {}) {
  const keys = ['schemaVersion', 'kind', 'adapter', 'batchId', 'caseIds', 'source', 'harness', 'input', 'output', 'stderr', 'image', 'nativeContainer',
    'nativeConfigurationAdmitted', 'sourceBookendMatches', 'controlBookendMatches', 'cleanupVerified', 'cleanupObservations', 'executionExitCode',
    'collectionStatus', 'primaryErrors', 'cleanupErrors', 'interruptionSignals', 'processes', 'absoluteDeadlines', 'secondsBeforeFinalization',
    'registered', 'currentCodeVerified', 'limitations', 'artifacts', 'aggregateAccounting'];
  if (!exact(value, keys) || value.schemaVersion !== 1 || value.kind !== 'CI_DOMAIN_NATIVE_BATCH_OBSERVATIONS' || value.adapter !== ADAPTER
    || !same(value.caseIds, batchCases(value.batchId)) || value.collectionStatus !== 'COMPLETE_UNASSESSED' || value.executionExitCode !== 0
    || value.registered !== false || value.currentCodeVerified !== false || value.image !== READER_IMAGE
    || value.nativeConfigurationAdmitted !== true || value.sourceBookendMatches !== true || value.controlBookendMatches !== true || value.cleanupVerified !== true
    || !same(value.primaryErrors, []) || !same(value.cleanupErrors, []) || !same(value.interruptionSignals, [])
    || !exact(value.cleanupObservations, ['name', 'owner', 'id', 'harnessAbsent']) || Object.values(value.cleanupObservations).some(item => item !== true)
    || !same(value.absoluteDeadlines, { workMs: 26000, cleanupEndMs: 44000, wholeMs: 45000 })
    || !Number.isFinite(value.secondsBeforeFinalization) || value.secondsBeforeFinalization < 0 || value.secondsBeforeFinalization >= 45) throw new Error('Incomplete or forged native batch manifest');
  if (!exact(value.source, ['commit', 'path', 'blob', 'sha256', 'bytes']) || !SHA.test(value.source.commit) || value.source.path !== SUBJECT
    || !SHA.test(value.source.blob) || !DIGEST.test(value.source.sha256) || !Number.isSafeInteger(value.source.bytes) || value.source.bytes < 1 || value.source.bytes > 1048576
    || expected.sourceRef !== undefined && value.source.commit !== expected.sourceRef || expected.sourceSha256 !== undefined && value.source.sha256 !== expected.sourceSha256
    || expected.batchId !== undefined && value.batchId !== expected.batchId || expected.caseIds !== undefined && !same(value.caseIds, expected.caseIds)) throw new Error('Batch source or case binding mismatch');
  if (!exact(value.harness, ['childSha256', 'probeSha256', 'stimulusSha256', 'parentOracleSha256', 'collectionSha256', 'parserSha256', 'parentOracleMounted'])
    || value.harness.probeSha256 !== PROBE_SHA || value.harness.stimulusSha256 !== STIMULUS_SHA || value.harness.parentOracleSha256 !== ORACLE_SHA
    || value.harness.parentOracleMounted !== false || Object.entries(value.harness).some(([key, item]) => key !== 'parentOracleMounted' && !DIGEST.test(item))) throw new Error('Batch control identities unavailable');
  for (const key of ['childSha256', 'collectionSha256', 'parserSha256']) if (expected[key] !== undefined && value.harness[key] !== expected[key]) throw new Error('Batch control binding mismatch');
  if (!exact(value.nativeContainer, ['name', 'id', 'owner', 'batchId']) || !/^verification-reader-[a-f0-9-]{36}$/.test(value.nativeContainer.name)
    || !DIGEST.test(value.nativeContainer.id) || !/^[a-f0-9-]{36}$/.test(value.nativeContainer.owner) || value.nativeContainer.batchId !== value.batchId) throw new Error('Batch native identity unavailable');
  if (!Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 128) throw new Error('Batch artifact inventory unavailable');
  const inventory = new Map();
  for (const item of value.artifacts) {
    if (!exact(item, ['path', 'bytes', 'sha256']) || typeof item.path !== 'string' || !/^[A-Za-z0-9_./-]{1,200}$/.test(item.path)
      || item.path.split('/').some(part => ['', '.', '..'].includes(part)) || inventory.has(item.path) || !DIGEST.test(item.sha256)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > COLLECTION_LIMITS.artifactBytes) throw new Error('Malformed or duplicate batch artifact inventory');
    inventory.set(item.path, item);
  }
  const ref = item => exact(item, ['path', 'bytes', 'sha256']) && same(inventory.get(item.path), item);
  for (const key of ['input', 'output', 'stderr']) if (!ref(value[key])) throw new Error('Missing raw batch input/output inventory');
  if (value.input.path !== 'stdin.json' || value.output.path !== 'start-attach.stdout.bin' || value.stderr.path !== 'start-attach.stderr.bin') throw new Error('Unexpected batch raw stream path');
  const expectedInput = json({ adapter: ADAPTER, cases: value.caseIds.map(id => ({ id, text: JSON.stringify({ caseId: id }) })) });
  if (value.input.bytes !== expectedInput.length || value.input.sha256 !== hash(expectedInput)) throw new Error('Batch input request identity mismatch');
  const pinnedFiles = { 'collection-source.mjs.txt': value.harness.collectionSha256, 'parser-source.mjs.txt': value.harness.parserSha256,
    'child.mjs.txt': value.harness.childSha256, 'ci-domain-probe.mjs.txt': PROBE_SHA, 'ci-domain-stimulus-v2.json.txt': STIMULUS_SHA,
    'parent-expectations-v2.json.txt': ORACLE_SHA, 'subject-git-bytes.stdout.bin': value.source.sha256,
    'subject-git-bookend.stdout.bin': value.source.sha256 };
  for (const [path, digest] of Object.entries(pinnedFiles)) if (inventory.get(path)?.sha256 !== digest) throw new Error('Missing or inconsistent retained source/control identity');
  for (const path of ['subject-git-bytes.stdout.bin', 'subject-git-bookend.stdout.bin']) if (inventory.get(path)?.bytes !== value.source.bytes) throw new Error('Source byte count mismatch');
  const expectedMode = Buffer.from('100644 blob ' + value.source.blob + '\t' + SUBJECT + '\n');
  for (const path of ['subject-git-mode.stdout.bin', 'subject-git-mode-bookend.stdout.bin']) if (inventory.get(path)?.sha256 !== hash(expectedMode)
    || inventory.get(path)?.bytes !== expectedMode.length) throw new Error('Literal Git blob mode/bookend identity mismatch');
  const requiredLabels = ['subject-git-type', 'subject-git-mode', 'subject-git-bytes', 'pre-name-absence', 'image-inspect', 'builtin-none-inspect',
    'create', 'inspect-prestart', 'start-attach', 'wait', 'inspect-postexit', 'cleanup-owned-discovery', 'cleanup-owner-inspect', 'stop',
    'cleanup-remove-owner-inspect', 'remove', 'absence-name', 'absence-owner', 'absence-id', 'subject-git-bookend', 'subject-git-mode-bookend'];
  if (!Array.isArray(value.processes) || !same(value.processes.map(item => item?.label), requiredLabels)) throw new Error('Incomplete native lifecycle/process inventory');
  const processKeys = ['label', 'argv', 'phase', 'startedOffsetMs', 'absoluteDeadlineOffsetMs', 'inputBytes', 'status', 'signal', 'pid',
    'processReaped', 'endedOffsetMs', 'milliseconds', 'timeout', 'overflow', 'interrupted', 'spawnError', 'ioErrors',
    'streamsComplete', 'processGroupAbsent', 'processGroupProbeError', 'processGroupCleanupRequired', 'processGroupProbes',
    'inputBytesWritten', 'inputComplete', 'stdout', 'stderr'];
  for (const [index, process] of value.processes.entries()) {
    if (!exact(process, processKeys) || !processCaptureComplete(process) || process.signal !== null || !Number.isSafeInteger(process.pid) || process.pid < 1
      || !exact(process.stdout, ['path', 'bytes', 'sha256', 'retained']) || process.stdout.retained !== true
      || !exact(process.stderr, ['path', 'bytes', 'sha256', 'retained']) || process.stderr.retained !== true
      || !ref({ path: process.stdout?.path, bytes: process.stdout?.bytes, sha256: process.stdout?.sha256 })
      || !ref({ path: process.stderr?.path, bytes: process.stderr?.bytes, sha256: process.stderr?.sha256 })
      || process.stdout.path !== process.label + '.stdout.bin' || process.stderr.path !== process.label + '.stderr.bin'
      || !Number.isFinite(process.startedOffsetMs) || !Number.isFinite(process.endedOffsetMs) || process.startedOffsetMs < 0
      || process.endedOffsetMs < process.startedOffsetMs || process.endedOffsetMs > process.absoluteDeadlineOffsetMs
      || !Number.isFinite(process.milliseconds) || Math.abs(process.milliseconds - (process.endedOffsetMs - process.startedOffsetMs)) > 0.001
      || !Number.isFinite(process.absoluteDeadlineOffsetMs) || process.absoluteDeadlineOffsetMs > (index < 11 ? 26000 : 44000)
      || process.phase !== (index < 11 ? 'work' : 'cleanup') || !Number.isSafeInteger(process.inputBytes) || process.inputBytes < 0
      || process.inputBytes > COLLECTION_LIMITS.artifactBytes || process.inputBytesWritten !== process.inputBytes
      || (process.label === 'start-attach' ? process.inputBytes !== value.input.bytes : process.inputBytes !== 0)
      || !Array.isArray(process.argv) || process.argv.some(item => typeof item !== 'string')) throw new Error('Failed/inconsistent native process capture');
    if (!Array.isArray(process.processGroupProbes) || !process.processGroupProbes.length || process.processGroupProbes.length > 32
      || process.processGroupProbes.some(item => !exact(item, ['offsetMs', 'absent', 'error']) || !Number.isFinite(item.offsetMs)
        || item.offsetMs < process.startedOffsetMs || item.offsetMs > process.endedOffsetMs || typeof item.absent !== 'boolean'
        || item.error !== null && typeof item.error !== 'string')
      || process.processGroupProbes.at(-1).absent !== true || process.processGroupProbes.at(-1).error !== null) throw new Error('Owned process-group absence is not proven');
    const intent = json({ label: process.label, argv: process.argv, phase: process.phase, startedOffsetMs: process.startedOffsetMs,
      absoluteDeadlineOffsetMs: process.absoluteDeadlineOffsetMs, inputBytes: process.inputBytes });
    if (inventory.get(process.label + '.intent.json')?.sha256 !== hash(intent) || inventory.get(process.label + '.intent.json')?.bytes !== intent.length
      || inventory.get(process.label + '.result.json')?.sha256 !== hash(json(process)) || inventory.get(process.label + '.result.json')?.bytes !== json(process).length) throw new Error('Process metadata inventory differs from batch receipt');
  }
  const commands = new Map(value.processes.map(process => [process.label, process.argv]));
  const id = value.nativeContainer.id, name = value.nativeContainer.name, owner = value.nativeContainer.owner;
  const git = ['git', '--no-replace-objects'];
  const expectedCommands = {
    'subject-git-type': [...git, 'cat-file', '-t', value.source.commit],
    'subject-git-mode': [...git, 'ls-tree', value.source.commit, '--', SUBJECT],
    'subject-git-bytes': [...git, 'cat-file', 'blob', value.source.blob],
    'pre-name-absence': ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}} {{.Names}}'],
    'image-inspect': ['docker', 'image', 'inspect', READER_IMAGE],
    'builtin-none-inspect': ['docker', 'network', 'inspect', 'none'],
    'inspect-prestart': ['docker', 'container', 'inspect', id],
    'start-attach': ['docker', 'start', '--attach', '--interactive', id],
    wait: ['docker', 'wait', id], 'inspect-postexit': ['docker', 'container', 'inspect', id],
    'cleanup-owned-discovery': ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'label=' + OWNER + '=' + owner,
      '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}'],
    'cleanup-owner-inspect': ['docker', 'container', 'inspect', id], stop: ['docker', 'stop', '--timeout=1', id],
    'cleanup-remove-owner-inspect': ['docker', 'container', 'inspect', id], remove: ['docker', 'rm', '--force', id],
    'absence-name': ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}} {{.Names}}'],
    'absence-owner': ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'label=' + OWNER + '=' + owner, '--format', '{{.ID}}'],
    'absence-id': ['docker', 'container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + id, '--format', '{{.ID}}'],
    'subject-git-bookend': [...git, 'cat-file', 'blob', value.source.blob],
    'subject-git-mode-bookend': [...git, 'ls-tree', value.source.commit, '--', SUBJECT],
  };
  for (const [label, argv] of Object.entries(expectedCommands)) if (!same(commands.get(label), argv)) throw new Error('Native command identity mismatch');
  const simpleOutputs = { 'subject-git-type': Buffer.from('commit\n'), create: Buffer.from(id + '\n'),
    'pre-name-absence': Buffer.alloc(0), wait: Buffer.from('0\n'), 'cleanup-owned-discovery': Buffer.from(id + '\n'),
    stop: Buffer.from(id + '\n'), remove: Buffer.from(id + '\n'), 'absence-name': Buffer.alloc(0),
    'absence-owner': Buffer.alloc(0), 'absence-id': Buffer.alloc(0) };
  for (const [label, bytes] of Object.entries(simpleOutputs)) if (inventory.get(label + '.stdout.bin')?.sha256 !== hash(bytes)
    || inventory.get(label + '.stdout.bin')?.bytes !== bytes.length) throw new Error('Native status or exact-absence output identity mismatch');
  const create = commands.get('create'), mount = create[create.indexOf('--mount') + 1];
  const mountMatch = /^type=bind,source=(\/[^,\x00-\x20]+),target=\/harness,readonly$/.exec(mount ?? '');
  if (!mountMatch || resolve(mountMatch[1]) !== mountMatch[1] || !mountMatch[1].endsWith('/owned-harness')
    || !same(create, ['docker', 'create', '--interactive', '--pull=never', '--name', name,
      '--label', OWNER + '=' + owner, '--label', KIND + '=' + ROLE, '--label', CASE + '=' + value.batchId,
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
      '--memory=768m', '--memory-swap=768m', '--cpus=1', '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m',
      '--workdir=/tmp', '--mount', mount, READER_IMAGE, 'node', '/harness/child.mjs'])) throw new Error('Native create isolation intent mismatch');
  const creation = json({ argv: create, sourceRef: value.source.commit, expectedSourceSha256: value.source.sha256,
    batchId: value.batchId, caseIds: value.caseIds, image: READER_IMAGE, childSha256: value.harness.childSha256,
    probeSha256: PROBE_SHA, stimulusSha256: STIMULUS_SHA, parentOracleSha256: ORACLE_SHA, parentOracleMounted: false,
    collectionSha256: value.harness.collectionSha256, parserSha256: value.harness.parserSha256, registered: false, currentCodeVerified: false });
  if (inventory.get('intent.json')?.sha256 !== hash(creation) || inventory.get('intent.json')?.bytes !== creation.length) throw new Error('Native create/source intent inventory mismatch');
  const account = value.aggregateAccounting, retained = value.artifacts.reduce((sum, item) => sum + item.bytes, 0);
  if (!exact(account, ['capBytes', 'retainedBeforeReceiptBytes', 'receiptBytes', 'totalRetainedBytes', 'cumulativeWrittenIncludingRemovedHarnessBytes', 'includesSourcesCollectorMetadataAndReceipt'])
    || account.capBytes !== COLLECTION_LIMITS.artifactBytes || account.retainedBeforeReceiptBytes !== retained || account.receiptBytes !== json(value).length
    || account.totalRetainedBytes !== retained + account.receiptBytes || account.receiptBytes > COLLECTION_LIMITS.receiptReserve
    || !Number.isSafeInteger(account.cumulativeWrittenIncludingRemovedHarnessBytes) || account.cumulativeWrittenIncludingRemovedHarnessBytes < account.totalRetainedBytes
    || account.cumulativeWrittenIncludingRemovedHarnessBytes > COLLECTION_LIMITS.artifactBytes || account.includesSourcesCollectorMetadataAndReceipt !== true) throw new Error('Batch aggregate accounting mismatch');
  return value;
}
