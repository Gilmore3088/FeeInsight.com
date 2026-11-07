// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seams = vi.hoisted(() => ({ github: vi.fn(), proof: vi.fn(), review: vi.fn(), scope: vi.fn(), scorecard: vi.fn() }));
vi.mock('./github.mjs', () => ({ collectGithubEvidence: seams.github }));
vi.mock('./proof.mjs', () => ({ collectProofEvidence: vi.fn(), assessCollectedProof: seams.proof }));
vi.mock('./evidence.mjs', () => ({ assessReviewEvidence: seams.review, collectRuntimeEvidence: vi.fn(), assessOperationalEvidence: vi.fn(), renderEvidenceSummary: () => 'Test-only composed evidence', calculateEngineeringMetrics: () => ({}) }));
vi.mock('./scope.mjs', () => ({ assessChangedScope: seams.scope }));
vi.mock('./scorecard.mjs', () => ({ collectScorecard: seams.scorecard, assessScorecard: vi.fn(), renderScorecard: vi.fn() }));
import { main } from './cli.mjs';

const SHA = 'a'.repeat(40), directories: string[] = [];
function directory() { const value = mkdtempSync(join(tmpdir(), 'feeinsight-cli-')); directories.push(value); return value; }
function github(files: unknown = [{ filename: 'src/lib/ai-provider.ts', status: 'modified' }]) {
  return { pullRequest: { headSha: SHA, body: '<!-- engineering-contract: 1048 -->', mergedAt: null }, files, problems: [], ci: { status: 'PASSED' } };
}
beforeEach(() => {
  vi.stubEnv('GH_TOKEN', 'test-only-read-token');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ head: { sha: SHA } })));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  seams.github.mockResolvedValue(github());
  // Auth collectors are stubbed only to test CLI composition; this fixture is not proof authority.
  seams.proof.mockReturnValue({ status: 'VERIFIED', blockers: [] });
  seams.review.mockImplementation(() => ({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: null, blockers: [] }));
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
    const result = await main(['audit', '--pr', '1', '--output', directory()]);
    expect(result.status).toBe('BLOCKED');
    expect(result.review.blockers).toContain('Required owner authorization for R3 risk or contract approval is missing');
  });
  it('also requires owner signoff when the contract requires it at lower actual risk', async () => {
    seams.github.mockResolvedValue(github([{ filename: 'src/lib/agents/knox/paid-extract.ts', status: 'modified' }]));
    const result = await main(['audit', '--pr', '1', '--output', directory()]);
    expect(result.actualRisk.risk_tier).toBe('R2');
    expect(result.status).toBe('BLOCKED');
    expect(result.review.blockers).toContain('Required owner authorization for R3 risk or contract approval is missing');
  });
  it('allows code-ready composition with verified independent review and required owner signoff', async () => {
    seams.review.mockReturnValue({ status: 'INDEPENDENT_REVIEW_VERIFIED', ownerSignoff: { actor: 'owner', id: 2, url: 'https://github.com/o/r/pull/1#issuecomment-2' }, blockers: [] });
    const result = await main(['audit', '--pr', '1', '--output', directory()]);
    expect(result.status).toBe('CODE_VERIFIED');
  });
  it('passes rename origins to actual risk and reviewed scope instead of only the inert destination', async () => {
    seams.github.mockResolvedValue(github([{ filename: 'docs/old-provider.txt', previous_filename: 'src/lib/ai-provider.ts', status: 'renamed' }]));
    const result = await main(['audit', '--pr', '1', '--output', directory()]);
    expect(result.actualRisk.risk_tier).toBe('R3');
    expect(result.actualChangedPaths).toEqual(['docs/old-provider.txt', 'src/lib/ai-provider.ts']);
    expect(seams.scope).toHaveBeenCalledWith(expect.anything(), result.actualChangedPaths);
  });
  it('blocks malformed rename inventory and refuses proof preparation for it', async () => {
    seams.github.mockResolvedValue(github([{ filename: 'docs/old-provider.txt', status: 'renamed' }]));
    const result = await main(['audit', '--pr', '1', '--output', directory()]);
    expect(result.status).toBe('BLOCKED');
    expect(result.review.blockers.join(' ')).toContain('missing its previous filename');
    await expect(main(['prepare', '--pr', '1', '--output', directory()])).rejects.toThrow('missing its previous filename');
  });
});
