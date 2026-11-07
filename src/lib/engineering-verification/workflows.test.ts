// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

type Step = { id?: string; name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; if?: string };
type Workflow = { name: string; on: Record<string, unknown>; permissions: Record<string, string>; env?: Record<string, string>; jobs: Record<string, { if?: string; steps: Step[] }> };
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
function workflow(name: string): Workflow {
  return yaml.load(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as Workflow;
}

describe('engineering verification workflow trust boundary', () => {
  it('runs fixture schema catch-up exactly once on a fresh separate database before shared DB suites', () => {
    const ci = workflow('test.yml');
    const fixtureTest = 'tests/e2e/hamilton/schema-catch-up.test.ts';
    expect(ci.env?.FIXTURE_SCHEMA_TEST).toBe(fixtureTest);
    expect(ci.env?.E2E_TESTS.split(/\s+/)).not.toContain(fixtureTest);
    const directory = mkdtempSync(join(tmpdir(), 'feeinsight-ci-fixture-'));
    const log = join(directory, 'commands.jsonl');
    type Command = { command: string; args: string[]; fixtureDatabaseName: string | null; appDatabaseMatchesFixture: boolean };
    // Exercise the actual workflow shell and variable expansion; intercept all database/test executables.
    const stub = '#!' + process.execPath + '\nconst {appendFileSync}=require("node:fs"); const {basename}=require("node:path"); const fixture=process.env.E2E_DATABASE_URL; let fixtureDatabaseName=null; try { fixtureDatabaseName=new URL(fixture).pathname.slice(1); } catch {} appendFileSync(process.env.CI_FIXTURE_COMMAND_LOG,JSON.stringify({command:basename(process.argv[1]),args:process.argv.slice(2),fixtureDatabaseName,appDatabaseMatchesFixture:!!fixture&&process.env.DATABASE_URL===fixture})+"\\n");\n';
    try {
      for (const command of ['sudo', 'psql', 'npx', 'node']) { const file = join(directory, command); writeFileSync(file, stub); chmodSync(file, 0o755); }
      const run = (script: string) => {
        writeFileSync(log, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: directory, encoding: 'utf8', env: { ...process.env, ...ci.env, DATABASE_URL: '', E2E_DATABASE_URL: '', PATH: directory + delimiter + process.env.PATH, CI_FIXTURE_COMMAND_LOG: log } });
        expect(result.status, result.stderr).toBe(0);
        return readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Command);
      };
      const e2e = ci.jobs.e2e.steps.find(step => step.name === 'End-to-end pipeline test');
      const commands = run(e2e?.run ?? 'exit 90');
      const fixtureRun = commands.findIndex(row => row.command === 'npx' && row.args.includes(fixtureTest));
      const sharedRun = commands.findIndex(row => row.command === 'npx' && row.fixtureDatabaseName === 'e2e');
      expect(fixtureRun).toBeGreaterThan(-1);
      expect(sharedRun).toBeGreaterThan(fixtureRun);
      expect(commands.filter(row => row.command === 'npx' && row.args.includes(fixtureTest))).toHaveLength(1);
      expect(commands[fixtureRun].fixtureDatabaseName).toBe('e2e_fixture_schema');
      expect(commands[fixtureRun].appDatabaseMatchesFixture).toBe(true);
      expect(commands[sharedRun].appDatabaseMatchesFixture).toBe(true);
      const guard = 'src/lib/engineering-verification/required-database-tests.mjs';
      const preflights = commands.flatMap((row, i) => row.command === 'node' && row.args.join(' ') === guard + ' check-env' ? [i] : []);
      expect(preflights).toHaveLength(2);
      expect(preflights[0]).toBeLessThan(fixtureRun);
      expect(preflights[1]).toBeGreaterThan(fixtureRun);
      expect(preflights[1]).toBeLessThan(sharedRun);
      for (const [runIndex, report, required] of [
        [fixtureRun, 'test-results/engineering-verification/required-db-fixture.json', [fixtureTest]],
        [sharedRun, 'test-results/engineering-verification/required-db-pipeline.json', ['E2E_TESTS', 'PUBLIC_FEE_APPLICABILITY_TEST', 'DARWIN_RECHECK_TEST', 'ROSETTA_BYTE_IDENTITY_TEST', 'PAID_RETURNED_EVENT_TEST'].flatMap(key => ci.env?.[key]?.trim().split(/\s+/) ?? [])],
      ] as const) {
        expect(commands[runIndex].args).toEqual(expect.arrayContaining(['--reporter=default', '--reporter=json', '--outputFile=' + report]));
        const postflight = commands.findIndex(row => row.command === 'node' && row.args[0] === guard && row.args[1] === 'check-results' && row.args.includes(report));
        expect(postflight).toBeGreaterThan(runIndex);
        expect(commands[postflight].args).toEqual([guard, 'check-results', '--report', report, '--files', ...required]);
        expect(commands[postflight].appDatabaseMatchesFixture).toBe(true);
      }
      const creation = commands.findIndex(row => row.command === 'sudo' && row.args.join(' ') === '-u postgres createdb e2e_fixture_schema');
      const snapshot = commands.findIndex(row => row.command === 'psql' && row.args.includes('e2e_fixture_schema') && row.args.includes('tests/e2e/production-schema.sql') && row.args.includes('ON_ERROR_STOP=1'));
      expect(creation).toBeGreaterThan(-1);
      expect(snapshot).toBeGreaterThan(creation);
      expect(fixtureRun).toBeGreaterThan(snapshot);
      expect(commands[sharedRun].args).not.toContain(fixtureTest);
      const unit = ci.jobs.unit.steps.find(step => step.name?.startsWith('Unit tests (shard'));
      const unitCommands = run((unit?.run ?? 'exit 90').replaceAll('${{ matrix.shard }}', '1'));
      const unitRun = unitCommands.find(row => row.command === 'npx');
      const exclusions = unitRun?.args.flatMap((argument, i, args) => argument === '--exclude' ? [args[i + 1]] : []) ?? [];
      expect(exclusions.filter(file => file === fixtureTest)).toHaveLength(1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('runs full CI for a real protected-file rename to an inert document', () => {
    const directory = mkdtempSync(join(tmpdir(), 'feeinsight-rename-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    try {
      git('init', '--quiet'); git('config', 'user.name', 'Offline fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'diff.renames', 'true');
      mkdirSync(join(directory, 'src/lib/engineering-verification'), { recursive: true });
      mkdirSync(join(directory, 'docs'));
      writeFileSync(join(directory, 'AGENTS.md'), 'Protected instructions unchanged by the rename.\n');
      writeFileSync(join(directory, 'src/lib/engineering-verification/contract.mjs'), readFileSync(new URL('./contract.mjs', import.meta.url)));
      git('add', '.'); git('commit', '--quiet', '-m', 'Frozen trusted base');
      const base = git('rev-parse', 'HEAD');
      git('mv', 'AGENTS.md', 'docs/old-guide.md'); git('commit', '--quiet', '-m', 'Pure rename');
      const head = git('rev-parse', 'HEAD');
      expect(git('diff', '--name-status', '-M', base, head)).toBe('R100\tAGENTS.md\tdocs/old-guide.md');
      const classifier = workflow('test.yml').jobs.changes.steps.find(step => step.id === 'diff');
      const output = join(directory, 'classification.txt');
      const result = spawnSync('bash', ['-c', classifier?.run ?? 'exit 90'], { cwd: directory, encoding: 'utf8',
        env: { ...process.env, EVENT_NAME: 'pull_request', DIFF_BASE: base, DIFF_HEAD: head, RUNNER_TEMP: directory, GITHUB_OUTPUT: output } });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe('code=true\n');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('retains both native required-database reports on failure with run-attempt identity', () => {
    const steps = workflow('test.yml').jobs.e2e.steps;
    const artifact = steps.find(step => step.name === 'Retain required database execution reports');
    expect(artifact?.if).toBe('always()');
    expect(artifact?.uses).toMatch(/^actions\/upload-artifact@[a-f0-9]{40}$/);
    expect(artifact?.with?.name).toBe('required-database-tests-${{ github.run_id }}-attempt-${{ github.run_attempt }}');
    expect(artifact?.with?.['retention-days']).toBe(90);
    expect(artifact?.with?.['if-no-files-found']).toBe('error');
    const retained = String(artifact?.with?.path).trim().split(/\s+/);
    const script = steps.find(step => step.name === 'End-to-end pipeline test')?.run ?? '';
    const generated = [...script.matchAll(/--outputFile=(\S+)/g)].map(match => match[1]);
    expect(retained.sort()).toEqual(generated.sort());
    expect(retained).toHaveLength(2);
  });
  it('keeps the proof adapter on explicit main dispatch with immutable actions and read-only permissions', () => {
    const proof = workflow('engineering-verification.yml');
    expect(Object.keys(proof.on)).toEqual(['workflow_dispatch']);
    expect(proof.jobs['historical-proof'].if).toBe("github.ref == 'refs/heads/main'");
    for (const definition of [proof, workflow('engineering-verification-gate.yml')]) {
      expect(Object.values(definition.permissions).every(permission => permission === 'read')).toBe(true);
      for (const job of Object.values(definition.jobs)) for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/^[^@]+@[a-f0-9]{40}$/);
        if (step.uses?.startsWith('actions/checkout@')) {
          expect(step.with?.['persist-credentials']).toBe(false);
          expect(['${{ github.sha }}', 'refs/heads/main']).toContain(step.with?.ref);
        }
        if (step.run) {
          expect(step.run).not.toMatch(/\$\{\{\s*(inputs|github\.event\.pull_request)/);
          const syntax = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
          expect(syntax.stderr).toBe('');
          expect(syntax.status).toBe(0);
        }
      }
    }
  });
  it('fetches source with an ephemeral read credential and strips it from source execution', () => {
    const steps = workflow('engineering-verification.yml').jobs['historical-proof'].steps;
    const materialize = steps.find(step => step.run?.includes('git -c credential.helper='));
    expect(materialize?.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(materialize?.run).toContain('GIT_ASKPASS=');
    expect(materialize?.run).toContain('trap');
    expect(materialize?.run).toContain('git -c credential.helper= fetch --no-tags origin "$TARGET_SHA" "$BASELINE_SHA"');
    const execute = steps.find(step => step.run?.includes('runner.mjs'));
    expect(execute?.env).not.toHaveProperty('GH_TOKEN');
    expect(execute?.env).not.toHaveProperty('GITHUB_TOKEN');
    const artifact = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
    expect(artifact?.with?.name).toBe('engineering-verification-${{ inputs.pr_number }}-${{ steps.prepare.outputs.head_sha }}-${{ inputs.contract }}-attempt-${{ github.run_attempt }}');
    expect(artifact?.with?.['retention-days']).toBe(90);
  });
  it('refreshes audit evidence on empty workflow-run PR associations without writing checks', () => {
    const gate = workflow('engineering-verification-gate.yml');
    expect(gate.permissions.checks).toBe('read');
    const steps = gate.jobs['engineering-audit'].steps;
    const scripts = steps.map(step => step.run ?? '').join('\n');
    expect(scripts).toContain('resolve-run --run "$WORKFLOW_RUN_ID"');
    expect(scripts).toContain('audit --pr "$PR_NUMBER"');
    expect(scripts).not.toContain('--publish');
    expect(scripts).not.toContain('enforcement_enabled');
    expect(scripts).not.toContain('pull_request.head');
    expect(scripts).not.toMatch(/git\s+(checkout|switch|fetch)/);
    expect(steps.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.ref).toBe('refs/heads/main');
    expect(steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))?.with?.['retention-days']).toBe(90);
  });
});
