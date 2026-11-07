import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

/** Independent synthetic authority: issue #2285, not current bank-source accuracy. */
export const PILOT_ID = 'EV-KNOX-2285';
export const ADAPTER_ID = 'knox.free-specialists.v1';
export const FIXTURE_PATH = new URL('./__fixtures__/knox-2285.json', import.meta.url);
export const PILOT = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

/** Expected values stay in the parent; the source process receives only input text. */
export function pilotRequest() {
  return { adapter: ADAPTER_ID, cases: PILOT.cases.map(({ id, text }) => ({ id, text })) };
}

export function validateAdapterRequest(value) {
  if (!value || value.adapter !== ADAPTER_ID || Object.keys(value).sort().join(',') !== 'adapter,cases'
    || !Array.isArray(value.cases) || !value.cases.length || value.cases.length > 32) throw new Error('Unsupported or malformed adapter request');
  const ids = new Set();
  for (const row of value.cases) {
    if (!row || Object.keys(row).sort().join(',') !== 'id,text' || typeof row.id !== 'string'
      || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id) || ids.has(row.id) || typeof row.text !== 'string'
      || row.text.length > 65536) throw new Error('Malformed adapter case');
    ids.add(row.id);
  }
  return value;
}

const candidate = row => [row.feeName, row.amount, row.canonicalHint];
const held = row => [row.shape, row.feeName, row.amount, row.canonicalHint, row.audience];

/** Malformed output is infrastructure, never behavioral RED. */
export function validateObservedValues(values) {
  if (!Array.isArray(values) || values.length !== PILOT.cases.length) throw new Error('Missing/extra observed cases');
  const ids = new Set();
  for (const row of values) {
    if (!row || Object.keys(row).sort().join(',') !== 'candidates,held,id' || typeof row.id !== 'string' || ids.has(row.id) || !PILOT.cases.some(item => item.id === row.id)
      || !Array.isArray(row.candidates) || !Array.isArray(row.held) || row.candidates.length > 128 || row.held.length > 128) throw new Error('Malformed observed case');
    for (const fee of [...row.candidates, ...row.held]) {
      if (!fee || typeof fee.feeName !== 'string' || fee.feeName.length > 1000 || !Number.isFinite(fee.amount)
        || typeof fee.canonicalHint !== 'string' || !fee.canonicalHint.startsWith('wire_')) throw new Error('Malformed observed fee');
    }
    if (row.held.some(fee => typeof fee.shape !== 'string' || typeof fee.audience !== 'string' || typeof fee.excerpt !== 'string' || fee.excerpt.length > 65536)) throw new Error('Malformed held witness');
    ids.add(row.id);
  }
  return values;
}

/** Parent-owned assertions: child output can describe values, never certify itself. */
export function assessPilotValues(values) {
  validateObservedValues(values);
  return PILOT.requirements.map(requirement => {
    const assertions = requirement.assertions.map(assertion => {
      const actual = values.find(row => row.id === assertion.case_id);
      const expected = PILOT.cases.find(row => row.id === assertion.case_id);
      let passed;
      if (assertion.kind === 'audience-witness') {
        passed = actual.held.length === 2 && actual.held.every(row => row.audience === 'business'
          && row.excerpt.includes(expected.heading) && row.excerpt.includes('$' + row.amount)
          && row.excerpt.toLowerCase().includes(row.canonicalHint.endsWith('_incoming') ? 'incoming' : 'outgoing'));
      } else if (assertion.kind === 'admitted-values') {
        // #2285 promises the admitted own-price pair. Existing untraced diagnostics stay visible.
        passed = isDeepStrictEqual(actual.candidates.map(candidate), expected.candidates)
          && actual.held.every(row => row.shape === 'untraced');
      } else {
        passed = isDeepStrictEqual(actual.candidates.map(candidate), expected.candidates)
          && isDeepStrictEqual(actual.held.map(held), expected.held);
      }
      return { id: assertion.id, status: passed ? 'PASSED' : 'FAILED',
        ...(passed ? {} : { message: assertion.failure_signature, observed: { candidates: actual.candidates.map(candidate), held: actual.held.map(held) } }) };
    });
    return { requirement_id: requirement.id, test_id: requirement.test_id,
      status: assertions.every(assertion => assertion.status === 'PASSED') ? 'PASSED' : 'FAILED', assertions };
  });
}
