export interface PilotAssertion { id: string; status: 'PASSED' | 'FAILED'; message?: string; observed?: unknown }
export interface PilotOutcome { requirement_id: string; test_id: string; status: 'PASSED' | 'FAILED'; assertions: PilotAssertion[] }
export const PILOT_ID: string;
export const ADAPTER_ID: string;
export const FIXTURE_PATH: URL;
export const PILOT: { requirements: Array<{ id: string; test_id: string; assertions: Array<{id: string}> }> };
export function pilotRequest(): { adapter: string; cases: Array<{ id: string; text: string }> };
export function validateAdapterRequest(value: unknown): ReturnType<typeof pilotRequest>;
export function validateObservedValues(value: unknown): unknown;
export function assessPilotValues(values: unknown): PilotOutcome[];
