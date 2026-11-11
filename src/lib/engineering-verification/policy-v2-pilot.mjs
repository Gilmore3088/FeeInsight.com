import { readFileSync } from 'node:fs';

export const PILOT_ID = 'EV-FOUNDATION-1048-V2';
export const ADAPTER_ID = 'engineering.policy.v2';
export const FIXTURE_PATH = new URL('./__fixtures__/policy-v2.json', import.meta.url);
const RECORD = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, keys) => RECORD(value) && Object.keys(value).sort().join(',') === keys;
const boundedText = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
const CASE_ID = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/;
const TIERS = new Set(['R0', 'R1', 'R2', 'R3']);
const SKILLS = new Set([
  'adversarial-document-testing', 'audit-data', 'data-quality-audit', 'diagnosing-bugs',
  'error-to-test', 'fee-evaluation', 'fee-taxonomy-regression', 'recover', 'report-reconciliation',
  'source-evidence-audit', 'supabase', 'supabase-postgres-best-practices', 'tdd',
  'buyer-journey-mapper', 'ux-ui-auditor', 'playwright-ux-simulator',
]);
const validPaths = value => Array.isArray(value) && value.length > 0 && value.length <= 16
  && value.every(path => boundedText(path, 1024));
const validSkills = value => Array.isArray(value) && value.length <= SKILLS.size
  && value.every((skill, index) => typeof skill === 'string' && SKILLS.has(skill) && (index === 0 || value[index - 1] < skill));
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const raw = readFileSync(FIXTURE_PATH, 'utf8');
if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Policy-v2 fixture exceeds bound');
const fixture = JSON.parse(raw);
if (!keysAre(fixture, 'authority,cases,schemaVersion') || fixture.schemaVersion !== 1
  || !Array.isArray(fixture.authority) || !fixture.authority.length || fixture.authority.length > 16
  || fixture.authority.some(source => !keysAre(source, 'path,sections,sha256') || !boundedText(source.path, 1024)
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Array.isArray(source.sections) || !source.sections.length || source.sections.length > 32
    || source.sections.some(section => !boundedText(section, 120)))
  || !Array.isArray(fixture.cases) || !fixture.cases.length || fixture.cases.length > 64) throw new Error('Malformed policy-v2 fixture');
const ids = new Set();
for (const row of fixture.cases) {
  if (!keysAre(row, 'authority,expectedRisk,expectedSkills,id,paths') || typeof row.id !== 'string'
    || !CASE_ID.test(row.id) || ids.has(row.id) || !validPaths(row.paths) || !TIERS.has(row.expectedRisk)
    || !validSkills(row.expectedSkills) || !boundedText(row.authority, 4096)) throw new Error('Malformed policy-v2 fixture case');
  ids.add(row.id);
}

/** Independent literals remain in the parent; source processes return values, never expected answers. */
export const PILOT = freeze({
  ...fixture,
  requirements: [
    { id: 'EV-FINANCIAL-RISK-ROUTES', test_id: 'financial-risk-routes', assertions: fixture.cases.map(row => ({
      id: 'risk-' + row.id, case_id: row.id, failure_signature: 'Financial risk requirement differs: ' + row.id,
    })) },
    { id: 'EV-FINANCIAL-SKILL-ROUTES', test_id: 'financial-skill-routes', assertions: fixture.cases.map(row => ({
      id: 'skills-' + row.id, case_id: row.id, failure_signature: 'Financial specialist requirement differs: ' + row.id,
    })) },
  ],
});

export function pilotRequest() {
  return { adapter: ADAPTER_ID, cases: PILOT.cases.map(row => ({ id: row.id, text: JSON.stringify({ operation: 'financial', paths: row.paths }) })) };
}

export function validateAdapterRequest(value) {
  if (!keysAre(value, 'adapter,cases') || value.adapter !== ADAPTER_ID || !Array.isArray(value.cases)
    || value.cases.length !== PILOT.cases.length) throw new Error('Unsupported policy-v2 adapter request');
  const seen = new Set();
  for (const row of value.cases) {
    const expected = PILOT.cases.find(item => item.id === row?.id);
    if (!keysAre(row, 'id,text') || !expected || seen.has(row.id) || !boundedText(row.text, 65536)) throw new Error('Malformed policy-v2 adapter case');
    const input = JSON.parse(row.text);
    if (!keysAre(input, 'operation,paths') || input.operation !== 'financial' || !validPaths(input.paths)
      || JSON.stringify(input.paths) !== JSON.stringify(expected.paths)) throw new Error('Malformed policy-v2 operation');
    seen.add(row.id);
  }
  return value;
}

export function validateObservedValues(values) {
  if (!Array.isArray(values) || values.length !== PILOT.cases.length) throw new Error('Missing/extra observed policy-v2 cases');
  const seen = new Set();
  for (const row of values) {
    if (!keysAre(row, 'id,risk,skills') || typeof row.id !== 'string' || !ids.has(row.id) || seen.has(row.id)
      || !TIERS.has(row.risk) || !validSkills(row.skills)) throw new Error('Malformed observed policy-v2 case');
    seen.add(row.id);
  }
  return values;
}

export function assessPilotValues(values) {
  validateObservedValues(values);
  return PILOT.requirements.map(requirement => {
    const risk = requirement.id === 'EV-FINANCIAL-RISK-ROUTES';
    const assertions = requirement.assertions.map(assertion => {
      const actual = values.find(row => row.id === assertion.case_id);
      const expected = PILOT.cases.find(row => row.id === assertion.case_id);
      const passed = risk ? actual.risk === expected.expectedRisk
        : JSON.stringify(actual.skills) === JSON.stringify(expected.expectedSkills);
      return { id: assertion.id, status: passed ? 'PASSED' : 'FAILED', ...(passed ? {} : {
        message: assertion.failure_signature, observed: risk ? actual.risk : actual.skills,
      }) };
    });
    return { requirement_id: requirement.id, test_id: requirement.test_id,
      status: assertions.every(assertion => assertion.status === 'PASSED') ? 'PASSED' : 'FAILED', assertions };
  });
}
