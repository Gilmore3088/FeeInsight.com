// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ADAPTER_ID, BASELINE_FAILURE_IDS, BATCHES, FIXTURE_PATH, ORACLE_SHA256, PILOT,
  STIMULUS_PATH, STIMULUS_SHA256, assessPilotValues, parseBatchOutput, pilotRequest,
  validateAdapterRequest, validateBatchValues, validateObservedValues, validateReaderBatchSet,
  validateReaderContractInventory, expectedBaselineOutcome, BASELINE_REF, BASELINE_SOURCE_SHA256 } from './ci-domain-pilot.mjs';
import { childMain, runReaderCases } from './child.mjs';
import { syntheticBatchEvidence } from './ci-domain-collection.fixture';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
const membershipUrl = 'https://api.github.com/repos/fixture-owner/fixture-repo/commits/' + 'a'.repeat(40) + '/pulls?per_page=100&page=1';
function values() {
  return Array.from({ length: 39 }, (_, index) => ({ schemaVersion: 1, caseId: 'reader-' + String(index + 1).padStart(2, '0'),
    observation: { provenanceKind: 'test-transport-untrusted', inProcessEvidenceClaim: false, globalProblems: [] as string[],
      ciStatus: 'BLOCKED', ciProblems: ['Native head and merge commit trees are not identical'], ciAssociation: null, actualCheckoutSha: null },
    wrapper: { executionComplete: true, setupErrors: [] as string[], requestCount: 2, membershipReadCount: 2,
      requests: [1, 2].map(readIndex => ({ method: 'GET', url: membershipUrl, readIndex })) },
  }));
}
function literalReader(collect = vi.fn(async () => ({ provenance: { kind: 'test-transport-untrusted' }, problems: [],
  ci: { status: 'BLOCKED', problems: [], association: null, actualCheckoutSha: null } }))) {
  return { collectGithubEvidence: collect, isGithubEvidence: () => false };
}

