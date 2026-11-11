/** Unregistered local draft. Only Docker executes subject source or parses its PDF bytes. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADAPTER_ID, PILOT, PILOT_ID, assessPilotValues, pilotRequest, validateObservedValues } from './board-brief-draft.mjs';
import { boundedJson, fields, keys, text } from './board-brief-protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = 'node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d';
const BASELINE = '8b748c49a9ffeedea997c44a1a0772e6b76a5fb8';
const TARGET = 'afcc6ec2e16b611262c174d8a619a1b7c220a661';
const LIMIT = 2 * 1024 * 1024, SOURCE_LIMIT = 64 * 1024 * 1024;
const PHASES = ['component', 'pdf-render', 'pdf-parse'];
const CODE_PAIR = 'MATCHES_FROZEN_EXPECTATIONS_UNTRUSTED', PREFIX = 'src/lib/engineering-verification/';
export const DRAFT_HARNESS_FILES = Object.freeze(['board-brief-loader.mjs', 'board-brief-protocol.mjs', 'board-brief-seams.mjs', 'board-brief-source.mjs', 'board-brief-pdf-reader.mjs']);
const CLOSURE = Object.freeze([
  '.gitattributes', 'AGENTS.md', 'CLAUDE.md', 'package.json', 'package-lock.json',
  'docs/project/acceptance/engineering/975-board-brief-draft.md',
  'docs/project/acceptance/engineering/design-v1/prd-v1.md', 'docs/project/acceptance/engineering/design-v1/technical-design-v1.md',
  ...[...DRAFT_HARNESS_FILES, 'board-brief-protocol.d.mts', 'board-brief-draft.mjs', 'board-brief-draft.d.mts', 'board-brief-runner.mjs', 'board-brief-runner.d.mts',
    'board-brief-boundary.test.ts', 'board-brief-protocol-stream.test.ts', 'board-brief-inventory.test.ts', 'board-brief-host-guards.test.ts', 'hamilton-board-brief-pilot.test.ts',
    '__fixtures__/hamilton-board-brief-975-v1.json', 'runtime.json', 'policy.json'].map(path => PREFIX + path),
  'vendor/baseline-browser-mapping/baseline-browser-mapping-2.9.19-process-error-backport.tgz',
].sort());
const FORBIDDEN = Object.freeze([
  '.npmrc', 'npm-shrinkwrap.json',
  ...['src', 'src/lib', 'src/lib/engineering-verification'].flatMap(path => [path + '/node_modules', path + '/package.json']),
  ...['.github', '.github/workflows', 'docs', 'docs/project', 'docs/project/acceptance', 'docs/project/acceptance/engineering',
    'docs/project/acceptance/engineering/design-v1', 'src', 'src/lib', 'src/lib/agents', 'src/lib/agents/hoovie',
    'src/lib/engineering-verification', 'src/lib/engineering-verification/__fixtures__', 'vendor', 'vendor/baseline-browser-mapping'].map(path => path + '/.gitattributes'),
].sort());
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha256(JSON.stringify(value));
const within = (root, path) => path === root || path.startsWith(root + sep);
const safePath = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && isAbsolute(value)
  && !/[,\x00-\x20\x7f]/.test(value) && value.split(/[\\/]/).every(part => part !== '.' && part !== '..') && !value.includes('\\');

/** Pure metadata admission; excluded paths and blob identities never enter its selected inventory. */
export function planDraftSourceInventory(listing) {
  if ((typeof listing !== 'string' && !(listing instanceof Uint8Array)) || Buffer.byteLength(listing) > SOURCE_LIMIT) throw new Error('Subject tree listing exceeds bound');
  const decoded = typeof listing === 'string' ? listing : new TextDecoder('utf-8', { fatal: true }).decode(listing);
  if (!decoded.length || !decoded.endsWith('\0')) throw new Error('Incomplete subject inventory');
  const selected = [], spellings = new Map(), terminals = new Set(), directories = new Set(), excluded = {};
  let entries = 0, totalBytes = 0;
  for (const entry of decoded.slice(0, -1).split('\0')) {
    if (++entries > 10000) throw new Error('Subject inventory exceeds file bound');
    const match = /^(\d{6}) (\w+) ([a-f0-9]{40}) +([0-9]+)\t(.+)$/.exec(entry);
    if (!match || !['100644', '100755'].includes(match[1]) || match[2] !== 'blob' || !relativePath(match[5]) || !match[5].startsWith('src/')) throw new Error('Nonregular or unsafe subject entry');
    const path = match[5], bytes = Number(match[4]), parts = path.split('/');
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > SOURCE_LIMIT) throw new Error('Invalid subject file size');
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join('/'), folded = prefix.toLowerCase(), prior = spellings.get(folded);
      if ((prior !== undefined && prior !== prefix) || (index < parts.length && terminals.has(folded))
        || (index === parts.length && (terminals.has(folded) || directories.has(folded)))) throw new Error('Ambiguous subject path or ancestor spelling');
      spellings.set(folded, prefix);
      if (index < parts.length) directories.add(folded); else terminals.add(folded);
    }
    const reason = exclusion(path);
    if (reason) { excluded[reason] ??= { count: 0, bytes: 0 }; excluded[reason].count++; excluded[reason].bytes += bytes; continue; }
    if (bytes > LIMIT || selected.length >= 5000 || (totalBytes += bytes) > SOURCE_LIMIT) throw new Error('Selected subject source exceeds bound');
    selected.push({ path, mode: match[1], blob: match[3], bytes });
  }
  if (!selected.length) throw new Error('Selected subject inventory is empty');
  return { selected, excluded, entries, totalBytes };
}
/** Validates every existing ancestor without creating any file or directory. */
export function validateDraftOutputDirectory(root, path) {
  if (!safePath(root) || !safePath(path) || resolve(root) !== root || resolve(path) !== path || realpathSync(root) !== root
    || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Canonical output root and absolute path are required');
  const ignored = join(root, 'test-results/engineering-verification/hamilton-proof-adapter');
  if (!within(ignored, path) || path === ignored) throw new Error('A fresh owned ignored output directory is required');
  let current = root, missing = false;
  const parts = relative(root, path).split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    if (missing) continue;
    let stat;
    try { stat = lstatSync(current); }
    catch (error) { if (error?.code === 'ENOENT') { missing = true; continue; } throw new Error('Output ancestry could not be verified'); }
    if (stat.isSymbolicLink() || !stat.isDirectory() || index === parts.length - 1) throw new Error('Output ancestry must be canonical and destination unused');
  }
  return path;
}

