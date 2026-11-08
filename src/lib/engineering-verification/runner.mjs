import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, chmodSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as knoxPilot from './pilot.mjs';
import * as policyPilot from './policy-pilot.mjs';
import { assessProofBundle, contractDigest, validateContract } from './contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^node@sha256:[a-f0-9]{64}$/;
const LIMIT = 2 * 1024 * 1024;
const PILOTS = { '2285': knoxPilot, '1048': policyPilot };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Inspect Git tree modes before extracting any candidate-controlled archive on the parent host. */
export function validateSnapshotEntries(tree) {
  if (typeof tree !== 'string') throw new Error('Git tree inventory unavailable');
  const entries = tree.split('\0').filter(Boolean);
  if (!entries.length) throw new Error('Empty source tree');
  for (const entry of entries) {
    const match = entry.match(/^100(?:644|755) blob [a-f0-9]{40}\t(.+)$/);
    const path = match?.[1];
    if (!path || /[\x00-\x1f\x7f\ufffd]/.test(path) || !(path === 'package.json' || path.startsWith('src/'))
      || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsupported or escaping source tree entry');
  }
  return entries.length;
}
const cleanEnvironment = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONTEXT: process.env.DOCKER_CONTEXT, TMPDIR: process.env.TMPDIR });

/** Static argv only. No shell, inherited credentials, network, or writable host mount. */
export function sandboxArguments({ name, image, source, harness, toolchain }) {
  if (!/^verification-[a-zA-Z0-9-]+$/.test(name) || !DIGEST.test(image)) throw new Error('Unapproved sandbox identity');
  for (const path of [source, harness, toolchain]) if (!path.startsWith('/') || /[,\r\n]/.test(path)) throw new Error('Unsafe mount path');
  return ['run', '--rm', '--interactive', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=768m', '--cpus=1',
    '--user=65534:65534', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m',
    '--mount', 'type=bind,source=' + source + ',target=/code,readonly',
    '--mount', 'type=bind,source=' + harness + ',target=/harness,readonly',
    '--mount', 'type=bind,source=' + toolchain + ',target=/toolchain/node_modules,readonly',
    '--workdir=/code', '--env=CODE_ROOT=/code', '--env=TOOLCHAIN_ROOT=/toolchain',
    image, 'node', '--import', '/harness/loader.mjs', '/harness/child.mjs'];
}

/** Process errors and child prose can never constitute an expected assertion failure. */
export function classifyExecution(result, adapterId = knoxPilot.ADAPTER_ID) {
  const base = { execution_exit_code: result.status ?? null, stderr: String(result.stderr ?? '').slice(0, 8192) };
  if (result.error?.code === 'ETIMEDOUT' || result.signal) return { ...base, failure_kind: 'TIMEOUT', outcomes: [], error: 'Source process timed out or was terminated' };
  if (result.error || result.status !== 0) return { ...base, failure_kind: 'SETUP_FAILURE', outcomes: [], error: result.error?.message ?? 'Source process did not complete' };
  try {
    if (Buffer.byteLength(String(result.stdout)) > LIMIT) throw new Error('Source output exceeds bound');
    const value = JSON.parse(result.stdout);
    if (!value || value.schema_version !== 1 || Object.keys(value).sort().join(',') !== 'cases,schema_version') throw new Error('Unexpected source output protocol');
    const pilot = Object.values(PILOTS).find(item => item.ADAPTER_ID === adapterId);
    if (!pilot) throw new Error('Unknown source adapter');
    pilot.validateObservedValues(value.cases);
    const outcomes = pilot.assessPilotValues(value.cases);
    return { ...base, failure_kind: outcomes.some(row => row.status === 'FAILED') ? 'ASSERTION_FAILURE' : 'NONE', outcomes, values: value.cases };
  } catch (error) {
    return { ...base, failure_kind: 'SETUP_FAILURE', outcomes: [], error: error.message };
  }
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', env: cleanEnvironment(), timeout: 60000, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(binary + ' failed: ' + (result.error?.message ?? String(result.stderr).slice(0, 4000)));
  return result.stdout.trim();
}

function assertCommit(root, sha) {
  if (!SHA.test(sha)) throw new Error('An exact 40-character commit SHA is required');
  if (command('git', ['cat-file', '-t', sha], { cwd: root }) !== 'commit') throw new Error('Source identity must be a commit');
  return sha;
}

