// @vitest-environment node
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProgram } from './program.mjs';
const PROGRAM = 'docs/project/acceptance/engineering/program.json';
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'feeinsight-program-')); roots.push(root);
  const program = JSON.parse(readFileSync(PROGRAM, 'utf8'));
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const source of program.sources) put(source.path, readFileSync(source.path, 'utf8'));
  for (const ref of Object.values(program.references) as Array<{ implementation: string[]; tests: string[] }>) for (const path of [...ref.implementation, ...ref.tests]) put(path, 'Fixture file exists; this is not a passing test receipt.');
  const save = () => put(PROGRAM, JSON.stringify(program)); save();
  return { root, program, save, put };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('complete plan traceability without self-certified completion', () => {
  it('traces all fifty original requirements while external activation remains pending', () => {
    const { root } = fixture();
    expect(validateProgram(root)).toMatchObject({ status: 'PLAN_TRACEABLE', requirements: 50, problems: [] });
  });
  it('traces the implemented source, browser and scorecard seams without declaring adoption complete', () => {
    const { root, program } = fixture();
    expect(program.references['source-security']?.implementation).toEqual(expect.arrayContaining([
      'src/lib/agents/source-data-boundary.ts',
      'src/lib/agents/knox/paid-extract.ts',
      'src/lib/agents/rosetta/paid-read.ts',
      'src/lib/engineering-verification/__fixtures__/source-injection/fee-schedule.pdf',
      'src/lib/engineering-verification/__fixtures__/source-injection/fee-schedule.html',
      'src/lib/engineering-verification/__fixtures__/source-injection/fee-schedule.txt',
    ]));
    expect(program.references['source-security'].tests).toContain('src/lib/engineering-verification/source-injection.test.ts');
    expect(program.references.metrics.implementation).toContain('src/lib/engineering-verification/scorecard.mjs');
    expect(program.references.metrics.tests).toContain('src/lib/engineering-verification/scorecard.test.ts');
    expect(program.references.ui.implementation).toEqual(expect.arrayContaining([
      '.claude/skills/buyer-journey-mapper/SKILL.md',
      '.claude/skills/ux-ui-auditor/SKILL.md',
      '.claude/skills/playwright-ux-simulator/SKILL.md',
      'src/lib/engineering-verification/browser-evidence.mjs',
      'tests/e2e/hamilton/evidence.ts',
    ]));
    expect(program.references.ui.tests).toContain('tests/e2e/hamilton/reports-journey.pw.ts');
    expect(program.activation_gates.find((gate: { id: string }) => gate.id === 'source-injection-coverage').state).toBe('PENDING_EXECUTION');
    expect(validateProgram(root).status).toBe('PLAN_TRACEABLE');
  });
  it('rejects replacing implemented source, browser or scorecard traceability with unrelated existing files', () => {
    const { root, program, save } = fixture();
    for (const name of ['source-security', 'ui', 'metrics']) {
      program.references[name] = { implementation: ['src/lib/engineering-verification/contract.mjs'], tests: ['src/lib/engineering-verification/contract.test.ts'] };
    }
    save();
    expect(validateProgram(root).problems.join(' ')).toContain('Required traceability file');
  });
  it('recognizes Playwright references only in the actual browser-test directory', () => {
    const { root, program, save, put } = fixture();
    put('src/lib/engineering-verification/pretend-browser.pw.ts', 'This file is not an executed browser journey.');
    program.references.ui.tests.push('src/lib/engineering-verification/pretend-browser.pw.ts'); save();
    expect(validateProgram(root).problems.join(' ')).toContain('actual test file');
  });
  it('blocks omitted, duplicated or unknown numbered requirements', () => {
    const { root, program, save } = fixture();
    program.requirements.pop(); save();
    expect(validateProgram(root).status).toBe('BLOCKED');
    program.requirements.push({ ...program.requirements[0], id: 'FR-99' }); save();
    expect(validateProgram(root).problems.join(' ')).toContain('Unknown requirement');
    program.requirements.push(program.requirements[0]); save();
    expect(validateProgram(root).problems.join(' ')).toContain('Duplicate requirement');
  });
  it('rejects changed source bytes and a wrong source attribution', () => {
    const { root, program, save, put } = fixture();
    put(program.sources[0].path, readFileSync(program.sources[0].path, 'utf8') + '\nUnapproved source amendment.');
    expect(validateProgram(root).problems.join(' ')).toContain('Source hash');
    program.requirements[0].source = 'technical-design-v1'; save();
    expect(validateProgram(root).problems.join(' ')).toContain('source attribution');
  });
  it('blocks missing test files, unknown references and escaping file paths', () => {
    const { root, program, save } = fixture();
    unlinkSync(join(root, program.references.contract.tests[0]));
    expect(validateProgram(root).problems.join(' ')).toContain('Missing file');
    program.requirements[0].references = ['invented']; save();
    expect(validateProgram(root).problems.join(' ')).toContain('Unknown reference');
    program.references.contract.implementation[0] = '../outside.mjs'; save();
    expect(validateProgram(root).problems.join(' ')).toContain('Unsafe');
  });
  it('blocks malformed registries rather than throwing or silently accepting missing controls', () => {
    const { root, program, save } = fixture();
    program.activation_gates = {}; program.stages = {}; program.references = null; save();
    expect(() => validateProgram(root)).not.toThrow();
    expect(validateProgram(root).status).toBe('BLOCKED');
  });
  it('retains external stale-review and broader injection acceptance even when remaining lists are rewritten', () => {
    const { root, program, save } = fixture();
    for (const requirement of program.requirements) {
      if (['AT-04', 'UAT-03'].includes(requirement.id)) requirement.activation_gates = [];
      if (requirement.id === 'SEC-05') {
        requirement.activation_gates = ['trusted-actions-proof'];
        requirement.implementation_state = 'MECHANISM_PRESENT';
      }
    }
    program.remaining_requirements = program.requirements.filter((requirement: { implementation_state: string; activation_gates: string[] }) => requirement.implementation_state === 'PARTIAL' || requirement.activation_gates.length).map((requirement: { id: string }) => requirement.id);
    save();
    const problems = validateProgram(root).problems.join(' ');
    expect(problems).toContain('AT-04 must retain required activation gate');
    expect(problems).toContain('UAT-03 must retain required activation gate');
    expect(problems).toContain('SEC-05 must retain required activation gate source-injection-coverage');
    expect(problems).toContain('SEC-05 remains PARTIAL');
  });
  it('does not let a manifest declare approval or conceal remaining work', () => {
    const { root, program, save } = fixture();
    program.activation_gates[0].state = 'COMPLETE'; save();
    expect(validateProgram(root).problems.join(' ')).toContain('pending external');
    program.remaining_requirements = []; save();
    expect(validateProgram(root).problems.join(' ')).toContain('remaining_requirements');
  });
  it('retains specialist, private-holdout and multi-change adoption dependencies', () => {
    const { root, program, save } = fixture();
    for (const requirement of program.requirements) {
      if (['FR-03', 'FR-17', 'FR-19', 'FR-20', 'FR-22', 'SEC-06', 'UAT-09'].includes(requirement.id)) {
        requirement.activation_gates = [];
        requirement.implementation_state = 'MECHANISM_PRESENT';
      }
    }
    program.remaining_requirements = program.requirements.filter((requirement: { implementation_state: string; activation_gates: string[] }) => requirement.implementation_state === 'PARTIAL' || requirement.activation_gates.length).map((requirement: { id: string }) => requirement.id);
    save();
    const problems = validateProgram(root).problems.join(' ');
    expect(problems).toContain('FR-20 must retain required activation gate ui-specialist-adoption');
    expect(problems).toContain('FR-19 must retain required activation gate holdout-and-scorecard-adoption');
    expect(problems).toContain('SEC-06 must retain required activation gate holdout-and-scorecard-adoption');
  });
});
