// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyChange, mayUseDocsOnlyFastPath } from './contract.mjs';
import { ADAPTER_ID, PILOT, pilotRequest, assessPilotValues, validateObservedValues } from './policy-pilot.mjs';
function currentValues() {
  return pilotRequest().cases.map(({ id, text }: { id: string; text: string }) => {
    const input = JSON.parse(text);
    return { id, value: input.operation === 'risk' ? classifyChange(input.paths).risk_tier : mayUseDocsOnlyFastPath(input.paths) };
  });
}
describe('independent engineering foundation bootstrap pilot', () => {
  it('sends only input data to the child and keeps all expected values in the parent', () => {
    const request = pilotRequest();
    expect(request.adapter).toBe(ADAPTER_ID);
    expect(request.cases).toHaveLength(7);
    expect(request.cases.every((row: object) => Object.keys(row).sort().join(',') === 'id,text')).toBe(true);
    expect(new Set(PILOT.requirements.flatMap((row: { assertions: { case_id: string }[] }) => row.assertions.map(item => item.case_id))).size).toBe(7);
  });
  it('proves the actual current policy behavior with three risk and four shortcut assertions', () => {
    const outcomes = assessPilotValues(currentValues());
    expect(outcomes.map((row: { status: string }) => row.status)).toEqual(['PASSED', 'PASSED']);
    expect(outcomes.map((row: { assertions: unknown[] }) => row.assertions.length)).toEqual([3, 4]);
  });
  it('rejects the historical misclassification and executable-doc shortcut without weakening negative controls', () => {
    const values = currentValues().map((row: { id: string; value: string | boolean }) => row.id === 'executable-doc' ? { ...row, value: true } : ['stripe-webhook', 'provider-access', 'automation-control'].includes(row.id) ? { ...row, value: 'R2' } : row);
    const outcomes = assessPilotValues(values);
    expect(outcomes.map((row: { status: string }) => row.status)).toEqual(['FAILED', 'FAILED']);
    expect(outcomes.flatMap((row: { assertions: { status: string }[] }) => row.assertions).filter((row: { status: string }) => row.status === 'FAILED')).toHaveLength(4);
  });
  it('treats missing values, verdict fields and malformed types as infrastructure failure', () => {
    const values = currentValues();
    expect(() => validateObservedValues(values.slice(1))).toThrow();
    expect(() => validateObservedValues(values.map((row: { id: string; value: string | boolean }) => ({ ...row, status: 'PASSED' })))).toThrow();
    expect(() => validateObservedValues(values.map((row: { id: string; value: string | boolean }) => row.id === 'stripe-webhook' ? { ...row, value: ['R3'] } : row))).toThrow();
    expect(() => validateObservedValues([...values.slice(0, 6), values[0]])).toThrow();
  });
});
