// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const seams = vi.hoisted(() => ({ github: vi.fn(), proof: vi.fn(), review: vi.fn(), scope: vi.fn(), scorecard: vi.fn(), frozen: vi.fn() }));
vi.mock('./github.mjs', () => ({ collectGithubEvidence: seams.github }));
vi.mock('./proof.mjs', async importOriginal => ({ ...await importOriginal<typeof import('./proof.mjs')>(), collectProofEvidence: vi.fn(), assessCollectedProof: seams.proof }));
vi.mock('./runner.mjs', () => ({ frozenIdentities: seams.frozen }));
vi.mock('./evidence.mjs', () => ({ assessReviewEvidence: seams.review, collectRuntimeEvidence: vi.fn(), assessOperationalEvidence: vi.fn(), renderEvidenceSummary: () => 'Test-only composed evidence', calculateEngineeringMetrics: () => ({}) }));
vi.mock('./scope.mjs', () => ({ assessChangedScope: seams.scope }));
vi.mock('./scorecard.mjs', () => ({ collectScorecard: seams.scorecard, assessScorecard: vi.fn(), renderScorecard: vi.fn() }));
import { CURRENT_PROOF_INPUTS } from './proof-inputs.fixture';
import { main } from './cli.mjs';

const SHA = 'a'.repeat(40), directories: string[] = [];
const CURRENT_PATH = 'docs/project/acceptance/engineering/1048-v2.json';
function repository() {
  const root = directory();
  const put = (path: string, value: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  put('src/lib/engineering-verification/policy.json', readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
  const contract = JSON.parse(readFileSync(new URL('../../../docs/project/acceptance/engineering/1048.json', import.meta.url), 'utf8'));
  contract.contract_id = 'EV-FOUNDATION-1048-V2';
  contract.execution_files = CURRENT_PROOF_INPUTS.map(path => ({ path, sha256: 'a'.repeat(64) }));
  put(CURRENT_PATH, JSON.stringify(contract));
  for (const key of ['1048', '2285']) put(`docs/project/acceptance/engineering/${key}.json`, readFileSync(new URL(`../../../docs/project/acceptance/engineering/${key}.json`, import.meta.url), 'utf8'));
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  return root;
}
function directory() { const value = mkdtempSync(join(tmpdir(), 'feeinsight-cli-')); directories.push(value); return value; }
function github(files: unknown = [{ filename: 'src/lib/ai-provider.ts', status: 'modified' }]) {
  return { pullRequest: { headSha: SHA, body: '<!-- engineering-contract: 1048-v2 -->', mergedAt: null }, files, problems: [], ci: { status: 'PASSED' } };
}
beforeEach(() => {
  vi.stubEnv('GH_TOKEN', 'test-only-read-token');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ head: { sha: SHA }, body: '<!-- engineering-contract: 1048-v2 -->' })));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  seams.github.mockResolvedValue(github());
  // Auth collectors are stubbed only to test CLI composition; this fixture is not proof authority.
  seams.proof.mockReturnValue({ status: 'VERIFIED', currentCodeVerified: true, blockers: [] });
  seams.review.mockImplementation(() => ({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: null, blockers: [] }));
  seams.frozen.mockReturnValue({});
  seams.scope.mockReturnValue({ status: 'SCOPED', problems: [] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true }); });

describe('CLI composes required authorization with rename-aware diff evidence', () => {
  it('retains an explicit blocked scorecard when trusted source collection is unavailable', async () => {
    seams.scorecard.mockRejectedValueOnce(new Error('Trusted policy unavailable'));
    const output = directory();
    const result = await main(['scorecard', '--prs', '1', '--output', output]);
    expect(result.status).toBe('BLOCKED');
    expect(JSON.parse(readFileSync(join(output, 'scorecard.json'), 'utf8')).status).toBe('BLOCKED');
    expect(readFileSync(join(output, 'summary.md'), 'utf8')).toContain('Trusted policy unavailable');
  });
  it('blocks a collaborator-only approval when actual risk is R3', async () => {
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result.status).toBe('BLOCKED');
    expect(result.review.blockers).toContain('Required owner authorization for R3 risk or contract approval is missing');
  });
  it('also requires owner signoff when the contract requires it at lower actual risk', async () => {
    seams.github.mockResolvedValue(github([{ filename: 'src/lib/agents/knox/paid-extract.ts', status: 'modified' }]));
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result.actualRisk.risk_tier).toBe('R2');
    expect(result.status).toBe('BLOCKED');
    expect(result.review.blockers).toContain('Required owner authorization for R3 risk or contract approval is missing');
  });
  it('allows code-ready composition with verified independent review and required owner signoff', async () => {
    seams.review.mockReturnValue({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: { actor: 'owner', id: 2, url: 'https://github.com/o/r/pull/1#issuecomment-2' }, blockers: [] });
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result.status).toBe('CODE_VERIFIED');
  });
  it('passes rename origins to actual risk and reviewed scope instead of only the inert destination', async () => {
    seams.github.mockResolvedValue(github([{ filename: 'docs/old-provider.txt', previous_filename: 'src/lib/ai-provider.ts', status: 'renamed' }]));
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result.actualRisk.risk_tier).toBe('R3');
    expect(result.actualChangedPaths).toEqual(['docs/old-provider.txt', 'src/lib/ai-provider.ts']);
    expect(seams.scope).toHaveBeenCalledWith(expect.anything(), result.actualChangedPaths);
  });
  it('blocks malformed rename inventory and refuses proof preparation for it', async () => {
    seams.github.mockResolvedValue(github([{ filename: 'docs/old-provider.txt', status: 'renamed' }]));
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result.status).toBe('BLOCKED');
    expect(result.review.blockers.join(' ')).toContain('missing its previous filename');
    await expect(main(['prepare', '--pr', '1', '--output', directory()], repository())).rejects.toThrow('missing its previous filename');
  });
});

