// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assessPilotValues, pilotRequest, validateAdapterRequest, validateObservedValues } from './pilot.mjs';
import { runFreeSpecialists } from '@/lib/agents/knox/specialists';
import { feeApplicability } from '@/lib/fee-audience';

describe('independent Knox #2285 acceptance seam', () => {
  it('detects the historical own-price defect from returned values, never a child verdict', () => {
    const values = pilotRequest().cases.map(({ id }) => ({ id, candidates: [{ feeName: 'Incoming Wires', amount: 10, canonicalHint: 'wire_domestic_incoming' }], held: [] }));
    const outcomes = assessPilotValues(values);
    expect(outcomes.find(row => row.test_id === 'knox-2285-business-heading-own-price')?.status).toBe('FAILED');
    expect(outcomes.flatMap(row => row.assertions).filter(row => row.status === 'FAILED').map(row => row.id)).toContain('business-own-price');
  });

  it('passes every frozen assertion against the actual current extraction seam', () => {
    const values = pilotRequest().cases.map(({ id, text }) => {
      const result = runFreeSpecialists(text);
      return { id,
        candidates: result.candidates.filter(row => row.canonicalHint?.startsWith('wire_')).map(({ feeName, amount, canonicalHint }) => ({ feeName, amount, canonicalHint })),
        held: result.held.filter(row => row.canonicalHint?.startsWith('wire_')).map(row => ({ ...row, audience: feeApplicability(row.feeName, row.excerpt, row.amount).feeAudience })),
      };
    });
    expect(assessPilotValues(values).flatMap(row => row.assertions).filter(row => row.status !== 'PASSED')).toEqual([]);
  });

  it('rejects unknown adapters and commands while keeping source text literal', () => {
    expect(validateAdapterRequest(pilotRequest()).cases.at(-1)?.text).toContain('$(touch');
    expect(() => validateAdapterRequest({ ...pilotRequest(), adapter: 'shell' })).toThrow();
    expect(() => validateAdapterRequest({ ...pilotRequest(), command: 'echo PASSED' })).toThrow();
    expect(() => validateAdapterRequest({ ...pilotRequest(), cases: [pilotRequest().cases[0], pilotRequest().cases[0]] })).toThrow();
  });

  it('refuses missing, duplicate or child-certified evidence as setup failure', () => {
    expect(() => validateObservedValues([])).toThrow();
    const rows = pilotRequest().cases.map(({ id }) => ({ id, candidates: [], held: [] }));
    expect(() => assessPilotValues(rows.map(row => ({ ...row, status: 'PASSED' })))).toThrow();
    expect(() => validateObservedValues(rows.map(() => rows[0]))).toThrow();
  });
});
