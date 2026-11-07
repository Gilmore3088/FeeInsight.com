// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assessDatabaseEnvironment, assessRequiredDatabaseResults, MAX_REPORT_BYTES } from './required-database-tests.mjs';

type Assertion = { title: string; fullName: string; status: string; duration?: number; failureMessages: string[] };
type FileResult = { name: string; status: string; startTime: number; endTime: number; message: string; assertionResults: Assertion[] };
type Report = { success: boolean; startTime: number; numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number; numTodoTests: number; numTotalTestSuites: number; numPassedTestSuites: number; numFailedTestSuites: number; numPendingTestSuites: number; testResults: FileResult[] };
const guardPath = fileURLToPath(new URL('./required-database-tests.mjs', import.meta.url));
const vitestPath = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));
const localUrl = 'postgres://fixture:synthetic-private-password@127.0.0.1:5432/offline_fixture';
let directory: string, passedReportPath: string, passed: Report, skipped: Report;
const clone = () => structuredClone(passed);
const assess = (report: unknown, files: unknown = ['required.test.mjs']) => assessRequiredDatabaseResults(report, files, { cwd: directory });
const required = (report: Report) => report.testResults.find(file => file.name === join(directory, 'required.test.mjs'))!;
function cli(args: string[], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [guardPath, ...args], { cwd: directory, encoding: 'utf8', timeout: 5000, env: { ...process.env, DATABASE_URL: '', E2E_DATABASE_URL: '', ...env } });
}

