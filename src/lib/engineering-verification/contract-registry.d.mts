export type ContractRevision = Readonly<{
  key: '1048' | '2285' | '1048-v2';
  path: string;
  contractId: string;
  issueNumber: number;
  executionStatus: 'CURRENT' | 'HISTORICAL_ONLY';
  adapter: 'engineering.policy.v1' | 'knox.free-specialists.v1' | 'engineering.policy.v2';
  historicalWorkflowSha256: string | null;
  requiredProofInputs: readonly string[];
  forbiddenProofInputs: readonly string[];
  historicalTrustedSourceRefs: readonly string[];
}>;
export const CONTRACT_REVISIONS: readonly ContractRevision[];
export function resolveContractRevision(key: unknown, options?: { requireRunnable?: boolean }): ContractRevision;
export function parseContractMarker(body: unknown): ContractRevision;