/** Fixed argv; caller strings cannot add a command, environment or mount. */
export function draftSandboxArguments({ name, image, source, harness, toolchain, phase }) {
  if (typeof name !== 'string' || !/^verification-[a-zA-Z0-9-]{1,100}$/.test(name) || image !== IMAGE || !PHASES.includes(phase)
    || ![source, harness, toolchain].every(safePath)) throw new Error('Unsupported finite draft sandbox input');
  const args = ['run', '--rm', '--interactive', '--pull=never', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=768m', '--cpus=1', '--user=65534:65534',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=32m', '--workdir=' + (phase === 'pdf-parse' ? '/tmp' : '/code'),
    '--env=TOOLCHAIN_ROOT=/toolchain/node_modules', '--env=HAMILTON_PHASE=' + phase,
    '--mount', 'type=bind,source=' + harness + ',target=/harness,readonly', '--mount', 'type=bind,source=' + toolchain + ',target=/toolchain/node_modules,readonly'];
  if (phase !== 'pdf-parse') args.push('--env=CODE_ROOT=/code', '--mount', 'type=bind,source=' + source + ',target=/code,readonly');
  return [...args, image, 'node', ...(phase === 'pdf-parse' ? ['/harness/board-brief-pdf-reader.mjs']
    : ['--import', '/harness/board-brief-loader.mjs', '/harness/board-brief-source.mjs'])];
}
function byteString(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new Error('Invalid bounded process output');
  if (Buffer.byteLength(value) > LIMIT) throw new Error('Process output exceeds bound');
  return typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value);
}
function validateStageValues(value, phase) {
  const expected = phase === 'component' ? PILOT.componentCases : PILOT.pdfCases;
  if (!Array.isArray(value) || value.length !== expected.length) throw new Error('Incomplete stage observation inventory');
  const seen = new Set(); let items = 0, textBytes = 0;
  if (phase !== 'pdf-render') boundedJson(value);
  if (phase !== 'pdf-render' && Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) throw new Error('Stage observations exceed bound');
  for (const row of value) {
    const declared = expected.find(item => item.id === row?.id);
    if (!declared || seen.has(row.id)) throw new Error('Unknown or duplicate stage observation');
    seen.add(row.id);
    if (phase === 'component') {
      if (!keys(row, ['id', 'kind', 'checkpoints']) || row.kind !== 'component' || !Array.isArray(row.checkpoints)
        || row.checkpoints.length !== declared.checkpoints.length) throw new Error('Incomplete raw component checkpoints');
      const names = new Set();
      for (const checkpoint of row.checkpoints) {
        if (!keys(checkpoint, ['name', 'values']) || !declared.checkpoints.includes(checkpoint.name) || names.has(checkpoint.name)
          || !keys(checkpoint.values, fields)) throw new Error('Unknown raw component checkpoint');
        names.add(checkpoint.name); const v = checkpoint.values;
        if (!text(v.pathnameSearch) || ['statusText', 'alertText', 'titleValue', 'noteValue'].some(key => v[key] !== null && !text(v[key]))
          || typeof v.alertPresent !== 'boolean' || ['titleDisabled', 'saveDisabled', 'downloadDisabled'].some(key => v[key] !== null && typeof v[key] !== 'boolean')) throw new Error('Invalid raw component value');
        for (const field of fields.filter(key => key.endsWith('Args'))) if (!Array.isArray(v[field]) || v[field].length > 16
          || v[field].some(args => !Array.isArray(args) || args.length > 4)) throw new Error('Invalid raw argument vector');
      }
    } else if (phase === 'pdf-render') {
      if (!keys(row, ['id', 'kind', 'base64']) || row.kind !== 'pdf-bytes' || typeof row.base64 !== 'string' || !row.base64.length
        || row.base64.length > LIMIT || row.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.base64)) throw new Error('Invalid raw PDF byte frame');
      const bytes = Buffer.from(row.base64, 'base64');
      if (!bytes.length || bytes.length > LIMIT || bytes.toString('base64') !== row.base64 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid bounded PDF bytes');
    } else {
      if (!keys(row, ['id', 'kind', 'pages']) || row.kind !== 'pdf' || !Array.isArray(row.pages) || !row.pages.length || row.pages.length > 12) throw new Error('Incomplete native PDF pages');
      for (const page of row.pages) {
        if (!keys(page, ['width', 'height', 'items']) || ![page.width, page.height].every(n => Number.isFinite(n) && n > 0 && n <= 2000)
          || !Array.isArray(page.items) || page.items.length > 10000) throw new Error('Invalid native PDF page');
        for (const item of page.items) {
          if (!keys(item, ['text', 'transform', 'width', 'height', 'fontAscent', 'fontDescent']) || !text(item.text)
            || !Array.isArray(item.transform) || item.transform.length !== 6 || ![...item.transform, item.width, item.height, item.fontAscent, item.fontDescent].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)
            || item.width < 0 || item.height < 0 || Math.abs(item.fontAscent) > 10 || Math.abs(item.fontDescent) > 10) throw new Error('Invalid native PDF item');
          if (++items > 50000 || (textBytes += Buffer.byteLength(item.text)) > 1024 * 1024) throw new Error('Native PDF text exceeds bound');
        }
      }
    }
  }
}
/** Process status and raw shape grant no behavioral or provenance authority. */
export function classifyDraftExecution(result, phase) {
  const base = { execution_exit_code: Number.isInteger(result?.status) ? result.status : null, phase, values: [] };
  if (!PHASES.includes(phase) || !result || typeof result !== 'object') return { ...base, status: 'SETUP_FAILURE', error: 'Unsupported process observation' };
  if (result.error?.code === 'ETIMEDOUT' || result.signal) return { ...base, status: 'TIMEOUT', error: 'Draft process timed out or was terminated' };
  if (result.error || result.status !== 0) return { ...base, status: 'SETUP_FAILURE', error: 'Draft process did not complete successfully' };
  try {
    const stdout = byteString(result.stdout); byteString(result.stderr);
    const value = JSON.parse(stdout);
    if (!keys(value, ['schema_version', 'cases']) || value.schema_version !== 1 || stdout !== JSON.stringify(value)) throw new Error('Unexpected single-record process protocol');
    validateStageValues(value.cases, phase);
    return { ...base, status: 'OBSERVED_UNTRUSTED', values: value.cases };
  } catch { return { ...base, status: 'SETUP_FAILURE', error: 'Bounded raw stage output is missing, malformed or incomplete' }; }
}
/** --rm can remove a completed container before our explicit removal attempt. */
export function ownedCleanupAssessment(removeResult, listResult) {
  const problems = [];
  if (!removeResult || !Number.isInteger(removeResult.status) || removeResult.error || removeResult.signal) problems.push('Owned removal attempt did not complete');
  try {
    if (!listResult || listResult.status !== 0 || listResult.error || listResult.signal
      || (typeof listResult.stdout !== 'string' && !(listResult.stdout instanceof Uint8Array)) || byteString(listResult.stdout).trim()) problems.push('Exact owned container absence was not corroborated');
  } catch { problems.push('Owned absence response is not bounded'); }
  return { ok: problems.length === 0, problems };
}
function checkedOutcomes(value, label, problems) {
  if (!Array.isArray(value) || value.length !== PILOT.requirements.length) { problems.push(label + ' requirement inventory is incomplete'); return null; }
  const seen = new Set(), result = new Map();
  for (const row of value) {
    const expected = PILOT.requirements.find(item => item.requirement_id === row?.requirement_id);
    if (!expected || seen.has(row.requirement_id) || !keys(row, ['requirement_id', 'test_id', 'status', 'assertions'])
      || row.test_id !== expected.test_id || !['PASSED', 'FAILED'].includes(row.status) || !Array.isArray(row.assertions)
      || row.assertions.length !== expected.assertions.length) { problems.push(label + ' requirement identity differs'); return null; }
    seen.add(row.requirement_id); const assertions = new Map();
    for (const assertion of row.assertions) {
      if (!assertion || !keys(assertion, ['id', 'status', ...(Object.hasOwn(assertion, 'message') ? ['message'] : [])])
        || !expected.assertions.some(item => item.id === assertion.id) || assertions.has(assertion.id) || !['PASSED', 'FAILED'].includes(assertion.status)
        || (Object.hasOwn(assertion, 'message') && !text(assertion.message))) { problems.push(label + ' assertion identity differs'); return null; }
      assertions.set(assertion.id, assertion.status);
    }
    if (row.status !== ([...assertions.values()].every(status => status === 'PASSED') ? 'PASSED' : 'FAILED')) { problems.push(label + ' group status contradicts assertions'); return null; }
    result.set(row.requirement_id, assertions);
  }
  return result;
}
/** Finite local code pairing cannot complete the required native groups. */
export function assessDraftResults({ baselineOutcomes, targetOutcomes, executionComplete, cleanupVerified } = {}) {
  const problems = [];
  if (executionComplete !== true) problems.push('All credentialless collection stages must complete');
  if (cleanupVerified !== true) problems.push('Owned resource cleanup must be verified');
  const baseline = checkedOutcomes(baselineOutcomes, 'Baseline', problems), target = checkedOutcomes(targetOutcomes, 'Target', problems);
  if (target) for (const assertions of target.values()) if ([...assertions.values()].some(status => status !== 'PASSED')) problems.push('Every target assertion must pass');
  if (baseline) for (const requirement of PILOT.requirements) {
    const assertions = baseline.get(requirement.requirement_id);
    if (requirement.requirement_id === 'HBB-SAVE-ROUTE-LIFETIME') {
      if ([...assertions.values()].some(status => status !== 'FAILED')) problems.push('Each of the eight baseline route defects must reproduce');
    } else if (requirement.requirement_id === 'HBB-PDF-DENSE-PAGINATION') {
      const geometric = requirement.assertions.filter(row => ['bounds', 'order', 'pagination'].includes(row.oracle));
      if (requirement.assertions.filter(row => !geometric.includes(row)).some(row => assertions.get(row.id) !== 'PASSED')) problems.push('Baseline PDF text, associations and native font must be preserved');
      if (!geometric.some(row => assertions.get(row.id) === 'FAILED')) problems.push('A baseline dense geometry defect must reproduce');
    } else if ([...assertions.values()].some(status => status !== 'PASSED')) problems.push('Every baseline compatibility control must pass');
  }
  return { status: 'BLOCKED', codePairStatus: problems.length ? 'BLOCKED' : CODE_PAIR, currentCodeVerified: false, registered: false,
    nativeStatus: 'BLOCKED', requiredNative: PILOT.requiredNative, problems };
}