function snapshot(root, sha, directory, adapterId) {
  validateSnapshotEntries(command('git', ['ls-tree', '-r', '-z', '--full-tree', sha, '--', 'src', 'package.json'], { cwd: root }));
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  const archive = spawnSync('git', ['archive', '--format=tar', sha, '--', 'src', 'package.json'], {
    cwd: root, env: cleanEnvironment(), timeout: 60000, maxBuffer: 64 * 1024 * 1024,
  });
  if (archive.error || archive.status !== 0) throw new Error('Could not materialize source snapshot');
  command('tar', ['-xf', '-', '-C', directory, '--no-same-owner'], { input: archive.stdout });
  // The extraction closure needs none of the verifier's public expected answers or control code.
  if (!realpathSync(join(directory, 'src/lib')).startsWith(realpathSync(directory) + sep)) throw new Error('Snapshot control directory escaped sandbox');
  const candidatePolicy = adapterId === policyPilot.ADAPTER_ID ? readFileSync(join(directory, 'src/lib/engineering-verification/contract.mjs')) : null;
  rmSync(join(directory, 'src/lib/engineering-verification'), { recursive: true, force: true });
  if (candidatePolicy) {
    mkdirSync(join(directory, 'src/lib/engineering-verification'), { mode: 0o755 });
    writeFileSync(join(directory, 'src/lib/engineering-verification/contract.mjs'), candidatePolicy, { mode: 0o644 });
  }
}

export function frozenIdentities(root, contract) {
  const identities = {};
  for (const requirement of contract.requirements) {
    for (const kind of ['test', 'fixture', 'adapter']) {
      const path = requirement[kind + '_path'];
      const actual = hash(readFileSync(join(root, path)));
      if (actual !== requirement[kind + '_sha256']) throw new Error('Frozen identity changed: ' + path);
      identities[kind + '_sha256'] = actual;
    }
  }
  for (const file of contract.execution_files ?? []) {
    if (hash(readFileSync(join(root, file.path))) !== file.sha256) throw new Error('Frozen execution identity changed: ' + file.path);
  }
  return { ...identities, execution_sha256: contractDigest(JSON.stringify(contract.execution_files ?? [])) };
}