describe('frozen parent reader requirements', () => {
  it('preserves independent raw oracle/stimulus and the exact39/21 inventory', () => {
    const digest = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex');
    expect(digest(FIXTURE_PATH)).toBe(ORACLE_SHA256);
    expect(digest(STIMULUS_PATH)).toBe(STIMULUS_SHA256);
    expect(PILOT.requirements).toHaveLength(1);
    expect(PILOT.requirements[0].assertions.map(row => row.id)).toEqual(values().map(row => row.caseId));
    expect(BASELINE_FAILURE_IDS).toEqual(['reader-01', ...values().slice(18, 38).map(row => row.caseId)]);
    expect(BATCHES.map(row => row.caseIds.length)).toEqual([32, 7]);
  });
  it('binds every authority ID to its actual source table and preserved edition bytes', () => {
    for (const authority of PILOT.authority as readonly {path:string;sha256:string;sections:string[]}[]) {
      const raw = readFileSync(new URL('../../../' + authority.path, import.meta.url));
      expect(createHash('sha256').update(raw).digest('hex')).toBe(authority.sha256);
      for (const section of authority.sections) expect(raw.toString('utf8')).toContain('| ' + section + ' |');
    }
  });
  it('compares independent domain controls rather than accepting arbitrary global refusal', () => {
    const actual = values();
    const outcome = assessPilotValues(actual)[0];
    expect(outcome.assertions).toHaveLength(39);
    expect(outcome.assertions[0]).toEqual({ id: 'reader-01', status: 'PASSED' });
    // The identical-tree positive control requires successful CI, so the same
    // CI-only refusal cannot satisfy it merely by being a plausible result.
    expect(outcome.assertions[1]).toMatchObject({ id: 'reader-02', status: 'FAILED' });
    actual[0].observation.globalProblems.push('Unrelated global failure');
    expect(assessPilotValues(actual)[0].assertions[0]).toEqual({ id: 'reader-01', status: 'FAILED', message: 'CI/proof domain requirement differs: reader-01' });
  });
  it('treats source API authentication claims as observed values and grades them as failures', () => {
    const actual = values();
    actual[0].observation.provenanceKind = 'authenticated-github-api';
    actual[0].observation.inProcessEvidenceClaim = true;
    expect(() => validateObservedValues(actual)).not.toThrow();
    expect(assessPilotValues(actual)[0].assertions[0].status).toBe('FAILED');
  });
  it.each(['missing', 'duplicate', 'reordered', 'extra', 'protocol-authority', 'wrapper-incomplete', 'forged-count'])('blocks %s output before grading', kind => {
    const actual = values();
    if (kind === 'missing') actual.pop();
    if (kind === 'duplicate') actual[1].caseId = actual[0].caseId;
    if (kind === 'reordered') [actual[0], actual[1]] = [actual[1], actual[0]];
    if (kind === 'extra') actual.push(structuredClone(actual[0]));
    if (kind === 'protocol-authority') Object.assign(actual[0], { currentCodeVerified: true });
    if (kind === 'wrapper-incomplete') actual[0].wrapper.setupErrors.push('caught-unmapped');
    if (kind === 'forged-count') actual[0].wrapper.membershipReadCount = 3;
    expect(() => assessPilotValues(actual)).toThrow();
  });
  it('requires both complete canonical batches before aggregate grading', () => {
    for (const batch of BATCHES) {
      const request = pilotRequest(batch.id);
      expect(validateAdapterRequest(request)).toEqual(batch);
      const rows = values().filter(row => batch.caseIds.includes(row.caseId));
      expect(parseBatchOutput(JSON.stringify({ schema_version: 1, cases: rows }), batch.id)).toEqual(rows);
      expect(() => assessPilotValues(rows)).toThrow();
      expect(() => validateBatchValues([...rows].reverse(), batch.caseIds)).toThrow();
    }
    expect(() => pilotRequest('all39')).toThrow();
    expect(() => validateAdapterRequest({ adapter: ADAPTER_ID, cases: values().slice(0, 33).map(row => ({ id: row.caseId, text: JSON.stringify({ caseId: row.caseId }) })) })).toThrow();
  });
  it.each([
    '{"schema_version":1,"schema_version":1,"cases":[]}',
    '{"schema_version":1,"\\u0073chema_version":1,"cases":[]}',
    '{"schema_version":1,"cases":[],"currentCodeVerified":true}',
    '{"schema_version":1e999,"cases":[]}',
    'PASS',
  ])('rejects untrusted parent JSON/protocol counterfactual %s', raw => {
    expect(() => parseBatchOutput(raw, BATCHES[0].id)).toThrow();
  });
  it('requires the precise prospective baseline inventory and refuses extra or missing failed guards', () => {
    const assertions = values().map(row => ({ id: row.caseId, status: BASELINE_FAILURE_IDS.includes(row.caseId) ? 'FAILED' : 'PASSED' }));
    const outcomes = [{ requirement_id: 'EV-CI-PROOF-DOMAIN-SEPARATION', assertions }];
    expect(expectedBaselineOutcome(outcomes)).toBe(true);
    assertions[1].status = 'FAILED';
    expect(expectedBaselineOutcome(outcomes)).toBe(false);
    assertions[1].status = 'PASSED'; assertions[0].status = 'PASSED';
    expect(expectedBaselineOutcome(outcomes)).toBe(false);
  });
  it('refuses changed contract fixture, assertions, baseline failure IDs or base before collection', () => {
    const contract = JSON.parse(readFileSync(new URL('../../../docs/project/acceptance/engineering/1048-v3.json', import.meta.url), 'utf8'));
    expect(() => validateReaderContractInventory(contract)).not.toThrow();
    for (const change of [
      (x: typeof contract) => { x.base_sha = 'a'.repeat(40); },
      (x: typeof contract) => { x.requirements[0].fixture_sha256 = 'a'.repeat(64); },
      (x: typeof contract) => { x.requirements[0].assertion_ids.pop(); },
      (x: typeof contract) => { x.requirements[0].baseline_failure_assertion_ids.pop(); },
      (x: typeof contract) => { x.requirements[0].adapter_path = 'caller-adapter.mjs'; },
    ]) {
      const altered = structuredClone(contract); change(altered);
      expect(() => validateReaderContractInventory(altered)).toThrow(/inventory/);
    }
  });
});