beforeAll(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'feeinsight-native-vitest-report-')));
  writeFileSync(join(directory, 'vitest.config.mjs'), "export default {test:{globals:true,environment:'node',include:['**/*.test.mjs'],maxWorkers:1}};\n");
  writeFileSync(join(directory, 'required.test.mjs'), "test('executes the required assertion',()=>expect(2+2).toBe(4));\ntest.skipIf(process.env.REPORT_FIXTURE_SKIP==='1')('conditional database assertion',()=>expect(true).toBe(true));\n");
  writeFileSync(join(directory, 'optional.test.mjs'), "test.skip('outside the selected database inventory',()=>expect(false).toBe(true));\n");
  for (const [name, skip] of [['passed', '0'], ['skipped', '1']] as const) {
    const path = join(directory, name + '.json');
    const result = spawnSync(process.execPath, [vitestPath, 'run', '--root', directory, '--config', join(directory, 'vitest.config.mjs'), '--reporter=json', '--outputFile=' + path], {
      encoding: 'utf8', timeout: 20000, env: { ...process.env, DATABASE_URL: '', E2E_DATABASE_URL: '', REPORT_FIXTURE_SKIP: skip },
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(path, 'utf8')) as Report;
    if (name === 'passed') { passed = report; passedReportPath = path; } else skipped = report;
  }
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('required database environment identity', () => {
  it.each(['postgres://u:p@localhost:5432/fixture', 'postgresql://u:p@127.0.0.1/fixture', 'postgres://u:p@[::1]:5432/fixture'])('accepts matching local PostgreSQL connections: %s', url => {
    expect(assessDatabaseEnvironment({ DATABASE_URL: url, E2E_DATABASE_URL: url }).ok).toBe(true);
  });
  it.each([{}, { E2E_DATABASE_URL: localUrl }, { DATABASE_URL: localUrl }, { DATABASE_URL: localUrl, E2E_DATABASE_URL: localUrl + '_other' }])('blocks an unset or different application connection without printing values', env => {
    const result = assessDatabaseEnvironment(env);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-private-password');
    expect(JSON.stringify(result)).not.toContain(localUrl);
  });
  it.each(['postgres://u:secret@db.example.invalid/fixture', 'mysql://u:secret@localhost/fixture', 'postgres://u:secret@localhost:0/fixture', 'postgres://u:secret@localhost/fixture?host=db.example.invalid', 'postgres://u:secret@localhost/fixture#secret', 'postgres://u:secret@localhost/', 'postgres://u:secret@localhost/a%2Fb', 'postgres://u:secret@localhost/%ZZ', 'not a connection secret'])('rejects invalid or nonlocal connections without including their values', url => {
    const result = assessDatabaseEnvironment({ DATABASE_URL: url, E2E_DATABASE_URL: url });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(url);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('blocks the standard-URL/driver multihost parser disagreement before any connection', () => {
    // postgres parses after the first raw @; WHATWG URL uses the last one.
    const url = 'postgres://user:pass@attacker.invalid,ignored@localhost:5432/fixture';
    expect(new URL(url).hostname).toBe('localhost');
    expect(assessDatabaseEnvironment({ DATABASE_URL: url, E2E_DATABASE_URL: url }).ok).toBe(false);
  });
});

describe('required native Vitest execution receipts', () => {
  it('accepts real passing required assertions while allowing an unrelated optional skip', () => {
    expect(passed.success).toBe(true);
    expect(passed.numPendingTests).toBe(1);
    expect(required(passed).assertionResults).toHaveLength(2);
    expect(assess(passed)).toMatchObject({ ok: true, requiredFiles: 1, requiredAssertions: 2 });
  });
  it('blocks the real zero-exit success report when a selected database assertion was skipped', () => {
    expect(skipped.success).toBe(true);
    expect(skipped.numPendingTests).toBe(2);
    expect(assess(skipped).problems).toContain('Required assertion in file 1 was not completely passed');
    expect(assess(skipped).ok).toBe(false);
  });
  it.each(['pending', 'skipped', 'todo', 'disabled', 'unknown', 'failed'])('blocks a required assertion with %s status', status => {
    const report = clone(); required(report).assertionResults[0].status = status;
    expect(assess(report).ok).toBe(false);
    expect(assess(report).problems).toContain('Required assertion in file 1 was not completely passed');
  });
  it.each([null, [], {}, { success: false, testResults: [] }, { ...Object.fromEntries(['numTotalTests', 'numPassedTests'].map(key => [key, 0])), success: true, testResults: [] }])('blocks malformed or incomplete top-level reports', report => {
    expect(assess(report).ok).toBe(false);
  });
  it.each(['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites', 'startTime'])('requires valid native aggregate field %s', key => {
    const report = clone() as unknown as Record<string, unknown>; delete report[key];
    expect(assess(report).ok).toBe(false);
  });
  it('blocks aggregate counters that conceal a skip, failure or incomplete suite execution', () => {
    for (const update of [{ numPendingTests: 0 }, { numFailedTests: 1 }, { numFailedTestSuites: 1 }, { numTotalTestSuites: 0, numPassedTestSuites: 0, numPendingTestSuites: 0 }, { numPassedTestSuites: 0, numPendingTestSuites: passed.numTotalTestSuites }]) {
      expect(assess({ ...clone(), ...update }).ok).toBe(false);
    }
  });
  it('requires each selected file exactly once, with at least one executed assertion', () => {
    const missing = clone(); missing.testResults = missing.testResults.filter(file => file !== required(missing));
    const duplicate = clone(); duplicate.testResults.push(structuredClone(required(duplicate)));
    const empty = clone(); required(empty).assertionResults = [];
    for (const report of [missing, duplicate, empty]) expect(assess(report).ok).toBe(false);
    expect(assess(duplicate).problems).toContain('Required file 1 must occur exactly once');
  });
  it.each([[], ['required.test.mjs', 'required.test.mjs'], ['../required.test.mjs'], ['/required.test.mjs'], ['required.test.mjs\n'], ['required.test.mjs', null], 'required.test.mjs'])('rejects malformed required inventories', files => {
    expect(assess(passed, files).ok).toBe(false);
  });
  it('requires completed passing assertion metadata and a successful suite result', () => {
    const changes = [(a: Assertion) => { delete a.duration; }, (a: Assertion) => { a.duration = -1; }, (a: Assertion) => { a.failureMessages = ['unhandled execution failure']; }, (a: Assertion) => { a.title = ''; }, (a: Assertion) => { a.fullName = ''; }];
    for (const change of changes) { const report = clone(); change(required(report).assertionResults[0]); expect(assess(report).ok).toBe(false); }
    const failed = clone(); required(failed).status = 'failed'; expect(assess(failed).ok).toBe(false);
    const unknown = clone(); required(unknown).status = 'unknown'; expect(assess(unknown).ok).toBe(false);
    const interrupted = clone(); required(interrupted).message = 'interrupted before completion'; expect(assess(interrupted).ok).toBe(false);
  });
  it('rejects a failed non-selected suite even when aggregate success was incorrectly retained', () => {
    const report = clone(); report.testResults.find(file => file !== required(report))!.status = 'failed';
    expect(assess(report).ok).toBe(false);
  });
});

describe('required database guard CLI', () => {
  it('checks actual environment identity without emitting connection credentials', () => {
    expect(cli(['check-env'], { DATABASE_URL: localUrl, E2E_DATABASE_URL: localUrl }).status).toBe(0);
    const blocked = cli(['check-env'], { E2E_DATABASE_URL: localUrl });
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain('BLOCKED');
    expect(blocked.stderr).not.toContain('synthetic-private-password');
    expect(blocked.stderr).not.toContain(localUrl);
  });
  it('reads and validates the native JSON report via the documented file selection', () => {
    const result = cli(['check-results', '--report', passedReportPath, '--files', 'required.test.mjs']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('Required database test guard: PASSED\n');
    expect(cli(['check-results', '--report', join(directory, 'skipped.json'), '--files', 'required.test.mjs']).status).toBe(1);
  });
  it('fails closed on unavailable, malformed, incomplete, oversized or non-file reports with bounded errors', () => {
    const malformed = join(directory, 'private-secret-malformed.json'), partial = join(directory, 'partial.json'), oversized = join(directory, 'oversized.json');
    writeFileSync(malformed, '{private-secret-value'); writeFileSync(partial, JSON.stringify({ success: true })); writeFileSync(oversized, ''); truncateSync(oversized, MAX_REPORT_BYTES + 1);
    for (const path of [join(directory, 'private-secret-missing.json'), malformed, partial, oversized, directory]) {
      const result = cli(['check-results', '--report', path, '--files', 'required.test.mjs']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('BLOCKED');
      expect(result.stderr.length).toBeLessThan(1000);
      expect(result.stderr).not.toContain('private-secret');
      expect(result.stderr).not.toContain(resolve(path));
    }
  });
  it('rejects missing selection and unknown arguments without echoing them', () => {
    for (const args of [[], ['check-env', 'private-secret'], ['check-results', '--report', passedReportPath, '--files'], ['private-secret']]) {
      const result = cli(args); expect(result.status).toBe(1); expect(result.stderr).toContain('Usage:'); expect(result.stderr).not.toContain('private-secret');
    }
  });
});
