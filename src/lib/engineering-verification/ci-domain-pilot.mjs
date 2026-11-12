/** Parent-owned reader assertions. This module and its oracle never enter the source sandbox. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseStrictJson } from './strict-json.mjs';
import { validateBatchManifest } from './ci-domain-collection.mjs';

export const PILOT_ID = 'EV-FOUNDATION-1048-V3';
export const ADAPTER_ID = 'engineering.ci-domains.v1';
export const STIMULUS_SHA256 = 'c89dfc33d196fdbd002a36fd778c7daf921f0fa3e06b1de57f3415fec0a742f9';
export const ORACLE_SHA256 = '9a017645c7467ce56f9cea9e367e5fcd93693c7b673fb9f514aefba78a5da723';
export const BASELINE_SOURCE_SHA256 = '87a9210baf62c30dab3e3b83863a6b9399cafd6159755b239bbc80ffdd0e996d';
export const BASELINE_REF = 'baf057d9e87f7f1c48306eb0ad2ef4e60dea787f';
export const FIXTURE_PATH = new URL('./__fixtures__/ci-domain-expectations-v2.json', import.meta.url);
export const STIMULUS_PATH = new URL('./__fixtures__/ci-domain-stimulus-v2.json', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => record(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const caseIds = Array.from({ length: 39 }, (_, index) => 'reader-' + String(index + 1).padStart(2, '0'));
export const BASELINE_FAILURE_IDS = freeze(['reader-01', ...caseIds.slice(18, 38)]);
export const BATCHES = freeze([
  { id: 'reader-01-32', index: 1, caseIds: caseIds.slice(0, 32) },
  { id: 'reader-33-39', index: 2, caseIds: caseIds.slice(32) },
]);

const oracleBytes = readFileSync(FIXTURE_PATH), stimulusBytes = readFileSync(STIMULUS_PATH);
if (hash(oracleBytes) !== ORACLE_SHA256 || hash(stimulusBytes) !== STIMULUS_SHA256) throw new Error('Frozen reader oracle or stimulus bytes changed');
const oracle = parseStrictJson(oracleBytes), stimulus = parseStrictJson(stimulusBytes);
if (oracle.schemaVersion !== 2 || oracle.caseCount !== 39 || !Array.isArray(oracle.cases)
  || JSON.stringify(oracle.cases.map(row => row.caseId)) !== JSON.stringify(caseIds)
  || JSON.stringify(oracle.prospectiveBaselineFailureCaseIds) !== JSON.stringify(BASELINE_FAILURE_IDS)
  || !Array.isArray(stimulus.cases) || JSON.stringify(stimulus.cases.map(row => row.id)) !== JSON.stringify(caseIds)) throw new Error('Frozen reader inventory changed');
const allowedPaths = new Set(['observation.provenanceKind', 'observation.inProcessEvidenceClaim',
  'observation.globalProblems', 'observation.ciStatus', 'observation.ciProblems', 'observation.ciAssociation',
  'observation.actualCheckoutSha', 'wrapper.executionComplete', 'wrapper.setupErrors', 'wrapper.membershipReadCount']);
for (const row of oracle.cases) {
  if (!Array.isArray(row.parentPredicates) || !row.parentPredicates.length || row.parentPredicates.some(predicate =>
    !record(predicate) || !allowedPaths.has(predicate.path) || !['eq', 'contains', 'nonemptyArray'].includes(predicate.op)
    || !keys(predicate, predicate.op === 'nonemptyArray' ? ['op', 'path'] : ['op', 'path', 'value']))) throw new Error('Unknown frozen reader predicate');
}

export const PILOT = freeze({ authority: [
  { path: 'docs/project/acceptance/engineering/design-v1/prd-v1.md', sha256: '6ec2ff3c9a5005dfd783cdfc94652148613cec77c493d712f228601da71f7dcc',
    sections: ['FR-01', 'FR-04', 'FR-05', 'FR-06', 'FR-07', 'FR-08', 'FR-18', 'SEC-02', 'SEC-04', 'SEC-06', 'SEC-08'] },
  { path: 'docs/project/acceptance/engineering/design-v1/technical-design-v1.md', sha256: '40acbb05266c300fc5dbb2b690d3fd89eb368310c3ccdeeb7580ccdf3c042c35',
    sections: ['AT-01', 'AT-02', 'AT-03'] },
], cases: oracle.cases, requirements: [
  { id: 'EV-CI-PROOF-DOMAIN-SEPARATION', test_id: 'ci-proof-domain-reader', assertions: caseIds.map(id => ({
    id, case_id: id, failure_signature: 'CI/proof domain requirement differs: ' + id,
  })) },
] });

export function pilotRequest(batchId) {
  const batch = BATCHES.find(row => row.id === batchId);
  if (!batch) throw new Error('Explicit fixed reader batch required');
  return { adapter: ADAPTER_ID, cases: batch.caseIds.map(id => ({ id, text: JSON.stringify({ caseId: id }) })) };
}

export function validateReaderContractInventory(contract) {
  const requirement = contract?.requirements?.[0];
  if (contract?.contract_id !== PILOT_ID || contract?.base_sha !== BASELINE_REF || contract?.requirements?.length !== 1
    || requirement?.id !== PILOT.requirements[0].id || requirement.test_id !== PILOT.requirements[0].test_id
    || requirement.test_path !== 'src/lib/engineering-verification/ci-domain-pilot.test.ts'
    || requirement.adapter_path !== 'src/lib/engineering-verification/ci-domain-pilot.mjs'
    || requirement.fixture_path !== 'src/lib/engineering-verification/__fixtures__/ci-domain-expectations-v2.json'
    || requirement.fixture_sha256 !== ORACLE_SHA256 || requirement.baseline_expectation !== 'FAIL'
    || JSON.stringify(requirement.assertion_ids) !== JSON.stringify(caseIds)
    || JSON.stringify(requirement.baseline_failure_assertion_ids) !== JSON.stringify(BASELINE_FAILURE_IDS)) throw new Error('Reader contract differs from frozen parent inventory');
  return contract;
}

export function expectedBaselineOutcome(outcomes) {
  return Array.isArray(outcomes) && outcomes.length === 1 && outcomes[0].requirement_id === PILOT.requirements[0].id
    && Array.isArray(outcomes[0].assertions) && JSON.stringify(outcomes[0].assertions.map(row => row.id)) === JSON.stringify(caseIds)
    && JSON.stringify(outcomes[0].assertions.filter(row => row.status === 'FAILED').map(row => row.id)) === JSON.stringify(BASELINE_FAILURE_IDS);
}

export function validateAdapterRequest(value) {
  if (!keys(value, ['adapter', 'cases']) || value.adapter !== ADAPTER_ID || !Array.isArray(value.cases)
    || !value.cases.length || value.cases.length > 32) throw new Error('Unsupported reader adapter request');
  const batch = BATCHES.find(row => JSON.stringify(row.caseIds) === JSON.stringify(value.cases.map(item => item?.id)));
  if (!batch || value.cases.some(row => !keys(row, ['id', 'text']) || row.text !== JSON.stringify({ caseId: row.id }))) throw new Error('Unknown, reordered or malformed reader batch');
  return batch;
}

const boundedStrings = value => Array.isArray(value) && value.length <= 128
  && value.every(item => typeof item === 'string' && item.length <= 4096);
const routes = new Set(stimulus.routeBase.map(row => row.method + ' ' + row.url));
const membership = 'GET https://api.github.com/repos/fixture-owner/fixture-repo/commits/' + 'a'.repeat(40) + '/pulls?per_page=100&page=1';

export function validateBatchValues(values, expectedIds) {
  if (!Array.isArray(expectedIds) || !expectedIds.length || expectedIds.length > 39
    || new Set(expectedIds).size !== expectedIds.length || expectedIds.some(id => !caseIds.includes(id))
    || !Array.isArray(values) || values.length !== expectedIds.length) throw new Error('Missing/extra observed reader cases');
  for (const [index, row] of values.entries()) {
    if (!keys(row, ['schemaVersion', 'caseId', 'observation', 'wrapper']) || row.schemaVersion !== 1
      || row.caseId !== expectedIds[index]) throw new Error('Unknown, duplicate or reordered reader case');
    const observed = row.observation, wrapper = row.wrapper;
    if (!keys(observed, ['provenanceKind', 'inProcessEvidenceClaim', 'globalProblems', 'ciStatus', 'ciProblems', 'ciAssociation', 'actualCheckoutSha'])
      || typeof observed.provenanceKind !== 'string' || observed.provenanceKind.length > 4096
      || typeof observed.inProcessEvidenceClaim !== 'boolean' || !boundedStrings(observed.globalProblems)
      || typeof observed.ciStatus !== 'string' || observed.ciStatus.length > 4096 || !boundedStrings(observed.ciProblems)
      || observed.ciAssociation !== null && !record(observed.ciAssociation)
      || observed.actualCheckoutSha !== null && (typeof observed.actualCheckoutSha !== 'string' || observed.actualCheckoutSha.length > 4096)) throw new Error('Malformed reader observed values');
    // API authenticity claims are ordinary observed values, compared by the oracle.
    // Trusted wrapper completeness is a prerequisite, never a behavioral assertion failure.
    if (!keys(wrapper, ['executionComplete', 'setupErrors', 'requestCount', 'membershipReadCount', 'requests'])
      || wrapper.executionComplete !== true || !Array.isArray(wrapper.setupErrors) || wrapper.setupErrors.length
      || !Number.isSafeInteger(wrapper.requestCount) || wrapper.requestCount < 0 || wrapper.requestCount > 128
      || !Number.isSafeInteger(wrapper.membershipReadCount) || !Array.isArray(wrapper.requests)
      || wrapper.requests.length !== wrapper.requestCount) throw new Error('Incomplete or forged reader wrapper protocol');
    const counts = new Map();
    for (const request of wrapper.requests) {
      const key = request?.method + ' ' + request?.url;
      if (!keys(request, ['method', 'url', 'readIndex']) || !routes.has(key)) throw new Error('Unmapped reader request observation');
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (request.readIndex !== count) throw new Error('Invalid reader request sequence');
    }
    if (wrapper.membershipReadCount !== (counts.get(membership) ?? 0)) throw new Error('Forged reader membership count');
  }
  return values;
}

export function validateObservedValues(values) { return validateBatchValues(values, caseIds); }

export function parseBatchOutput(raw, batchId) {
  const batch = BATCHES.find(row => row.id === batchId);
  if (!batch) throw new Error('Unknown reader output batch');
  const value = parseStrictJson(raw);
  if (!keys(value, ['schema_version', 'cases']) || value.schema_version !== 1) throw new Error('Unexpected reader source output protocol');
  return validateBatchValues(value.cases, batch.caseIds);
}

/** Receipt structure and source/control bindings only; raw archive replay is separate. */
export function validateReaderBatchSet(value, { baseSha, headSha, executionFiles }) {
  if (!keys(value, ['schemaVersion', 'adapter', 'sources']) || value.schemaVersion !== 1 || value.adapter !== ADAPTER_ID
    || !Array.isArray(value.sources) || value.sources.length !== 2 || !Array.isArray(executionFiles)) throw new Error('Complete reader batch manifest required');
  const inputHash = path => {
    const entries = executionFiles.filter(row => row.path === 'src/lib/engineering-verification/' + path);
    if (entries.length !== 1 || !/^[a-f0-9]{64}$/.test(entries[0].sha256)) throw new Error('Frozen reader control binding unavailable');
    return entries[0].sha256;
  };
  const seen = new Set();
  for (const [index, label] of ['red', 'green'].entries()) {
    const source = value.sources[index], sourceRef = label === 'red' ? baseSha : headSha;
    if (!keys(source, ['label', 'sourceRef', 'batches']) || source.label !== label || source.sourceRef !== sourceRef
      || !Array.isArray(source.batches) || source.batches.length !== 2) throw new Error('Missing, duplicate or cross-source reader batches');
    let previous;
    for (const [batchIndex, batch] of BATCHES.entries()) {
      const entry = source.batches[batchIndex];
      if (!keys(entry, ['directory', 'receiptSha256', 'receiptBytes', 'manifest']) || entry.directory !== label + '-' + batch.id
        || typeof entry.receiptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.receiptSha256)
        || !Number.isSafeInteger(entry.receiptBytes)) throw new Error('Reader batch record identity unavailable');
      const manifest = validateBatchManifest(entry.manifest, { sourceRef, batchId: batch.id, caseIds: batch.caseIds,
        sourceSha256: label === 'red' ? BASELINE_SOURCE_SHA256 : inputHash('github.mjs'),
        childSha256: inputHash('child.mjs'), collectionSha256: inputHash('ci-domain-collection.mjs'), parserSha256: inputHash('strict-json.mjs') });
      const serialized = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
      if (serialized.length !== entry.receiptBytes || hash(serialized) !== entry.receiptSha256) throw new Error('Reader batch receipt bytes/digest mismatch');
      if (previous && (previous.blob !== manifest.source.blob || previous.sha256 !== manifest.source.sha256
        || previous.bytes !== manifest.source.bytes)) throw new Error('Reader source changed across batches');
      previous = manifest.source;
      for (const identity of ['name', 'id', 'owner']) {
        const key = identity + ':' + manifest.nativeContainer[identity];
        if (seen.has(key)) throw new Error('Reader batches reused native container identity');
        seen.add(key);
      }
    }
  }
  return value;
}

function equal(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (!record(left) || !record(right)) return false;
  const names = Object.keys(left);
  return names.length === Object.keys(right).length && names.every(name => Object.hasOwn(right, name) && equal(left[name], right[name]));
}

export function assessPilotValues(values) {
  validateObservedValues(values);
  const requirement = PILOT.requirements[0];
  const assertions = requirement.assertions.map((assertion, index) => {
    const passed = oracle.cases[index].parentPredicates.every(predicate => {
      const observed = predicate.path.split('.').reduce((value, part) => value?.[part], values[index]);
      if (predicate.op === 'eq') return equal(observed, predicate.value);
      if (predicate.op === 'contains') return Array.isArray(observed) && observed.some(item => equal(item, predicate.value));
      return Array.isArray(observed) && observed.length > 0;
    });
    return { id: assertion.id, status: passed ? 'PASSED' : 'FAILED', ...(passed ? {} : { message: assertion.failure_signature }) };
  });
  return [{ requirement_id: requirement.id, test_id: requirement.test_id,
    status: assertions.every(row => row.status === 'PASSED') ? 'PASSED' : 'FAILED', assertions }];
}
