// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyChange, routeSkills } from './contract.mjs';
type RouteCase = { id: string; paths: string[]; expectedRisk: 'R0' | 'R1' | 'R2' | 'R3'; expectedSkills: string[]; authority: string };
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/policy-v2.json', import.meta.url), 'utf8')) as { schemaVersion: number; cases: RouteCase[] };

describe('financial-risk-routes', () => {
  it.each(fixture.cases)('risk-$id', row => {
    expect(classifyChange(row.paths).risk_tier).toBe(row.expectedRisk);
  });
});
describe('financial-skill-routes', () => {
  it.each(fixture.cases)('skills-$id', row => {
    expect(routeSkills(row.paths)).toEqual(row.expectedSkills);
  });
});
describe('independent financial fixture identity', () => {
  it('contains unique literal cases and canonical required skills', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(new Set(fixture.cases.map(row => row.id)).size).toBe(fixture.cases.length);
    for (const row of fixture.cases) {
      expect(row.authority.length).toBeGreaterThan(0);
      expect(row.expectedSkills).toEqual([...new Set(row.expectedSkills)].sort());
    }
  });
});

describe('nonfinancial authorization precedence', () => {
  it('keeps the real paid branch-location route at R3 without inventing financial analysis skills', () => {
    expect(classifyChange(['src/app/api/v1/branches/route.ts']).risk_tier).toBe('R3');
  });
});


describe('public regulator ownership boundary controls', () => {
  it('leaves inert regulator documentation at R0 without execution skills', () => {
    const paths = ['src/lib/regulatory/README.md'];
    expect(classifyChange(paths).risk_tier).toBe('R0');
    expect(routeSkills(paths)).toEqual([]);
  });
  it('retains R3 precedence when public regulator work also changes provider authority', () => {
    expect(classifyChange(['src/lib/regulatory/ffiec-call-items.ts', 'src/lib/ai-provider.ts']).risk_tier).toBe('R3');
  });
});


describe('repository execution-input policy sensitivity', () => {
  it.each(['.gitattributes', 'npm-shrinkwrap.json', 'src/lib/.gitattributes'])('marks %s policy-sensitive', path => {
    expect(classifyChange([path]).policy_sensitive).toBe(true);
  });
});
