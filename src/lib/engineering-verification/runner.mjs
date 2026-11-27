import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, chmodSync, realpathSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as knoxPilot from './pilot.mjs';
import * as policyPilot from './policy-pilot.mjs';
import * as policyV2Pilot from './policy-v2-pilot.mjs';
import * as ciDomainPilot from './ci-domain-pilot.mjs';
import { canonicalPath, collectCiDomainBatch } from './ci-domain-collection.mjs';
import { parseStrictJson } from './strict-json.mjs';
import { assessProofBundle, contractDigest, validateContract } from './contract.mjs';
import { CONTRACT_REVISIONS, resolveContractRevision } from './contract-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^node@sha256:[a-f0-9]{64}$/;
const LIMIT = 2 * 1024 * 1024;
const PILOTS = { '2285': knoxPilot, '1048': policyPilot, '1048-v2': policyV2Pilot, '1048-v3': ciDomainPilot };
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
    const value = parseStrictJson(result.stdout);
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
  const candidatePolicy = [policyPilot.ADAPTER_ID, policyV2Pilot.ADAPTER_ID].includes(adapterId)
    ? readFileSync(join(directory, 'src/lib/engineering-verification/contract.mjs')) : null;
  rmSync(join(directory, 'src/lib/engineering-verification'), { recursive: true, force: true });
  if (candidatePolicy) {
    mkdirSync(join(directory, 'src/lib/engineering-verification'), { mode: 0o755 });
    writeFileSync(join(directory, 'src/lib/engineering-verification/contract.mjs'), candidatePolicy, { mode: 0o644 });
  }
}

function readCanonicalFile(root, path) {
  if (typeof path !== 'string' || !path.length || path.startsWith('/') || /[\\\x00-\x20\x7f:%*?]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe frozen source path');
  let current = realpathSync(root);
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('Frozen source must use a canonical regular file');
  }
  return readFileSync(current);
}

function currentProofPolicy(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('Registered current contract required for proof input closure');
  const matches = CONTRACT_REVISIONS.filter(row => row.contractId === contract.contract_id && '#' + row.issueNumber === contract.issue);
  if (matches.length !== 1) throw new Error('Registered current contract required for proof input closure');
  const revision = resolveContractRevision(matches[0].key, { requireRunnable: true });
  if (!Array.isArray(revision.requiredProofInputs) || !revision.requiredProofInputs.length
    || !Array.isArray(revision.forbiddenProofInputs) || !revision.forbiddenProofInputs.length) throw new Error('Canonical proof input closure unavailable');
  if (!Array.isArray(contract.execution_files)) throw new Error('Required proof execution input closure missing');
  const declared = new Set();
  for (const file of contract.execution_files) {
    if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.path !== 'string' || declared.has(file.path)) throw new Error('Malformed or duplicate proof execution input');
    declared.add(file.path);
  }
  for (const path of revision.requiredProofInputs) {
    if (!declared.has(path)) throw new Error('Required proof execution input missing: ' + path);
  }
  return revision;
}

function assertProofOverridesAbsent(root, paths) {
  const canonicalRoot = realpathSync(root);
  for (const path of paths) {
    try { lstatSync(join(canonicalRoot, path)); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error('Forbidden proof input absence could not be verified: ' + path);
    }
    throw new Error('Forbidden proof input override is present: ' + path);
  }
}

export function frozenIdentities(root, contract) {
  const revision = currentProofPolicy(contract);
  assertProofOverridesAbsent(root, revision.forbiddenProofInputs);
  const identities = {};
  for (const requirement of contract.requirements) {
    for (const kind of ['test', 'fixture', 'adapter']) {
      const path = requirement[kind + '_path'];
      const actual = hash(readCanonicalFile(root, path));
      if (actual !== requirement[kind + '_sha256']) throw new Error('Frozen identity changed: ' + path);
      if (identities[kind + '_sha256'] && identities[kind + '_sha256'] !== actual) throw new Error('Approved pilot requires one shared ' + kind + ' identity');
      identities[kind + '_sha256'] = actual;
    }
  }
  for (const file of contract.execution_files ?? []) {
    if (hash(readCanonicalFile(root, file.path)) !== file.sha256) throw new Error('Frozen execution identity changed: ' + file.path);
  }
  assertProofOverridesAbsent(root, revision.forbiddenProofInputs);
  return { ...identities, execution_sha256: contractDigest(JSON.stringify(contract.execution_files ?? [])) };
}

