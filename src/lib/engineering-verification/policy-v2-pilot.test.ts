// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADAPTER_ID, PILOT_ID, PILOT, pilotRequest, validateAdapterRequest, validateObservedValues, assessPilotValues } from './policy-v2-pilot.mjs';
const literal = JSON.parse(readFileSync(new URL('./__fixtures__/policy-v2.json', import.meta.url), 'utf8')) as { cases: Array<{ id: string; paths: string[]; expectedRisk: string; expectedSkills: string[] }> };
const values = () => literal.cases.map(row => ({ id: row.id, risk: row.expectedRisk, skills: [...row.expectedSkills] }));
const request = () => ({ adapter: 'engineering.policy.v2', cases: literal.cases.map(row => ({ id: row.id, text: JSON.stringify({ operation: 'financial', paths: row.paths }) })) });

describe('parent-owned financial routing pilot protocol', () => {
  it('binds the explicit v2 identity and deeply freezes independent expectations', () => {
    expect(PILOT_ID).toBe('EV-FOUNDATION-1048-V2');
    expect(ADAPTER_ID).toBe('engineering.policy.v2');
    expect(Object.isFrozen(PILOT)).toBe(true);
    expect(Object.isFrozen(PILOT.cases)).toBe(true);
    for (const row of PILOT.cases) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.expectedSkills)).toBe(true);
    }
  });
  it('sends only exact case identity and normal financial inputs to the child', () => {
    expect(pilotRequest()).toEqual(request());
    expect(JSON.stringify(pilotRequest())).not.toContain('expectedRisk');
    expect(JSON.stringify(pilotRequest())).not.toContain('expectedSkills');
    expect(JSON.stringify(pilotRequest())).not.toContain('authority');
    expect(validateAdapterRequest(request())).toEqual(request());
  });
  it.each([
    ['unknown adapter', (r: ReturnType<typeof request>) => { r.adapter = 'engineering.policy.v1'; }],
    ['missing case', (r: ReturnType<typeof request>) => { r.cases.pop(); }],
    ['duplicate case', (r: ReturnType<typeof request>) => { r.cases[1] = r.cases[0]; }],
    ['unknown case', (r: ReturnType<typeof request>) => { r.cases[0].id = 'BUILDER_CASE'; }],
    ['malformed text', (r: ReturnType<typeof request>) => { r.cases[0].text = '{'; }],
    ['different operation', (r: ReturnType<typeof request>) => { r.cases[0].text = JSON.stringify({ operation: 'shell', paths: literal.cases[0].paths }); }],
    ['changed input path', (r: ReturnType<typeof request>) => { r.cases[0].text = JSON.stringify({ operation: 'financial', paths: ['src/lib/other.ts'] }); }],
    ['path traversal', (r: ReturnType<typeof request>) => { r.cases[0].text = JSON.stringify({ operation: 'financial', paths: ['../outside.ts'] }); }],
    ['authored expected verdict', (r: ReturnType<typeof request>) => { r.cases[0].text = JSON.stringify({ operation: 'financial', paths: literal.cases[0].paths, expectedRisk: 'R2' }); }],
    ['top-level success claim', (r: ReturnType<typeof request>) => { Object.assign(r, { status: 'PASSED' }); }],
  ])('rejects request substitution: %s', (_name, mutate) => {
    const candidate = request(); mutate(candidate);
    expect(() => validateAdapterRequest(candidate)).toThrow();
  });
  it('accepts complete normal values by exact case identity regardless of result order', () => {
    expect(validateObservedValues(values())).toEqual(values());
    const reversed = values().reverse();
    expect(validateObservedValues(reversed)).toEqual(reversed);
  });
  it.each([
    ['missing values', (v: ReturnType<typeof values>) => { v.pop(); }],
    ['duplicate identity', (v: ReturnType<typeof values>) => { v[1] = v[0]; }],
    ['unknown identity', (v: ReturnType<typeof values>) => { v[0].id = 'BUILDER_CASE'; }],
    ['unknown risk', (v: ReturnType<typeof values>) => { v[0].risk = 'SAFE'; }],
    ['unsorted skills', (v: ReturnType<typeof values>) => { v[0].skills.reverse(); }],
    ['duplicate skills', (v: ReturnType<typeof values>) => { v[0].skills.push(v[0].skills[0]); }],
    ['unknown capability', (v: ReturnType<typeof values>) => { v[0].skills = ['execute-shell']; }],
    ['non-string skill', (v: ReturnType<typeof values>) => { Object.assign(v[0], { skills: [1] }); }],
    ['success narrative', (v: ReturnType<typeof values>) => { Object.assign(v[0], { status: 'VERIFIED' }); }],
  ])('rejects malformed or authored-success child output: %s', (_name, mutate) => {
    const candidate = values(); mutate(candidate);
    expect(() => validateObservedValues(candidate)).toThrow();
  });
  it('compares risk and skills separately with every independently frozen assertion ID', () => {
    const assessed = assessPilotValues(values());
    expect(assessed).toEqual([
      { requirement_id: 'EV-FINANCIAL-RISK-ROUTES', test_id: 'financial-risk-routes', status: 'PASSED', assertions: literal.cases.map(row => ({ id: `risk-${row.id}`, status: 'PASSED' })) },
      { requirement_id: 'EV-FINANCIAL-SKILL-ROUTES', test_id: 'financial-skill-routes', status: 'PASSED', assertions: literal.cases.map(row => ({ id: `skills-${row.id}`, status: 'PASSED' })) },
    ]);
  });
  it('does not let passing skills conceal a wrong risk value', () => {
    const candidate = values(); candidate[0].risk = 'R1';
    const assessed = assessPilotValues(candidate);
    expect(assessed.map(row => row.status)).toEqual(['FAILED', 'PASSED']);
    expect(assessed[0].assertions.filter(row => row.status === 'FAILED').map(row => row.id)).toEqual(['risk-FIN-01']);
  });
  it('does not let a passing risk conceal missing required skills', () => {
    const candidate = values(); candidate[0].skills = [];
    const assessed = assessPilotValues(candidate);
    expect(assessed.map(row => row.status)).toEqual(['PASSED', 'FAILED']);
    expect(assessed[1].assertions.filter(row => row.status === 'FAILED').map(row => row.id)).toEqual(['skills-FIN-01']);
  });
});