describe('explicit revision and local identity boundaries', () => {
  it.each(['latest', '1048-v3', '../1048-v2', '1048-v2.json'])('rejects unknown explicit selector %s before any metadata or filesystem read', async key => {
    await expect(main(['audit', '--pr', '1', '--contract', key], '/nonexistent-fixture-root')).rejects.toThrow(/revision|selector/i);
    expect(seams.github).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('refuses runnable preparation for a historical explicit key before source reads', async () => {
    await expect(main(['prepare', '--pr', '1', '--contract', '1048'], '/nonexistent-fixture-root')).rejects.toThrow(/historical/i);
    expect(seams.github).not.toHaveBeenCalled();
  });
  it('rejects same-issue marker/flag mismatch before reading a nonexistent current contract', async () => {
    seams.github.mockResolvedValue({ ...github(), pullRequest: { ...github().pullRequest, body: '<!-- engineering-contract: 1048 -->' } });
    await expect(main(['audit', '--pr', '1', '--contract', '1048-v2'], repository())).rejects.toThrow(/differs.*marker/);
    expect(seams.proof).not.toHaveBeenCalled();
  });
  it('never certifies historical evidence as current code even with composed passing review and owner seams', async () => {
    seams.github.mockResolvedValue({ ...github(), pullRequest: { ...github().pullRequest, body: '<!-- engineering-contract: 1048 -->' } });
    seams.proof.mockReturnValue({ status: 'HISTORICAL_VERIFIED', currentCodeVerified: false, blockers: [] });
    seams.review.mockReturnValue({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: { actor: 'owner' }, blockers: [] });
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result).toMatchObject({ status: 'BLOCKED', contractKey: '1048', executionStatus: 'HISTORICAL_ONLY', currentCodeVerified: false });
    expect(result.proof.blockers.join(' ')).toContain('Historical contract evidence');
  });
  it.each(['file', 'parent'])('rejects a %s symlink in the canonical contract path without consuming the target', async kind => {
    const root = repository(), outside = directory();
    writeFileSync(join(outside, 'outside-contract.json'), 'PRIVATE_OUTSIDE_CANARY');
    const target = kind === 'file' ? join(root, CURRENT_PATH) : join(root, 'docs/project/acceptance/engineering');
    if (kind === 'file') rmSync(target); else renameSync(target, target + '-retained');
    symlinkSync(kind === 'file' ? join(outside, 'outside-contract.json') : outside, target);
    await expect(main(['prepare', '--pr', '1', '--output', directory()], root)).rejects.toThrow(/canonical regular/);
    expect(seams.frozen).not.toHaveBeenCalled();
  });
  it('re-reads exact declaration bytes after preparation instead of accepting a changed source', async () => {
    const root = repository();
    seams.frozen.mockImplementationOnce(() => { writeFileSync(join(root, CURRENT_PATH), readFileSync(join(root, CURRENT_PATH), 'utf8') + '\n'); return {}; });
    const output = directory();
    await expect(main(['prepare', '--pr', '1', '--output', output], root)).rejects.toThrow('Frozen contract changed during preparation');
    expect(() => readFileSync(join(output, 'inputs.json'))).toThrow();
  });
  it('re-reads exact declaration bytes after the final head check before reporting code-ready', async () => {
    const root = repository();
    seams.review.mockReturnValue({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: { actor: 'owner' }, blockers: [] });
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => {
      writeFileSync(join(root, CURRENT_PATH), readFileSync(join(root, CURRENT_PATH), 'utf8') + '\n');
      return Response.json({ head: { sha: SHA }, body: '<!-- engineering-contract: 1048-v2 -->' });
    });
    const result = await main(['audit', '--pr', '1', '--output', directory()], root);
    expect(result).toMatchObject({ status: 'BLOCKED', currentCodeVerified: false });
    expect(result.review.blockers).toContain('Frozen contract changed before finalization');
  });
});


describe('final same-head CLI marker freshness', () => {
  const changedMarkers = [
    ['same-issue historical revision', '<!-- engineering-contract: 1048 -->'],
    ['unknown revision', '<!-- engineering-contract: 1048-v3 -->'],
    ['duplicate marker', '<!-- engineering-contract: 1048-v2 -->\n<!-- engineering-contract: 1048-v2 -->'],
    ['malformed marker', '<!-- engineering-contract: 1048-v2'],
    ['missing marker', ''],
  ];
  it.each(changedMarkers)('blocks otherwise code-ready composition after %s', async (_kind, body) => {
    seams.review.mockReturnValue({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: { actor: 'owner', id: 2 }, blockers: [] });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ head: { sha: SHA }, body }));
    const result = await main(['audit', '--pr', '1', '--output', directory()], repository());
    expect(result.status).toBe('BLOCKED');
    expect(result.currentCodeVerified).toBe(false);
    expect([...result.proof.blockers, ...result.review.blockers].join(' ')).toMatch(/marker|revision/i);
    expect(result.proof.currentCodeVerified).toBe(false);
  });
});
