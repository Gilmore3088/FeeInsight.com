// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CURRENT_PROOF_INPUTS } from './proof-inputs.fixture';
import { frozenIdentities, runPilot } from './runner.mjs';
const roots: string[] = [], hash = (s: string) => createHash('sha256').update(s).digest('hex');
function root() { const p = mkdtempSync(join(tmpdir(), 'runner-revision-')); roots.push(p); return p; }
function put(p: string, file: string, raw: string) { mkdirSync(dirname(join(p, file)), { recursive: true }); writeFileSync(join(p, file), raw); }
function declaration() {
  const original = JSON.parse(readFileSync(new URL('../../../docs/project/acceptance/engineering/1048.json', import.meta.url), 'utf8'));
  const cases = JSON.parse(readFileSync(new URL('./__fixtures__/policy-v2.json', import.meta.url), 'utf8')).cases as Array<{ id: string }>;
  return { ...original, contract_id: 'EV-FOUNDATION-1048-V2', requirements: [
    { ...original.requirements[0], id: 'EV-FINANCIAL-RISK-ROUTES', test_id: 'financial-risk-routes', assertion_ids: cases.map(row => 'risk-' + row.id), baseline_failure_assertion_ids: ['risk-FIN-01'] },
    { ...original.requirements[0], id: 'EV-FINANCIAL-SKILL-ROUTES', test_id: 'financial-skill-routes', assertion_ids: cases.map(row => 'skills-' + row.id), baseline_failure_assertion_ids: ['skills-FIN-01'] },
  ] };
}
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
describe('runner exact revision and parent inventory admission', () => {
  it.each([undefined, '1048', '2285'])('blocks historical/default selector %s before missing repository or Docker can be touched', contractKey => {
    expect(() => runPilot({ repositoryRoot: '/nonexistent-fixture-root', headSha: 'a'.repeat(40), outputDirectory: '/nonexistent-fixture-output', contractKey })).toThrow(/historical/i);
  });
  it('rejects conflicting exact selectors before repository reads', () => {
    expect(() => runPilot({ repositoryRoot: '/nonexistent-fixture-root', headSha: 'a'.repeat(40), outputDirectory: '/nonexistent-fixture-output', contractKey: '1048-v2', contractNumber: '1048' })).toThrow(/conflicting/i);
  });
  it.each(['omitted group', 'missing assertion', 'wrong test', 'duplicate risk group', 'wrong identity'])('rejects %s before any missing frozen source or Git execution', kind => {
    const p = root(), value = declaration();
    if (kind === 'omitted group') value.requirements.pop();
    if (kind === 'missing assertion') value.requirements[1].assertion_ids.pop();
    if (kind === 'wrong test') value.requirements[1].test_id = 'builder-supplied-green';
    if (kind === 'duplicate risk group') value.requirements[1] = structuredClone(value.requirements[0]);
    if (kind === 'wrong identity') value.contract_id = 'EV-FOUNDATION-1048';
    put(p, 'docs/project/acceptance/engineering/1048-v2.json', JSON.stringify(value));
    expect(() => runPilot({ repositoryRoot: p, headSha: 'a'.repeat(40), outputDirectory: join(p, 'output'), contractKey: '1048-v2' })).toThrow(/inventory|identity|duplicate/);
  });
});
function completeClosure() {
  const p = root(), value = declaration(), files: Record<string, string> = {};
  for (const path of CURRENT_PROOF_INPUTS) files[path] = 'Synthetic source: ' + path;
  for (const requirement of value.requirements) for (const kind of ['test', 'fixture', 'adapter'] as const) {
    const path = requirement[kind + '_path']; files[path] ??= 'Synthetic source: ' + path; requirement[kind + '_sha256'] = hash(files[path]);
  }
  value.execution_files = CURRENT_PROOF_INPUTS.map(path => ({ path, sha256: hash(files[path]) }));
  for (const [path, raw] of Object.entries(files)) put(p, path, raw);
  return { p, value, files };
}
describe('shared pilot frozen identity', () => {
  it('retains one shared identity and refuses last-requirement overwrite in a registered complete closure', () => {
    const f = completeClosure(); put(f.p, 'a.ts', 'first'); put(f.p, 'b.ts', 'second');
    f.value.requirements[0].test_path = 'a.ts'; f.value.requirements[0].test_sha256 = hash('first');
    f.value.requirements[1].test_path = 'b.ts'; f.value.requirements[1].test_sha256 = hash('second');
    expect(() => frozenIdentities(f.p, f.value)).toThrow(/shared test identity/);
    f.value.requirements[1].test_path = 'a.ts'; f.value.requirements[1].test_sha256 = hash('first');
    expect(frozenIdentities(f.p, f.value)).toMatchObject({ test_sha256: hash('first') });
  });
  it.each(['../outside', 'encoded%2fpath', '/tmp/absolute', 'a//b'])('rejects unsafe frozen source path %s', path => {
    const f = completeClosure(); f.value.execution_files.push({ path, sha256: hash('canary') });
    expect(() => frozenIdentities(f.p, f.value)).toThrow(/unsafe/i);
  });
  it('refuses a symlinked mandatory input even when its target bytes match the frozen hash', () => {
    const f = completeClosure(), outside = root(), path = 'src/lib/engineering-verification/cli.mjs';
    put(outside, 'source.mjs', f.files[path]); rmSync(join(f.p, path)); symlinkSync(join(outside, 'source.mjs'), join(f.p, path));
    expect(() => frozenIdentities(f.p, f.value)).toThrow(/canonical regular/);
  });
});