describe('parent aggregate native batch manifest controls', () => {
  function fixture() {
    const headSha = 'a'.repeat(40);
    const executionFiles = ['github.mjs', 'child.mjs', 'ci-domain-collection.mjs', 'strict-json.mjs'].map(name => ({
      path: 'src/lib/engineering-verification/' + name,
      sha256: createHash('sha256').update(readFileSync(new URL('./' + name, import.meta.url))).digest('hex'),
    }));
    const value = { schemaVersion: 1, adapter: ADAPTER_ID, sources: ['red', 'green'].map(label => {
      const sourceRef = label === 'red' ? BASELINE_REF : headSha;
      return { label, sourceRef, batches: BATCHES.map(batch => {
        const sample = syntheticBatchEvidence({ sourceRef, batchId: batch.id, caseIds: [...batch.caseIds],
          ...(label === 'red' ? { sourceSha256: BASELINE_SOURCE_SHA256 } : {}) });
        const bytes = sample.artifacts['receipt.json'];
        return { directory: label + '-' + batch.id, receiptSha256: createHash('sha256').update(bytes).digest('hex'), receiptBytes: bytes.length, manifest: sample.manifest };
      }) };
    }) };
    return { value, expected: { baseSha: BASELINE_REF, headSha, executionFiles } };
  }
  it('admits only a complete structurally consistent four-batch fixture without minting authority', () => {
    const f = fixture();
    expect(validateReaderBatchSet(f.value, f.expected)).toBe(f.value);
    for (const source of f.value.sources) for (const batch of source.batches) {
      expect(batch.manifest.registered).toBe(false);
      expect(batch.manifest.currentCodeVerified).toBe(false);
    }
  });
  it.each(['missing', 'reordered', 'duplicate', 'cross-source', 'digest', 'authority', 'nonzero', 'unfrozen-control'])('refuses %s batch composition before assertions', mode => {
    const f = fixture();
    if (mode === 'missing') f.value.sources[0].batches.pop();
    if (mode === 'reordered') f.value.sources.reverse();
    if (mode === 'duplicate') f.value.sources[0].batches[1] = structuredClone(f.value.sources[0].batches[0]);
    if (mode === 'cross-source') f.value.sources[0].sourceRef = f.expected.headSha;
    if (mode === 'digest') f.value.sources[0].batches[0].receiptSha256 = '0'.repeat(64);
    if (mode === 'authority') Object.assign(f.value, { currentCodeVerified: true });
    if (mode === 'nonzero') f.value.sources[0].batches[0].manifest.executionExitCode = 1;
    if (mode === 'unfrozen-control') f.expected.executionFiles.find(row => row.path.endsWith('/child.mjs'))!.sha256 = '0'.repeat(64);
    expect(() => validateReaderBatchSet(f.value, f.expected)).toThrow();
  });
});

describe('trusted child selection with own literal reader stubs only', () => {
  it('executes exactly32 then7 selected cases with fresh request state and no extra source calls', async () => {
    const reader = literalReader(), load = vi.fn(async () => reader), raw = readFileSync(STIMULUS_PATH);
    const first = await runReaderCases(pilotRequest(BATCHES[0].id), raw, load);
    expect(first.map(row => (row as {caseId:string}).caseId)).toEqual(BATCHES[0].caseIds);
    expect(reader.collectGithubEvidence).toHaveBeenCalledTimes(32);
    const second = await runReaderCases(pilotRequest(BATCHES[1].id), raw, load);
    expect(second.map(row => (row as {caseId:string}).caseId)).toEqual(BATCHES[1].caseIds);
    expect(reader.collectGithubEvidence).toHaveBeenCalledTimes(39);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).not.toBe(globalThis.fetch);
  });
  it('keeps a caught default-fetch attempt sticky outside source catch control', async () => {
    const reader = literalReader(vi.fn(async () => {
      try { await globalThis.fetch('https://example.invalid'); } catch { /* subject catches denial */ }
      return { provenance: { kind: 'test-transport-untrusted' }, problems: [], ci: { status: 'BLOCKED', problems: [], association: null, actualCheckoutSha: null } };
    }));
    await expect(runReaderCases(pilotRequest(BATCHES[1].id), readFileSync(STIMULUS_PATH), async () => reader)).rejects.toThrow(/setup incomplete/);
  });
  it('keeps a caught unmapped finite-API attempt setup-blocking', async () => {
    const reader = { collectGithubEvidence: async ({ fetchImpl }: {fetchImpl:typeof fetch}) => {
      try { await fetchImpl('https://example.invalid', {}); } catch { /* subject catches wrapper error */ }
      return { provenance: { kind: 'test-transport-untrusted' }, problems: ['plausible refusal'], ci: { status: 'BLOCKED', problems: [], association: null, actualCheckoutSha: null } };
    }, isGithubEvidence: () => false };
    await expect(runReaderCases(pilotRequest(BATCHES[1].id), readFileSync(STIMULUS_PATH), async () => reader)).rejects.toThrow(/setup incomplete/);
  });
  it('rejects wrong stimulus bytes and duplicate/reordered request IDs before loader invocation', async () => {
    const load = vi.fn(async () => literalReader());
    await expect(runReaderCases(pilotRequest(BATCHES[0].id), Buffer.from('{}'), load)).rejects.toThrow(/stimulus/);
    const request = pilotRequest(BATCHES[1].id); request.cases.reverse();
    await expect(runReaderCases(request, readFileSync(STIMULUS_PATH), load)).rejects.toThrow(/batch/);
    expect(load).not.toHaveBeenCalled();
  });
  it('does not increase the generic cap or permit caller-selected adapters', async () => {
    await expect(childMain(JSON.stringify({ adapter: 'engineering.ci-domains.v1', cases: Array.from({ length: 33 }, (_, index) => ({ id: 'reader-' + index, text: '{}' })) }))).rejects.toThrow(/Unsupported/);
    await expect(childMain(JSON.stringify({ adapter: 'caller.command', cases: [{ id: 'reader-01', text: '{}' }] }))).rejects.toThrow(/Unsupported/);
  });
});
