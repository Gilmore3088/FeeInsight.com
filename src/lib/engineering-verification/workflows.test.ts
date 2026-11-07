// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

type Step = { id?: string; name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown>; if?: string };
type Workflow = { name: string; on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { if?: string; steps: Step[] }> };
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (text: string) => unknown };
function workflow(name: string): Workflow {
  return yaml.load(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')) as Workflow;
}

describe('engineering verification workflow trust boundary', () => {
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
