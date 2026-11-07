import { readFileSync } from 'node:fs';

/** Parent-owned PRD authority, deliberately independent of the candidate classifier implementation. */
export const PILOT_ID = 'EV-FOUNDATION-1048';
export const ADAPTER_ID = 'engineering.policy.v1';
export const FIXTURE_PATH = new URL('./__fixtures__/policy-1048.json', import.meta.url);
export const PILOT = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

export function pilotRequest() {
  return { adapter: ADAPTER_ID, cases: PILOT.cases.map(({ id, text }) => ({ id, text })) };
}
export function validateAdapterRequest(value) {
  if (!value || value.adapter !== ADAPTER_ID || Object.keys(value).sort().join(',') !== 'adapter,cases' || !Array.isArray(value.cases) || value.cases.length !== PILOT.cases.length) throw new Error('Unsupported policy adapter request');
  const ids = new Set();
  for (const row of value.cases) {
    if (!row || Object.keys(row).sort().join(',') !== 'id,text' || typeof row.id !== 'string' || ids.has(row.id) || !PILOT.cases.some(item => item.id === row.id) || typeof row.text !== 'string' || row.text.length > 65536) throw new Error('Malformed policy adapter case');
    const input = JSON.parse(row.text);
    if (!input || Object.keys(input).sort().join(',') !== 'operation,paths' || !['risk', 'docs'].includes(input.operation) || !Array.isArray(input.paths) || input.paths.length !== 1 || input.paths.some(path => typeof path !== 'string' || path.length > 1024)) throw new Error('Malformed policy operation');
    ids.add(row.id);
  }
  return value;
}
export function validateObservedValues(values) {
  if (!Array.isArray(values) || values.length !== PILOT.cases.length) throw new Error('Missing/extra observed policy cases');
  const ids = new Set();
  for (const row of values) {
    const expected = PILOT.cases.find(item => item.id === row?.id);
    if (!row || Object.keys(row).sort().join(',') !== 'id,value' || typeof row.id !== 'string' || ids.has(row.id) || !expected || (typeof expected.value === 'boolean' ? typeof row.value !== 'boolean' : typeof row.value !== 'string' || !['R0', 'R1', 'R2', 'R3'].includes(row.value))) throw new Error('Malformed observed policy case');
    ids.add(row.id);
  }
  return values;
}
export function assessPilotValues(values) {
  validateObservedValues(values);
  return PILOT.requirements.map(requirement => {
    const assertions = requirement.assertions.map(assertion => {
      const actual = values.find(row => row.id === assertion.case_id);
      const expected = PILOT.cases.find(row => row.id === assertion.case_id);
      const passed = actual.value === expected.value;
      return { id: assertion.id, status: passed ? 'PASSED' : 'FAILED', ...(passed ? {} : { message: assertion.failure_signature, observed: actual.value }) };
    });
    return { requirement_id: requirement.id, test_id: requirement.test_id, status: assertions.every(assertion => assertion.status === 'PASSED') ? 'PASSED' : 'FAILED', assertions };
  });
}
