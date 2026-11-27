const EMPTY = Object.freeze([]);
const HISTORICAL_SOURCE_REFS = Object.freeze(['d28d77a4da9d2fb6edc73d8c264e42a7e380ae77']);
// Every eagerly imported preparer module and installed toolchain input belongs to the parent boundary.
const REQUIRED_PROOF_INPUTS = Object.freeze([
  '.gitattributes', '.github/workflows/engineering-verification.yml', 'package.json', 'package-lock.json',
  ...['child', 'cli', 'contract-registry', 'contract', 'events', 'evidence', 'github', 'loader', 'pilot',
    'policy-pilot', 'policy-v2-pilot', 'program', 'proof', 'runner', 'scope', 'scorecard',
    'ci-domain-pilot', 'ci-domain-probe', 'ci-domain-collection', 'strict-json']
    .map(name => 'src/lib/engineering-verification/' + name + '.mjs'),
  ...['knox-2285', 'policy-1048', 'policy-v2', 'ci-domain-stimulus-v2', 'ci-domain-expectations-v2'].map(name => 'src/lib/engineering-verification/__fixtures__/' + name + '.json'),
  'docs/project/acceptance/engineering/design-v1/prd-v1.md',
  'docs/project/acceptance/engineering/design-v1/technical-design-v1.md',
  'docs/project/acceptance/engineering/program.json', 'src/lib/agents/hoovie/AGENTS.md',
  'src/lib/engineering-verification/policy.json', 'src/lib/engineering-verification/runtime.json',
  'vendor/baseline-browser-mapping/baseline-browser-mapping-2.9.19-process-error-backport.tgz',
].sort());
const FORBIDDEN_PROOF_INPUTS = Object.freeze([
  '.npmrc', 'npm-shrinkwrap.json',
  ...['src', 'src/lib', 'src/lib/engineering-verification'].flatMap(path => [path + '/node_modules', path + '/package.json']),
  ...['.github', '.github/workflows', 'docs', 'docs/project', 'docs/project/acceptance',
    'docs/project/acceptance/engineering', 'docs/project/acceptance/engineering/design-v1',
    'src', 'src/lib', 'src/lib/agents', 'src/lib/agents/hoovie', 'src/lib/engineering-verification',
    'src/lib/engineering-verification/__fixtures__', 'vendor', 'vendor/baseline-browser-mapping']
    .map(path => path + '/.gitattributes'),
].sort());

/** Registration selects source; CURRENT is not native acceptance, review or proof. */
export const CONTRACT_REVISIONS = Object.freeze([
  Object.freeze({ key: '1048', path: 'docs/project/acceptance/engineering/1048.json',
    contractId: 'EV-FOUNDATION-1048', issueNumber: 1048, executionStatus: 'HISTORICAL_ONLY', adapter: 'engineering.policy.v1',
    historicalWorkflowSha256: '07f2b3c1cd35f9ba91f61da3c14c11fea75ccd3d5b50b9db61ffe5b75f66dfb3',
    requiredProofInputs: EMPTY, forbiddenProofInputs: EMPTY, historicalTrustedSourceRefs: HISTORICAL_SOURCE_REFS }),
  Object.freeze({ key: '2285', path: 'docs/project/acceptance/engineering/2285.json',
    contractId: 'EV-KNOX-2285', issueNumber: 2285, executionStatus: 'HISTORICAL_ONLY', adapter: 'knox.free-specialists.v1',
    historicalWorkflowSha256: '07f2b3c1cd35f9ba91f61da3c14c11fea75ccd3d5b50b9db61ffe5b75f66dfb3',
    requiredProofInputs: EMPTY, forbiddenProofInputs: EMPTY, historicalTrustedSourceRefs: HISTORICAL_SOURCE_REFS }),
  Object.freeze({ key: '1048-v2', path: 'docs/project/acceptance/engineering/1048-v2.json',
    contractId: 'EV-FOUNDATION-1048-V2', issueNumber: 1048, executionStatus: 'HISTORICAL_ONLY', adapter: 'engineering.policy.v2',
    historicalWorkflowSha256: '02c17ecbd29b154cd667f868a7beed2b59ba70ec6ce3274face95c82be45f60a',
    requiredProofInputs: EMPTY, forbiddenProofInputs: EMPTY,
    historicalTrustedSourceRefs: Object.freeze(['baf057d9e87f7f1c48306eb0ad2ef4e60dea787f']) }),
  Object.freeze({ key: '1048-v3', path: 'docs/project/acceptance/engineering/1048-v3.json',
    contractId: 'EV-FOUNDATION-1048-V3', issueNumber: 1048, executionStatus: 'CURRENT', adapter: 'engineering.ci-domains.v1', historicalWorkflowSha256: null,
    requiredProofInputs: REQUIRED_PROOF_INPUTS, forbiddenProofInputs: FORBIDDEN_PROOF_INPUTS, historicalTrustedSourceRefs: EMPTY }),
]);

export function resolveContractRevision(key, { requireRunnable = false } = {}) {
  if (typeof key !== 'string' || typeof requireRunnable !== 'boolean') throw new Error('Unsupported contract revision');
  const revision = CONTRACT_REVISIONS.find(row => row.key === key);
  if (!revision) throw new Error('Unsupported contract revision');
  if (requireRunnable && revision.executionStatus !== 'CURRENT') throw new Error('Contract revision is HISTORICAL_ONLY; current execution is blocked');
  return revision;
}

export function parseContractMarker(body) {
  if (typeof body !== 'string' || body.length > 262144) throw new Error('Exactly one registered contract revision marker is required');
  const declarations = [...body.matchAll(/\bengineering-contract[ \t]*:/gi)];
  const markers = [...body.matchAll(/<!--[ \t]*engineering-contract:[ \t]*([^\s<>]+?)[ \t]*-->/g)];
  if (declarations.length !== 1 || markers.length !== 1) throw new Error('Exactly one registered contract revision marker is required');
  return resolveContractRevision(markers[0][1]);
}
