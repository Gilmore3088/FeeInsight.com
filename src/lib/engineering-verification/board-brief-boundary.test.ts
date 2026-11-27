// @vitest-environment node
/** Independent synthetic infrastructure controls. No historical product RED or native acceptance. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Outcome } from './board-brief-draft.mjs';
import {
  DRAFT_HARNESS_FILES, assessDraftResults, classifyDraftExecution, draftSandboxArguments,
  ownedCleanupAssessment, validateDraftOutputDirectory, type Phase, type ProcessResult,
} from './board-brief-runner.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const IMAGE = 'node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d';
const LIMIT = 2 * 1024 * 1024;
const LOCAL_PAIR = 'MATCHES_FROZEN_EXPECTATIONS_UNTRUSTED';
const HARNESS = ['board-brief-loader.mjs', 'board-brief-protocol.mjs', 'board-brief-seams.mjs', 'board-brief-source.mjs', 'board-brief-pdf-reader.mjs'];
const literal = JSON.parse(readFileSync(new URL('./__fixtures__/hamilton-board-brief-975-v1.json', import.meta.url), 'utf8')) as {
  requirements: { requirement_id: string; test_id: string; baselineExpected: 'PASS' | 'FAIL'; assertions: { id: string }[] }[];
  requiredNative: { requirement_id: string; test_id: string; status: string; reason: string }[];
};
const clean: ProcessResult = { status: 0, signal: null, stdout: '', stderr: '' };
const argvInput = (phase: Phase = 'component') => ({
  name: 'verification-hamilton-boundary', image: IMAGE,
  source: '/tmp/hamilton-boundary-source', harness: '/tmp/hamilton-boundary-harness',
  toolchain: '/tmp/hamilton-boundary-toolchain', phase,
});
function mounts(args: string[]) { return args.flatMap((arg, index) => arg === '--mount' ? [args[index + 1]] : []); }
function localOutcomes(baseline: boolean): Outcome[] {
  // Explicit synthetic parent results, not execution, provenance or child PASS claims.
  return literal.requirements.map(group => {
    const assertions = group.assertions.map(row => ({
      id: row.id,
      status: baseline && (group.requirement_id === 'HBB-SAVE-ROUTE-LIFETIME' || row.id === 'HBB-PDF-DENSE-BOUNDS')
        ? 'FAILED' as const : 'PASSED' as const,
    }));
    return { requirement_id: group.requirement_id, test_id: group.test_id,
      status: assertions.some(row => row.status === 'FAILED') ? 'FAILED' : 'PASSED', assertions };
  });
}
function pair() {
  return { baselineOutcomes: localOutcomes(true), targetOutcomes: localOutcomes(false), executionComplete: true, cleanupVerified: true };
}
afterEach(() => { vi.unstubAllEnvs(); });

describe('independent finite Hamilton sandbox boundary', () => {
  it.each<Phase>(['component', 'pdf-render', 'pdf-parse'])('uses fixed resource, user, network and command constraints in %s', phase => {
    const args = draftSandboxArguments(argvInput(phase));
    expect(args.slice(0, 3)).toEqual(['run', '--rm', '--interactive']);
    for (const arg of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--pids-limit=128', '--memory=768m', '--cpus=1', '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m']) expect(args).toContain(arg);
    const imageIndex = args.indexOf(IMAGE);
    expect(imageIndex).toBeGreaterThan(0);
    expect(args.slice(imageIndex + 1)).toEqual(phase === 'pdf-parse'
      ? ['node', '/harness/board-brief-pdf-reader.mjs']
      : ['node', '--import', '/harness/board-brief-loader.mjs', '/harness/board-brief-source.mjs']);
    expect(args).not.toContain('--privileged');
    expect(args).not.toContain('--network=host');
    expect(args).not.toContain('--env-file');
    expect(args).not.toContain('sh');
    expect(args).not.toContain('bash');
  });

  it.each<Phase>(['component', 'pdf-render', 'pdf-parse'])('mounts only declared read-only inputs and omits source in %s parser', phase => {
    const args = draftSandboxArguments(argvInput(phase));
    expect(mounts(args).sort()).toEqual([
      'type=bind,source=/tmp/hamilton-boundary-harness,target=/harness,readonly',
      'type=bind,source=/tmp/hamilton-boundary-toolchain,target=/toolchain/node_modules,readonly',
      ...(phase === 'pdf-parse' ? [] : ['type=bind,source=/tmp/hamilton-boundary-source,target=/code,readonly']),
    ].sort());
    expect(args.join('\n')).not.toContain('docker.sock');
    expect(args.join('\n')).not.toContain('type=volume');
  });

  it('does not promote host credential or resolver environment into container argv', () => {
    for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'ANTHROPIC_API_KEY', 'DATABASE_URL', 'NODE_OPTIONS', 'NPM_CONFIG_USERCONFIG']) vi.stubEnv(key, `BOUNDARY_CANARY_${key}`);
    const args = draftSandboxArguments(argvInput());
    const env = args.filter(arg => arg.startsWith('--env='));
    expect(env).toContain('--env=HAMILTON_PHASE=component');
    for (const entry of env) expect(['CODE_ROOT', 'TOOLCHAIN_ROOT', 'HAMILTON_PHASE']).toContain(entry.slice('--env='.length).split('=')[0]);
    expect(args.join('\n')).not.toContain('BOUNDARY_CANARY_');
    expect(args.join('\n')).not.toMatch(/GITHUB_TOKEN|GH_TOKEN|ANTHROPIC_API_KEY|DATABASE_URL|NODE_OPTIONS|NPM_CONFIG_USERCONFIG/);
  });

  it.each<[string, Partial<Parameters<typeof draftSandboxArguments>[0]>]>([
    ['relative source', { source: 'relative/source' }],
    ['mount comma', { source: '/tmp/source,target=/secrets' }],
    ['mount newline', { harness: '/tmp/harness\n--privileged' }],
    ['mount null', { toolchain: '/tmp/tool\0chain' }],
    ['mount traversal', { source: '/tmp/../secrets' }],
    ['unscoped container name', { name: 'production-database' }],
    ['name option injection', { name: 'verification-test --privileged' }],
    ['mutable image', { image: 'node:22' }],
    ['image option injection', { image: `${IMAGE} --privileged` }],
    ['unknown phase', { phase: 'native' as Phase }],
  ])('rejects %s before execution', (_label, change) => {
    expect(() => draftSandboxArguments({ ...argvInput(), ...change } as Parameters<typeof draftSandboxArguments>[0])).toThrow();
  });

  it('allows only the frozen value-driver files, never parent oracle, assertions or fixture', () => {
    expect(DRAFT_HARNESS_FILES).toEqual(HARNESS);
    expect(Object.isFrozen(DRAFT_HARNESS_FILES)).toBe(true);
    expect(DRAFT_HARNESS_FILES.join('\n')).not.toMatch(/draft|runner|\.test\.|__fixtures__|\.json/);
  });
});

describe('independent structured process failures are never behavioral RED', () => {
  it.each<Phase>(['component', 'pdf-render', 'pdf-parse'])('does not trust assertion prose or a source PASSED claim in %s', phase => {
    const result = classifyDraftExecution({ status: 1,
      stdout: JSON.stringify({ schema_version: 1, status: 'PASSED', cases: [] }),
      stderr: 'AssertionError: HBB-COMP-06 expected assertion; Cannot find module /code/missing.tsx',
    }, phase);
    expect(result.status).toBe('SETUP_FAILURE');
    expect(result.values).toEqual([]);
  });

  it.each<ProcessResult>([
    { status: null, error: { code: 'ENOENT', message: 'docker unavailable' }, stdout: '', stderr: '' },
    { status: 0, error: { code: 'ENOMEM', message: 'allocation failed' }, stdout: '{"status":"PASSED"}' },
    { status: 137, stdout: '{"status":"PASSED"}', stderr: 'OOM killed' },
  ])('keeps spawn/nonzero failures blocked: %j', fake => {
    expect(classifyDraftExecution(fake, 'component')).toMatchObject({ status: 'SETUP_FAILURE', values: [] });
  });

  it.each<ProcessResult>([
    { status: null, error: { code: 'ETIMEDOUT', message: 'timed out' }, stdout: '{"status":"PASSED"}' },
    { status: null, signal: 'SIGTERM', stdout: '{"status":"PASSED"}' },
    { status: 0, signal: 'SIGKILL', stdout: '{"status":"PASSED"}' },
  ])('keeps timeout and termination separate from expected assertion failure: %j', fake => {
    expect(classifyDraftExecution(fake, 'component')).toMatchObject({ status: 'TIMEOUT', values: [] });
  });

  it.each<[string, string]>([
    ['empty stdout', ''],
    ['invalid JSON', 'AssertionError: HBB-COMP-06'],
    ['primitive JSON', 'true'],
    ['child verdict', '{"schema_version":1,"cases":[],"status":"PASSED"}'],
    ['missing cases', '{"schema_version":1}'],
    ['missing observations', '{"schema_version":1,"cases":[]}'],
    ['trailing record', '{"schema_version":1,"cases":[]}\n{"status":"PASSED"}'],
    ['extra top-level field', '{"schema_version":1,"cases":[],"proof":"CODE_VERIFIED"}'],
    ['wrong source stage', '{"schema_version":1,"cases":[{"id":"HBB-PDF-DENSE","kind":"pdf-bytes","base64":"JVBERi0="}]}'],
    ['oversized stdout', 'x'.repeat(LIMIT + 1)],
  ])('rejects %s rather than borrowing child status', (_label, stdout) => {
    expect(classifyDraftExecution({ ...clean, stdout }, 'component')).toMatchObject({ status: 'SETUP_FAILURE', values: [] });
  });

  it('rejects bytes without mistaking nonzero setup for a parser layout failure', () => {
    expect(classifyDraftExecution({ status: 1, stdout: '{"schema_version":1,"cases":[]}', stderr: 'Invalid bounded PDF bytes' }, 'pdf-parse'))
      .toMatchObject({ status: 'SETUP_FAILURE', values: [] });
  });
});

describe('independent owned container cleanup', () => {
  it('accepts completed removal and a successful empty native absence query', () => {
    expect(ownedCleanupAssessment(clean, clean)).toEqual({ ok: true, problems: [] });
  });
  it('accepts an already auto-removed --rm container only with successful native absence corroboration', () => {
    expect(ownedCleanupAssessment({ ...clean, status: 1, stderr: 'No such container: verification-hamilton-boundary' }, clean))
      .toEqual({ ok: true, problems: [] });
  });
  it.each<[string, ProcessResult, ProcessResult]>([
    ['incomplete removal', { ...clean, status: null }, clean],
    ['remove error', { ...clean, error: { code: 'ENOENT' } }, clean],
    ['remove termination', { ...clean, signal: 'SIGTERM' }, clean],
    ['query exit', clean, { ...clean, status: 1 }],
    ['query error', clean, { ...clean, error: { code: 'ETIMEDOUT' } }],
    ['query termination', clean, { ...clean, signal: 'SIGTERM' }],
    ['incomplete absence query', clean, { ...clean, status: null }],
    ['uncorroborated already-removed claim', { ...clean, status: 1, stderr: 'No such container' }, { ...clean, status: 1 }],
    ['owned container remains', clean, { ...clean, stdout: 'verification-hamilton-boundary\n' }],
    ['unrecognized nonempty answer', clean, { ...clean, stdout: '{}' }],
  ])('fails closed on %s', (_label, removal, absence) => {
    const result = ownedCleanupAssessment(removal, absence);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe('independent local code pairing cannot grant native or trusted authority', () => {
  it('reports a complete synthetic local pair while both required native groups and overall status remain blocked', () => {
    const result = assessDraftResults(pair());
    expect(result).toMatchObject({ status: 'BLOCKED', codePairStatus: LOCAL_PAIR, currentCodeVerified: false, registered: false, nativeStatus: 'BLOCKED' });
    expect(result.requiredNative).toEqual(literal.requiredNative);
    expect(result.requiredNative).toHaveLength(2);
  });
  it.each<[string, (input: ReturnType<typeof pair>) => void]>([
    ['missing group', (input: ReturnType<typeof pair>) => { input.targetOutcomes.pop(); }],
    ['duplicate group', (input: ReturnType<typeof pair>) => { input.targetOutcomes[1] = structuredClone(input.targetOutcomes[0]); }],
    ['wrong test identity', (input: ReturnType<typeof pair>) => { input.targetOutcomes[0].test_id = 'BUILDER_GREEN'; }],
    ['missing assertion', (input: ReturnType<typeof pair>) => { input.targetOutcomes[0].assertions.pop(); }],
    ['duplicate assertion', (input: ReturnType<typeof pair>) => { input.targetOutcomes[0].assertions[1] = structuredClone(input.targetOutcomes[0].assertions[0]); }],
    ['cross-group assertion', (input: ReturnType<typeof pair>) => { input.targetOutcomes[0].assertions[0].id = input.targetOutcomes[1].assertions[0].id; }],
    ['failed target hidden by PASSED group', (input: ReturnType<typeof pair>) => { input.targetOutcomes[0].assertions[0].status = 'FAILED'; }],
    ['wrong target group status', (input: ReturnType<typeof pair>) => { input.targetOutcomes[0].status = 'FAILED'; }],
    ['baseline defect no longer fails', (input: ReturnType<typeof pair>) => { input.baselineOutcomes = localOutcomes(false); }],
    ['baseline PASS control fails', (input: ReturnType<typeof pair>) => { input.baselineOutcomes[1].status = 'FAILED'; input.baselineOutcomes[1].assertions[0].status = 'FAILED'; }],
    ['missing PDF literals disguised as baseline defect', (input: ReturnType<typeof pair>) => { input.baselineOutcomes[2].assertions.find(row => row.id === 'HBB-PDF-DENSE-ALL-LITERALS')!.status = 'FAILED'; }],
    ['missing PDF associations disguised as baseline defect', (input: ReturnType<typeof pair>) => { input.baselineOutcomes[2].assertions.find(row => row.id === 'HBB-PDF-DENSE-ROW-ASSOCIATIONS')!.status = 'FAILED'; }],
    ['missing native font disguised as baseline defect', (input: ReturnType<typeof pair>) => { input.baselineOutcomes[2].assertions.find(row => row.id === 'HBB-PDF-DENSE-NATIVE-FONT')!.status = 'FAILED'; }],
    ['missing native execution not silently completed', (input: ReturnType<typeof pair>) => { input.executionComplete = false; }],
    ['unverified cleanup', (input: ReturnType<typeof pair>) => { input.cleanupVerified = false; }],
  ])('blocks local matching on %s', (_label, mutate) => {
    const input = pair(); mutate(input);
    const result = assessDraftResults(input);
    expect(result).toMatchObject({ status: 'BLOCKED', codePairStatus: 'BLOCKED', currentCodeVerified: false, registered: false, nativeStatus: 'BLOCKED' });
    expect(result.requiredNative).toEqual(literal.requiredNative);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

const docker = process.env.HAMILTON_PROOF_DRAFT_DOCKER === '1' ? describe : describe.skip;
const hostDockerEnvironment = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'TMPDIR']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]!])) });
const driver = `import {createSeamControl} from './board-brief-seams.mjs';
createSeamControl();
const value = await import('file:///code/src/probe.ts');
process.stdout.write(JSON.stringify(value.default));\n`;

function cleanDockerToolchain(): string {
  // This tree is never used to run host tests. Only dependencies are mounted;
  // package/lock/config/install receipts remain outside the candidate container.
  const requested = process.env.HAMILTON_PROOF_DRAFT_TOOLCHAIN;
  if (!requested || !isAbsolute(requested)) throw new Error('Explicit clean Docker toolchain path is required');
  const toolchain = realpathSync(requested), root = dirname(toolchain);
  if (requested !== toolchain || !lstatSync(toolchain).isDirectory() || lstatSync(toolchain).isSymbolicLink()
    || join(root, 'node_modules') !== toolchain) throw new Error('Docker toolchain must be a canonical dependency directory');
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const read = (path: string) => {
    const file = join(root, path), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Clean toolchain input is not a bounded regular file');
    return readFileSync(file);
  };
  const install = JSON.parse(read('install-receipt.json').toString('utf8')) as Record<string, unknown>;
  const inputs = JSON.parse(read('inputs.json').toString('utf8')) as Record<string, string>;
  const recorded = install.inputSha256 as Record<string, string> | undefined;
  if (install.exitCode !== 0 || install.scriptsEnabled !== false || install.candidateSourcePresent !== false
    || install.usedByHostTests !== false || install.nodeModulesPresent !== true || !recorded) throw new Error('Clean dependency install receipt is incomplete');
  for (const path of ['package.json', 'package-lock.json', 'vendor/baseline-browser-mapping/baseline-browser-mapping-2.9.19-process-error-backport.tgz']) {
    const actual = hash(read(path));
    if (actual !== hash(readFileSync(join(REPOSITORY, path))) || actual !== recorded[path] || actual !== inputs[path]) throw new Error('Clean runtime differs from the trusted parent package inputs');
  }
  for (const path of ['empty-user.conf', 'empty-global.conf']) {
    const bytes = read(path);
    if (bytes.length || hash(bytes) !== recorded[path] || hash(bytes) !== inputs[path]) throw new Error('Clean npm configuration was not empty');
  }
  if (hash(read('install.log')) !== install.installLogSha256) throw new Error('Clean dependency install log changed');
  const inventory = JSON.parse(read('dependency-inventory-receipt.json').toString('utf8')) as Record<string, unknown>;
  if (hash(read('dependency-byte-inventory.json')) !== inventory.inventorySha256 || inventory.cacheOrConfigAtKnownRoots !== false
    || inventory.parentFixtureOrSubjectInputsProvidedToInstall !== false || inventory.candidateExecution !== false
    || inventory.hostTestsUsedTree !== false) throw new Error('Clean dependency inventory is incomplete');
  for (const file of ['.vite', '.cache', '.vite-temp', '.vitest', '.turbo', '.parcel-cache', '.npmrc']) {
    try { lstatSync(join(toolchain, file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Docker dependency tree contains cache or configuration artifacts');
  }
  for (const path of ['src', '.git', '.npmrc', 'npm-shrinkwrap.json']) {
    try { lstatSync(join(root, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    throw new Error('Clean dependency preparation contains unexpected source or configuration');
  }
  return toolchain;
}

function runProbe(probe: string, phase: 'component' | 'pdf-render', invalidPhase = false): { status: number | null; stdout: string; stderr: string } {
  // Preparing literal files is safe on the host; ONLY Docker executes the loader/source.
  // The daemon shares this workspace, unlike macOS tmpdir. A node_modules segment
  // excludes the intentional forbidden.test.ts probe from ordinary tool discovery.
  const repository = realpathSync(REPOSITORY);
  const probeBase = join(repository, 'test-results/engineering-verification/hamilton-proof-adapter/docker-probe-scratch/node_modules');
  const prefix = validateDraftOutputDirectory(repository, join(probeBase, 'owned-probe-'));
  mkdirSync(probeBase, { recursive: true, mode: 0o755 });
  if (realpathSync(probeBase) !== probeBase) throw new Error('Probe scratch ancestry changed before preparation');
  const scratch = mkdtempSync(prefix);
  const source = join(scratch, 'source'), harness = join(scratch, 'harness');
  const name = 'verification-hamilton-boundary-' + randomUUID();
  let result: ReturnType<typeof spawnSync> | undefined;
  let primary: unknown, cleanup: unknown;
  try {
    chmodSync(scratch, 0o755);
    mkdirSync(join(source, 'src/lib/engineering-verification'), { recursive: true, mode: 0o755 });
    mkdirSync(harness, { mode: 0o755 });
    for (const file of DRAFT_HARNESS_FILES) copyFileSync(join(HERE, file), join(harness, file));
    writeFileSync(join(harness, 'probe-driver.mjs'), driver, { mode: 0o644 });
    writeFileSync(join(source, 'src/probe.ts'), probe, { mode: 0o644 });
    writeFileSync(join(source, 'src/forbidden.test.ts'), 'throw new Error("FORBIDDEN_TEST_EXECUTED");', { mode: 0o644 });
    writeFileSync(join(source, 'src/lib/engineering-verification/control.mjs'), 'throw new Error("FORBIDDEN_CONTROL_EXECUTED");', { mode: 0o644 });
    const env = hostDockerEnvironment();
    const present = spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf8', env, timeout: 15000, maxBuffer: LIMIT });
    if (present.error || present.signal || present.status !== 0) throw new Error('Required pinned Docker image is not locally available');
    let args = draftSandboxArguments({ name, image: IMAGE, source, harness, toolchain: cleanDockerToolchain(), phase });
    if (invalidPhase) args = args.map(arg => arg === '--env=HAMILTON_PHASE=component' ? '--env=HAMILTON_PHASE=not-a-phase' : arg);
    const index = args.indexOf(IMAGE);
    if (index < 0) throw new Error('Pinned image missing from finite argv');
    args = [...args.slice(0, index), IMAGE, 'node', '--import', '/harness/board-brief-loader.mjs', '/harness/probe-driver.mjs'];
    // The probe never pulls an absent image; no candidate command is run on the host.
    args.splice(1, 0, '--pull=never');
    result = spawnSync('docker', args, { encoding: 'utf8', env, timeout: 45000, maxBuffer: LIMIT });
    if (result.error || result.signal) throw new Error('Docker boundary probe did not complete');
  } catch (error) { primary = error; }
  finally {
    const env = hostDockerEnvironment();
    const removed = spawnSync('docker', ['rm', '--force', name], { encoding: 'utf8', env, timeout: 10000, maxBuffer: LIMIT });
    const absent = spawnSync('docker', ['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], { encoding: 'utf8', env, timeout: 10000, maxBuffer: LIMIT });
    const verified = ownedCleanupAssessment(removed, absent);
    if (!verified.ok) cleanup = new Error('Owned Docker probe cleanup or absence could not be verified');
    try {
      rmSync(scratch, { recursive: true, force: true });
      if (existsSync(scratch)) cleanup = new Error('Owned probe source fixtures were not removed');
    } catch { cleanup = new Error('Owned probe source fixtures could not be removed'); }
  }
  if (primary && cleanup) throw new AggregateError([primary, cleanup], 'Boundary probe and owned cleanup failed');
  if (primary) throw primary;
  if (cleanup) throw cleanup;
  if (!result) throw new Error('No Docker boundary observation');
  return { status: result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

docker('opt-in Docker-only loader and parent-data isolation probes', () => {
  it('positive control: exposes only the finite ordinary action seam exports', () => {
    const result = runProbe(`const actions=await import('@/app/pro/(hamilton)/reports/board-actions'); export default Object.keys(actions).sort();`, 'component');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['previewBoardBriefFindings', 'saveBoardBrief']);
  }, 75000);

  it('rejects unknown phase before the source execution canary', () => {
    const result = runProbe(`process.stdout.write('SOURCE_RAN'); export default true;`, 'component', true);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('SOURCE_RAN');
    expect(result.stderr).toContain('Unsupported immutable loader phase');
  }, 75000);

  it('keeps PDF phase immutable when source tries to enable component-only seams', () => {
    const result = runProbe(`process.env.HAMILTON_PHASE='component'; let admitted=false; try{await import('@/app/pro/(hamilton)/reports/board-actions'); admitted=true;}catch{} export default {admitted};`, 'pdf-render');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ admitted: false });
  }, 75000);

  it('rejects existing control, test and private-harness imports plus undeclared import schemes', () => {
    const result = runProbe(`const targets=['./forbidden.test.ts','./lib/engineering-verification/control.mjs','file:///harness/board-brief-protocol.mjs','data:text/javascript,export default true']; const blocked=[]; for(const target of targets){try{await import(target);blocked.push(false);}catch{blocked.push(true);}} export default blocked;`, 'component');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([true, true, true, true]);
    expect(result.stderr).not.toMatch(/FORBIDDEN_TEST_EXECUTED|FORBIDDEN_CONTROL_EXECUTED/);
  }, 75000);

  it('does not mount the parent oracle, expected fixture or assertion files into the actual value harness', () => {
    const result = runProbe(`import {existsSync,readdirSync} from 'node:fs'; const forbidden=['/harness/board-brief-draft.mjs','/harness/board-brief-runner.mjs','/harness/hamilton-board-brief-pilot.test.ts','/harness/__fixtures__/hamilton-board-brief-975-v1.json','/code/src/lib/engineering-verification/__fixtures__/hamilton-board-brief-975-v1.json']; export default {names:readdirSync('/harness').sort(),present:forbidden.map(path=>existsSync(path))};`, 'component');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ names: [...HARNESS, 'probe-driver.mjs'].sort(), present: [false, false, false, false, false] });
  }, 75000);
});