/** Only the known pilot is executable; contracts never supply commands to run. */
export function runPilot({ repositoryRoot, headSha, outputDirectory, contractNumber = '2285', artifactUrl = 'local:engineering-verification' }) {
  const root = resolve(repositoryRoot);
  const pilot = PILOTS[contractNumber];
  if (!pilot) throw new Error('No approved execution adapter for this contract');
  const contractPath = join(root, 'docs/project/acceptance/engineering/' + contractNumber + '.json');
  const raw = readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(raw);
  const validation = validateContract(contract);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  if (contract.contract_id !== pilot.PILOT_ID) throw new Error('Contract identity does not match approved adapter');
  const identities = frozenIdentities(root, contract);
  const head = assertCommit(root, headSha);
  const base = assertCommit(root, contract.base_sha);
  const runtime = JSON.parse(readFileSync(join(HERE, 'runtime.json'), 'utf8'));
  if (!DIGEST.test(runtime.image)) throw new Error('Runtime image must be an immutable approved Node digest');
  mkdirSync(outputDirectory, { recursive: true });
  const scratch = mkdtempSync(join(resolve(outputDirectory), 'sandbox-'));
  chmodSync(scratch, 0o755);
  const harness = join(scratch, 'harness');
  mkdirSync(harness, { mode: 0o755 });
  for (const file of ['loader.mjs', 'child.mjs']) cpSync(join(HERE, file), join(harness, file));
  const started = new Date();
  try {
    command('docker', ['image', 'inspect', runtime.image]);
    const runtimeIdentity = JSON.parse(command('docker', ['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL',
      '--user=65534:65534', runtime.image, 'node', '-p', 'JSON.stringify({node:process.version,arch:process.arch,platform:process.platform})']));
    const results = {};
    for (const [label, sha] of [['red', base], ['green', head]]) {
      const directory = join(scratch, label);
      snapshot(root, sha, directory, pilot.ADAPTER_ID);
      const name = 'verification-' + randomUUID();
      try {
        const result = spawnSync('docker', sandboxArguments({ name, image: runtime.image, source: directory, harness, toolchain: join(root, 'node_modules') }), {
          input: JSON.stringify(pilot.pilotRequest()), encoding: 'utf8', env: cleanEnvironment(), timeout: 45000, maxBuffer: LIMIT,
        });
        results[label] = classifyExecution(result, pilot.ADAPTER_ID);
      } finally {
        spawnSync('docker', ['rm', '--force', name], { env: cleanEnvironment(), stdio: 'ignore', timeout: 10000 });
        const absent = spawnSync('docker', ['container', 'ls', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'], { env: cleanEnvironment(), encoding: 'utf8', timeout: 10000 });
        if (absent.error || absent.status !== 0 || absent.stdout.trim()) results[label] = {
          ...results[label], failure_kind: 'CLEANUP_FAILURE', outcomes: [], cleanup_verified: false, error: 'Owned sandbox cleanup could not be verified',
        };
        else results[label].cleanup_verified = true;
      }
      writeFileSync(join(outputDirectory, label + '.json'), JSON.stringify(results[label], null, 2) + '\n');
    }
    const pairs = contract.requirements.map(requirement => {
      const pair = {};
      for (const label of ['red', 'green']) {
        const actual = results[label];
        const outcome = actual.outcomes.find(row => row.requirement_id === requirement.id);
        pair[label] = {
          requirement_id: requirement.id, test_id: requirement.test_id,
          ...identities, contract_sha256: contractDigest(raw),
          ...(label === 'red' ? { base_sha: base } : { head_sha: head }),
          command: pilot.ADAPTER_ID + ' (trusted parent assertions)',
          artifact_url: artifactUrl, execution_exit_code: actual.execution_exit_code,
          exit_code: outcome?.status === 'PASSED' ? 0 : 1, status: outcome?.status ?? 'NOT_TESTED',
          failure_kind: outcome ? (outcome.status === 'FAILED' ? 'ASSERTION_FAILURE' : 'NONE') : actual.failure_kind,
          assertions: outcome?.assertions ?? [],
        };
      }
      return pair;
    });
    const assessment = assessProofBundle(contract, { pairs }, head, contractDigest(raw));
    const receipt = {
      schema_version: '1.0', contract_id: pilot.PILOT_ID, authority: pilot.PILOT.authority,
      base_sha: base, head_sha: head, contract_sha256: contractDigest(raw), execution_files: contract.execution_files,
      source_scope: 'Committed src excluding engineering-verification control-plane files, plus package.json',
      runtime: { ...runtimeIdentity, image: runtime.image, typescript: JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'), 'utf8')).version,
        dependency_lock_sha256: hash(readFileSync(join(root, 'package-lock.json'))) },
      started_at: started.toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - started.valueOf(),
      provenance: { claimed_origin: process.env.GITHUB_ACTIONS === 'true' ? 'GITHUB_ACTIONS_UNCORROBORATED' : 'LOCAL_SANDBOXED_UNTRUSTED',
        workflow_sha: process.env.GITHUB_SHA ?? null, run_id: process.env.GITHUB_RUN_ID ?? null, run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null },
      assessment, pairs, review_status: 'INDEPENDENT_REVIEW_NOT_ENFORCED', production_status: 'PRODUCTION_UNVERIFIED',
    };
    writeFileSync(join(outputDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    writeFileSync(join(outputDirectory, 'summary.md'), [
      '# Fee Insight verification proof', '', 'Contract: ' + pilot.PILOT_ID, 'Baseline: ' + base, 'Target head: ' + head,
      'Behavioral evidence: ' + assessment.status, 'Origin: ' + receipt.provenance.claimed_origin,
      '', ...pairs.map(pair => '- ' + pair.red.requirement_id + ': baseline ' + pair.red.status + ', target ' + pair.green.status),
      '', 'Independent GitHub enforcement and production outcome remain unverified.',
      ...assessment.problems.map(problem => '- BLOCKED: ' + problem), '',
    ].join('\n'));
    return receipt;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length % 2 || args.some((arg, index) => index % 2 === 0 && !['--head', '--output', '--contract'].includes(arg))) throw new Error('Usage: runner.mjs --head <exact-sha> --output <directory> [--contract 2285|1048]');
    const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
    if (!options['--head'] || !options['--output']) throw new Error('Exact --head and --output are required');
    const receipt = runPilot({ repositoryRoot: process.cwd(), headSha: options['--head'], outputDirectory: options['--output'], contractNumber: options['--contract'] ?? '2285',
      artifactUrl: process.env.GITHUB_RUN_ID ? 'https://github.com/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID : undefined });
    process.stdout.write(JSON.stringify({ status: receipt.assessment.status, head_sha: receipt.head_sha, duration_ms: receipt.duration_ms }) + '\n');
    if (receipt.assessment.status === 'BLOCKED') process.exitCode = 1;
  } catch (error) {
    process.stderr.write('BLOCKED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