/** Reader-only path: each native batch owns its complete asynchronous collection envelope. */
export function prepareReaderOutputDirectory(repositoryRoot, outputDirectory) {
  const root = canonicalPath(resolve(repositoryRoot)), output = canonicalPath(resolve(outputDirectory), true);
  if (output === root || !output.startsWith(root + sep)) throw new Error('Fresh reader output must be inside canonical repository');
  try { lstatSync(output); throw new Error('Fresh reader output required; attempt directory already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  canonicalPath(dirname(output));
  // The final mkdir is atomic and refuses a path created after the absence check.
  mkdirSync(output, { mode: 0o700 });
  return canonicalPath(output);
}

async function runCiDomainPilot({ root, headSha, outputDirectory, contract, raw, identities, artifactUrl, revision }) {
  if (!SHA.test(headSha) || !SHA.test(contract.base_sha)) throw new Error('Exact immutable reader source commits required');
  const runtime = parseStrictJson(readCanonicalFile(root, 'src/lib/engineering-verification/runtime.json'));
  if (!DIGEST.test(runtime.image)) throw new Error('Immutable reader runtime required');
  const output = prepareReaderOutputDirectory(root, outputDirectory);
  const harnessSources = Object.fromEntries(['child.mjs', 'ci-domain-probe.mjs', 'ci-domain-stimulus-v2.json'].map(name => [name,
    readCanonicalFile(root, 'src/lib/engineering-verification/' + (name.endsWith('.json') ? '__fixtures__/' : '') + name)]));
  const parentOracleBytes = readCanonicalFile(root, 'src/lib/engineering-verification/__fixtures__/ci-domain-expectations-v2.json');
  const targetHash = contract.execution_files.find(file => file.path === 'src/lib/engineering-verification/github.mjs')?.sha256;
  const started = new Date(), results = {}, readerBatches = { schemaVersion: 1, adapter: ciDomainPilot.ADAPTER_ID, sources: [] };
  let runtimeIdentity = null, retainedBytes = 0, setupBlocked = false;
  for (const [label, sourceRef] of [['red', contract.base_sha], ['green', headSha]]) {
    const group = { label, sourceRef, batches: [] }, values = [];
    readerBatches.sources.push(group);
    results[label] = { execution_exit_code: null, failure_kind: 'SETUP_FAILURE', outcomes: [], cleanup_verified: false };
    for (const batch of ciDomainPilot.BATCHES) {
      if (setupBlocked) break;
      const directory = label + '-' + batch.id;
      try {
        const collected = await collectCiDomainBatch({ repositoryRoot: root, sourceRef,
          expectedSourceSha256: label === 'red' ? ciDomainPilot.BASELINE_SOURCE_SHA256 : targetHash,
          outputDirectory: join(output, directory), batchId: batch.id, caseIds: batch.caseIds,
          request: ciDomainPilot.pilotRequest(batch.id), image: runtime.image, harnessSources, parentOracleBytes });
        const receiptBytes = readCanonicalFile(output, directory + '/receipt.json');
        group.batches.push({ directory, receiptSha256: hash(receiptBytes), receiptBytes: receiptBytes.length, manifest: collected.manifest });
        if (collected.collectionStatus !== 'COMPLETE_UNASSESSED' || collected.execution_exit_code !== 0 || !collected.cleanupVerified) throw new Error(collected.error ?? 'Native reader batch incomplete');
        // Verify every retained raw file; no receipt-authored PASS can replace it.
        for (const artifact of collected.manifest.artifacts) {
          const bytes = readCanonicalFile(output, directory + '/' + artifact.path);
          if (bytes.length !== artifact.bytes || hash(bytes) !== artifact.sha256) throw new Error('Retained reader batch artifact changed');
          retainedBytes += bytes.length;
        }
        retainedBytes += receiptBytes.length;
        if (hash(receiptBytes) !== collected.receiptSha256 || retainedBytes > 8 * 1024 * 1024 - 65536) throw new Error('Reader artifact aggregate exceeds finalization capacity');
        values.push(...ciDomainPilot.parseBatchOutput(collected.stdout, batch.id));
        runtimeIdentity ??= collected.runtime;
      } catch (error) {
        setupBlocked = true;
        results[label].error = error.message;
      }
    }
    if (!setupBlocked && group.batches.length === 2) {
      const outcomes = ciDomainPilot.assessPilotValues(values);
      results[label] = { execution_exit_code: 0, failure_kind: outcomes.some(row => row.status === 'FAILED') ? 'ASSERTION_FAILURE' : 'NONE',
        outcomes, cleanup_verified: true, values };
    }
  }
  // Parent controls must still have their original canonical bytes after collection.
  if (JSON.stringify(frozenIdentities(root, contract)) !== JSON.stringify(identities)) throw new Error('Parent control input bookend changed');
  if (!setupBlocked) ciDomainPilot.validateReaderBatchSet(readerBatches, { baseSha: contract.base_sha, headSha, executionFiles: contract.execution_files });
  const pairs = contract.requirements.map(requirement => Object.fromEntries(['red', 'green'].map(label => {
    const actual = results[label], outcome = actual.outcomes.find(row => row.requirement_id === requirement.id);
    return [label, { requirement_id: requirement.id, test_id: requirement.test_id, ...identities, contract_sha256: contractDigest(raw),
      ...(label === 'red' ? { base_sha: contract.base_sha } : { head_sha: headSha }), command: ciDomainPilot.ADAPTER_ID + ' (trusted parent assertions)',
      artifact_url: artifactUrl, execution_exit_code: actual.execution_exit_code,
      exit_code: outcome?.status === 'PASSED' ? 0 : 1, status: outcome?.status ?? 'NOT_TESTED',
      failure_kind: outcome ? (outcome.status === 'FAILED' ? 'ASSERTION_FAILURE' : 'NONE') : actual.failure_kind,
      assertions: outcome?.assertions ?? [] }];
  })));
  const assessment = assessProofBundle(contract, { pairs }, headSha, contractDigest(raw));
  if (results.red.outcomes.length && !ciDomainPilot.expectedBaselineOutcome(results.red.outcomes)) {
    assessment.status = 'BLOCKED';
    assessment.problems.push('Observed baseline failures differ from the frozen21-case inventory; preserve evidence for review');
  }
  const receipt = { schema_version: '1.0', contract_key: revision.key, contract_id: ciDomainPilot.PILOT_ID, authority: ciDomainPilot.PILOT.authority,
    base_sha: contract.base_sha, head_sha: headSha, contract_sha256: contractDigest(raw), execution_files: contract.execution_files,
    source_scope: 'One literal canonical Git blob src/lib/engineering-verification/github.mjs; selected32+7 fresh builtin-only Node containers per source',
    runtime: { ...runtimeIdentity, image: runtime.image, subject_loader: 'node-mjs-builtins-only', dependency_lock_sha256: hash(readCanonicalFile(root, 'package-lock.json')) },
    started_at: started.toISOString(), completed_at: new Date().toISOString(), duration_ms: Date.now() - started.valueOf(),
    provenance: { claimed_origin: process.env.GITHUB_ACTIONS === 'true' ? 'GITHUB_ACTIONS_UNCORROBORATED' : 'LOCAL_SANDBOXED_UNTRUSTED',
      workflow_sha: process.env.GITHUB_SHA ?? null, run_id: process.env.GITHUB_RUN_ID ?? null, run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null },
    reader_batches: readerBatches, assessment, pairs, review_status: 'INDEPENDENT_REVIEW_NOT_ENFORCED', production_status: 'PRODUCTION_UNVERIFIED' };
  const serialized = JSON.stringify(receipt, null, 2) + '\n';
  const summary = ['# Fee Insight reader verification proof', '', 'Contract: ' + ciDomainPilot.PILOT_ID,
    'Baseline: ' + contract.base_sha, 'Target head: ' + headSha, 'Behavioral evidence: ' + assessment.status,
    'Four fresh32+7 batch captures are required; source exit0 records completion, not an assertion verdict.',
    'Native GitHub acceptance, independent review, owner authorization and production outcomes remain separate.',
    ...assessment.problems.map(problem => 'BLOCKED: ' + problem), ''].join('\n');
  const ownDirectories = new Set(readerBatches.sources.flatMap(source => source.batches.map(batch => batch.directory)));
  const topEntries = readdirSync(output, { withFileTypes: true });
  if (topEntries.length !== ownDirectories.size || topEntries.some(entry => !entry.isDirectory() || !ownDirectories.has(entry.name))) throw new Error('Unexpected or unrelated reader attempt artifacts');
  if (Buffer.byteLength(serialized) > LIMIT || retainedBytes + Buffer.byteLength(serialized) + Buffer.byteLength(summary) > 8 * 1024 * 1024 - 65536) throw new Error('Reader proof receipt/artifact exceeds unchanged capacity');
  writeFileSync(join(output, 'receipt.json'), serialized, { flag: 'wx' });
  writeFileSync(join(output, 'summary.md'), summary, { flag: 'wx' });
  if (readdirSync(output).some(name => !ownDirectories.has(name) && !['receipt.json', 'summary.md'].includes(name))) throw new Error('Reader attempt artifact inventory changed during finalization');
  return receipt;
}

/** Only the known pilot is executable; contracts never supply commands to run. */
export function runPilot({ repositoryRoot, headSha, outputDirectory, contractKey, contractNumber, artifactUrl = 'local:engineering-verification' }) {
  if (contractKey !== undefined && contractNumber !== undefined && contractKey !== contractNumber) throw new Error('Conflicting contract revision selectors');
  const revision = resolveContractRevision(contractKey ?? contractNumber ?? '2285', { requireRunnable: true });
  const root = resolve(repositoryRoot);
  const pilot = PILOTS[revision.key];
  if (!pilot || revision.adapter !== pilot.ADAPTER_ID) throw new Error('No approved execution adapter for this contract revision');
  const raw = readCanonicalFile(root, revision.path).toString('utf8');
  const contract = parseStrictJson(raw);
  const validation = validateContract(contract);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  if (contract.contract_id !== revision.contractId || contract.contract_id !== pilot.PILOT_ID
    || contract.issue !== '#' + revision.issueNumber) throw new Error('Contract identity does not match registered revision and approved adapter');
  if (contract.requirements.length !== pilot.PILOT.requirements.length || pilot.PILOT.requirements.some(expected => {
    const actual = contract.requirements.find(row => row.id === expected.id);
    return !actual || actual.test_id !== expected.test_id
      || JSON.stringify([...actual.assertion_ids].sort()) !== JSON.stringify(expected.assertions.map(row => row.id).sort());
  })) throw new Error('Contract requirements do not match approved parent assertion inventory');
  if (pilot.ADAPTER_ID === ciDomainPilot.ADAPTER_ID) ciDomainPilot.validateReaderContractInventory(contract);
  const identities = frozenIdentities(root, contract);
  if (pilot.ADAPTER_ID === ciDomainPilot.ADAPTER_ID) return runCiDomainPilot({ root, headSha, outputDirectory, contract, raw, identities, artifactUrl, revision });
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
      schema_version: '1.0', contract_key: revision.key, contract_id: pilot.PILOT_ID, authority: pilot.PILOT.authority,
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
    if (args.length % 2 || args.some((arg, index) => index % 2 === 0 && !['--head', '--output', '--contract'].includes(arg))
      || new Set(args.filter((_, index) => index % 2 === 0)).size !== args.length / 2) throw new Error('Usage: runner.mjs --head <exact-sha> --output <directory> --contract 1048-v3');
    const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
    if (!options['--head'] || !options['--output']) throw new Error('Exact --head and --output are required');
    const receipt = await runPilot({ repositoryRoot: process.cwd(), headSha: options['--head'], outputDirectory: options['--output'], contractKey: options['--contract'],
      artifactUrl: process.env.GITHUB_RUN_ID ? 'https://github.com/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID : undefined });
    process.stdout.write(JSON.stringify({ status: receipt.assessment.status, head_sha: receipt.head_sha, duration_ms: receipt.duration_ms }) + '\n');
    if (receipt.assessment.status === 'BLOCKED') process.exitCode = 1;
  } catch (error) {
    process.stderr.write('BLOCKED: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
