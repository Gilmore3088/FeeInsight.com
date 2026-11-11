export interface ProofCollection {
  schemaVersion: number;
  repository: string;
  prNumber: number;
  headSha: string;
  contractKey: string | null;
  executionStatus: 'CURRENT' | 'HISTORICAL_ONLY' | null;
  currentCodeVerified: boolean;
  observedAt: string;
  provenance: { kind: 'test-transport-untrusted' | 'authenticated-github-proof-artifact' };
  run: Record<string, unknown> | null;
  artifact: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  validation: { status: 'PASSED' | 'BLOCKED'; problems: string[] };
  status: 'VERIFIED' | 'HISTORICAL_VERIFIED' | 'BLOCKED';
}
export function validateRevisionContract(revision: unknown, contract: unknown, contractRaw: string): { ok: boolean; errors: string[] };
export function expectedWorkflowDigest(revision: unknown, contract: unknown): string;
export function assertNativeContractPath(revision: unknown, ref: string, get: (path: string) => Promise<unknown>, cache?: Map<string, Promise<unknown>>): Promise<string>;
export function assertNativeSourcePath(path: string, ref: string, get: (path: string) => Promise<unknown>, cache?: Map<string, Promise<unknown>>): Promise<string>;
export function assertNativeProofSource(revision: unknown, ref: string, get: (path: string) => Promise<unknown>, cache?: Map<string, Promise<unknown>>): Promise<void>;
export function collectProofEvidence(options: {
  github: unknown;
  contract: unknown;
  contractRaw: string;
  contractKey?: string;
  token: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<ProofCollection>;
export function isCollectedProof(value: unknown): boolean;
export function assessCollectedProof(snapshot: unknown, options?: { now?: Date }): {
  status: 'VERIFIED' | 'HISTORICAL_VERIFIED' | 'BLOCKED';
  currentCodeVerified: boolean;
  contractKey: string | null;
  blockers: string[];
  runId: number | null;
  runAttempt: number | null;
  artifactId: number | null;
  artifactDigest: string | null;
};
