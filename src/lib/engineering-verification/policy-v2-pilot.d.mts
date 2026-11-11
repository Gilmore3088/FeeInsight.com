import type { RiskTier } from './contract.mjs';

export const PILOT_ID: 'EV-FOUNDATION-1048-V2';
export const ADAPTER_ID: 'engineering.policy.v2';
export const FIXTURE_PATH: URL;
export type FinancialPolicyCase = Readonly<{
  id: string;
  paths: readonly string[];
  expectedRisk: RiskTier;
  expectedSkills: readonly string[];
  authority: string;
}>;
export type FinancialPolicyRequest = {
  adapter: typeof ADAPTER_ID;
  cases: { id: string; text: string }[];
};
export type FinancialPolicyValues = {
  id: string;
  risk: RiskTier;
  skills: string[];
}[];
export type FinancialPolicyOutcome = {
  requirement_id: string;
  test_id: string;
  status: 'PASSED' | 'FAILED';
  assertions: {
    id: string;
    status: 'PASSED' | 'FAILED';
    message?: string;
    observed?: string | string[];
  }[];
};
export const PILOT: Readonly<{
  schemaVersion: 1;
  authority: readonly Readonly<{ path: string; sha256: string; sections: readonly string[] }>[];
  cases: readonly FinancialPolicyCase[];
  requirements: readonly Readonly<{
    id: string;
    test_id: string;
    assertions: readonly Readonly<{ id: string; case_id: string; failure_signature: string }>[];
  }>[];
}>;
export function pilotRequest(): FinancialPolicyRequest;
export function validateAdapterRequest(value: unknown): FinancialPolicyRequest;
export function validateObservedValues(value: unknown): FinancialPolicyValues;
export function assessPilotValues(value: unknown): FinancialPolicyOutcome[];