function hostEnvironment(docker = false) {
  const allowed = docker ? ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'TMPDIR'] : ['PATH', 'TMPDIR'];
  return Object.fromEntries(allowed.filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
}
function git(root, args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, env: { ...hostEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 45000, maxBuffer: SOURCE_LIMIT, ...options });
  if (result.error || result.signal || result.status !== 0) throw new Error('Exact subject Git read did not complete');
  return result.stdout;
}
function relativePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024 && !path.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(path)
    && path.normalize('NFC') === path && path.split('/').every(part => part && part !== '.' && part !== '..');
}
function canonicalBytes(root, path) {
  if (!relativePath(path)) throw new Error('Invalid parent input path');
  let current = root;
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part); const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('Parent inputs require canonical regular files');
  }
  const fd = openSync(current, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Parent input exceeds file bound');
    const bytes = readFileSync(fd);
    if (bytes.length !== stat.size) throw new Error('Parent input changed during read');
    return bytes;
  } finally { closeSync(fd); }
}
function absentOverrides(root) {
  for (const path of FORBIDDEN) {
    try { lstatSync(join(root, path)); }
    catch (error) { if (error?.code === 'ENOENT') continue; throw new Error('Parent override absence could not be verified'); }
    throw new Error('Forbidden parent resolver or attributes input exists');
  }
}
function cleanToolchain(root, directory, files) {
  if (!safePath(directory) || realpathSync(directory) !== directory || !directory.endsWith('/node_modules')
    || !lstatSync(directory).isDirectory() || directory === realpathSync(join(root, 'node_modules'))) throw new Error('An explicit separate clean runtime installation is required');
  const installRoot = dirname(directory), inputs = ['package.json', 'package-lock.json',
    'vendor/baseline-browser-mapping/baseline-browser-mapping-2.9.19-process-error-backport.tgz'];
  const hashes = {};
  for (const path of inputs) {
    const bytes = canonicalBytes(installRoot, path), expected = files.find(row => row.path === path)?.sha256;
    if (!expected || sha256(bytes) !== expected) throw new Error('Clean runtime input differs from reviewed parent source');
    hashes[path] = expected;
  }
  for (const path of ['src', '.git', '.npmrc', 'npm-shrinkwrap.json']) {
    try { lstatSync(join(installRoot, path)); }
    catch (error) { if (error?.code === 'ENOENT') continue; throw new Error('Clean runtime config absence could not be verified'); }
    throw new Error('Unexpected clean runtime installation config');
  }
  const empty = sha256('');
  for (const path of ['empty-user.conf', 'empty-global.conf']) {
    if (sha256(canonicalBytes(installRoot, path)) !== empty) throw new Error('Clean runtime npm configs are not empty');
    hashes[path] = empty;
  }
  const receiptBytes = canonicalBytes(installRoot, 'install-receipt.json'), receipt = JSON.parse(receiptBytes.toString('utf8'));
  const command = ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline',
    '--userconfig=' + join(installRoot, 'empty-user.conf'), '--globalconfig=' + join(installRoot, 'empty-global.conf')];
  if (receipt.exitCode !== 0 || receipt.scriptsEnabled !== false || receipt.candidateSourcePresent !== false || receipt.usedByHostTests !== false
    || receipt.offline !== true || receipt.nodeModulesPresent !== true || JSON.stringify(receipt.command) !== JSON.stringify(command)
    || !keys(receipt.inputSha256, inputs.concat(['empty-user.conf', 'empty-global.conf']))
    || Object.entries(hashes).some(([path, hash]) => receipt.inputSha256[path] !== hash)
    || receipt.installLogSha256 !== sha256(canonicalBytes(installRoot, 'install.log'))) throw new Error('Clean runtime preparation receipt does not match retained local inputs');
  const inventoryBytes = canonicalBytes(installRoot, 'dependency-byte-inventory.json');
  const inventoryReceiptBytes = canonicalBytes(installRoot, 'dependency-inventory-receipt.json');
  const inventoryReceipt = JSON.parse(inventoryReceiptBytes.toString('utf8'));
  if (inventoryReceipt.inventorySha256 !== sha256(inventoryBytes) || inventoryReceipt.cacheOrConfigAtKnownRoots !== false
    || inventoryReceipt.parentFixtureOrSubjectInputsProvidedToInstall !== false || inventoryReceipt.candidateExecution !== false
    || inventoryReceipt.hostTestsUsedTree !== false) throw new Error('Clean runtime inventory receipt does not match retained preparation');
  const forbidden = new Set(['.vite', '.vite-temp', '.vitest', '.cache', '.next', '.turbo', '.parcel-cache', '.npmrc', 'npm-shrinkwrap.json']);
  let entries = 0, symlinks = 0;
  const scan = (path, depth) => {
    if (depth > 32) throw new Error('Clean runtime metadata depth exceeds bound');
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (++entries > 500000 || forbidden.has(entry.name) || (depth === 0 && /^\.env(?:\.|$)/.test(entry.name))) throw new Error('Clean runtime contains cache/config artifacts or exceeds bound');
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        if (!within(directory, realpathSync(child))) throw new Error('Clean runtime link escapes its installation');
        symlinks++;
      } else if (entry.isDirectory()) scan(child, depth + 1);
      else if (!entry.isFile()) throw new Error('Clean runtime contains a nonregular input');
    }
  };
  scan(directory, 0);
  return { directory, install_inputs: hashes, install_receipt_sha256: sha256(receiptBytes),
    recorded_dependency_inventory_sha256: sha256(inventoryBytes), dependency_inventory_receipt_sha256: sha256(inventoryReceiptBytes),
    cache_scan: { entries, symlinks, forbidden_names: [...forbidden] },
    preparation_authority: 'LOCAL_RECORDED_PREPARATION_NOT_NATIVE_AUTHENTICATION' };
}
function closure(root, toolchainDirectory) {
  absentOverrides(root);
  const files = CLOSURE.map(path => { const bytes = canonicalBytes(root, path); return { path, sha256: sha256(bytes), bytes: bytes.length }; });
  const packages = ['typescript', 'react', 'react-dom', 'jsdom', '@testing-library/react', '@react-pdf/renderer', 'unpdf'];
  const clean = cleanToolchain(root, toolchainDirectory, files), toolchain = clean.directory;
  const installed = packages.map(name => {
    const bytes = canonicalBytes(toolchain, name + '/package.json'), value = JSON.parse(bytes.toString('utf8'));
    if (typeof value.version !== 'string' || !value.version.length) throw new Error('Toolchain package identity unavailable');
    return { name, version: value.version, package_json_sha256: sha256(bytes) };
  });
  const runtime = JSON.parse(canonicalBytes(root, PREFIX + 'runtime.json').toString('utf8'));
  if (runtime.image !== IMAGE) throw new Error('Draft runtime differs from approved immutable image');
  absentOverrides(root);
  const toolchainProvenance = { ...clean, resolved_path: toolchain, lock_sha256: files.find(row => row.path === 'package-lock.json').sha256,
    installed_package_metadata: installed, byte_authentication: 'NOT_ESTABLISHED_BY_LOCK_OR_PACKAGE_METADATA',
    host_node: { version: process.version, platform: process.platform, arch: process.arch }, image: IMAGE };
  return { files, forbidden_inputs: FORBIDDEN, toolchain, toolchain_provenance: toolchainProvenance,
    sha256: digest({ files, toolchain_provenance: toolchainProvenance, forbidden_inputs: FORBIDDEN }) };
}
function exclusion(path) {
  if (path.startsWith(PREFIX)) return 'verifier-control';
  if (path.split('/').some(part => /^(?:__tests__|__fixtures__|tests?|test[-_]fixtures|fixtures?|private|__private__|\.private|(?:private[-_])?holdouts?)$/i.test(part))
    || /(?:^|[._-])fixtures?(?:[._-]|$)/i.test(path.split('/').at(-1)) || /holdout/i.test(path)) return 'test-fixture-holdout';
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path) || /\.pw\.[cm]?[jt]sx?$/i.test(path)) return 'candidate-test';
  if (/(?:^|\/)(?:node_modules|\.git)(?:\/|$)/.test(path)) return 'resolver-override';
  if (/(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|\.gitattributes|\.env(?:\..*)?|(?:ts|js)config[^/]*\.json)$/.test(path)) return 'candidate-config';
  return null;
}
function materialize(root, sha, directory) {
  if (git(root, ['cat-file', '-t', sha], { encoding: 'utf8', maxBuffer: LIMIT }).trim() !== 'commit') throw new Error('Subject identity is not an exact commit');
  const tree = git(root, ['rev-parse', '--verify', sha + '^{tree}'], { encoding: 'utf8', maxBuffer: LIMIT }).trim();
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('Subject tree identity unavailable');
  const plan = planDraftSourceInventory(git(root, ['ls-tree', '-r', '-l', '-z', '--full-tree', sha, '--', 'src']));
  const selected = plan.selected.map(row => ({ path: row.path, git_mode: row.mode, blob_sha: row.blob, bytes: row.bytes }));
  // Validate every path/mode/exclusion/size before reading any selected blob. No Git attribute filters run.
  const batch = git(root, ['cat-file', '--batch'], { input: selected.map(row => row.blob_sha + '\n').join('') });
  let offset = 0; const sources = [];
  for (const row of selected) {
    const end = batch.indexOf(10, offset);
    if (end < offset || end - offset > 128 || batch.subarray(offset, end).toString('ascii') !== row.blob_sha + ' blob ' + row.bytes) throw new Error('Subject blob header disagrees with inventory');
    const start = end + 1, finish = start + row.bytes;
    if (finish >= batch.length || batch[finish] !== 10) throw new Error('Subject blob stream is incomplete');
    const bytes = batch.subarray(start, finish);
    if (createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') !== row.blob_sha) throw new Error('Literal subject blob bytes disagree with Git identity');
    sources.push({ ...row, sha256: sha256(bytes), content: bytes }); offset = finish + 1;
  }
  if (offset !== batch.length) throw new Error('Unexpected trailing subject blob data');
  mkdirSync(directory, { mode: 0o755 });
  for (const row of sources) {
    const target = join(directory, row.path); mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(target, row.content, { flag: 'wx', mode: 0o644 });
    if (sha256(readFileSync(target)) !== row.sha256) throw new Error('Materialized source bytes changed');
  }
  const files = sources.map(row => ({ path: row.path, git_mode: row.git_mode, blob_sha: row.blob_sha, bytes: row.bytes, sha256: row.sha256 }));
  return { commit: sha, tree, files, files_sha256: digest(files), selected_files: files.length, selected_bytes: plan.totalBytes, excluded: plan.excluded, tree_entries: plan.entries,
    materialization: 'literal-git-cat-file-batch', filters: ['verifier-control', 'test-fixture-holdout', 'candidate-test', 'resolver-override', 'candidate-config'],
    limits: { files: 5000, bytes: SOURCE_LIMIT, file_bytes: LIMIT }, authenticity: 'SUBJECT_BYTES_ONLY_NOT_TRUSTED_BEHAVIOR' };
}
function saved(directory, path, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  writeFileSync(join(directory, path), bytes, { flag: 'wx', mode: 0o600 });
  return { path, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) };
}
function executeStage({ phase, source, harness, toolchain, input, directory }) {
  const name = 'verification-hamilton-' + randomUUID(), started = new Date().toISOString();
  let raw, removal, absent, classified;
  try {
    raw = spawnSync('docker', draftSandboxArguments({ name, image: IMAGE, source, harness, toolchain, phase }), {
      input: JSON.stringify(input), env: hostEnvironment(true), timeout: 45000, maxBuffer: LIMIT, killSignal: 'SIGKILL',
    });
    classified = classifyDraftExecution(raw, phase);
  } catch { classified = { status: 'SETUP_FAILURE', phase, values: [], execution_exit_code: null, error: 'Draft stage could not be started' }; }
  finally {
    removal = spawnSync('docker', ['rm', '--force', name], { env: hostEnvironment(true), timeout: 10000, maxBuffer: LIMIT, encoding: 'utf8' });
    absent = spawnSync('docker', ['container', 'ls', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}'], {
      env: hostEnvironment(true), timeout: 10000, maxBuffer: LIMIT, encoding: 'utf8',
    });
  }
  const cleanup = ownedCleanupAssessment(removal, absent);
  const rawEvidence = raw ? { status: raw.status, signal: raw.signal ?? null, spawn_error_code: raw.error?.code ?? null,
    stdout_sha256: sha256(raw.stdout ?? ''), stdout_bytes: Buffer.byteLength(raw.stdout ?? ''),
    stderr_sha256: sha256(raw.stderr ?? ''), stderr_bytes: Buffer.byteLength(raw.stderr ?? '') } : null;
  // Candidate stderr prose is never assertion authority and is not copied into the parent receipt.
  const receipt = { ...classified, started_at: started, completed_at: new Date().toISOString(), cleanup, container_name: name,
    raw: rawEvidence, source_mount: phase !== 'pdf-parse', authority: 'LOCAL_PROCESS_UNTRUSTED' };
  saved(directory, phase + '.json', receipt); return receipt;
}

