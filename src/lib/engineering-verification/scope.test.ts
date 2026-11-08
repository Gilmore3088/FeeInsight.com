// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assessChangedScope } from './scope.mjs';
describe('reviewed scope against actual diff', () => {
  const contract = { issue: '#2285', scope: ['src/lib/agents/knox/**'], required_skills: ['tdd','adversarial-document-testing','error-to-test'], requirements: [], execution_files: [] };
  it('never uses a historical Knox contract to certify unrelated authentication or publication changes', () => {
    expect(assessChangedScope(contract, ['src/lib/auth.ts']).status).toBe('BLOCKED');
    expect(assessChangedScope(contract, ['src/lib/agents/darwin/verify.ts']).status).toBe('BLOCKED');
  });
  it('accepts scoped tests and inert copy but requires protected policy to be explicitly reviewed', () => {
    expect(assessChangedScope(contract, ['src/lib/agents/knox/rules.ts','docs/changelog.md']).status).toBe('SCOPED');
    expect(assessChangedScope(contract, ['AGENTS.md']).status).toBe('BLOCKED');
    expect(assessChangedScope(contract, []).status).toBe('BLOCKED');
  });
});