/** Only named immutable subjects are admitted. Expectations and commands never come from subject source. */
export function runBoardBriefDraft({ repositoryRoot, outputDirectory, baselineSha, headSha, toolchainDirectory }) {
  if (baselineSha !== BASELINE || headSha !== TARGET) throw new Error('Draft admits only the reviewed immutable baseline and retained target');
  const root = realpathSync(resolve(repositoryRoot));
  if (realpathSync(join(root, PREFIX)) !== HERE) throw new Error('Draft must run from its own repository closure');
  const output = validateDraftOutputDirectory(root, resolve(outputDirectory));
  const before = closure(root, toolchainDirectory), request = pilotRequest(), started = new Date().toISOString();
  mkdirSync(output, { recursive: true, mode: 0o700 });
  if (realpathSync(output) !== output) throw new Error('Output ancestry changed before collection');
  const scratch = mkdtempSync(join(output, 'owned-sandbox-')); chmodSync(scratch, 0o755);
  const harness = join(scratch, 'harness'); mkdirSync(harness, { mode: 0o755 });
  const snapshots = {}, runs = {}; let primary = null, scratchClean = false, after = null;
  try {
    for (const name of DRAFT_HARNESS_FILES) writeFileSync(join(harness, name), canonicalBytes(root, PREFIX + name), { flag: 'wx', mode: 0o644 });
    const harnessInventory = DRAFT_HARNESS_FILES.map(name => ({ path: name, sha256: sha256(readFileSync(join(harness, name))) }));
    saved(output, 'harness-inventory.json', { files: harnessInventory, sha256: digest(harnessInventory), parent_oracle_mounted: false });
    saved(output, 'parent-inputs-before.json', before);
    const image = spawnSync('docker', ['image', 'inspect', IMAGE], { env: hostEnvironment(true), timeout: 15000, maxBuffer: LIMIT, encoding: 'utf8' });
    if (image.error || image.signal || image.status !== 0) throw new Error('Required immutable Docker image is not locally available');
    saved(output, 'runtime-image.json', { image: IMAGE, inspect_sha256: sha256(image.stdout), inspect_bytes: Buffer.byteLength(image.stdout),
      network: 'none', memory_mib: 768, pids: 128, cpus: 1, tmpfs_mib: 32, stage_timeout_ms: 45000, process_output_bytes: LIMIT });
    for (const [label, sha] of [['baseline', BASELINE], ['target', TARGET]]) {
      const directory = join(output, label); mkdirSync(directory, { mode: 0o700 });
      const source = join(scratch, label); snapshots[label] = materialize(root, sha, source);
      saved(directory, 'source-inventory.json', snapshots[label]);
      const common = { source, harness, toolchain: before.toolchain, directory };
      const component = executeStage({ ...common, phase: 'component', input: request });
      const render = executeStage({ ...common, phase: 'pdf-render', input: request });
      const parse = render.status === 'OBSERVED_UNTRUSTED' && render.cleanup.ok
        ? executeStage({ ...common, phase: 'pdf-parse', input: { schema_version: 1, cases: render.values } })
        : { phase: 'pdf-parse', status: 'SETUP_FAILURE', values: [], execution_exit_code: null, cleanup: { ok: true, problems: [] },
          error: 'Renderer did not produce complete bounded bytes; parser was not started' };
      const stages = { component, render, parse };
      const complete = Object.values(stages).every(stage => stage.status === 'OBSERVED_UNTRUSTED' && stage.cleanup.ok);
      let outcomes = [], observations = [];
      if (complete) { observations = [...component.values, ...parse.values]; validateObservedValues(observations); outcomes = assessPilotValues(observations); }
      runs[label] = { stages, executionComplete: complete, cleanupVerified: Object.values(stages).every(stage => stage.cleanup.ok), outcomes };
      saved(directory, 'parent-assessment.json', { authority: 'LOCAL_PARENT_COMPARISON_UNTRUSTED', executionComplete: complete,
        outcomes, observations_sha256: complete ? digest(observations) : null, parser_source_mount: false });
    }
  } catch (error) { primary = error instanceof Error ? error.message : 'Draft setup did not complete'; }
  finally {
    try { rmSync(scratch, { recursive: true, force: true }); scratchClean = !existsSync(scratch); } catch { scratchClean = false; }
    try { after = closure(root, toolchainDirectory); } catch { primary ??= 'Parent execution closure could not be revalidated'; }
  }
  const identitiesStable = after !== null && before.sha256 === after.sha256;
  if (!identitiesStable) primary ??= 'Parent execution closure changed during collection';
  if (after) saved(output, 'parent-inputs-after.json', after);
  const assessment = assessDraftResults({ baselineOutcomes: runs.baseline?.outcomes, targetOutcomes: runs.target?.outcomes,
    executionComplete: !primary && identitiesStable && runs.baseline?.executionComplete === true && runs.target?.executionComplete === true,
    cleanupVerified: scratchClean && runs.baseline?.cleanupVerified === true && runs.target?.cleanupVerified === true });
  if (primary) assessment.problems.unshift(primary);
  const receipt = { schema_version: 'draft-1', pilot_id: PILOT_ID, adapter: ADAPTER_ID, status: 'BLOCKED', registered: false, currentCodeVerified: false,
    origin: 'LOCAL_SANDBOXED_UNTRUSTED', started_at: started, completed_at: new Date().toISOString(),
    source: { baseline: snapshots.baseline ?? null, target: snapshots.target ?? null },
    parent_closure_sha256: before.sha256, parent_closure_unchanged: identitiesStable, request_sha256: digest(request),
    runtime_image: IMAGE, harness_files: DRAFT_HARNESS_FILES, scratch_cleanup_verified: scratchClean,
    code_groups: { baseline: runs.baseline?.outcomes ?? [], target: runs.target?.outcomes ?? [] }, assessment,
    requiredNative: PILOT.requiredNative, limitations: ['Public finite cases do not authenticate hostile same-process observations',
      'Both required native groups remain BLOCKED', 'Installed dependency bytes are not authenticated by lock/package metadata alone',
      'No registration, trusted workflow, independent principal review, owner approval or production outcome is established'] };
  saved(output, 'receipt.json', receipt); return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 8 || new Set(args.filter((_, index) => index % 2 === 0)).size !== 4
      || args.some((arg, index) => index % 2 === 0 && !['--baseline', '--head', '--output', '--toolchain'].includes(arg))) throw new Error('Finite baseline, head, new output and clean toolchain are required');
    const options = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [args[index * 2], args[index * 2 + 1]]));
    const receipt = runBoardBriefDraft({ repositoryRoot: process.cwd(), baselineSha: options['--baseline'], headSha: options['--head'], outputDirectory: options['--output'], toolchainDirectory: options['--toolchain'] });
    process.stdout.write(JSON.stringify({ status: receipt.status, codePairStatus: receipt.assessment.codePairStatus, registered: false, currentCodeVerified: false }) + '\n');
    process.exitCode = receipt.status === 'BLOCKED' ? 1 : 0;
  } catch { process.stderr.write('BLOCKED: finite draft collection did not complete; no code or native acceptance granted\n'); process.exitCode = 1; }
}
